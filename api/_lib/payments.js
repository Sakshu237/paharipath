// /api/_lib/payments.js
// Razorpay + money settings, all driven by Vercel environment variables so
// nothing secret ever sits in the repo and payments can be switched on/off
// without a code change.
//
// Vercel env vars:
//   PAY_ONLINE=1                 turn online payment on (anything else = "pay at stay")
//   RAZORPAY_KEY_ID              rzp_live_… or rzp_test_… (public key id)
//   RAZORPAY_KEY_SECRET          secret — server only, never in the browser
//   RAZORPAY_WEBHOOK_SECRET      the secret you type when creating the webhook
//   GST_RATE=0.05                GST charged to guests (leave unset until you have a GSTIN)
//   GSTIN                        your GSTIN, printed on invoices
//   HOLD_MINUTES=15              how long unpaid dates stay reserved

const crypto = require('crypto');

function cfg() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  const gstRate = Math.min(Math.max(Number(process.env.GST_RATE) || 0, 0), 0.28);
  return {
    payOnline: process.env.PAY_ONLINE === '1' && !!keyId && !!secret,
    keyId, secret,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    gstRate,
    gstin: process.env.GSTIN || '',
    holdMinutes: Math.min(Math.max(parseInt(process.env.HOLD_MINUTES) || 15, 5), 60),
  };
}

// Public part of the config — safe for the browser.
function publicCfg() {
  const c = cfg();
  return { payOnline: c.payOnline, keyId: c.payOnline ? c.keyId : '', gstRate: c.gstRate, holdMinutes: c.holdMinutes };
}

async function razorpay(path, method, body) {
  const c = cfg();
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.keyId}:${c.secret}`).toString('base64'), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.description) || `Razorpay ${path} failed (${r.status})`);
  return j;
}

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a || ''), 'utf8'), y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyCheckoutSignature(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', cfg().secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

// Webhook signature: HMAC_SHA256(raw request body, webhook_secret)
function verifyWebhookSignature(rawBody, signature) {
  const s = cfg().webhookSecret;
  if (!s) return false;
  const expected = crypto.createHmac('sha256', s).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

const rupees = s => parseInt(String(s || '0').replace(/[^0-9]/g, '')) || 0;

// Marks a pending booking as paid exactly once. Returns the updated booking,
// or null if it was already handled. If the dates were taken by someone else
// while this guest was paying (hold expired), the payment is refunded in full.
async function confirmPaidBooking(booking, paymentId, paidPaise, headers, SUPABASE_URL) {
  // A payment can arrive after the hold ran out (slow UPI, late webhook).
  // Make sure nobody else confirmed these dates in the meantime.
  {
    const clash = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${booking.stay_id}&status=eq.confirmed&id=neq.${encodeURIComponent(booking.id)}&checkin_date=lt.${booking.checkout_date}&checkout_date=gt.${booking.checkin_date}&select=id`,
      { headers }
    ).then(r => r.json()).catch(() => []);
    if (Array.isArray(clash) && clash.length) {
      let refundId = null;
      try { refundId = (await razorpay(`/payments/${paymentId}/refund`, 'POST', { amount: paidPaise, notes: { booking_ref: booking.id, reason: 'dates no longer available' } })).id; } catch (e) { console.error('auto-refund failed', e.message); }
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ status: 'cancelled', payment_status: refundId ? 'refunded' : 'refund_failed', payment_id: paymentId, refund_id: refundId, refund_status: refundId ? 'initiated' : 'failed', cancelled_at: new Date().toISOString() }),
      });
      return { clash: true };
    }
  }
  const patch = { status: 'confirmed', payment_status: 'paid', payment_id: paymentId, paid_amount: Math.round(paidPaise / 100), paid_at: new Date().toISOString(), payout_status: 'due' };
  if (booking.gst_amount > 0) {
    const inv = await fetch(`${SUPABASE_URL}/rest/v1/rpc/next_invoice_no`, { method: 'POST', headers, body: '{}' }).then(r => r.json()).catch(() => null);
    if (typeof inv === 'string') patch.invoice_no = inv;
  }
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}&status=in.(pending_payment,expired)`,
    { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(patch) }
  );
  const rows = r.ok ? await r.json() : [];
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = { cfg, publicCfg, razorpay, verifyCheckoutSignature, verifyWebhookSignature, confirmPaidBooking, rupees };
