// /api/razorpay-webhook.js
// Razorpay calls this URL directly when a payment is captured or a refund
// is processed. It is the safety net for guests who pay and then close the
// tab before the browser can confirm — their booking still gets confirmed.
//
// SETUP (Razorpay Dashboard → Settings → Webhooks → Add):
//   URL:     https://paharipath.in/api/razorpay-webhook
//   Secret:  any long random text — put the same value in Vercel as RAZORPAY_WEBHOOK_SECRET
//   Events:  payment.captured, order.paid, refund.processed, refund.failed
//
// Every event is checked twice: the HMAC signature, and (for payments) a
// direct fetch of the payment from Razorpay's API before anything changes.

const { cfg, razorpay, verifyWebhookSignature, confirmPaidBooking } = require('./_lib/payments');
const notify = require('./_lib/notify');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

// The signature is over the exact bytes Razorpay sent, so read the raw body
// before anything parses it. Falls back to re-serialising if the platform
// already consumed the stream (the payment is re-checked via the API anyway).
function rawBody(req) {
  return new Promise(resolve => {
    if (typeof req.on !== 'function' || req.readableEnded || req.complete) { resolve(null); return; }
    const chunks = [];
    const timer = setTimeout(() => resolve(chunks.length ? Buffer.concat(chunks).toString('utf8') : null), 3000);
    req.on('data', c => chunks.push(c));
    req.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => resolve(null));
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !cfg().webhookSecret) { res.status(500).json({ error: 'Not configured' }); return; }
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  let raw = await rawBody(req);
  let event;
  try { event = raw ? JSON.parse(raw) : req.body; } catch (e) { res.status(400).json({ error: 'Bad JSON' }); return; }
  if (!raw) raw = JSON.stringify(req.body);

  const signatureOk = verifyWebhookSignature(raw, req.headers['x-razorpay-signature']);
  if (!signatureOk) { res.status(401).json({ error: 'Bad signature' }); return; }

  try {
    const type = event && event.event;
    const payload = (event && event.payload) || {};

    if (type === 'payment.captured' || type === 'order.paid') {
      const paymentId = payload.payment && payload.payment.entity && payload.payment.entity.id;
      if (!paymentId) { res.status(200).json({ ok: true, skipped: 'no payment id' }); return; }
      // Trust Razorpay's API, not the event body.
      const payment = await razorpay(`/payments/${paymentId}`, 'GET');
      if (payment.status !== 'captured' || !payment.order_id) { res.status(200).json({ ok: true, skipped: payment.status }); return; }
      const br = await fetch(`${SUPABASE_URL}/rest/v1/bookings?razorpay_order_id=eq.${encodeURIComponent(payment.order_id)}&select=*`, { headers });
      const [booking] = br.ok ? await br.json() : [];
      if (!booking) { res.status(200).json({ ok: true, skipped: 'no booking for order' }); return; }
      if (booking.payment_status === 'paid') { res.status(200).json({ ok: true, already: true }); return; }
      const done = await confirmPaidBooking(booking, paymentId, payment.amount, headers, SUPABASE_URL);
      if (done && !done.clash) await notify.bookingConfirmed(done, headers, SUPABASE_URL);
      res.status(200).json({ ok: true, confirmed: !!(done && !done.clash), clash: !!(done && done.clash) });
      return;
    }

    if (type === 'refund.processed' || type === 'refund.failed') {
      const refund = payload.refund && payload.refund.entity;
      if (refund && refund.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/bookings?refund_id=eq.${encodeURIComponent(refund.id)}`, {
          method: 'PATCH', headers,
          body: JSON.stringify({ refund_status: type === 'refund.processed' ? 'processed' : 'failed' }),
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true, ignored: type });
  } catch (err) {
    console.error('razorpay-webhook error:', err);
    // 500 makes Razorpay retry later, which is what we want for temporary failures.
    res.status(500).json({ error: 'Server error' });
  }
};
