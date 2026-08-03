# Authentiqo

A digital product passport platform for electronics. Authentiqo logs the full
repair and ownership history of a device — from manufacturing through
repairs, ownership transfers, and resale — so buyers can verify what they're
actually getting before they pay for it.

**Buyers** scan a QR code or enter a serial number to see a device's
complete, tamper-evident repair timeline and an algorithmic Trust Score — no
account required. **Repair shops** authenticate with a company account and
permanently stamp repairs and part replacements to a device's history; once
logged, an entry can never be edited or deleted. **Sellers** register
devices for resale, automatically inherit the verified repair history tied
to that serial number, and generate a QR code that encodes the repair count
and ownership-transfer count for buyers to check.

Repair history is the immutable source of truth. Sellers can view it but
never touch it — the only thing they control is device registration and
ownership metadata (owner count, not owner identity).

---

## Tech stack

- **Backend**: Node.js + Express, REST API
- **Database**: Postgres, hosted by [Supabase](https://supabase.com), accessed
  through the `@supabase/supabase-js` client — because it lives on Supabase's
  servers (not in the browser), every buyer, seller, and repair shop hitting
  your deployed URL — from any device — reads and writes the same shared data
- **Auth**: JWT tokens, passwords hashed with `bcryptjs`
- **QR codes**: generated server-side with the `qrcode` package
- **Frontend**: plain HTML/CSS/JS (no build step, no framework) — served as
  static files by Express

No native modules to compile locally. Create a free Supabase project, run one
SQL script, `npm install`, add one `.env` file, and it runs.

---

## Project structure

```
authentiqo/
├── server.js                  Express app entry point
├── package.json
├── .env.example                Copy to .env and fill in
├── render.yaml                 One-click Render.com deployment config
├── db/
│   ├── database.js             Connects to your Supabase project
│   ├── schema.sql               Table definitions (paste into Supabase SQL Editor)
│   └── seed.js                  Optional: adds one demo device + accounts
├── middleware/
│   └── auth.js                  JWT signing + role-based route protection
├── routes/
│   ├── auth.js                  Repairman + seller signup/login
│   ├── devices.js               Seller: register devices, generate QR codes
│   ├── repairs.js               Repairman: log repair entries (immutable)
│   └── buyer.js                  Public: look up a device by serial number
├── utils/
│   ├── trustScore.js             Trust Score calculation logic
│   └── qrGenerator.js            QR code generation
└── public/                      Static frontend
    ├── index.html                Homepage — 3 role entry points
    ├── buyer.html                 QR scan / serial lookup
    ├── device.html                 Buyer results: timeline + Trust Score
    ├── repairman-login.html
    ├── repairman-dashboard.html    Log repairs
    ├── seller-login.html
    ├── seller-dashboard.html       Register devices, generate QR codes
    ├── css/style.css
    └── js/api.js
```

---

## Data model

**`devices`** — one row per physical device, keyed by `serial_number`.
Tracks brand/model/type, which seller registered it, and
`ownership_transfer_count` (an integer counter — no owner names or personal
data are ever stored).

**`repair_logs`** — one row per repair. Foreign-keyed to a device's serial
number and to the repair company that logged it. **Immutable**: there is
intentionally no update or delete route for this table anywhere in the API.

**`ownership_events`** — one row per ownership transfer, used to detect
rapid resale flips for the Trust Score. Stores a timestamp and the new
owner number only.

**`repair_companies`** / **`sellers`** — auth tables. Passwords are hashed
with bcrypt; plaintext passwords are never stored.

Full column definitions are in [`db/schema.sql`](db/schema.sql).

---

## Trust Score

Calculated in [`utils/trustScore.js`](utils/trustScore.js), starting from a
neutral baseline of 70 and adjusted by:

- **Verification mix** — verified entries from registered shops raise the
  score; self-reported entries lower confidence
- **Timeline plausibility** — repair entries clustered suspiciously on the
  same day repeatedly are flagged
- **Ownership stability** — original owner raises the score; many owners
  lowers it
- **Rapid resale flips** — ownership transfers within two weeks of each
  other lower the score

Returns `{ score, band, factors }` where `band` is `high` / `moderate` /
`low` and `factors` is a plain-language list shown on the buyer page. It's
rule-based and transparent by design — you can swap in a more sophisticated
model later without changing what the API returns.

**This is displayed with the disclaimer "Trust Scores are algorithmic
estimates, not guarantees" everywhere it appears**, per the product
requirement — don't remove that.

---

## Running it locally

### 1. Install Node.js

You need Node 18 or newer. Check your version:

```bash
node -v
```

If you don't have Node, install it from [nodejs.org](https://nodejs.org)
(the LTS version), or with a version manager like `nvm`:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts
```

### 2. Get the code onto your machine

If you're putting this in your own GitHub repo (recommended — see the next
section), clone your repo and copy these files in. Otherwise, just make
sure all the files above are in one folder called `authentiqo`.

### 3. Create a free Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (GitHub login works).
2. Click **New project**. Give it any name, set a database password (save
   it somewhere, though you won't need it for this app), pick the region
   closest to you, and click **Create new project**. Wait ~2 minutes for it
   to finish provisioning.
3. Once it's ready, open the **SQL Editor** in the left sidebar, click
   **New query**, open [`db/schema.sql`](db/schema.sql) from this project,
   copy its entire contents, paste it into the SQL Editor, and click **Run**.
   This creates all the tables the app needs. You only need to do this once.
4. Go to **Project Settings** (gear icon) -> **API**. You'll need two values
   from this page in the next step:
   - **Project URL** (looks like `https://abcxyz.supabase.co`)
   - **service_role** secret key, under "Project API keys" — click "Reveal"
     to see it. **Not** the `anon` `public` key — the `service_role` one.

### 4. Install dependencies

```bash
cd authentiqo
npm install
```

This reads `package.json` and downloads Express, the Supabase client,
bcryptjs, jsonwebtoken, qrcode, and the other packages into `node_modules/`.
Nothing here needs to compile native code, so this step should just work.

### 5. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:

- `JWT_SECRET` — generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
  and paste the output in as `JWT_SECRET=...`.
- `SUPABASE_URL` — the Project URL from step 3.
- `SUPABASE_SERVICE_KEY` — the `service_role` key from step 3.

Leave `PUBLIC_BASE_URL` as `http://localhost:3000` for now — you'll change
it after deploying.

### 6. Start the server

```bash
npm start
```

You should see:

```
Authentiqo server running at http://localhost:3000
```

Open that URL in your browser. All data now reads and writes through your
Supabase project.

**Optional — load demo data** so you have something to test with
immediately:

```bash
npm run seed
```

This prints a demo repairman login, seller login, and a serial number
(`SN-DEMO-0001`) you can search for on the buyer page.

### 7. Make changes and auto-restart (optional)

For development, `npm run dev` uses `nodemon` to restart the server
automatically whenever you edit a file.

---

## Putting it in a GitHub repository

```bash
cd authentiqo
git init
git add .
git commit -m "Initial commit: Authentiqo product passport platform"
```

Then create an empty repository on GitHub (no README/gitignore — you
already have those), and push:

```bash
git remote add origin https://github.com/YOUR_USERNAME/authentiqo.git
git branch -M main
git push -u origin main
```

`.gitignore` is already set up to keep `node_modules/` and your `.env` file
out of git — you never want to commit secrets like your Supabase key.

### Suggested GitHub repo description

> Authentiqo is a digital product passport platform that logs the complete
> repair and ownership history of electronic devices. Repair shops
> permanently stamp service records to a device's serial number, sellers
> register devices and generate QR codes that expose that history, and
> buyers scan or search to see a full timeline plus an algorithmic Trust
> Score — before they buy.

---

## Deploying to Render.com

1. **Push the repo to GitHub** (steps above) if you haven't already.
2. Go to [render.com](https://render.com) and sign in (GitHub login is
   easiest).
3. Click **New +** → **Web Service**, and connect your `authentiqo`
   GitHub repo.
4. Render will detect `render.yaml` automatically and pre-fill most
   settings. If it doesn't, set these manually:
   - **Build command**: `npm install`
   - **Start command**: `npm start`
   - **Environment**: Node
5. Set environment variables under **Environment**:
   - `JWT_SECRET` — generate one the same way as above; Render can also
     auto-generate this for you (already set up in `render.yaml`)
   - `PUBLIC_BASE_URL` — after your first deploy, Render gives you a URL
     like `https://authentiqo.onrender.com`. Come back and set this
     variable to that exact URL, then redeploy. This is what gets baked
     into every generated QR code, so it needs to be your real public URL,
     not `localhost`.
   - `SUPABASE_URL` — same Project URL you used locally.
   - `SUPABASE_SERVICE_KEY` — same `service_role` key you used locally.
6. Click **Create Web Service**. Render will install dependencies, start
   the server, and give you a live URL.
7. Visit your live URL and confirm the homepage loads. Try registering a
   repairman account and a seller account to confirm data is being saved
   (refresh the page, log back in — if your login persists, the database
   is working). You can also check the **Table Editor** in your Supabase
   project to see the rows land in real time.

### A note on the free tier

Render's free web service tier can spin down when idle and spin back up on
the next request (with a short delay). That's fine for demos. Your data
itself is unaffected by this either way — it lives in Supabase, not on
Render's server, so it survives restarts, redeploys, and idle spin-downs
with no extra setup on your end.

---

## API reference

All endpoints are prefixed with `/api`. Authenticated endpoints expect
`Authorization: Bearer <token>`.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/repairman/signup` | — | Create a repair company account |
| POST | `/auth/repairman/login` | — | Log in as a repair company |
| POST | `/auth/seller/signup` | — | Create a seller account |
| POST | `/auth/seller/login` | — | Log in as a seller |
| POST | `/repairs` | repairman | Log a repair entry (immutable) |
| GET | `/repairs/mine` | repairman | List entries logged by your company |
| POST | `/devices/register` | seller | Register or transfer a device |
| GET | `/devices/mine` | seller | List devices you've registered |
| GET | `/devices/:serial/qrcode` | seller | Generate a QR code for a device |
| GET | `/device-lookup/:serial` | — (public) | Full history + Trust Score for buyers |
| GET | `/health` | — | Health check |

---

## Security notes

- Passwords are hashed with bcrypt (never stored in plain text).
- Auth uses signed JWTs with a 12-hour expiry.
- Rate limiting is applied to `/api/auth/*` to slow down brute-force
  attempts.
- `helmet` sets sensible security headers by default.
- Repair log entries have no update/delete route by design — immutability
  is enforced at the API layer, not just the UI.

Before going to production with real user data, also consider: HTTPS
(Render provides this automatically), stronger password requirements,
email verification, and a proper backup strategy for your database file.
