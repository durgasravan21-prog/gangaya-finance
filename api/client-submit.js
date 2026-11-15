// Gangaya Finance - Unified Client Submission & Admin Sync Serverless API
// Reliably ingests, persists, and synchronizes Customer Support messages,
// Bug Reports, Personal Details / KYC, Payment Proofs, Digital Agreements, and Loan Applications.

const rateMap = new Map();
function checkRate(ip, maxReq = 60) {
  const now = Date.now();
  const rec = rateMap.get(ip) || { count: 0, reset: now + 60000 };
  if (now > rec.reset) { rec.count = 1; rec.reset = now + 60000; }
  else { rec.count++; }
  rateMap.set(ip, rec);
  return rec.count <= maxReq;
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://digmxlceoejepixflqnh.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ214bGNlb2VqZXBpeGZscW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAyNTMsImV4cCI6MjEwNjkxNjI1M30.LK3l8h7EnWcsKTzEJrRC-r7z9GY2UKThUQ8bmmCXwkk';
const authKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ANON_KEY;

// In-Memory Edge Store for Zero-RLS Server Sync fallback
let serverStore = {
  support: [],
  bugs: [],
  profiles: [],
  receipts: [],
  agreements: [],
  loan_requests: [],
  notifs: []
};

// Helper to write directly to Supabase docs table
async function trySupabaseWrite(collection, id, data) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/docs`, {
      method: 'POST',
      headers: {
        'apikey': authKey,
        'Authorization': `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify({ collection, id, data }),
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

// Helper to fetch single doc from Supabase docs table
async function getExistingDoc(collection, id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/docs?select=data&collection=eq.${collection}&id=eq.${encodeURIComponent(id)}`, {
      headers: {
        'apikey': authKey,
        'Authorization': `Bearer ${authKey}`
      },
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const rows = await res.json();
      if (rows && rows[0] && rows[0].data) return rows[0].data;
    }
  } catch (_) {}
  return null;
}

// Helper to fetch live from Supabase docs table
async function fetchSupabaseCollections() {
  try {
    const cols = 'client_support,client_bugs,client_profiles,client_agreements,client_receipts,loan_requests,notifs';
    const res = await fetch(`${SUPABASE_URL}/rest/v1/docs?select=collection,id,data&collection=in.(${cols})&order=created_at.desc&limit=1000`, {
      headers: {
        'apikey': authKey,
        'Authorization': `Bearer ${authKey}`
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const result = {
      support: [],
      bugs: [],
      profiles: [],
      receipts: [],
      agreements: [],
      loan_requests: [],
      notifs: []
    };
    for (const r of rows) {
      const d = r.data || {};
      d.id = r.id || d.id;
      if (r.collection === 'client_support') result.support.push(d);
      else if (r.collection === 'client_bugs') result.bugs.push(d);
      else if (r.collection === 'client_profiles') result.profiles.push(d);
      else if (r.collection === 'client_receipts') result.receipts.push(d);
      else if (r.collection === 'client_agreements') result.agreements.push(d);
      else if (r.collection === 'loan_requests') result.loan_requests.push(d);
      else if (r.collection === 'notifs') result.notifs.push(d);
    }
    return result;
  } catch (_) {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRate(ip)) {
    return res.status(429).json({ ok: false, error: 'Rate limit exceeded. Please wait 1 minute.' });
  }

  function isTestRecord(x) {
    if (!x) return true;
    const s = ((x.id || '') + ' ' + (x.mid || '') + ' ' + (x.name || '') + ' ' + (x.borrower || '') + ' ' + (x.phone || '')).toLowerCase();
    return s.includes('m_test') || s.includes('test user') || s.includes('test_write');
  }

  // -------------------------------------------------------------
  // GET: Fetch Submissions (for Admin and Client synchronization)
  // -------------------------------------------------------------
  if (req.method === 'GET') {
    const role = (req.query.role || '').trim();
    const mid = (req.query.mid || '').trim();
    const qEmail = (req.query.email || '').toLowerCase().trim();
    const qName = (req.query.name || '').toLowerCase().trim();

    // Query live from Supabase docs table
    const remote = await fetchSupabaseCollections();

    function mergeLists(remoteList, localList) {
      const map = new Map();
      (remoteList || []).forEach(x => { if (x && x.id && !isTestRecord(x)) map.set(x.id, x); });
      (localList || []).forEach(x => { if (x && x.id && !map.has(x.id) && !isTestRecord(x)) map.set(x.id, x); });
      return Array.from(map.values()).sort((a,b) => (b.ts || 0) - (a.ts || 0));
    }

    const merged = {
      support: mergeLists(remote?.support, serverStore.support),
      bugs: mergeLists(remote?.bugs, serverStore.bugs),
      profiles: mergeLists(remote?.profiles, serverStore.profiles),
      receipts: mergeLists(remote?.receipts, serverStore.receipts),
      agreements: mergeLists(remote?.agreements, serverStore.agreements),
      loan_requests: mergeLists(remote?.loan_requests, serverStore.loan_requests),
      notifs: mergeLists(remote?.notifs, serverStore.notifs)
    };

    // If Admin: return full sets across all collections
    if (role === 'admin' || role === 'a') {
      return res.status(200).json({
        ok: true,
        ...merged,
        timestamp: Date.now()
      });
    }

    // If Client: return items matching borrower's mid, phone, email, or name
    function matchBorrower(x) {
      if (!x) return false;
      if (mid && (x.mid === mid || (x.phone && x.phone.includes(mid)) || (x.id && x.id.includes(mid)))) return true;
      if (qEmail && (x.email === qEmail || (x.mid && qEmail.includes(x.mid)))) return true;
      if (qName && x.borrower && x.borrower.toLowerCase() === qName) return true;
      return false;
    }

    return res.status(200).json({
      ok: true,
      support: merged.support.filter(matchBorrower),
      bugs: merged.bugs.filter(matchBorrower),
      profiles: merged.profiles.filter(matchBorrower),
      receipts: merged.receipts.filter(matchBorrower),
      agreements: merged.agreements.filter(matchBorrower),
      loan_requests: merged.loan_requests.filter(matchBorrower),
      timestamp: Date.now()
    });
  }

  // -------------------------------------------------------------
  // POST: Ingest Client Submissions & Admin Actions
  // -------------------------------------------------------------
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }
    body = body || {};

    const action = body.action || '';

    if (isTestRecord(body) && action !== 'verify_email') {
      return res.status(200).json({ ok: true, message: 'Test submission ignored' });
    }

    // 1. Customer Support Message Submission
    if (action === 'submit_support') {
      const msgText = String(body.msg || '').slice(0, 500).trim();
      if (!msgText || msgText.length < 3) {
        return res.status(400).json({ ok: false, error: 'Valid message text required' });
      }
      const item = {
        id: body.id || ('cs_' + Date.now()),
        mid: String(body.mid || 'guest').trim(),
        borrower: String(body.borrower || 'Customer').slice(0, 60),
        village: String(body.village || '').slice(0, 60),
        phone: String(body.phone || '').slice(0, 20),
        topic: String(body.topic || 'General').slice(0, 40),
        msg: msgText,
        reply: '',
        status: 'open',
        ts: Date.now()
      };
      serverStore.support.unshift(item);
      if (serverStore.support.length > 200) serverStore.support.pop();

      // Create Admin Alert Notification
      const notif = {
        id: 'n_cs_' + Date.now(),
        type: 'client_support',
        mid: item.mid,
        mname: item.borrower,
        text: `Customer Support [${item.topic}] from ${item.borrower}: ${item.msg}`,
        ts: Date.now(),
        read: false
      };
      serverStore.notifs.unshift(notif);

      await Promise.all([
        trySupabaseWrite('client_support', item.id, item),
        trySupabaseWrite('notifs', notif.id, notif)
      ]);

      return res.status(200).json({ ok: true, message: 'Support message delivered to Admin successfully', item });
    }

    // 2. Technical Bug Report Submission
    if (action === 'submit_bug') {
      const desc = String(body.description || body.desc || '').slice(0, 600).trim();
      if (!desc || desc.length < 5) {
        return res.status(400).json({ ok: false, error: 'Detailed bug description required' });
      }
      const item = {
        id: body.id || ('bug_' + Date.now()),
        mid: String(body.mid || 'guest').trim(),
        borrower: String(body.borrower || 'Customer').slice(0, 60),
        village: String(body.village || '').slice(0, 60),
        phone: String(body.phone || '').slice(0, 20),
        category: String(body.category || 'Other').slice(0, 40),
        description: desc,
        diagnostics: body.diagnostics || {},
        photo: String(body.photo || '').slice(0, 500000), // bounded photo size
        status: 'investigating',
        resolution_notes: '',
        ts: Date.now()
      };
      serverStore.bugs.unshift(item);
      if (serverStore.bugs.length > 200) serverStore.bugs.pop();

      const notif = {
        id: 'n_cb_' + Date.now(),
        type: 'client_bug',
        mid: item.mid,
        mname: item.borrower,
        text: `Bug Report [${item.category}] from ${item.borrower}: ${item.description}`,
        ts: Date.now(),
        read: false
      };
      serverStore.notifs.unshift(notif);

      await Promise.all([
        trySupabaseWrite('client_bugs', item.id, item),
        trySupabaseWrite('notifs', notif.id, notif)
      ]);

      return res.status(200).json({ ok: true, message: 'Bug report delivered to technical team successfully', item });
    }

    // 3. Personal Details & KYC Profile Submission
    if (action === 'save_profile') {
      const name = String(body.name || '').slice(0, 60).trim();
      const phone1 = String(body.phone1 || body.phone || '').slice(0, 15).trim();
      if (!name || !phone1) {
        return res.status(400).json({ ok: false, error: 'Full name and primary phone number required' });
      }
      const item = {
        id: body.id || ('cp_' + (body.mid || phone1)),
        mid: String(body.mid || phone1).trim(),
        name: name,
        email: String(body.email || '').slice(0, 80).trim(),
        age: parseInt(body.age, 10) || 0,
        place: String(body.place || '').slice(0, 60).trim(),
        phone1: phone1,
        phone2: String(body.phone2 || '').slice(0, 15).trim(),
        photo: String(body.photo || '').slice(0, 500000),
        updated_at: new Date().toISOString(),
        ts: Date.now()
      };
      const idx = serverStore.profiles.findIndex(x => x.id === item.id || x.mid === item.mid);
      if (idx >= 0) serverStore.profiles[idx] = item; else serverStore.profiles.unshift(item);

      await trySupabaseWrite('client_profiles', item.id, item);
      if (item.place) {
        const vId = 'v_' + item.place.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        await trySupabaseWrite('villages', vId, {
          name: item.place,
          te: item.place,
          day: 1
        });
      }
      return res.status(200).json({ ok: true, message: 'Personal profile & KYC saved successfully', item });
    }

    // 4. Payment Proof Lodgement (Pending Admin Verification)
    if (action === 'lodge_payment') {
      const amt = Math.max(1, Math.round(Number(body.amt) || 0));
      const utr = String(body.utr || '').slice(0, 30).trim();
      if (!utr || utr.length < 4) {
        return res.status(400).json({ ok: false, error: 'Valid UTR number required' });
      }
      const item = {
        id: body.id || ('cr_' + Date.now()),
        mid: String(body.mid || 'guest').trim(),
        borrower: String(body.borrower || 'Customer').slice(0, 60),
        village: String(body.village || '').slice(0, 60),
        phone: String(body.phone || '').slice(0, 20),
        amt: amt,
        d: body.d || new Date().toISOString().slice(0, 10),
        mode: 'upi',
        utr: utr,
        photo: String(body.photo || '').slice(0, 500000),
        status: 'pending',
        ts: Date.now()
      };
      serverStore.receipts.unshift(item);
      if (serverStore.receipts.length > 200) serverStore.receipts.pop();

      const notif = {
        id: 'n_cr_' + Date.now(),
        type: 'client_pay',
        mid: item.mid,
        mname: item.borrower,
        amt: amt,
        utr: utr,
        text: `Payment proof of ₹${amt} lodged by ${item.borrower} (UTR: ${utr}). Pending Admin verification.`,
        ts: Date.now(),
        read: false
      };
      serverStore.notifs.unshift(notif);

      await Promise.all([
        trySupabaseWrite('client_receipts', item.id, item),
        trySupabaseWrite('notifs', notif.id, notif)
      ]);

      return res.status(200).json({ ok: true, message: 'Payment proof lodged successfully. Pending Admin verification.', item });
    }

    // 5. Digital Loan Agreement Signature Execution
    if (action === 'sign_agreement') {
      const mid = String(body.mid || '').trim();
      const signedName = String(body.signed_name || '').slice(0, 60).trim();
      if (!mid || !signedName) {
        return res.status(400).json({ ok: false, error: 'Mid and signed legal name required' });
      }
      const agrObj = {
        id: body.id || ('agr_' + mid),
        mid: mid,
        borrower: String(body.borrower || signedName).slice(0, 60),
        phone: String(body.phone || '').slice(0, 20),
        signed_name: signedName,
        signed: true,
        needs_resignature: false,
        ts: Date.now(),
        signed_at: new Date().toISOString(),
        hash: body.hash || ('SHA256-' + Math.random().toString(36).slice(2, 10).toUpperCase()),
        selfie_photo: String(body.selfie_photo || body.photo || '').slice(0, 500000)
      };
      const idx = serverStore.agreements.findIndex(x => x.id === agrObj.id || x.mid === agrObj.mid);
      if (idx >= 0) serverStore.agreements[idx] = agrObj; else serverStore.agreements.unshift(agrObj);

      await trySupabaseWrite('client_agreements', agrObj.id, agrObj);
      return res.status(200).json({ ok: true, message: 'Digital agreement signed & recorded', agreement: agrObj });
    }

    // 6. Admin Re-Signature Request
    if (action === 'request_resignature') {
      const mid = String(body.mid || '').trim();
      const reason = String(body.reason || 'Terms updated by Durga Sravan').slice(0, 200);
      const agr = serverStore.agreements.find(x => x.mid === mid || x.id === ('agr_' + mid)) || {
        id: 'agr_' + mid,
        mid: mid,
        signed: false,
        needs_resignature: true,
        resignature_reason: reason,
        requested_at: new Date().toISOString(),
        ts: Date.now()
      };
      agr.signed = false;
      agr.needs_resignature = true;
      agr.resignature_reason = reason;
      agr.requested_at = new Date().toISOString();
      await trySupabaseWrite('client_agreements', agr.id, agr);
      return res.status(200).json({ ok: true, message: 'Re-signature requested' });
    }

    // 7. Client Loan Application Submission
    if (action === 'apply_loan') {
      const amt = Math.max(500, Math.round(Number(body.amt) || 0));
      const mid = String(body.mid || 'guest').trim();
      const borrower = String(body.borrower || body.mname || 'Customer').slice(0, 60);
      const reqId = body.id || ('lr_' + Date.now());

      const loanReq = {
        id: reqId,
        mid: mid,
        mname: borrower,
        village: String(body.village || '').slice(0, 60),
        phone: String(body.phone || '').slice(0, 20),
        amt: amt,
        repay: Math.round(Number(body.repay) || (amt * 1.10)),
        inst: Math.round(Number(body.inst) || (amt / 10)),
        freq: parseInt(body.freq, 10) || 1,
        purpose: String(body.purpose || 'Personal').slice(0, 60),
        disbursement_type: String(body.disbursement_type || 'upi').slice(0, 20),
        upi_id: String(body.upi_id || '').slice(0, 50),
        bank_details: body.bank_details || {},
        status: 'pending',
        requested_by: 'Client (Online Application)',
        ts: Date.now(),
        d: body.d || new Date().toISOString().slice(0, 10)
      };

      const idx = serverStore.loan_requests.findIndex(x => x.id === loanReq.id);
      if (idx >= 0) serverStore.loan_requests[idx] = loanReq; else serverStore.loan_requests.unshift(loanReq);
      if (serverStore.loan_requests.length > 200) serverStore.loan_requests.pop();

      const notif = {
        id: 'n_lr_' + Date.now(),
        type: 'loan_req',
        rawId: reqId,
        mid: mid,
        mname: borrower,
        amt: amt,
        repay: loanReq.repay,
        inst: loanReq.inst,
        by: borrower,
        to: 'admin',
        text: `New loan application of ₹${amt} submitted by ${borrower}. Pending Admin approval.`,
        ts: Date.now(),
        read: false
      };
      serverStore.notifs.unshift(notif);

      await Promise.all([
        trySupabaseWrite('loan_requests', loanReq.id, loanReq),
        trySupabaseWrite('notifs', notif.id, notif)
      ]);

      return res.status(200).json({ ok: true, message: 'Loan application submitted for Admin approval', item: loanReq });
    }

    // 8. Admin Approving Loan Application
    if (action === 'approve_loan') {
      const id = String(body.id || '').trim();
      const lr = serverStore.loan_requests.find(x => x.id === id) || { id, status: 'approved' };
      lr.status = 'approved';
      lr.approved_at = Date.now();
      lr.approved_by = 'Durga Sravan';
      await trySupabaseWrite('loan_requests', lr.id, lr);
      return res.status(200).json({ ok: true, message: 'Loan application approved' });
    }

    // 9. Admin Rejecting Loan Application
    if (action === 'reject_loan') {
      const id = String(body.id || '').trim();
      const lr = serverStore.loan_requests.find(x => x.id === id) || { id, status: 'rejected' };
      lr.status = 'rejected';
      lr.rejected_at = Date.now();
      lr.rejected_by = 'Durga Sravan';
      await trySupabaseWrite('loan_requests', lr.id, lr);
      return res.status(200).json({ ok: true, message: 'Loan application rejected' });
    }

    // 10. Admin Resolving Support Inquiry
    if (action === 'resolve_support') {
      const itemId = String(body.id || '').trim();
      const replyText = String(body.reply || '').slice(0, 500).trim();
      let item = serverStore.support.find(x => x.id === itemId);
      if (!item) {
        const existing = await getExistingDoc('client_support', itemId);
        item = existing || { id: itemId };
        serverStore.support.unshift(item);
      }
      item.reply = replyText;
      item.status = 'resolved';
      item.resolved_at = new Date().toISOString();
      if (body.borrower && !item.borrower) item.borrower = body.borrower;
      if (body.msg && !item.msg) item.msg = body.msg;
      if (body.topic && !item.topic) item.topic = body.topic;
      if (body.village && !item.village) item.village = body.village;
      if (body.phone && !item.phone) item.phone = body.phone;
      if (body.mid && !item.mid) item.mid = body.mid;
      await trySupabaseWrite('client_support', item.id, item);
      return res.status(200).json({ ok: true, message: 'Inquiry resolved successfully', item });
    }

    // 11. Admin Verifying Client Payment Proof
    if (action === 'verify_payment') {
      const proofId = String(body.id || '').trim();
      const item = serverStore.receipts.find(x => x.id === proofId) || { id: proofId };
      item.status = 'verified';
      item.verified_by = 'Durga Sravan';
      item.verified_at = new Date().toISOString();
      item.txn_id = body.txn_id || ('gf-' + Math.random().toString(36).slice(2, 10));
      await trySupabaseWrite('client_receipts', item.id, item);
      return res.status(200).json({ ok: true, message: 'Payment verified successfully' });
    }

    // 12. Admin Rejecting Client Payment Proof
    if (action === 'reject_payment') {
      const proofId = String(body.id || '').trim();
      const reason = String(body.reason || 'Payment could not be verified').slice(0, 200);
      const item = serverStore.receipts.find(x => x.id === proofId) || { id: proofId };
      item.status = 'rejected';
      item.rejection_reason = reason;
      item.rejected_at = new Date().toISOString();
      await trySupabaseWrite('client_receipts', item.id, item);
      return res.status(200).json({ ok: true, message: 'Payment rejected' });
    }

    // 13. Direct Email Verification (Bypasses email delivery rate limits)
    if (action === 'verify_email') {
      const emailVal = String(body.email || '').trim().toLowerCase();
      if (!emailVal || !emailVal.includes('@')) {
        return res.status(400).json({ ok: false, error: 'Valid email required' });
      }
      try {
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirm_user_email`, {
          method: 'POST',
          headers: {
            'apikey': authKey,
            'Authorization': `Bearer ${authKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ user_email: emailVal }),
          signal: AbortSignal.timeout(5000)
        });
        const rpcData = await rpcRes.json();
        return res.status(200).json({
          ok: true,
          message: (rpcData && rpcData.message) || 'Email verified successfully in cloud database',
          details: rpcData
        });
      } catch (e) {
        return res.status(500).json({ ok: false, error: e.message || 'Could not verify email' });
      }
    }

    // 14. Admin Resolving Bug Report
    if (action === 'resolve_bug') {
      const bugId = String(body.id || '').trim();
      const status = String(body.status || 'resolved').slice(0, 30);
      const notes = String(body.notes || 'Resolved by Durga Sravan').slice(0, 500);
      let bug = serverStore.bugs.find(x => x.id === bugId);
      if (!bug) {
        const existing = await getExistingDoc('client_bugs', bugId);
        bug = existing || { id: bugId };
        serverStore.bugs.unshift(bug);
      }
      bug.status = status;
      bug.resolution_notes = notes;
      bug.resolved_at = new Date().toISOString();
      if (body.description && !bug.description) bug.description = body.description;
      if (body.borrower && !bug.borrower) bug.borrower = body.borrower;
      if (body.category && !bug.category) bug.category = body.category;
      if (body.village && !bug.village) bug.village = body.village;
      if (body.phone && !bug.phone) bug.phone = body.phone;
      if (body.diagnostics && !bug.diagnostics) bug.diagnostics = body.diagnostics;
      if (body.photo && !bug.photo) bug.photo = body.photo;
      await trySupabaseWrite('client_bugs', bug.id, bug);
      return res.status(200).json({ ok: true, message: 'Bug report status updated successfully', item: bug });
    }

    // 15. Auto-Create / Provision New Borrower Member
    if (action === 'create_member') {
      const mid = String(body.id || body.mid || '').trim();
      const email = String(body.email || '').toLowerCase().trim();
      const name = String(body.name || '').slice(0, 60).trim();
      const village = String(body.village || 'Guntur').slice(0, 60).trim();
      const phone = String(body.phone || '').slice(0, 20).trim();
      if (!mid || !name) {
        return res.status(400).json({ ok: false, error: 'Member ID and name required' });
      }
      const memberObj = {
        id: mid,
        name: name,
        email: email,
        village: village,
        phone: phone,
        inst: 0,
        freq: 1,
        created: new Date().toISOString().slice(0, 10),
        archived: false,
        created_at: Date.now()
      };
      await trySupabaseWrite('members', memberObj.id, memberObj);
      if (village) {
        const vId = 'v_' + village.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        await trySupabaseWrite('villages', vId, {
          name: village,
          te: village,
          day: 1
        });
      }
      return res.status(200).json({ ok: true, message: 'Member created successfully', member: memberObj });
    }

    return res.status(400).json({ ok: false, error: 'Unknown submission action' });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || 'Server error processing submission' });
  }
};
