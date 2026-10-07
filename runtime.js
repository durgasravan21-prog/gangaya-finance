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
      const o = overlay('<form id="rt-f" class="card" style="width:100%;max-width:340px;margin:0"><h1 style="margin:0 0 4px">📒 Gangaya Finance</h1><p class="m" style="margin:0 0 12px">Sign in to continue</p>' +
        '<div class="g" style="grid-template-columns:1fr"><input id="rt-e" type="email" autocomplete="username" placeholder="Email" required><input id="rt-p" type="password" autocomplete="current-password" placeholder="Password" required></div>' +
        '<p id="rt-m" class="m" style="color:var(--r);min-height:18px"></p><button class="p" style="width:100%;padding:12px">Sign in</button></form>');
      o.querySelector('#rt-m').textContent = msg || '';
      o.querySelector('#rt-f').onsubmit = async ev => {
        ev.preventDefault();
        const b = o.querySelector('button'); b.disabled = true;
        const { error } = await sb.auth.signInWithPassword({ email: o.querySelector('#rt-e').value.trim(), password: o.querySelector('#rt-p').value });
        b.disabled = false;
        if (error) { o.querySelector('#rt-m').textContent = 'Wrong email or password.'; return; }
        res();
      };
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
  function colRef(c) {
    return {
      async add(d) {
        const id = crypto.randomUUID();
        const { error } = await sb.from('docs').insert({ collection: c, id, data: d });
        if (error) throw err(error);
        return { id };
      },
      onSnapshot(next, fail) {
        let map = new Map(), on = true, t = 0;
        const emit = () => { if (on) next({ size: map.size, docs: [...map].map(([id, d]) => ({ id, exists: true, data: () => JSON.parse(JSON.stringify(d)) })) }); };
        const load = async () => { try { map = new Map((await allRows(c)).map(r => [r.id, r.data])); emit(); } catch (e) { if (on && fail) fail(e); } };
        load();
        const ch = sb.channel('docs-' + c + '-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'docs', filter: 'collection=eq.' + c }, p => {
            if (p.eventType === 'DELETE') { if (p.old && p.old.collection && p.old.collection !== c) return; map.delete(p.old.id); }
            else map.set(p.new.id, p.new.data);
            emit();
          })
          .subscribe(s => { if (s === 'SUBSCRIBED') load(); else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); t = setTimeout(load, 5000); } });
        return () => { on = false; sb.removeChannel(ch); };
      }
    };
  }
  function docRef(path) {
    const [c, id] = String(path).split('/');
    return {
      async update(patch) { const { data, error } = await sb.rpc('doc_update', { c, i: id, patch }); if (error) throw err(error); if (!data) throw denied(); },
      async set(d) { const { error } = await sb.from('docs').upsert({ collection: c, id, data: d }); if (error) throw err(error); },
      async delete() { const { data, error } = await sb.from('docs').delete().eq('collection', c).eq('id', id).select('id'); if (error) throw err(error); if (!data || !data.length) throw denied(); }
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
      const { data } = await sb.auth.getSession();
      const r = await fetch('/api/sample', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ name: m[1].trim() }) });
      if (!r.ok) throw new Error('sample unavailable');
      return r.json();
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
