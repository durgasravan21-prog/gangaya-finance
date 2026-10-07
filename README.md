# Gangaya Finance

Collections, WhatsApp receipts (Telugu), ledger and reports for a private lending business.
Static site + two small Vercel functions + Supabase (login and database). No build step.

```
index.html        the app            runtime.js   sign-in + data layer
api/config.js     public settings    api/sample.js  English -> Telugu names (admin only, optional)
supabase/schema.sql   database, permissions, safeguards      supabase/seed_users.sql   the two accounts
vendor/supabase.js    Supabase client v2.45.4 (bundled, no CDN)      vercel.json   security headers
```

## 1. Supabase (database + login)
1. supabase.com -> New project (pick a nearby region, e.g. Mumbai). Save the database password.
2. **SQL Editor** -> paste all of `supabase/schema.sql` -> Run. (Safe to run again.)
3. **Authentication -> Sign In / Providers -> Email**: turn **OFF "Allow new users to sign up"**.
4. **Create the two accounts** - `durgasravan21@gmail.com` (admin) and `challagollasridevi@gmail.com` (collector). Pick one way:
   - *Script (on your own computer, in this folder; needs Node 18+).* Passwords are typed into the command, never stored in the project:
     ```
     SUPABASE_URL=https://xxxx.supabase.co SERVICE_ROLE_KEY=<secret key> \
     ADMIN_PASSWORD='<your password>' FATHER_PASSWORD='<a different password>' node scripts/create-users.js
     ```
     The secret key is under Project Settings -> API (`service_role`). Use it only here, never commit it, never put it in Vercel.
     Run it again any time to reset the passwords. It refuses identical passwords and passwords under 10 characters.
   - *Dashboard.* Authentication -> Users -> Add user for both emails (tick **Auto Confirm User**), then run `supabase/seed_users.sql`.
5. Anyone without a row in `profiles` can sign in but sees nothing.
6. **Project Settings -> API** (this is the *public* page): copy the **Project URL** and the **anon / public** key. Never use `service_role`.

## 2. GitHub
```
cd gangaya-finance
git init -b main
git add .
git commit -m "Gangaya Finance"
# create an EMPTY PRIVATE repo on github.com, then:
git remote add origin https://github.com/YOUR-USER/gangaya-finance.git
git push -u origin main
```

## 3. Vercel
1. vercel.com -> Add New -> Project -> import the repo.
2. Framework Preset **Other**. Leave Build Command and Output Directory empty.
3. Environment Variables:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_ANON_KEY` = anon / public key
   - `ANTHROPIC_API_KEY` = optional, only for automatic Telugu names (admin only). Without it, type the Telugu name yourself.
4. Deploy. Open the URL, sign in with your admin account.
   Changing an environment variable needs a redeploy.

### Or deploy from the command line
```
npx vercel login
npx vercel link
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_ANON_KEY production
npx vercel --prod
```

## 4. First-run checklist
- Admin: Villages -> add a village and its collection day. Members -> add a member with a loan.
- Father (his phone, his account): sees the Telugu collector screen; Collect -> Done -> pays appear on your Receipts tab live.
- Receipts -> green bar opens WhatsApp one by one. Reports -> Download Excel.
- On each phone: browser menu -> Add to Home screen.

## Rules enforced by the database (not just the screens)
- Father's account can only **add payments**. It cannot add/edit members, villages, loans or mark receipts.
- Payment and loan records can **never be edited or deleted**, by anyone. Only the receipt "sent" flag changes.
- A member who has records cannot be deleted (the app archives him instead).
- Time, date (India) and author of every payment/loan are set by the server, so a wrong phone clock cannot change them.
- Amounts must be positive, loan total >= loan given, payment mode cash/upi.
- No sign-ups, no anonymous access. Row Level Security is on for every table.
- Headers: HTTPS only, no framing, no referrer, content-security policy (`vercel.json`).
  The CSP allows inline scripts because the app uses inline click handlers; all data shown is HTML-escaped and validated.

## Please do
- **Passwords:** use two different passwords of 12+ characters. The admin and collector accounts only stay separate if their passwords differ - with one shared password, whoever knows it can sign in as admin. Six-digit numbers can be guessed. Never put passwords or tokens in the code or in chat.
- Download the Excel from Reports regularly as your own backup, and check Supabase's current backup/pausing rules for the plan you use.
- Never put the `service_role` key anywhere in this project.

## Not included
- Data from the Claude-hosted version does not move across automatically (download its Excel first if you need it).
- WhatsApp still needs one Send tap per chat. Fully automatic sending needs the WhatsApp Business Cloud API.
