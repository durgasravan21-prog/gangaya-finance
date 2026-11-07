// Keepalive endpoint to ping Supabase and prevent it from pausing due to inactivity
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Verify caller: allow Vercel Cron or bearer secret if configured
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1' || (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (cronSecret && !isVercelCron) {
    return res.status(401).json({ ok: false, error: 'Unauthorized cron trigger' });
  }

  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = process.env;
  if (!U || !K) return res.status(503).json({ ok: false, error: 'Database environment missing' });

  try {
    const r = await fetch(U + '/rest/v1/rpc/health_check', {
      method: 'POST',
      headers: { apikey: K, Authorization: 'Bearer ' + K },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      return res.status(502).json({ ok: false, status: r.status });
    }
    return res.status(200).json({ ok: true, timestamp: Date.now() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Keepalive ping failed' });
  }
};
