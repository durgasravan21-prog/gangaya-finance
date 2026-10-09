// English name -> Telugu name (admin only).
//  1) Claude, if ANTHROPIC_API_KEY is set: best spelling for Indian names and villages.
//  2) Google Input Tools: free fallback that needs no key.
const TE = /[\u0C00-\u0C7F]/;

async function transliterateGoogle(text) {
  try {
    const parts = text.trim().split(/\s+/);
    const results = [];
    for (const p of parts) {
      if (!p) continue;
      if (TE.test(p)) { results.push(p); continue; }
      const res = await fetch(`https://inputtools.google.com/request?text=${encodeURIComponent(p)}&itc=te-t-i0-und&num=1`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        if (data && data[0] === 'SUCCESS' && data[1] && data[1][0] && data[1][0][1] && data[1][0][1][0]) { results.push(data[1][0][1][0]); continue; }
      }
      return null;
    }
    const combined = results.join(' ');
    if (TE.test(combined)) return combined;
  } catch (e) {}
  return null;
}

async function transliterateClaude(name, key) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: 'claude-sonnet-5-5', max_tokens: 80,
        system: 'You write Indian person names and village or town names, given in English letters, in Telugu script exactly as a Telugu speaker would spell them (phonetic transliteration, never a translation). Keep every word and the word order. Use the standard Telugu spelling for common names, for example: Ravi=రవి, Sravan=శ్రావణ్, Srinivas=శ్రీనివాస్, Lakshmi=లక్ష్మి, Venkata=వెంకట, Krishna=కృష్ణ, Sridevi=శ్రీదేవి, Challagolla=చల్లగొల్ల, Gudivada=గుడివాడ, Vijayawada=విజయవాడ, Pamarru=పామర్రు. Reply with only the Telugu text on one line, nothing else.',
        messages: [{ role: 'user', content: name }]
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    const t = String((j.content && j.content[0] && j.content[0].text) || '').trim().split('\n')[0].slice(0, 60);
    return TE.test(t) ? t : null;
  } catch (e) { return null; }
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
    if (!Array.isArray(rows) || !rows[0] || !['admin', 'collector'].includes(rows[0].role)) return res.status(403).json({ error: 'forbidden' });
    let te = A ? await transliterateClaude(name, A) : null;
    if (!te) te = await transliterateGoogle(name);
    if (!te) return res.status(502).json({ error: 'no transliteration' });
    return res.status(200).json({ te });
  } catch (e) {
    return res.status(500).json({ error: 'server error' });
  }
};
