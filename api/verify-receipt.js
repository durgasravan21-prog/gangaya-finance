// Gangaya Finance - Public Receipt Verification API
// Serves standalone verified receipt data for Google Lens & phone camera QR scans

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let rawId = (req.query.id || req.query.vr || req.query.r || req.query.receipt || '').trim();
  if (!rawId) {
    return res.status(400).json({ ok: false, error: 'Receipt ID required' });
  }

  if (rawId.includes('vr=') || rawId.includes('r=') || rawId.includes('receipt=')) {
    const match = rawId.match(/[?&](?:vr|r|receipt)=([^&#]+)/);
    if (match) rawId = decodeURIComponent(match[1]);
  }
  const cleanId = rawId.replace(/^GF-/i, '').trim();

  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = process.env;
  const url = U || 'https://digmxlceoejepixflqnh.supabase.co';
  const key = K || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ214bGNlb2VqZXBpeGZscW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAyNTMsImV4cCI6MjEwNjkxNjI1M30.LK3l8h7EnWcsKTzEJrRC-r7z9GY2UKThUQ8bmmCXwkk';

  try {
    const resp = await fetch(`${url}/rest/v1/rpc/get_verified_receipt`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ p_id: cleanId }),
      signal: AbortSignal.timeout(6000)
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || 'Verification RPC failed');
    }

    const data = await resp.json();
    if (!data || !data.ok) {
      return res.status(404).json(data || { ok: false, error: 'Receipt not found' });
    }

    // Strip borrower phone number for public privacy
    if (data.m) {
      delete data.m.phone;
    }
    if (data.t) {
      delete data.t.phone;
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Lookup error' });
  }
};
