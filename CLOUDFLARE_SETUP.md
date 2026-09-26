# VINTIQQ — Cloudflare Workers

This version runs the VINTIQQ frontend as Cloudflare Static Assets and the Razorpay/Google Sheets API as a Cloudflare Worker.

## What changed

- Replaced the Express/Vercel server runtime with `worker.js`.
- Razorpay is called directly through its HTTPS API; the Node-only Razorpay SDK is no longer required.
- Payment signature verification uses the Web Crypto API available in Cloudflare Workers.
- Google Sheets webhook integration is preserved.
- The existing checkout frontend still calls:
  - `POST /api/create-order`
  - `POST /api/verify-payment`
- `public/` is the single Cloudflare static-assets directory.
- The root HTML files were synced into `public/` so Cloudflare does not deploy a stale duplicate homepage.
- Root `assets/` were synced into `public/assets/`.

## 1. Install

```powershell
npm install
```

## 2. Local secrets

Create `.dev.vars` from `.dev.vars.example` and put in the same values currently used by VINTIQQ:

```text
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
GOOGLE_SHEETS_WEBHOOK_URL=...
GOOGLE_SHEETS_SHARED_SECRET=...
```

Do not commit `.dev.vars`.

## 3. Local test

```powershell
npm run dev
```

Open the Wrangler local URL it prints.

## 4. Add production secrets

Run these one at a time:

```powershell
npx wrangler secret put RAZORPAY_KEY_ID
npx wrangler secret put RAZORPAY_KEY_SECRET
npx wrangler secret put GOOGLE_SHEETS_WEBHOOK_URL
npx wrangler secret put GOOGLE_SHEETS_SHARED_SECRET
```

Paste the existing values when prompted.

## 5. Deploy

```powershell
npm run deploy
```

Cloudflare deploys the Worker and the contents of `public/` together.

## 6. Domain

After the Worker works on its `workers.dev` URL, attach `vintiqq.shop` as a Custom Domain in the Cloudflare dashboard.

Do not change the GoDaddy DNS until the Cloudflare project/domain screen tells you exactly which DNS records it requires.

## Important

Razorpay secrets stay server-side. Do not put `RAZORPAY_KEY_SECRET` in HTML, browser JavaScript, `wrangler.toml`, or GitHub.

The public Razorpay Key ID is intentionally returned by `/api/create-order`, as it was in the original Vercel implementation.
