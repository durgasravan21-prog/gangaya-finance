// Gangaya Finance - UPI Auto-Verification Webhook Endpoint
// Ingests bank SMS / Push forwarder / UPI credit notifications into Supabase.

function parseBankSms(text) {
  if (!text || typeof text !== 'string') return null;
  const str = text.replace(/,/g, '');

  // 1. Amount Extraction (Rs. 1000, Rs 1000.00, INR 1000, credited by/with Rs 1000)
  let amt = null;
  const amtMatch = str.match(/(?:Rs\.?|INR)\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
    || str.match(/credited\s*(?:with|by|for)?\s*(?:Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i)
    || str.match(/received\s*(?:Rs\.?|INR)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);

  if (amtMatch && amtMatch[1]) {
    amt = parseFloat(amtMatch[1]);
  }

  // 2. 12-digit UTR / UPI Reference Number Extraction
  let utr = null;
  const utrMatch = str.match(/(?:UPI(?:\/|-|\s*Ref:?\s*)|Ref(?:\s*No\.?)?:?\s*|UTR:?\s*)([0-9]{12})/i)
    || str.match(/\b([0-9]{12})\b/);

  if (utrMatch && utrMatch[1]) {
    utr = utrMatch[1];
  }

  // 3. Payer Name Extraction (e.g. UPI/430291827361/Ravi Kumar/ or from Ravi Kumar)
  let payer = '';
  const payerMatch = str.match(/UPI\/[0-9]{12}\/([^\/]+)\//i)
    || str.match(/(?:from|by)\s+([A-Za-z\s]{3,30})(?:\s+(?:on|via|Ref|A\/C|\.|\,)|$)/i);

  if (payerMatch && payerMatch[1]) {
    payer = payerMatch[1].trim().replace(/\s+/g, ' ');
  }

  if (amt && amt > 0 && utr && utr.length >= 6) {
    return { amt, utr, payer, raw: text };
  }
  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-webhook-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      service: 'Gangaya Finance UPI Auto-Verify Engine',
      status: 'active',
      methods_supported: ['JSON payload', 'Bank SMS Forwarder', 'UTR auto-matching'],
      timestamp: Date.now()
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { SUPABASE_URL: U, SUPABASE_ANON_KEY: K } = process.env;
  if (!U || !K) {
    return res.status(503).json({ ok: false, error: 'Database environment missing' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    body = body || {};

    let amt = null, utr = null, payer = '', raw = '';

    // Direct structured input
    if (body.amt && body.utr) {
      amt = parseFloat(body.amt);
      utr = String(body.utr).trim();
      payer = String(body.payer || body.mname || '').trim();
      raw = String(body.raw || body.message || 'Direct API Ingestion');
    } else {
      // Parse SMS text from message/body/text field
      const smsText = String(body.message || body.text || body.body || body.content || body.sms || '');
      const parsed = parseBankSms(smsText);
      if (!parsed) {
        return res.status(400).json({
          ok: false,
          error: 'Could not extract valid UPI amount and 12-digit UTR from message',
          received: smsText.slice(0, 100)
        });
      }
      amt = parsed.amt;
      utr = parsed.utr;
      payer = parsed.payer;
      raw = parsed.raw;
    }

    if (!amt || amt <= 0 || !utr || utr.length < 6) {
      return res.status(400).json({ ok: false, error: 'Invalid amount or UTR' });
    }

    // Call PostgreSQL RPC ingest_upi_payment with atomic transaction & deduplication
    const rpcRes = await fetch(U + '/rest/v1/rpc/ingest_upi_payment', {
      method: 'POST',
      headers: {
        'apikey': K,
        'Authorization': 'Bearer ' + K,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_amt: amt,
        p_utr: utr,
        p_payer: payer,
        p_raw: raw
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      return res.status(502).json({ ok: false, error: 'Database ingestion failed: ' + errText });
    }

    const result = await rpcRes.json();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err && err.message) || 'Internal server error' });
  }
};
