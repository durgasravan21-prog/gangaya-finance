// Public settings the browser needs (the anon key is designed to be public; Row Level Security protects the data).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400');
  res.status(200).json({ url: process.env.SUPABASE_URL || '', anonKey: process.env.SUPABASE_ANON_KEY || '' });
};
