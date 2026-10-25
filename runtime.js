/* Gangaya Finance - sign-in and data layer (Supabase). Gives the page the small API it uses: claude.use('user'|'db'|'downloads'|'sample'). */
(function () {
  'use strict';
  let sb = null, uid = null, prof = null, email = '', finish;
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
  function loginUI(msg) {
    return new Promise(res => {
      let isSignUp = false;
      const render = () => {
        const curTheme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('gangaya_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        const isDark = curTheme === 'dark';
        const o = overlay('<form id="rt-f" class="card" style="width:100%;max-width:340px;margin:0"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><h1 style="margin:0">📒 Gangaya Finance</h1><button type="button" class="sm" id="rt-th" style="padding:2px 9px;font-size:12px">' + (isDark ? '☀️ Light' : '🌙 Dark') + '</button></div><p class="m" style="margin:0 0 12px">' + (isSignUp ? 'Create your account (first time setup)' : 'Sign in to continue') + '</p>' +
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
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('docs').select('id,data').eq('collection', c).order('created_at').order('id').range(from, from + 999);
      if (error) throw err(error);
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  }
  const stores = new Map();
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
        async load() {
          try {
            const rows = await allRows(c);
            s.map = new Map(rows.map(r => [r.id, r.data]));
            s.loaded = true;
            try {
              localStorage.setItem('gf_c_' + c, JSON.stringify(rows.map(r => ({ id: r.id, data: r.data }))));
            } catch (_) {}
            s.emit();
          } catch (e) {
            console.error('load error for ' + c, e);
            if (s.map.size > 0) s.emit();
            else throw e;
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

      let t = 0;
      const ch = sb.channel('docs-' + c + '-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'collection=eq.' + c }, p => {
          if (p.eventType === 'DELETE') {
            const delId = (p.old && p.old.id) || (p.new && p.new.id);
            if (delId) {
              s.map.delete(delId);
              try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([id, data]) => ({ id, data })))); } catch (_) {}
              s.emit();
            }
          } else if (p.new && p.new.id && p.new.data) {
            s.map.set(p.new.id, p.new.data);
            try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([id, data]) => ({ id, data })))); } catch (_) {}
            s.emit();
          }
        })
        .subscribe(st => {
          if (st === 'SUBSCRIBED') s.load().catch(() => {});
          else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
            clearTimeout(t);
            t = setTimeout(() => s.load().catch(() => {}), 5000);
          }
        });
    }
    return s;
  }

  function colRef(c) {
    const s = getStore(c);
    return {
      async add(d) {
        const id = crypto.randomUUID();
        const { data, error } = await sb.from('docs').insert({ collection: c, id, data: d }).select('id,data').maybeSingle();
        if (error) throw err(error);
        s.map.set(id, (data && data.data) || d);
        try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([i, item]) => ({ id: i, data: item })))); } catch (_) {}
        s.emit();
        return { id };
      },
      onSnapshot(next, fail) {
        s.subs.add(next);
        let on = true;
        if (s.loaded) {
          next({
            size: s.map.size,
            docs: [...s.map].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) }))
          });
        }
        s.load().catch(e => { if (on && fail && !s.loaded) fail(e); });
        return () => { on = false; s.subs.delete(next); };
      }
    };
  }
  function docRef(path) {
    const [c, id] = String(path).split('/');
    const s = getStore(c);
    return {
      async update(patch) {
        const { data, error } = await sb.rpc('doc_update', { c, i: id, patch });
        if (error) throw err(error);
        if (!data) throw denied();
        if (s.map.has(id)) {
          s.map.set(id, { ...s.map.get(id), ...patch });
          try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([i, item]) => ({ id: i, data: item })))); } catch (_) {}
          s.emit();
        } else {
          s.load().catch(() => {});
        }
      },
      async set(d) {
        const { error } = await sb.from('docs').upsert({ collection: c, id, data: d });
        if (error) throw err(error);
        s.map.set(id, d);
        try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([i, item]) => ({ id: i, data: item })))); } catch (_) {}
        s.emit();
      },
      async delete() {
        const { data, error } = await sb.from('docs').delete().eq('collection', c).eq('id', id).select('id');
        if (error) throw err(error);
        if (!data || !data.length) throw denied();
        s.map.delete(id);
        try { localStorage.setItem('gf_c_' + c, JSON.stringify([...s.map].map(([i, item]) => ({ id: i, data: item })))); } catch (_) {}
        s.emit();
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
  const caps = {
    user: { async canEdit() { return prof.role === 'admin'; }, async isOwner() { return prof.role === 'admin'; }, async me() { return { id: uid, name: prof.name || email, email }; } },
    db: { collection: colRef, doc: docRef }, downloads, sample
  };
  window.claude = { use: n => ready.then(() => caps[n] || null) };

  async function boot() {
    let cfg;
    try {
      const r = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      cfg = await r.json();
      if (!cfg.url || !cfg.anonKey) throw new Error('config');
    } catch (e) {
      overlay('<div class="card" style="max-width:360px;margin:0;text-align:center"><h3 style="margin:0 0 8px">⚠ Connection Error</h3><p class="m">Could not load app settings. Check internet connection and tap retry.</p><button class="p" style="margin-top:10px" onclick="location.reload()">🔄 Retry</button></div>');
      return;
    }

    const fetchWithTimeout = (url, options = {}) => {
      const timeoutMs = (options && options.timeout) || 12000;
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
      overlay('<div class="card" style="max-width:340px;margin:0"><b>Client Error</b><p class="m">' + e.message + '</p><button class="p" onclick="location.reload()">🔄 Retry</button></div>');
      return;
    }

    let s = null;
    try {
      s = (await sb.auth.getSession()).data.session;
    } catch (_) {}

    // Check for cached profile in localStorage
    try {
      const cp = localStorage.getItem('gf_prof');
      if (cp && s) {
        prof = JSON.parse(cp);
        uid = s.user.id;
        email = s.user.email || '';
      }
    } catch (_) {}

    let msg = '';
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
            overlay('<div class="card" style="max-width:340px;margin:0;text-align:center"><h3 style="margin:0 0 8px">⏳ Connecting to database…</h3><p class="m">Database is starting up. Retrying (' + attempts + '/3)…</p></div>');
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
          overlay('<div class="card" style="max-width:360px;margin:0"><h3 style="margin:0 0 8px">⚠ Connection Timeout</h3><p class="m">Could not connect to the database. If it was paused, it may take 20-30 seconds to wake up.</p><div class="acts" style="margin-top:12px"><button class="p" id="rt-retry">🔄 Retry Connection</button><button id="rt-so">Sign Out</button></div></div>');
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
