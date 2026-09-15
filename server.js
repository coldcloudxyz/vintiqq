const express = require('express');
const crypto = require('crypto');
const Razorpay = require('razorpay');
const path = require('path');

const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3000;
const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const SHEETS_WEBHOOK_URL = process.env.GOOGLE_SHEETS_WEBHOOK_URL;
const SHEETS_SHARED_SECRET = process.env.GOOGLE_SHEETS_SHARED_SECRET;
const PUBLIC_DIR = path.join(__dirname, 'public');
const AMOUNT = 1499 * 100;

if (!KEY_ID || !KEY_SECRET) {
  console.warn('WARNING: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set.');
}

let razorpay = null;
function getRazorpay() {
  if (!KEY_ID || !KEY_SECRET) throw new Error('Razorpay keys are not configured on the server.');
  if (!razorpay) razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  return razorpay;
}

const allowedColors = new Set(['Vintage Brown', 'Seaweed Green', 'Ghost Black', 'Space White']);

function clean(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

function validateCustomer(body) {
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 20).replace(/\D/g, '');
  const email = clean(body.email, 150).toLowerCase();
  const pin = clean(body.pin, 10).replace(/\D/g, '');
  const city = clean(body.city, 80);
  const state = clean(body.state, 80);
  const address = clean(body.address, 500);
  const color = clean(body.color, 50);

  if (!name || phone.length < 10 || !email.includes('@') || pin.length !== 6 || !city || !state || !address) {
    throw new Error('Please enter valid delivery details.');
  }
  if (!allowedColors.has(color)) throw new Error('Invalid colour selected.');

  return { name, phone, email, pin, city, state, address, color };
}

app.post('/api/create-order', async (req, res) => {
  try {
    if (!KEY_ID || !KEY_SECRET) return res.status(500).json({ error: 'Razorpay keys are not configured on the server.' });
    const customer = validateCustomer(req.body);
    const receipt = `VQ_${Date.now()}`;
    const order = await getRazorpay().orders.create({
      amount: AMOUNT,
      currency: 'INR',
      receipt,
      notes: {
        product: 'VINTIQQ Life Camera',
        color: customer.color,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email,
        pin: customer.pin,
        city: customer.city,
        state: customer.state
      }
    });
    return res.json({
      key_id: KEY_ID,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Could not create Razorpay order.' });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const orderId = clean(req.body.razorpay_order_id, 100);
    const paymentId = clean(req.body.razorpay_payment_id, 100);
    const signature = clean(req.body.razorpay_signature, 200);
    if (!orderId || !paymentId || !signature) return res.status(400).json({ error: 'Missing payment verification fields.' });

    const expected = crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) return res.status(400).json({ error: 'Payment verification failed.' });

    const customer = validateCustomer(req.body.customer || {});

    // Fetch the server-created order so the amount is never trusted from the browser.
    const order = await getRazorpay().orders.fetch(orderId);
    if (order.amount !== AMOUNT || order.currency !== 'INR') {
      return res.status(400).json({ error: 'Order amount mismatch.' });
    }

    const payment = await getRazorpay().payments.fetch(paymentId);
    if (payment.order_id !== orderId || Number(payment.amount) !== AMOUNT) {
      return res.status(400).json({ error: 'Payment/order mismatch.' });
    }

    const orderRecord = {
      order_id: orderId,
      payment_id: paymentId,
      status: payment.status,
      product: 'VINTIQQ Life Camera',
      color: customer.color,
      amount: 1499,
      currency: 'INR',
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pin: customer.pin,
      delivery: '2–3 weeks',
      shipping: 'FREE',
      created_at: new Date().toISOString()
    };

    if (payment.status === 'captured') {
      try {
        await saveToGoogleSheets(orderRecord);
      } catch (sheetErr) {
        // Payment is already verified; do not turn a successful payment into a false failure.
        console.error('Google Sheets write failed after verified payment:', sheetErr);
      }
    }

    return res.json({ ok: true, order: orderRecord });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ error: err.message || 'Payment verification failed.' });
  }
});

async function saveToGoogleSheets(record) {
  if (!SHEETS_WEBHOOK_URL) {
    console.warn('GOOGLE_SHEETS_WEBHOOK_URL not configured; skipping Sheets write.');
    return;
  }
  const response = await fetch(SHEETS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: SHEETS_SHARED_SECRET || '',
      ...record
    })
  });
  if (!response.ok) throw new Error(`Google Sheets write failed: ${response.status}`);
}

app.use(express.static(PUBLIC_DIR));
app.use((req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

if (require.main === module) {
  app.listen(PORT, () => console.log(`VINTIQQ store running on port ${PORT}`));
}

module.exports = app;
