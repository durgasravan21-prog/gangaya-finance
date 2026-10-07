// English name -> Telugu name transliteration.
// Uses Google Input Tools (Telugu) with fallback to Anthropic if key configured.
const TE = /[\u0C00-\u0C7F]/;

async function transliterateGoogle(text) {
  try {
    const parts = text.trim().split(/\s+/);
    const results = [];
    for (const p of parts) {
      if (!p) continue;
      // If already Telugu, keep as is
      if (TE.test(p)) {
        results.push(p);
        continue;
      }
      const res = await fetch(`https://inputtools.google.com/request?text=${encodeURIComponent(p)}&itc=te-t-i0-und&num=1`);
      if (res.ok) {
        const data = await res.json();
        if (data && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1] && data[1][0][1][0]) {
          results.push(data[1][0][1][0]);
          continue;
        }
      }
      results.push(p);
    }
    const combined = results.join(' ');
    if (TE.test(combined)) return combined;
  } catch (e) {}
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K, ANTHROPIC_API_KEY: A } = process.env;
  if (!U || !K) return res.status(503).json({ error: 'database not configured' });
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tok) return res.status(401).json({ error: 'auth' });
  const name = String((req.body && req.body.name) || '').trim();
  if (!name || name.length > 60 || !/^[\p{L}\p{M}\s.'-]+$/u.test(name)) return res.status(400).json({ error: 'name' });
  
  try {
    const u = await fetch(U + '/auth/v1/user', { headers: { apikey: K, Authorization: 'Bearer ' + tok } });
    if (!u.ok) return res.status(401).json({ error: 'auth' });
    const user = await u.json();
    const p = await fetch(U + '/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(user.id), { headers: { apikey: K, Authorization: 'Bearer ' + tok } });
    const rows = await p.json();
    if (!Array.isArray(rows) || !rows[0] || rows[0].role !== 'admin') return res.status(403).json({ error: 'forbidden' });

    // 1. Google Input Tools transliteration (free, fast, no external API key needed)
    const googleResult = await transliterateGoogle(name);
    if (googleResult) {
      return res.status(200).json({ te: googleResult });
    }

    // 2. Anthropic fallback if configured
    if (A) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': A, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 60,
          system: 'You transliterate Indian person and village names from English letters into Telugu script. Reply with only the Telugu text, nothing else.',
          messages: [{ role: 'user', content: name }]
        })
      });
      if (r.ok) {
        const j = await r.json();
        const t = String((j.content && j.content[0] && j.content[0].text) || '').trim().split('\n')[0].slice(0, 60);
        if (TE.test(t)) return res.status(200).json({ te: t });
      }
    }

    return res.status(200).json({ te: name });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
