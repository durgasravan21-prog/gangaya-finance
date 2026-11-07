// Public settings the browser needs (the anon key is designed to be public; Row Level Security protects the data).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.status(200).json({ url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '' });
};
