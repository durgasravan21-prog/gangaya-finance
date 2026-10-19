// Keepalive endpoint to ping Supabase and prevent it from pausing due to inactivity
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = process.env;
  if (!U || !K) return res.status(500).json({ ok: false, error: 'env missing' });

  try {
    const r = await fetch(U + '/rest/v1/rpc/health_check', {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, status: r.status, statusText: r.statusText });
    }
    const text = await r.text();
    return res.status(200).json({ ok: true, result: text, timestamp: Date.now() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
