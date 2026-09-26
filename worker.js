const JSON_HEADERS = {
  "content-type": "application/json; charset=UTF-8",
  "cache-control": "no-store",
};

const AMOUNT = 1499 * 100;
const CURRENCY = "INR";
const PRODUCT = "VINTIQQ Life Camera";
const DELIVERY = "2 weeks";
const SHIPPING = "FREE";

const ALLOWED_COLORS = new Set([
  "Vintage Brown",
  "Seaweed Green",
  "Ghost Black",
  "Space White",
]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

function clean(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validateCustomer(body) {
  const name = clean(body.name, 100);
  const phone = clean(body.phone, 20).replace(/\D/g, "");
  const email = clean(body.email, 150).toLowerCase();
  const pin = clean(body.pin, 10).replace(/\D/g, "");
  const city = clean(body.city, 80);
  const state = clean(body.state, 80);
  const address = clean(body.address, 500);
  const color = clean(body.color, 50);

  if (
    !name ||
    phone.length < 10 ||
    !email.includes("@") ||
    pin.length !== 6 ||
    !city ||
    !state ||
    !address
  ) {
    throw new Error("Please enter valid delivery details.");
  }

  if (!ALLOWED_COLORS.has(color)) {
    throw new Error("Invalid colour selected.");
  }

  return { name, phone, email, pin, city, state, address, color };
}

function razorpayAuth(env) {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay keys are not configured on the server.");
  }

  return "Basic " + btoa(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`
  );
}

async function razorpayRequest(env, path, options = {}) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: razorpayAuth(env),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      data?.error?.description ||
      data?.error?.reason ||
      `Razorpay API error: ${response.status}`
    );
  }

  return data;
}

async function createOrder(env, customer) {
  const receipt = `VQ_${Date.now()}`;

  return razorpayRequest(env, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: AMOUNT,
      currency: CURRENCY,
      receipt,
      notes: {
        product: PRODUCT,
        color: customer.color,
        customer_name: customer.name,
        customer_phone: customer.phone,
        customer_email: customer.email,
        pin: customer.pin,
        city: customer.city,
        state: customer.state,
      },
    }),
  });
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );

  return bytesToHex(signature);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function verifySignature(env, orderId, paymentId, signature) {
  const expected = await hmacSha256Hex(
    env.RAZORPAY_KEY_SECRET,
    `${orderId}|${paymentId}`
  );
  return constantTimeEqual(expected, signature);
}

async function saveToGoogleSheets(env, record) {
  if (!env.GOOGLE_SHEETS_WEBHOOK_URL) {
    console.warn("GOOGLE_SHEETS_WEBHOOK_URL is not configured; skipping Sheets write.");
    return;
  }

  const response = await fetch(env.GOOGLE_SHEETS_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: env.GOOGLE_SHEETS_SHARED_SECRET || "",
      ...record,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Sheets write failed: ${response.status}`);
  }

  const result = await response.json().catch(() => null);
  if (!result || result.ok !== true) {
    throw new Error(
      result?.error || "Google Sheets webhook rejected the order."
    );
  }
}

async function handleCreateOrder(request, env) {
  try {
    const body = await request.json();
    const customer = validateCustomer(body);
    const order = await createOrder(env, customer);

    return json({
      key_id: env.RAZORPAY_KEY_ID,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
    });
  } catch (error) {
    console.error("create-order:", error);
    return json(
      { error: error.message || "Could not create Razorpay order." },
      400
    );
  }
}

async function handleVerifyPayment(request, env) {
  try {
    const body = await request.json();

    const orderId = clean(body.razorpay_order_id, 100);
    const paymentId = clean(body.razorpay_payment_id, 100);
    const signature = clean(body.razorpay_signature, 200);

    if (!orderId || !paymentId || !signature) {
      return json(
        { error: "Missing payment verification fields." },
        400
      );
    }

    if (!env.RAZORPAY_KEY_SECRET) {
      return json(
        { error: "Razorpay keys are not configured on the server." },
        500
      );
    }

    const valid = await verifySignature(
      env,
      orderId,
      paymentId,
      signature
    );

    if (!valid) {
      return json({ error: "Payment verification failed." }, 400);
    }

    const customer = validateCustomer(body.customer || {});

    // Re-fetch the server-created order so amount/currency are never trusted
    // from browser input.
    const order = await razorpayRequest(env, `/orders/${encodeURIComponent(orderId)}`, {
      method: "GET",
    });

    if (order.amount !== AMOUNT || order.currency !== CURRENCY) {
      return json({ error: "Order amount mismatch." }, 400);
    }

    const payment = await razorpayRequest(
      env,
      `/payments/${encodeURIComponent(paymentId)}`,
      { method: "GET" }
    );

    if (
      payment.order_id !== orderId ||
      Number(payment.amount) !== AMOUNT
    ) {
      return json({ error: "Payment/order mismatch." }, 400);
    }

    const orderRecord = {
      order_id: orderId,
      payment_id: paymentId,
      status: payment.status,
      product: PRODUCT,
      color: customer.color,
      amount: 1499,
      currency: CURRENCY,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      pin: customer.pin,
      delivery: DELIVERY,
      shipping: SHIPPING,
      created_at: new Date().toISOString(),
    };

    if (payment.status === "captured") {
      try {
        await saveToGoogleSheets(env, orderRecord);
      } catch (sheetError) {
        // Payment is already verified. Do not turn a successful payment into
        // a false payment failure if Sheets is temporarily unavailable.
        console.error(
          "Google Sheets write failed after verified payment:",
          sheetError
        );
      }
    }

    return json({ ok: true, order: orderRecord });
  } catch (error) {
    console.error("verify-payment:", error);
    return json(
      { error: error.message || "Payment verification failed." },
      400
    );
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/create-order") {
      return handleCreateOrder(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/verify-payment") {
      return handleVerifyPayment(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
