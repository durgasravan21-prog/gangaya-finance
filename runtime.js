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
          if (m) m.setAttribute('content', next === 'dark' ? '#121513' : '#1f7a4d');
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
            s.emit();
          } catch (e) {
            console.error('load error for ' + c, e);
          }
        }
      };
      stores.set(c, s);

      let t = 0;
      const ch = sb.channel('docs-' + c + '-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'collection=eq.' + c }, p => {
          if (p.eventType === 'DELETE') {
            const delId = (p.old && p.old.id) || (p.new && p.new.id);
            if (delId) { s.map.delete(delId); s.emit(); }
          } else if (p.new && p.new.id && p.new.data) {
            s.map.set(p.new.id, p.new.data);
            s.emit();
          }
        })
        .subscribe(st => {
          if (st === 'SUBSCRIBED') s.load();
          else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); t = setTimeout(() => s.load(), 5000); }
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
        } else {
          s.load().catch(e => { if (on && fail) fail(e); });
        }
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
          s.emit();
        } else {
          s.load();
        }
      },
      async set(d) {
        const { error } = await sb.from('docs').upsert({ collection: c, id, data: d });
        if (error) throw err(error);
        s.map.set(id, d);
        s.emit();
      },
      async delete() {
        const { data, error } = await sb.from('docs').delete().eq('collection', c).eq('id', id).select('id');
        if (error) throw err(error);
        if (!data || !data.length) throw denied();
        s.map.delete(id);
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
            body: JSON.stringify({ name })
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
          const res = await fetch('https://inputtools.google.com/request?text=' + encodeURIComponent(p) + '&itc=te-t-i0-und&num=1');
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
    try {
      const cfg = await (await fetch('/api/config', { cache: 'no-store' })).json();
      if (!cfg.url || !cfg.anonKey) throw new Error('config');
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    } catch (e) {
      overlay('<div class="card" style="max-width:340px;margin:0"><b>Not configured yet</b><p class="m">Set SUPABASE_URL and SUPABASE_ANON_KEY in the Vercel project settings, then redeploy.</p></div>');
      return;
    }
    let s = (await sb.auth.getSession()).data.session, msg = '';
    for (;;) {
      if (!s) { await loginUI(msg); s = (await sb.auth.getSession()).data.session; }
      const { data, error } = await sb.from('profiles').select('role,name').eq('id', s.user.id).maybeSingle();
      if (data && data.role) { prof = data; uid = s.user.id; email = s.user.email || ''; break; }
      msg = error ? 'Could not reach the server. Check the connection and sign in again.' : 'This account has no access. Ask the owner to enable it.';
      await sb.auth.signOut(); s = null;
    }
    const o = document.getElementById('rt-ov'); if (o) o.remove();
    sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
    window.__signout = async () => { await sb.auth.signOut(); location.reload(); };
    finish();
  }
  boot();
})();
