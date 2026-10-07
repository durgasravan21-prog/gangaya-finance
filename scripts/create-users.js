// Creates (or resets) the two accounts and gives them their roles.
// RUN ON YOUR OWN COMPUTER ONLY. Passwords come from environment variables, so they are never written into the project.
//
//   SUPABASE_URL=https://xxxx.supabase.co SERVICE_ROLE_KEY=... ADMIN_PASSWORD=... FATHER_PASSWORD=... node scripts/create-users.js
//
// SERVICE_ROLE_KEY is the secret key from Supabase -> Project Settings -> API. Never commit it, never put it in Vercel.
const U = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), K = process.env.SERVICE_ROLE_KEY || '';
const USERS = [
  { email: 'durgasravan21@gmail.com',      name: 'Sravan', role: 'admin',     pw: process.env.ADMIN_PASSWORD },
  { email: 'challagollasridevi@gmail.com', name: 'Father', role: 'collector', pw: process.env.FATHER_PASSWORD }
];
const die = m => { console.error('\n' + m + '\n'); process.exit(1); };
if (!U || !K) die('Set SUPABASE_URL and SERVICE_ROLE_KEY.');
if (!USERS[0].pw || !USERS[1].pw) die('Set ADMIN_PASSWORD and FATHER_PASSWORD.');
if (USERS[0].pw === USERS[1].pw && process.env.ALLOW_WEAK !== '1')
  die('Refusing: both accounts have the same password. Anyone who knows the collector password could sign in as admin.\nUse two different passwords (or set ALLOW_WEAK=1 to override).');
for (const u of USERS) if (u.pw.length < 10 && process.env.ALLOW_WEAK !== '1')
  die('Refusing: the password for ' + u.email + ' is shorter than 10 characters. Short or numeric-only passwords can be guessed.\nUse a longer one (or set ALLOW_WEAK=1 to override at your own risk).');
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };
async function api(method, path, body, extra) {
  const r = await fetch(U + path, { method, headers: { ...H, ...(extra || {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ok: r.ok, body: j };
}
(async () => {
  for (const u of USERS) {
    let id, r = await api('POST', '/auth/v1/admin/users', { email: u.email, password: u.pw, email_confirm: true });
    if (r.ok) { id = r.body.id; console.log('created  ' + u.email); }
    else if (r.status === 422 || (r.body && /exist|registered/i.test(JSON.stringify(r.body)))) {
      const list = await api('GET', '/auth/v1/admin/users?per_page=1000');
      const found = list.ok && (list.body.users || []).find(x => (x.email || '').toLowerCase() === u.email);
      if (!found) die('Could not find the existing user ' + u.email);
      id = found.id;
      const up = await api('PUT', '/auth/v1/admin/users/' + id, { password: u.pw, email_confirm: true });
      if (!up.ok) die('Could not update ' + u.email + ' (' + up.status + ')');
      console.log('updated  ' + u.email + ' (password reset)');
    } else die('Could not create ' + u.email + ' (' + r.status + ')');
    const p = await api('POST', '/rest/v1/profiles', [{ id, role: u.role, name: u.name }], { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (!p.ok) die('Could not save the role for ' + u.email + ' (' + p.status + '). Did you run supabase/schema.sql first?');
    console.log('role     ' + u.email + ' -> ' + u.role);
  }
  console.log('\nDone. Sign in at your site with these emails.');
})().catch(e => die('Failed: ' + e.message));
