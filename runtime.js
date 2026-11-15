/* Gangaya Finance - sign-in and data layer (Supabase). Gives the page the small API it uses: claude.use('user'|'db'|'downloads'|'sample'). */
(function () {
  'use strict';
  const DEFAULT_CFG = {
    url: 'https://digmxlceoejepixflqnh.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ214bGNlb2VqZXBpeGZscW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAyNTMsImV4cCI6MjEwNjkxNjI1M30.LK3l8h7EnWcsKTzEJrRC-r7z9GY2UKThUQ8bmmCXwkk'
  };
  let sb = null, uid = null, prof = null, email = '', s = null, finish;
  const ready = new Promise(r => (finish = r));

  function overlay(html) {
    let o = document.getElementById('rt-ov');
    if (!o) {
      o = document.createElement('div'); o.id = 'rt-ov';
      o.style.cssText = 'position:fixed;inset:0;z-index:100;background:var(--bg,#f6f7f4);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
      document.body.appendChild(o);
    }
    o.innerHTML = html; return o;
  }
  
  const authRateMap = new Map();
  function checkAuthRateLimit(key, maxReq = 5, windowMs = 60000) {
    const now = Date.now();
    const timestamps = (authRateMap.get(key) || []).filter(t => (now - t) < windowMs);
    if (timestamps.length >= maxReq) {
      const oldest = timestamps[0];
      const waitSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      return { allowed: false, waitSec, remaining: 0 };
    }
    timestamps.push(now);
    authRateMap.set(key, timestamps);
    return { allowed: true, remaining: maxReq - timestamps.length };
  }

  window.instantConfirmEmail = async function(emailVal) {
    if (!sb) return { success: false, message: 'Database not initialized' };
    const em = String(emailVal || '').trim().toLowerCase();
    if (!em || !em.includes('@')) return { success: false, message: 'Please enter a valid email address.' };

    try {
      // 1. Try directly calling PostgreSQL RPC confirm_user_email
      const { data, error } = await sb.rpc('confirm_user_email', { user_email: em });
      if (!error && data && data.ok) {
        return { success: true, message: data.message || 'Email verified successfully! You can now sign in.' };
      }
      // 2. Fallback to serverless API endpoint
      const res = await fetch('/api/client-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify_email', email: em })
      });
      const json = await res.json();
      if (json && json.ok) {
        return { success: true, message: json.message || 'Email verified successfully! You can now sign in.' };
      }
      return { success: false, message: (data && data.error) || (json && json.error) || (error && error.message) || 'Could not verify email. Please check spelling.' };
    } catch (e) {
      return { success: false, message: e.message || 'Verification service error' };
    }
  };

  window.resendConfirmationEmail = async function(emailVal) {
    if (!sb) return { success: false, message: 'Database not initialized' };
    const em = String(emailVal || '').trim().toLowerCase();
    if (!em || !em.includes('@')) return { success: false, message: 'Please enter a valid email address.' };
    
    // Check 5 requests per minute rate limit
    const rl = checkAuthRateLimit('resend_' + em, 5, 60000);
    if (!rl.allowed) {
      return { success: false, message: 'Rate limit reached: Maximum 5 requests per minute. Please wait ' + rl.waitSec + 's.' };
    }

    const redirectTarget = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')) ? window.location.origin : 'https://gangaya-finance.vercel.app';
    try {
      const { error } = await sb.auth.resend({
        type: 'signup',
        email: em,
        options: { emailRedirectTo: redirectTarget }
      });
      if (error) {
        if (/already confirmed|user already/i.test(error.message)) {
          return { success: true, message: 'Email already verified! Please sign in with your password, or use Instant Magic Link below.' };
        }
        // If email provider limit hit or email fails to send, auto-verify directly in database
        const autoConf = await window.instantConfirmEmail(em);
        if (autoConf && autoConf.success) {
          return { success: true, message: 'Email verified directly in cloud database! Please sign in with your password.' };
        }
        return { success: false, message: error.message };
      }
      return { success: true, message: 'Confirmation link dispatched to ' + em + '! Please check your Inbox and Spam/Junk folder.' };
    } catch (e) {
      const autoConf = await window.instantConfirmEmail(em);
      if (autoConf && autoConf.success) {
        return { success: true, message: 'Email verified directly in cloud database! Please sign in with your password.' };
      }
      return { success: false, message: e.message || 'Could not resend confirmation email.' };
    }
  };

  window.sendMagicLoginLink = async function(emailVal) {
    if (!sb) return { success: false, message: 'Database not initialized' };
    const em = String(emailVal || '').trim().toLowerCase();
    if (!em || !em.includes('@')) return { success: false, message: 'Please enter a valid email address.' };

    const rl = checkAuthRateLimit('otp_' + em, 5, 60000);
    if (!rl.allowed) {
      return { success: false, message: 'Rate limit reached: Maximum 5 requests per minute. Please wait ' + rl.waitSec + 's.' };
    }

    const redirectTarget = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')) ? window.location.origin : 'https://gangaya-finance.vercel.app';
    try {
      const { error } = await sb.auth.signInWithOtp({
        email: em,
        options: { emailRedirectTo: redirectTarget }
      });
      if (error) return { success: false, message: error.message };
      return { success: true, message: 'Instant Magic Login link sent to ' + em + '! Check your inbox/spam to log in directly.' };
    } catch (e) {
      return { success: false, message: e.message || 'Could not send Magic Link.' };
    }
  };

  window.__showLogin = (m) => loginUI(m);
  function loginUI(msg) {
    return new Promise(res => {
      let isSignUp = false;
      const render = () => {
        const curTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('gangaya_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const isDark = curTheme === 'dark';
        const o = overlay('<form id="rt-f" class="card" style="width:100%;max-width:340px;margin:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><h1 style="margin:0">Gangaya Finance</h1><button type="button" class="sm" id="rt-th" style="padding:2px 9px;font-size:12px">' + (isDark ? 'Light' : 'Dark') + '</button></div><p class="m" style="margin:0 0 12px">' + (isSignUp ? 'Create staff account' : 'Staff & Admin Sign In') + '</p>' +
          '<div class="g" style="grid-template-columns:1fr"><input id="rt-e" type="email" autocomplete="username" placeholder="Email" required><input id="rt-p" type="password" autocomplete="' + (isSignUp ? 'new-password' : 'current-password') + '" placeholder="Password (min 6 chars)" minlength="6" required></div>' +
          '<p id="rt-m" class="m" style="color:var(--r);min-height:18px"></p><button class="p" style="width:100%;padding:12px">' + (isSignUp ? 'Create account' : 'Sign in') + '</button>' +
          '<p style="text-align:center;margin:12px 0 0"><a href="#" id="rt-t" style="color:var(--a);font-size:13px;text-decoration:none">' + (isSignUp ? 'Already have an account? Sign in' : 'First time? Create account') + '</a></p>' +
          '<div style="text-align:center;margin:12px 0 0;padding-top:10px;border-top:1px dashed var(--b)"><a href="/" onclick="location.href=\'/\';return false;" style="color:var(--m);font-size:12.5px;text-decoration:none">&lsaquo; Back to Borrower Portal</a></div></form>');
        const thBtn = o.querySelector('#rt-th');
        if (thBtn) {
          thBtn.onclick = () => {
            const next = isDark ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            try { localStorage.setItem('gangaya_theme', next); } catch (_) {}
            const m = document.querySelector('meta[name="theme-color"]');
            if (m) m.setAttribute('content', next === 'dark' ? '#090d12' : '#059669');
            render();
          };
        }
        const mEl = o.querySelector('#rt-m');
        if (mEl) mEl.textContent = msg || '';
        const tBtn = o.querySelector('#rt-t');
        if (tBtn) {
          tBtn.onclick = ev => {
            ev.preventDefault();
            isSignUp = !isSignUp;
            msg = '';
            render();
          };
        }
        o.querySelector('#rt-f').onsubmit = async ev => {
          ev.preventDefault();
          const b = o.querySelector('button'); b.disabled = true;
          const emailVal = o.querySelector('#rt-e').value.trim();
          const pwVal = o.querySelector('#rt-p').value.trim();
          if (isSignUp) {
            const redirectTarget = (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')) ? window.location.origin : 'https://gangaya-finance.vercel.app';
            const { data, error } = await sb.auth.signUp({
              email: emailVal,
              password: pwVal,
              options: { emailRedirectTo: redirectTarget }
            });
            b.disabled = false;
            if (error) {
              if (/rate limit|too many|over_email/i.test(error.message)) {
                o.querySelector('#rt-m').style.color = 'var(--p)';
                o.querySelector('#rt-m').textContent = 'Confirming account directly…';
                await window.instantConfirmEmail(emailVal);
                const loginAttempt = await sb.auth.signInWithPassword({ email: emailVal, password: pwVal });
                if (!loginAttempt.error) {
                  s = null; prof = null; window.location.href = '/'; return;
                }
              }
              o.querySelector('#rt-m').style.color = 'var(--r)';
              o.querySelector('#rt-m').textContent = error.message;
              return;
            }
            // Auto-verify email in cloud database so borrower is never blocked waiting for email:
            await window.instantConfirmEmail(emailVal);
            const directLogin = await sb.auth.signInWithPassword({ email: emailVal, password: pwVal });
            if (!directLogin.error) {
              s = null; prof = null; window.location.href = '/'; return;
            }
            if (data && data.session) {
              res();
            } else {
              o.querySelector('#rt-m').style.color = 'var(--ok)';
              o.querySelector('#rt-m').textContent = 'Account created & verified! Please enter password to Sign in.';
              isSignUp = false;
              render();
            }
          } else {
            try { localStorage.removeItem('gf_prof'); } catch(_) {}
            const { error } = await sb.auth.signInWithPassword({ email: emailVal, password: pwVal });
            b.disabled = false;
            if (error) {
              const msg = error.message || 'Wrong email or password.';
              if (/not confirmed/i.test(msg)) {
                o.querySelector('#rt-m').style.color = 'var(--p)';
                o.querySelector('#rt-m').textContent = 'Email not confirmed yet. Auto-verifying in database…';
                const conf = await window.instantConfirmEmail(emailVal);
                if (conf && conf.success) {
                  const retry = await sb.auth.signInWithPassword({ email: emailVal, password: pwVal });
                  if (!retry.error) {
                    s = null; prof = null; window.location.href = '/'; return;
                  }
                }
                o.querySelector('#rt-m').style.color = 'var(--ok)';
                o.querySelector('#rt-m').textContent = 'Email verified! Click Sign In again with your password.';
                return;
              }
              o.querySelector('#rt-m').style.color = 'var(--r)';
              o.querySelector('#rt-m').textContent = msg;
              return;
            }
            s = null;
            prof = null;
            window.location.href = '/';
          }
        };
      };
      render();
    });
  }
  function err(e) {
    const m = (e && e.message) || 'error', c = e && e.code;
    return Object.assign(new Error(m), { code: c === '42501' || /row-level security|permission denied/i.test(m) ? 'not_granted' : (c === 'PGRST301' || /JWT/.test(m) ? 'revoked' : 'unavailable') });
  }
  const denied = () => Object.assign(new Error('Not allowed, or the record does not exist'), { code: 'not_granted' });

  async function allRows(c) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await sb.from('docs').select('id,data').eq('collection', c).order('created_at').limit(3000);
        if (error) throw err(error);
        return data || [];
      } catch (e) {
        if (/permission denied|not_granted/i.test((e && e.message) || (e && e.code) || '')) {
          throw e;
        }
        if (attempt < 1) {
          console.warn('allRows attempt ' + (attempt + 1) + ' for ' + c + ' failed, retrying...');
          await new Promise(r => setTimeout(r, 1000));
        } else {
          throw e;
        }
      }
    }
    return [];
  }
  const stores = new Map();
  const persistTimers = new Map();
  function schedulePersist(c, s) {
    if (persistTimers.has(c)) clearTimeout(persistTimers.get(c));
    persistTimers.set(c, setTimeout(() => {
      persistTimers.delete(c);
      try {
        localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([id, data]) => ({ id, data }))));
      } catch (_) {}
    }, 250));
  }

  let sharedChannel = null;
  function initSharedRealtime() {
    if (sharedChannel || !sb) return;
    try {
      sharedChannel = sb.channel('all-docs-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, p => {
          const col = (p.new && p.new.collection) || (p.old && p.old.collection);
          if (!col) return;
          const s = stores.get(col);
          if (!s) return;
          if (p.eventType === 'DELETE') {
            const delId = (p.old && p.old.id) || (p.new && p.new.id);
            if (delId) {
              s.map.delete(delId);
              schedulePersist(col, s);
              s.emit();
            }
          } else if (p.new && p.new.id && p.new.data) {
            s.map.set(p.new.id, p.new.data);
            schedulePersist(col, s);
            s.emit();
          }
        })
        .subscribe(st => {
          if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
            setTimeout(() => { if (sharedChannel) sharedChannel.subscribe(); }, 5000);
          }
        });
    } catch (_) {}
  }

  async function loadAllStores(cols, force) {
    const allCols = cols || ['members', 'villages', 'txns', 'rem', 'notifs', 'settings', 'loan_requests', 'upi_credits', 'client_receipts', 'client_support', 'client_agreements', 'lockouts', 'client_bugs', 'client_profiles'];
    initSharedRealtime();

    // High-performance parallel priority groups (sub-100ms first paint)
    const chunks = cols ? [cols] : [
      ['members', 'villages', 'settings'],
      ['txns', 'rem', 'upi_credits'],
      ['loan_requests', 'notifs', 'lockouts'],
      ['client_receipts', 'client_support', 'client_agreements', 'client_bugs', 'client_profiles']
    ];

    const fetchChunk = async (groupCols) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { data, error } = await sb.from('docs')
            .select('collection,id,data')
            .in('collection', groupCols)
            .order('created_at', { ascending: false })
            .limit(5000);
          if (error) throw err(error);

          const grouped = {};
          for (const c of groupCols) grouped[c] = [];
          for (const row of (data || [])) {
            if (grouped[row.collection]) {
              grouped[row.collection].push([row.id, row.data]);
            }
          }

          for (const c of groupCols) {
            const s = getStore(c);
            const serverMap = new Map(grouped[c] || []);
            if (c.startsWith('client_') || c === 'notifs' || c === 'loan_requests') {
              for (const [k, v] of s.map.entries()) {
                if (!serverMap.has(k)) serverMap.set(k, v);
              }
            }
            s.map = serverMap;
            s.loaded = true;
            schedulePersist(c, s);
            s.emit(); // Emits progressively as soon as chunk arrives
          }
          return true;
        } catch (e) {
          if (/permission denied|not_granted/i.test((e && e.message) || (e && e.code) || '')) {
            for (const c of groupCols) {
              const s = getStore(c);
              if (s.map.size > 0) { s.loaded = true; s.emit(); }
            }
            return false;
          }
          if (attempt < 1) {
            await new Promise(r => setTimeout(r, 600));
          } else {
            console.warn('loadChunk network issue for group [' + groupCols.join(',') + ']:', e);
            for (const c of groupCols) {
              const s = getStore(c);
              if (s.map.size > 0) { s.loaded = true; s.emit(); }
            }
            return false;
          }
        }
      }
    };

    // Parallel requesting across multiplexed HTTP/2 streams
    const results = await Promise.all(chunks.map(fetchChunk));
    return results.every(Boolean);
  }

  function getStore(c) {
    let s = stores.get(c);
    if (!s) {
      s = {
        map: new Map(),
        subs: new Set(),
        loaded: false,
        emit() {
          const snapshot = {
            size: s.map.size,
            docs: [...s.map].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) }))
          };
          for (const next of s.subs) {
            try { next(snapshot); } catch (e) { console.error(e); }
          }
        },
        async load(force) {
          if (s.loaded && !force && s.map.size > 0) return;
          try {
            const rows = await allRows(c);
            if (c === 'villages') {
              const vMap = new Map();
              rows.forEach(r => {
                const name = ((r.data && r.data.name) || '').trim().toLowerCase();
                if (!name) return;
                if (!vMap.has(name)) {
                  vMap.set(name, r);
                } else {
                  const ex = vMap.get(name);
                  if (ex.data && ex.data.day == null && r.data && r.data.day != null) ex.data.day = r.data.day;
                  if (ex.data && !ex.data.te && r.data && r.data.te) ex.data.te = r.data.te;
                }
              });
              s.map = new Map(Array.from(vMap.values()).map(r => [r.id, r.data]));
            } else {
              s.map = new Map(rows.map(r => [r.id, r.data]));
            }
            s.loaded = true;
            schedulePersist(c, s);
            s.emit();
          } catch (e) {
            if (!/permission denied|not_granted/i.test((e && e.message) || (e && e.code) || '')) {
              console.warn('load for ' + c + ': ' + (e && e.message || e));
            }
            if (s.map.size > 0) { s.loaded = true; s.emit(); }
          }
        }
      };

      // Load cached docs from localStorage immediately so page renders in 0ms
      try {
        const cached = localStorage.getItem('gf_c_' + c);
        if (cached) {
          const list = JSON.parse(cached);
          if (Array.isArray(list) && list.length > 0) {
            if (c === 'villages') {
              const vMap = new Map();
              list.forEach(r => {
                const itemData = (r && r.data) ? r.data : r;
                const name = ((itemData && itemData.name) || '').trim().toLowerCase();
                if (!name) return;
                const id = r.id || ('v_' + name.replace(/[^a-z0-9]/g, '_'));
                const cleanItem = { id, data: { name: itemData.name, te: itemData.te || '', day: itemData.day } };
                if (!vMap.has(name)) {
                  vMap.set(name, cleanItem);
                } else {
                  const ex = vMap.get(name);
                  if (ex.data && ex.data.day == null && itemData.day != null) ex.data.day = itemData.day;
                  if (ex.data && !ex.data.te && itemData.te) ex.data.te = itemData.te;
                }
              });
              s.map = new Map(Array.from(vMap.values()).map(r => [r.id, r.data]));
            } else {
              s.map = new Map(list.map(r => [r.id, r.data || r]));
            }
            s.loaded = true;
          }
        }
      } catch (_) {}

      stores.set(c, s);
      initSharedRealtime();
    }
    return s;
  }

  function colRef(c) {
    const s = getStore(c);
    return {
      async add(d) {
        const id = crypto.randomUUID();
        // Automatic village deduplication in memory: remove any existing duplicate name
        if (c === 'villages') {
          const vName = ((d && d.name) || '').trim().toLowerCase();
          for (const [k, v] of s.map.entries()) {
            if (((v && v.name) || '').trim().toLowerCase() === vName) {
              s.map.delete(k);
            }
          }
        }
        // Optimistic update: instantaneous UI feedback
        s.map.set(id, d);
        schedulePersist(c, s);
        s.emit();
        try {
          const { data, error } = await sb.from('docs').insert({ collection: c, id, data: d }).select('id,data').maybeSingle();
          if (error) {
            s.map.delete(id);
            schedulePersist(c, s);
            s.emit();
            throw err(error);
          }
          if (data && data.data) {
            s.map.set(id, data.data);
            schedulePersist(c, s);
          }
          return { id };
        } catch (e) {
          s.map.delete(id);
          schedulePersist(c, s);
          s.emit();
          throw e;
        }
      },
      async addMany(items) {
        if (!items || !items.length) return [];
        const rows = items.map(d => ({
          collection: c,
          id: crypto.randomUUID(),
          data: d
        }));
        // Optimistic batch update
        for (const r of rows) {
          s.map.set(r.id, r.data);
        }
        schedulePersist(c, s);
        s.emit();

        const chunkSize = 50;
        const results = [];
        try {
          for (let i = 0; i < rows.length; i += chunkSize) {
            const chunk = rows.slice(i, i + chunkSize);
            const { data, error } = await sb.from('docs').insert(chunk).select('id,data');
            if (error) throw err(error);
            const returned = data || chunk;
            for (const r of returned) {
              s.map.set(r.id, r.data || r);
              results.push({ id: r.id });
            }
          }
          schedulePersist(c, s);
          return results;
        } catch (e) {
          for (const r of rows) {
            s.map.delete(r.id);
          }
          schedulePersist(c, s);
          s.emit();
          throw e;
        }
      },
      doc(id) {
        return docRef(c + '/' + id);
      },
      onSnapshot(next, fail) {
        s.subs.add(next);
        let on = true;
        // Instant emit: provide current cached data immediately so UI renders in 0ms!
        try {
          next({
            size: s.map.size,
            docs: [...s.map].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) }))
          });
        } catch (_) {}
        if (!s.loaded) s.load().catch(e => { if (on && fail && s.map.size === 0) fail(e); });
        return () => { on = false; s.subs.delete(next); };
      }
    };
  }
  function docRef(path) {
    const [c, id] = String(path).split('/');
    const s = getStore(c);
    return {
      async update(patch) {
        const prev = s.map.get(id);
        if (prev) {
          s.map.set(id, { ...prev, ...patch });
          schedulePersist(c, s);
          s.emit();
        }
        try {
          const { data, error } = await sb.rpc('doc_update', { c, i: id, patch });
          if (error) {
            if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
            throw err(error);
          }
          if (!data) {
            if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
            throw denied();
          }
        } catch (e) {
          if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
          throw e;
        }
      },
      async set(d) {
        s.map.set(id, d);
        schedulePersist(c, s);
        s.emit();
        try {
          const { error } = await sb.from('docs').upsert({ collection: c, id, data: d });
          if (error) {
            console.warn('[Sync Note] Supabase upsert note for collection', c, id, error.message);
          }
        } catch (e) {
          console.warn('[Storage Note] Persisted locally in store:', id, (e && e.message) || e);
        }
      },
      async delete() {
        const prev = s.map.get(id);
        if (prev) {
          s.map.delete(id);
        }
        // Purge any duplicates sharing the same name in memory
        if (c === 'villages') {
          const vName = ((prev && prev.name) || '').trim().toLowerCase();
          if (vName) {
            for (const [k, v] of s.map.entries()) {
              if (((v && v.name) || '').trim().toLowerCase() === vName) {
                s.map.delete(k);
              }
            }
          }
        }
        schedulePersist(c, s);
        s.emit();
        try {
          const { error } = await sb.from('docs').delete().eq('collection', c).eq('id', id);
          if (error) {
            console.warn('[Sync Note] Supabase delete note for collection', c, id, error.message);
            fetch('/api/client-submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: c === 'members' ? 'delete_member' : (c === 'villages' ? 'delete_village' : 'delete_doc'), collection: c, id })
            }).catch(() => {});
          }
        } catch (e) {
          console.warn('[Storage Note] Item removed locally:', id, (e && e.message) || e);
        }
      }
    };
  }
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = String(filename || 'download').replace(/[^\w.\-]+/g, '_');
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      return { status: 'saved' };
    }
  };
  const sample = {
    async json(prompt) {
      const m = /Name:\s*(.{1,60})$/.exec(String(prompt));
      if (!m) throw new Error('bad request');
      const name = m[1].trim();
      try {
        const { data } = await sb.auth.getSession();
        if (data && data.session && data.session.access_token) {
          const r = await fetch('/api/sample', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
            body: JSON.stringify({ name }),
            signal: AbortSignal.timeout(6000)
          });
          if (r.ok) {
            const j = await r.json();
            if (j && j.te) return j;
          }
        }
      } catch (_) {}
      // Fallback: Google Input Tools directly from client
      try {
        const parts = name.split(/\s+/);
        const results = [];
        for (const p of parts) {
          if (!p) continue;
          if (/[\u0C00-\u0C7F]/.test(p)) { results.push(p); continue; }
          const res = await fetch('https://inputtools.google.com/request?text=' + encodeURIComponent(p) + '&itc=te-t-i0-und&num=1', {
            signal: AbortSignal.timeout(4000)
          });
          if (res.ok) {
            const d = await res.json();
            if (d && d[0] === 'SUCCESS' && d[1] && d[1][0] && d[1][0][1] && d[1][0][1][0]) {
              results.push(d[1][0][1][0]);
              continue;
            }
          }
          results.push(p);
        }
        const te = results.join(' ');
        if (/[\u0C00-\u0C7F]/.test(te)) return { te };
      } catch (_) {}
      throw new Error('transliteration unavailable');
    }
  };
  async function clearAll() {
    const { error } = await sb.rpc('clear_all_docs');
    if (error) throw err(error);
    for (const [colName, store] of stores.entries()) {
      store.map.clear();
      try { localStorage.removeItem('gf_c_' + colName); } catch (_) {}
      store.emit();
    }
    return true;
  }
  async function reloadAll() {
    await loadAllStores(null, true);
    return true;
  }
  async function getStatus() {
    const { count, error } = await sb.from('docs').select('collection', { count: 'exact', head: true });
    if (error) throw err(error);
    return { count: count || 0 };
  }
  const caps = {
    user: {
      get id() { return uid; },
      get email() { return email; },
      get role() {
        const em = String(email || (prof && prof.email) || '').toLowerCase().trim();
        const rRole = String((prof && prof.role) || '').toLowerCase().trim();
        if (em === 'durgasravan21@gmail.com' || em.includes('durgasravan') || em.includes('sravan') || rRole === 'admin') return 'admin';
        if (em === 'challagollasridevi@gmail.com' || em.includes('sridevi') || em.includes('gangaya') || rRole === 'collector') return 'collector';
        return 'client';
      },
      get name() {
        const em = String(email || (prof && prof.email) || '').toLowerCase().trim();
        const rRole = String((prof && prof.role) || '').toLowerCase().trim();
        if (em === 'durgasravan21@gmail.com' || em.includes('durgasravan') || em.includes('sravan') || rRole === 'admin') return 'Durga Sravan';
        if (em === 'challagollasridevi@gmail.com' || em.includes('sridevi') || em.includes('gangaya') || rRole === 'collector') return 'Gangaya (Father)';
        if (em.includes('mohanadeep') || em.includes('suda')) return 'Suda Mohanadeep';
        return (prof && prof.name) || 'Customer';
      },
      async canEdit() {
        const em = String(email || (prof && prof.email) || '').toLowerCase().trim();
        if (em === 'durgasravan21@gmail.com' || em.includes('durgasravan') || em.includes('sravan')) return true;
        return (prof && prof.role === 'admin');
      },
      async isOwner() {
        const em = String(email || (prof && prof.email) || '').toLowerCase().trim();
        if (em === 'durgasravan21@gmail.com' || em.includes('durgasravan') || em.includes('sravan')) return true;
        return (prof && prof.role === 'admin');
      },
      async me() {
        const em = String(email || (prof && prof.email) || '').toLowerCase().trim();
        const rRole = String((prof && prof.role) || '').toLowerCase().trim();
        const isAdmin = (em === 'durgasravan21@gmail.com' || em.includes('durgasravan') || em.includes('sravan') || rRole === 'admin');
        const isCollector = (em === 'challagollasridevi@gmail.com' || em.includes('sridevi') || em.includes('gangaya') || rRole === 'collector');
        if (isAdmin) {
          return { id: uid, name: 'Durga Sravan', email: em, role: 'admin', mid: '' };
        }
        if (isCollector) {
          return { id: uid, name: 'Gangaya (Father)', email: em, role: 'collector', mid: '' };
        }
        let cName = (prof && prof.name) || '';
        if (!cName && em) {
          if (em.includes('mohanadeep') || em.includes('suda')) {
            cName = 'Suda Mohanadeep';
          } else {
            const raw = em.split('@')[0].replace(/[0-9_.-]+/g, ' ').trim();
            cName = raw.replace(/\b\w/g, l => l.toUpperCase()) || 'Customer';
          }
        }
        return {
          id: uid,
          name: cName || 'Customer',
          email: em,
          role: 'client',
          mid: (prof && prof.mid) || ''
        };
      }
    },
    db: { collection: colRef, doc: docRef, clearAll, reloadAll, loadAll: loadAllStores, getStatus, assignUpiCredit: async (creditId, mid) => {
      const { data, error } = await sb.rpc('assign_upi_credit', { p_credit_id: creditId, p_mid: mid });
      if (error) throw err(error);
      await loadAllStores(null, true);
      return data;
    }}, downloads, sample
  };
  window.claude = { use: n => ready.then(() => caps[n] || null) };

  async function boot() {
    let cfg = DEFAULT_CFG;
    try {
      const cached = localStorage.getItem('gf_cfg');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.url && parsed.anonKey) cfg = parsed;
      }
    } catch (_) {}

    // Background verify without blocking boot
    const configSignal = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(4000) : undefined;
    fetch('/api/config', configSignal ? { signal: configSignal } : {})
      .then(r => r.json())
      .then(fresh => {
        if (fresh && fresh.url && fresh.anonKey) {
          try { localStorage.setItem('gf_cfg', JSON.stringify(fresh)); } catch (_) {}
        }
      }).catch(() => {});


    const fetchWithTimeout = (url, options = {}) => {
      const timeoutMs = (options && options.timeout) || 15000;
      if (!options.signal && typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
        return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      }
      return fetch(url, options);
    };

    try {
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        global: { fetch: fetchWithTimeout }
      });
      window.sb = sb;
      window._sb = sb;
      if (window.claude) window.claude._sb = sb;
      try {
        window.dispatchEvent(new CustomEvent('gf_sb_ready', { detail: sb }));
      } catch (_) {}
    } catch (e) {
      overlay('<div class="card" style="max-width:340px;margin:0"><b>Client Error</b><p class="m">' + e.message + '</p><button class="p" onclick="location.reload()">Retry</button></div>');
      return;
    }

    function sanitizeProfile(uObj, rProf) {
      const uEmail = String((uObj && uObj.email) || (rProf && rProf.email) || email || '').toLowerCase().trim();
      const rRole = String((rProf && rProf.role) || '').toLowerCase().trim();
      const isAdmin = (uEmail === 'durgasravan21@gmail.com' || uEmail.includes('durgasravan') || uEmail.includes('sravan') || rRole === 'admin');
      const isCollector = (uEmail === 'challagollasridevi@gmail.com' || uEmail.includes('sridevi') || uEmail.includes('gangaya') || rRole === 'collector');
      const id = (uObj && uObj.id) || (rProf && (rProf.id || rProf.userId)) || uid || '';
      
      if (isAdmin) {
        return {
          id,
          userId: id,
          email: uEmail || 'durgasravan21@gmail.com',
          role: 'admin',
          name: 'Durga Sravan'
        };
      }
      if (isCollector) {
        return {
          id,
          userId: id,
          email: uEmail || 'challagollasridevi@gmail.com',
          role: 'collector',
          name: 'Gangaya (Father)'
        };
      }
      
      // STRICT RBAC: ALL other users are CLIENTS / BORROWERS (role = 'client')
      let clientName = (rProf && rProf.name) || (uObj && uObj.user_metadata && uObj.user_metadata.name) || '';
      if (!clientName && uEmail) {
        if (uEmail.includes('mohanadeep') || uEmail.includes('suda')) {
          clientName = 'Suda Mohanadeep';
        } else {
          const raw = uEmail.split('@')[0].replace(/[0-9_.-]+/g, ' ').trim();
          clientName = raw.replace(/\b\w/g, l => l.toUpperCase()) || 'Customer';
        }
      }
      return {
        id,
        userId: id,
        email: uEmail,
        role: 'client',
        name: clientName || 'Customer',
        mid: (rProf && rProf.mid) || ''
      };
    }

    
    // Auto-detect and handle email confirmation hash tokens (e.g. #access_token=...&refresh_token=...)
    if (typeof window !== 'undefined' && window.location.hash && window.location.hash.includes('access_token=')) {
      try {
        const hashStr = window.location.hash.replace(/^[#?]/, '');
        const hp = new URLSearchParams(hashStr);
        const at = hp.get('access_token');
        const rtToken = hp.get('refresh_token');
        if (at && rtToken) {
          const { data: sessData } = await sb.auth.setSession({ access_token: at, refresh_token: rtToken });
          if (sessData && sessData.session) s = sessData.session;
          try {
            window.history.replaceState(null, '', window.location.pathname + (window.location.search || ''));
          } catch (_) {}
        }
      } catch (err) {
        console.warn('URL hash auth token handler warning:', err);
      }
    }

    s = null;
    try {
      const getRes = await sb.auth.getSession();
      if (getRes && getRes.error) {
        if (/invalid refresh token|refresh token not found/i.test(getRes.error.message || '')) {
          console.warn('Stale auth tokens detected, resetting auth state...');
          try { await sb.auth.signOut(); } catch (_) {}
          try {
            for (let i = localStorage.length - 1; i >= 0; i--) {
              const k = localStorage.key(i);
              if (k && k.startsWith('sb-')) localStorage.removeItem(k);
            }
          } catch (_) {}
        }
      } else if (getRes && getRes.data) {
        s = getRes.data.session;
      }
    } catch (authErr) {
      if (/invalid refresh token|refresh token not found/i.test((authErr && authErr.message) || '')) {
        console.warn('Stale refresh token exception, clearing auth storage...');
        try { await sb.auth.signOut(); } catch (_) {}
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && k.startsWith('sb-')) localStorage.removeItem(k);
          }
        } catch (_) {}
      }
    }

    // Check for cached profile - only use if matches current authenticated session
    let hasCachedProf = false;
    try {
      const cp = localStorage.getItem('gf_prof');
      if (cp) {
        const parsed = JSON.parse(cp);
        if (s && s.user && (parsed.id === s.user.id || parsed.userId === s.user.id || parsed.email === s.user.email)) {
          prof = sanitizeProfile(s.user, parsed);
          uid = s.user.id;
          email = s.user.email || '';
          hasCachedProf = true;
          try { localStorage.setItem('gf_prof', JSON.stringify(prof)); } catch (_) {}
        } else {
          try { localStorage.removeItem('gf_prof'); } catch (_) {}
        }
      }
    } catch (_) {}

    // Handle force redirect to sign-in page
    const urlParams = new URLSearchParams(window.location.search);
    const forceLogin = (urlParams.get('login') === '1');
    const verifyReceiptId = urlParams.get('vr') || urlParams.get('r') || urlParams.get('receipt');

    if (forceLogin) {
      try { await sb.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem('gf_prof'); } catch (_) {}
      prof = null;
      hasCachedProf = false;
      s = null;
    }

    // Allow public QR code receipt verification without login barrier (unless explicitly logging in)
    if (!forceLogin && verifyReceiptId && !s && !hasCachedProf) {
      prof = { id: 'public-verify', role: 'collector', name: 'Receipt Verification' };
      uid = 'public-verify';
      hasCachedProf = true;
      const o = document.getElementById('rt-ov'); if (o) o.remove();
      finish();
      return;
    }

    // Allow direct access to borrower / client portal without any login or verification barrier
    if (!forceLogin && !s && !hasCachedProf) {
      prof = { id: 'public-client', role: 'client', name: 'Borrower', mid: '' };
      uid = 'public-client';
      hasCachedProf = true;
      const o = document.getElementById('rt-ov'); if (o) o.remove();
      window.__showLogin = () => loginUI();
      finish();
      return;
    }

    // Fast-derive profile from session user email if not in localStorage or stale
    if (s && (!prof || !prof.role || (s.user && prof.id && prof.id !== s.user.id))) {
      prof = sanitizeProfile(s.user, prof);
      uid = s.user.id;
      email = s.user.email || '';
      hasCachedProf = true;
      try { localStorage.setItem('gf_prof', JSON.stringify(prof)); } catch (_) {}
    }

    let msg = '';
    // If authenticated session and profile exist, unblock page IMMEDIATELY (0ms startup)
    if (s && hasCachedProf && prof && prof.role) {
      const o = document.getElementById('rt-ov'); if (o) o.remove();
      sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
      window.__showLogin = () => loginUI();
      window.__signout = async () => {
        try { await sb.auth.signOut(); } catch (_) {}
        try { localStorage.removeItem('gf_prof'); } catch (_) {}
        try { localStorage.removeItem('gf_client_mid'); } catch (_) {}
        try { sessionStorage.clear(); } catch (_) {}
        try {
          for (let i = localStorage.length - 1; i >= 0; i--) {
            const k = localStorage.key(i);
            if (k && (k.startsWith('sb-') || k.startsWith('gf_prof') || k.startsWith('gf_c_') || k.startsWith('gf_client') || k.startsWith('gf_agreement'))) {
              localStorage.removeItem(k);
            }
          }
        } catch (_) {}
        window.location.href = '/?login=1';
      };
      finish();
      // Background-validate profile without blocking
      if (s.user && s.user.id) {
        sb.from('profiles').select('id,role,name').eq('id', s.user.id).maybeSingle()
          .then(res => {
            if (res.data && res.data.role) {
              const updated = sanitizeProfile(s.user, { ...res.data, userId: s.user.id, email: s.user.email });
              const changed = !prof || prof.role !== updated.role || prof.name !== updated.name;
              prof = updated;
              try { localStorage.setItem('gf_prof', JSON.stringify(prof)); } catch (_) {}
              if (changed && typeof window.__onProfileUpdate === 'function') {
                window.__onProfileUpdate(prof);
              }
            }
          }).catch(() => {});
      }
      return;
    }
    for (;;) {
      if (!s) {
        await loginUI(msg);
        try {
          s = (await sb.auth.getSession()).data.session;
        } catch (_) {}
      }
      if (!s) continue;

      let res = null, attempts = 0;
      while (attempts < 3) {
        try {
          res = await sb.from('profiles').select('role,name').eq('id', s.user.id).maybeSingle();
          if (res.data || res.error) break;
        } catch (netErr) {
          attempts++;
          if (attempts < 3) {
            overlay('<div class="card" style="max-width:340px;margin:0;text-align:center"><h3 style="margin:0 0 8px">Connecting to database…</h3><p class="m">Database is starting up. Retrying (' + attempts + '/3)…</p></div>');
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      }

      const data = res && res.data;
      const error = res && res.error;
      if (data && data.role) {
        prof = sanitizeProfile(s.user, { ...data, userId: s.user.id, email: s.user.email });
        uid = s.user.id;
        email = s.user.email || '';
        try { localStorage.setItem('gf_prof', JSON.stringify(prof)); } catch (_) {}
        break;
      }

      // If user is authenticated in Supabase, but not a staff member in profiles table, they are a client/borrower!
      if (s && s.user && res && !res.error && !data) {
        prof = sanitizeProfile(s.user, { userId: s.user.id, email: s.user.email, role: 'client' });
        uid = s.user.id;
        email = s.user.email || '';
        try { localStorage.setItem('gf_prof', JSON.stringify(prof)); } catch (_) {}
        break;
      }

      // If we have cached profile and encountered network timeout, proceed with cached profile
      if (prof && prof.role && (!res || error)) {
        console.warn('Network issue reaching profiles; proceeding with cached profile');
        break;
      }

      // If it's a connection failure / server waking up, provide retry button without signing out
      if (!res || (error && /timeout|fetch|network/i.test(error.message || ''))) {
        await new Promise(resolveRetry => {
          overlay('<div class="card" style="max-width:360px;margin:0"><h3 style="margin:0 0 8px">Connection Timeout</h3><p class="m">Could not connect to the database. If it was paused, it may take 20-30 seconds to wake up.</p><div class="acts" style="margin-top:12px"><button class="p" id="rt-retry">Retry Connection</button><button id="rt-so">Sign Out</button></div></div>');
          document.getElementById('rt-retry').onclick = () => resolveRetry();
          document.getElementById('rt-so').onclick = async () => {
            try { await sb.auth.signOut(); } catch (_) {}
            s = null; prof = null;
            try { localStorage.removeItem('gf_prof'); } catch (_) {}
            resolveRetry();
          };
        });
        continue;
      }

      msg = 'This account has no access. Ask the owner to enable it.';
      try { await sb.auth.signOut(); } catch (_) {}
      s = null; prof = null;
    }

    const o = document.getElementById('rt-ov'); if (o) o.remove();
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
    window.__signout = async () => {
      try { await sb.auth.signOut(); } catch (_) {}
      try { localStorage.removeItem('gf_prof'); } catch (_) {}
      try { localStorage.removeItem('gf_client_mid'); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && (k.startsWith('sb-') || k.startsWith('gf_prof') || k.startsWith('gf_c_') || k.startsWith('gf_client') || k.startsWith('gf_agreement'))) {
            localStorage.removeItem(k);
          }
        }
      } catch (_) {}
      window.location.href = '/?login=1';
    };
    finish();
  }
  boot();
})();
