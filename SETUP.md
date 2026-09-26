# VINTIQQ — Razorpay + Google Sheets setup

This package now contains a real server-side Razorpay flow and a Google Sheets order collector.

## 1. Razorpay

Create API keys in Razorpay Dashboard.

For testing, use Test Mode keys first. Put them in `.env`:

RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...

The browser never receives the secret. The server creates the Razorpay order and verifies the payment signature before treating an order as paid.

## 2. Google Sheet

Create a Google Sheet. Open **Extensions → Apps Script** and paste `google-apps-script.gs` into `Code.gs`.

Set `SHARED_SECRET` to a long random value. Use the exact same value in `.env` as `GOOGLE_SHEETS_SHARED_SECRET`.

Deploy the Apps Script as a **Web app**:
- Execute as: **Me**
- Who has access: **Anyone**
- Copy the `/exec` URL

Put that URL in:

GOOGLE_SHEETS_WEBHOOK_URL=...

The first successful payment creates an `Orders` sheet/header row and then each verified order is appended.

## 3. Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## 4. Test

Use Razorpay Test Mode first. Do not put the Razorpay secret in HTML or JavaScript.

After a successful payment, the server verifies the signature and writes the order to Google Sheets.

## 5. Go live

After testing, replace the Test Mode Razorpay keys with Live Mode keys. Razorpay recommends testing end-to-end before switching to live payments.

## Order columns

Timestamp | Order ID | Payment ID | Status | Product | Colour | Amount | Currency | Name | Phone | Email | Address | City | State | PIN | Delivery | Shipping
