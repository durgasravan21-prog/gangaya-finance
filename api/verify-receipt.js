// Gangaya Finance - Public Receipt Verification API
// Serves standalone verified receipt data for Google Lens & phone camera QR scans

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const id = (req.query.id || req.query.vr || req.query.r || '').trim();
  if (!id) {
    return res.status(400).json({ ok: false, error: 'Receipt ID required' });
  }

  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = process.env;
  const url = U || 'https://digmxlceoejepixflqnh.supabase.co';
  const key = K || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ214bGNlb2VqZXBpeGZscW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAyNTMsImV4cCI6MjEwNjkxNjI1M30.LK3l8h7EnWcsKTzEJrRC-r7z9GY2UKThUQ8bmmCXwkk';

  try {
    const cleanId = id.replace(/^GF-/i, '');
    const resp = await fetch(`${url}/rest/v1/docs?collection=eq.txns&select=id,data`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000)
    });
    if (!resp.ok) throw new Error('Database lookup failed');
    const docs = await resp.json();
    const match = (Array.isArray(docs) ? docs : []).find(d => d.id === cleanId || d.id.startsWith(cleanId) || (d.data && d.data.id === cleanId));
    if (!match) {
      return res.status(404).json({ ok: false, error: 'Receipt not found' });
    }
    const t = { id: match.id, ...(match.data || {}) };

    // Fetch member
    let m = {};
    if (t.mid) {
      const mResp = await fetch(`${url}/rest/v1/docs?collection=eq.members&id=eq.${t.mid}&select=id,data`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(6000)
      });
      if (mResp.ok) {
        const mDocs = await mResp.json();
        if (mDocs && mDocs[0]) m = { id: mDocs[0].id, ...(mDocs[0].data || {}) };
      }
    }

    return res.status(200).json({ ok: true, t, m });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Lookup error' });
  }
};
