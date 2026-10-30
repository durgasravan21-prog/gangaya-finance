/* Gangaya Finance - sign-in and data layer (Supabase). Gives the page the small API it uses: claude.use('user'|'db'|'downloads'|'sample'). */
(function () {
  'use strict';
  const DEFAULT_CFG = {
    url: 'https://digmxlceoejepixflqnh.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpZ214bGNlb2VqZXBpeGZscW5oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEzNDAyNTMsImV4cCI6MjEwNjkxNjI1M30.LK3l8h7EnWcsKTzEJrRC-r7z9GY2UKThUQ8bmmCXwkk'
  };
  let sb = null, uid = null, prof = null, email = '', finish;
  const ready = new Promise(r => (finish = r));

  try {
    if (window.supabase) {
      sb = window.supabase.createClient(DEFAULT_CFG.url, DEFAULT_CFG.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
  } catch (_) {}

  function overlay(html) {
    let o = document.getElementById('rt-ov');
    if (!o) {
      o = document.createElement('div'); o.id = 'rt-ov';
      o.style.cssText = 'position:fixed;inset:0;z-index:100;background:var(--bg,#f6f7f4);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto';
      document.body.appendChild(o);
    }
    o.innerHTML = html; return o;
  }
  function loginUI(msg) {
    return new Promise(res => {
      let isSignUp = false;
      const render = () => {
        const curTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('gangaya_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const isDark = curTheme === 'dark';
        const o = overlay('<form id="rt-f" class="card" style="width:100%;max-width:340px;margin:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><h1 style="margin:0">Gangaya Finance</h1><button type="button" class="sm" id="rt-th" style="padding:2px 9px;font-size:12px">' + (isDark ? 'Light' : 'Dark') + '</button></div><p class="m" style="margin:0 0 12px">' + (isSignUp ? 'Create your account (first time setup)' : 'Sign in to continue') + '</p>' +
          '<div class="g" style="grid-template-columns:1fr"><input id="rt-e" type="email" autocomplete="username" placeholder="Email" required><input id="rt-p" type="password" autocomplete="' + (isSignUp ? 'new-password' : 'current-password') + '" placeholder="Password (min 6 chars)" minlength="6" required></div>' +
          '<p id="rt-m" class="m" style="color:var(--r);min-height:18px"></p><button class="p" style="width:100%;padding:12px">' + (isSignUp ? 'Create account' : 'Sign in') + '</button>' +
          '<p style="text-align:center;margin:12px 0 0"><a href="#" id="rt-t" style="color:var(--a);font-size:13px;text-decoration:none">' + (isSignUp ? 'Already have an account? Sign in' : 'First time? Create account') + '</a></p></form>');
        o.querySelector('#rt-th').onclick = () => {
          const next = isDark ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem('gangaya_theme', next); } catch (_) {}
          const m = document.querySelector('meta[name="theme-color"]');
          if (m) m.setAttribute('content', next === 'dark' ? '#090d12' : '#059669');
          render();
        };
        o.querySelector('#rt-m').textContent = msg || '';
        o.querySelector('#rt-t').onclick = ev => {
          ev.preventDefault();
          isSignUp = !isSignUp;
          msg = '';
          render();
        };
        o.querySelector('#rt-f').onsubmit = async ev => {
          ev.preventDefault();
          const b = o.querySelector('button'); b.disabled = true;
          const emailVal = o.querySelector('#rt-e').value.trim();
          const pwVal = o.querySelector('#rt-p').value.trim();
          if (isSignUp) {
            const { data, error } = await sb.auth.signUp({ email: emailVal, password: pwVal });
            b.disabled = false;
            if (error) { o.querySelector('#rt-m').textContent = error.message; return; }
            if (data && data.session) { res(); }
            else {
              o.querySelector('#rt-m').style.color = 'var(--a)';
              o.querySelector('#rt-m').textContent = 'Account created! If confirmation was sent, check email, then Sign in.';
            }
          } else {
            const { error } = await sb.auth.signInWithPassword({ email: emailVal, password: pwVal });
            b.disabled = false;
            if (error) { o.querySelector('#rt-m').textContent = error.message || 'Wrong email or password.'; return; }
            res();
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
    const targetCols = cols || ['members', 'villages', 'txns', 'rem', 'notifs', 'settings', 'loan_requests', 'upi_credits'];
    initSharedRealtime();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, error } = await sb.from('docs')
          .select('collection,id,data')
          .in('collection', targetCols)
          .order('created_at')
          .limit(10000);
        if (error) throw err(error);
        const grouped = {};
        for (const c of targetCols) grouped[c] = [];
        for (const row of (data || [])) {
          if (grouped[row.collection]) {
            grouped[row.collection].push([row.id, row.data]);
          }
        }
        for (const c of targetCols) {
          const s = getStore(c);
          s.map = new Map(grouped[c] || []);
          s.loaded = true;
          schedulePersist(c, s);
          s.emit();
        }
        return true;
      } catch (e) {
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 1000));
        } else {
          console.warn('loadAllStores network issue, activating local cached stores:', e);
          for (const c of targetCols) {
            const s = getStore(c);
            if (s.map.size > 0) {
              s.loaded = true;
              s.emit();
            }
          }
          return false;
        }
      }
    }
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
            s.map = new Map(rows.map(r => [r.id, r.data]));
            s.loaded = true;
            schedulePersist(c, s);
            s.emit();
          } catch (e) {
            console.warn('load for ' + c + ': ' + (e && e.message || e));
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
            s.map = new Map(list.map(r => [r.id, r.data]));
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
        const prev = s.map.get(id);
        s.map.set(id, d);
        schedulePersist(c, s);
        s.emit();
        try {
          const { error } = await sb.from('docs').upsert({ collection: c, id, data: d });
          if (error) {
            if (prev) s.map.set(id, prev); else s.map.delete(id);
            schedulePersist(c, s);
            s.emit();
            throw err(error);
          }
        } catch (e) {
          if (prev) s.map.set(id, prev); else s.map.delete(id);
          schedulePersist(c, s);
          s.emit();
          throw e;
        }
      },
      async delete() {
        const prev = s.map.get(id);
        if (prev) {
          s.map.delete(id);
          schedulePersist(c, s);
          s.emit();
        }
        try {
          const { data, error } = await sb.from('docs').delete().eq('collection', c).eq('id', id).select('id');
          if (error) {
            if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
            throw err(error);
          }
          if (!data || !data.length) {
            if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
            throw denied();
          }
        } catch (e) {
          if (prev) { s.map.set(id, prev); schedulePersist(c, s); s.emit(); }
          throw e;
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
    user: { async canEdit() { return prof.role === 'admin'; }, async isOwner() { return prof.role === 'admin'; }, async me() { return { id: uid, name: prof.name || email, email }; } },
    db: { collection: colRef, doc: docRef, clearAll, reloadAll, loadAll: loadAllStores, getStatus, assignUpiCredit: async (creditId, mid) => {
      const { data, error } = await sb.rpc('assign_upi_credit', { p_credit_id: creditId, p_mid: mid });
      if (error) throw err(error);
      await loadAllStores(null, true);
      return data;
    }}, downloads, sample
  };
  window.claude = { use: n => (n === 'db' ? Promise.resolve(caps.db) : ready.then(() => caps[n] || null)) };

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
    fetch('/api/config', { signal: AbortSignal.timeout(4000) })
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
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
        global: { fetch: fetchWithTimeout }
      });
    } catch (e) {
      overlay('<div class="card" style="max-width:340px;margin:0"><b>Client Error</b><p class="m">' + e.message + '</p><button class="p" onclick="location.reload()">Retry</button></div>');
      return;
    }

    let s = null;
    try {
      s = (await sb.auth.getSession()).data.session;
    } catch (_) {}

    // Check for cached profile - unblock immediately if available
    let hasCachedProf = false;
    try {
      const cp = localStorage.getItem('gf_prof');
      if (cp) {
        prof = JSON.parse(cp);
        if (s && s.user) { uid = s.user.id; email = s.user.email || ''; }
        hasCachedProf = true;
      }
    } catch (_) {}

    // Fast-derive profile from session user email if not in localStorage
    if (s && (!prof || !prof.role)) {
      const em = (s.user && s.user.email || '').toLowerCase();
      const isAdmin = em.includes('durgasravan') || em.includes('sravan') || em.includes('admin');
      prof = {
        role: isAdmin ? 'admin' : 'collector',
        name: isAdmin ? 'Durga Sravan' : 'Gangaya'
      };
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
      window.__signout = async () => {
        try { await sb.auth.signOut(); } catch (_) {}
        try { localStorage.removeItem('gf_prof'); } catch (_) {}
        location.reload();
      };
      finish();
      // Background-validate profile without blocking
      if (s.user && s.user.id) {
        sb.from('profiles').select('role,name').eq('id', s.user.id).maybeSingle()
          .then(res => {
            if (res.data && res.data.role) {
              prof = res.data;
              try { localStorage.setItem('gf_prof', JSON.stringify(res.data)); } catch (_) {}
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
        prof = data;
        uid = s.user.id;
        email = s.user.email || '';
        try { localStorage.setItem('gf_prof', JSON.stringify(data)); } catch (_) {}
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
      location.reload();
    };
    finish();
  }
  boot();
})();
