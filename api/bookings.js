// /api/bookings.js
// Consolidates what were 4 separate serverless functions
// (create-booking, cancel-booking, lookup-booking, my-bookings) into
// one, routed by `action` — needed to stay under Vercel's Hobby-plan
// cap of 12 serverless functions per deployment (same pattern as
// /api/crowd.js and /api/dest-admin.js).
//
// complete-stays.js is deliberately NOT merged in here — it's a cron
// job invoked by Vercel Cron via GET + an Authorization header, a
// different mechanism from everything else in this file, and merging
// it would mean touching vercel.json's cron config for one extra
// saved function slot. Not worth the risk to your points system.
//
// REQUEST BODY (POST, JSON): { action, ...fields }
//   action: 'create'         — create a new booking (rate-limited)
//   action: 'cancel'         — guest cancels their own booking
//   action: 'lookup'         — guest looks up their booking by ref+phone
//   action: 'my-bookings'    — traveller dashboard fetches all their bookings
//   action: 'submit-review'  — guest reviews a stay after checkout
//   action: 'config'         — public payment settings (online or pay-at-stay, GST rate)
//   action: 'verify-payment' — confirms a booking after Razorpay checkout (signature checked)
//
// REQUEST-TO-BOOK + CHAT (see _lib/chat.js). While online payment is off
// (PAY_ONLINE not set), 'create' makes a *request*: the host accepts or
// declines within 24h and the guest pays the host directly or on arrival.
//   action: 'messages'       — read a booking's chat (guest: ref+phone or token; host/admin: access_token)
//   action: 'send'           — post a chat message (contacts hidden until confirmed)
//   action: 'respond'        — host/admin accepts or declines a request
//   action: 'host-inbox'     — host's requests + bookings with unread counts
//   action: 'admin-inbox'    — admin view of all requests

const { tsKey, calcPoints, reverseRef } = require('./_lib/points');
const { cfg, publicCfg, razorpay, verifyCheckoutSignature, confirmPaidBooking, rupees } = require('./_lib/payments');
const notify = require('./_lib/notify');
const chat = require('./_lib/chat');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 10;

// Verifies a host's Supabase Auth session and returns their email —
// used so a host can only ever see bookings for their own stay.
async function verifyHostEmail(access_token) {
  if (!access_token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  return user.email || null;
}

// Booking emails (guest, host, admin) now live in _lib/notify.js.

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Today's date in India (YYYY-MM-DD) — Vercel runs in UTC, which is
// 5h30m behind IST, so plain toISOString() gives yesterday before 5:30am.
function todayIST() {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_RE = /^PP[A-Z0-9]{6,12}$/;
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

// Builds the booking row on the SERVER from a whitelist of fields.
// Previously the client's object was inserted as-is, so a caller could
// set any column: amount, status, nights, points_awarded, offbeat, etc.
// Now price, nights, offbeat, stay name and status all come from the DB
// or are recomputed here; only genuine guest inputs are taken from the
// request, and each is validated. Returns { row } or { error, status }.
async function buildBookingRow(input, headers) {
  const guest = typeof input.guest === 'string' ? input.guest.trim().replace(/[<>]/g, '').slice(0, 80) : '';
  if (guest.length < 2) return { error: 'Please enter your full name', status: 400 };

  const guest_phone = String(input.guest_phone || '');
  if (!/^[6-9]\d{9}$/.test(guest_phone)) return { error: 'Invalid phone number', status: 400 };

  let guest_email = null;
  if (!input.guest_email && !cfg().payOnline) return { error: "Please add your email — that's how the host's reply reaches you", status: 400 };
  if (input.guest_email) {
    guest_email = String(input.guest_email).trim().toLowerCase().slice(0, 150);
    if (!EMAIL_RE.test(guest_email)) return { error: 'Please enter a valid email address', status: 400 };
  }

  const id = String(input.id || '');
  if (!REF_RE.test(id)) return { error: 'Invalid booking reference — please refresh the page and try again', status: 400 };

  const checkin_date = String(input.checkin_date || '');
  const checkout_date = String(input.checkout_date || '');
  if (!DATE_RE.test(checkin_date) || !DATE_RE.test(checkout_date)) return { error: 'Please choose check-in and check-out dates', status: 400 };
  if (checkin_date < todayIST()) return { error: 'Check-in date cannot be in the past', status: 400 };
  const nights = Math.round((Date.parse(checkout_date) - Date.parse(checkin_date)) / 86400000);
  if (!(nights >= 1 && nights <= 30)) return { error: 'Stays must be between 1 and 30 nights', status: 400 };

  const stayId = parseInt(input.stay_id);
  if (!stayId) return { error: 'Missing stay', status: 400 };
  const stayRes = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${stayId}&select=id,name,pn,type,status,max_guests`, { headers });
  const [stay] = stayRes.ok ? await stayRes.json() : [];
  if (!stay) return { error: 'This stay could not be found', status: 404 };
  if (stay.status && stay.status !== 'active') return { error: 'This stay is not taking bookings right now', status: 409 };
  const pn = parseInt(stay.pn) || 0;
  if (pn <= 0) return { error: 'This stay has no price set yet — please message us on WhatsApp to book', status: 409 };

  // Same formula as recalcBooking() in app.js: stay + GST (only when paying
  // online and GST_RATE is set — see _lib/payments.js) + optional eco offset.
  const c = cfg();
  // Carbon offset is only collected with online payment (it goes to the NGO partner, not the host).
  const eco = input.eco === true && c.payOnline;
  const eco_amount = eco ? Math.min(Math.max(parseInt(input.eco_amount) || 0, 0), 5000) : 0;
  const eco_trees = eco ? Math.min(Math.max(parseInt(input.eco_trees) || 0, 0), 100) : 0;
  const base = pn * nights;
  const gst = c.payOnline ? Math.round(c.gstRate * base) : 0;
  const total = base + gst + eco_amount;

  const guests = Math.min(Math.max(parseInt(input.guests) || 1, 1), 20);
  const maxGuests = parseInt(stay.max_guests) || 0;
  if (maxGuests && guests > maxGuests) return { error: `This stay takes up to ${maxGuests} guest${maxGuests > 1 ? 's' : ''}`, status: 400 };
  const pledges_accepted = Math.min(Math.max(parseInt(input.pledges_accepted) || 0, 0), 4);
  const offbeat = (stay.type || '').toLowerCase().includes('village') || pn < 1500;
  const fmt = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  if (input.privacy_consent !== true || input.terms_consent !== true) {
    return { error: 'Please accept the Privacy Policy and Terms of Service', status: 400 };
  }
  const now = new Date().toISOString();

  return {
    total,
    row: {
      id, guest, guest_phone, guest_email,
      guest_photo_url: typeof input.guest_photo_url === 'string' && input.guest_photo_url.startsWith(SUPABASE_URL + '/storage/') ? input.guest_photo_url.slice(0, 500) : null,
      stay_id: stay.id, stay_name: stay.name,
      dates: fmt(checkin_date) + ' – ' + fmt(checkout_date),
      checkin_date, checkout_date, nights, guests,
      amount: '₹' + total.toLocaleString('en-IN'),
      base_amount: base, gst_amount: gst,
      eco, eco_amount, eco_trees, offbeat, pledges_accepted,
      privacy_consent: true, privacy_consent_at: now, terms_consent: true, terms_consent_at: now,
      // Forced server-side. payment_id is NOT accepted from the browser —
      // it is set only after a verified Razorpay payment (verify-payment / webhook).
      // Without online payment a booking is a REQUEST the host accepts or declines.
      status: c.payOnline ? 'pending_payment' : 'requested',
      payment_status: c.payOnline ? 'pending' : 'pay_at_stay',
      points_awarded: false, payment_id: null,
      ...(c.payOnline ? {} : { request_expires_at: chat.requestExpiry() }),
    },
    firstMessage: chat.clipMessage(input.request_message),
  };
}

// Light IP throttle for the read/cancel actions, which previously had none.
async function ipThrottled(req, prefix, max, headers) {
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const key = `${prefix}:${ip}`;
  if (await countRecentAttempts(key, headers) >= max) return true;
  await logAttempt(key, headers);
  return false;
}

async function countRecentAttempts(key, headers) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rate_limit_log?rl_key=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
    { headers }
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}
async function logAttempt(key, headers) {
  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_log`, { method: 'POST', headers, body: JSON.stringify({ rl_key: key }) });
}

// Cancellation policy: free 48h+ before check-in, sliding scale down
// to a 100% fee inside 3 hours. Assumes a noon check-in time since
// bookings only store a date, not a check-in time.
//   ≥48h left  → 0% fee (full refund)
//   3h–48h left → fee scales linearly from 0% to 100%
//   ≤3h left, or already checked in → 100% fee (no refund)
function calcCancellationFee(checkinDateStr) {
  if (!checkinDateStr) return { feePercent: 0, hoursLeft: null };
  const checkin = new Date(checkinDateStr + 'T12:00:00');
  const hoursLeft = (checkin.getTime() - Date.now()) / (1000 * 60 * 60);
  let feePercent;
  if (hoursLeft >= 48) feePercent = 0;
  else if (hoursLeft <= 3) feePercent = 100;
  else feePercent = Math.round(100 * (48 - hoursLeft) / (48 - 3));
  return { feePercent, hoursLeft };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if ((req.body || {}).action === 'config') {
    res.status(200).json(publicCfg());
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const { action } = req.body || {};

  try {
    // ═══════════════════════════════════════════════════════
    // action: 'create' — new booking, rate-limited by phone AND IP
    // fields: booking: {...the full bookingRow object}
    // ═══════════════════════════════════════════════════════
    if (action === 'create') {
      const input = req.body.booking || {};
      const phoneOk = /^[6-9]\d{9}$/.test(String(input.guest_phone || ''));
      if (!phoneOk) {
        res.status(400).json({ error: 'Invalid phone number' });
        return;
      }
      const booking = { guest_phone: String(input.guest_phone) };

      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const phoneKey = `phone:${booking.guest_phone}`;
      const ipKey = `ip:${ip}`;

      const [phoneCount, ipCount] = await Promise.all([
        countRecentAttempts(phoneKey, headers),
        countRecentAttempts(ipKey, headers),
      ]);
      if (phoneCount >= MAX_ATTEMPTS || ipCount >= MAX_ATTEMPTS) {
        res.status(429).json({ error: `Too many booking attempts. Please wait ${WINDOW_MINUTES} minutes and try again, or contact us on WhatsApp to book directly.` });
        return;
      }
      await Promise.all([logAttempt(phoneKey, headers), logAttempt(ipKey, headers)]);

      const built = await buildBookingRow(input, headers);
      if (built.error) { res.status(built.status).json({ error: built.error }); return; }
      Object.assign(booking, built.row);
      const pay = cfg();

      // A guest who abandoned an earlier checkout for this stay releases that hold.
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${booking.guest_phone}&stay_id=eq.${booking.stay_id}&status=eq.pending_payment`, {
        method: 'PATCH', headers, body: JSON.stringify({ status: 'expired' }),
      });
      if (booking.status === 'requested') {
        // Max 3 open requests per guest at a time, so hosts aren't spammed.
        const open = await fetch(`${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${booking.guest_phone}&stay_id=neq.${booking.stay_id}&status=eq.requested&request_expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id`, { headers }).then(r => r.json()).catch(() => []);
        if (Array.isArray(open) && open.length >= 3) {
          res.status(429).json({ error: 'You already have 3 requests waiting for a host reply. Please wait for an answer, or withdraw one from "My Trips".' });
          return;
        }
        // A new request for the same stay replaces the guest's older open one.
        const replaced = await fetch(`${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${booking.guest_phone}&stay_id=eq.${booking.stay_id}&status=eq.requested`, {
          method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }),
        }).then(r => r.json()).catch(() => []);
        for (const old of Array.isArray(replaced) ? replaced : []) {
          await chat.addMessage(old.id, 'system', 'The guest replaced this request with a new one.', headers, SUPABASE_URL).catch(() => {});
        }
      }
      const holdSince = new Date(Date.now() - pay.holdMinutes * 60 * 1000).toISOString();

      // Server-side date-conflict check. The client already blocks obviously
      // conflicting dates before showing the pay button, but that check runs
      // against a snapshot fetched moments earlier — it can't see a booking
      // that was confirmed in between, and it can't be trusted at all if the
      // client is bypassed. This re-checks against the live table right
      // before insert, closing that race/bypass window. Mirrors the same
      // overlap and blocked-date logic checkDateAvailability() runs client-side.
      {
        const [conflictRes, blockedRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${encodeURIComponent(booking.stay_id)}&or=(status.eq.confirmed,and(status.eq.pending_payment,created_at.gt.${encodeURIComponent(holdSince)}))&checkin_date=lt.${encodeURIComponent(booking.checkout_date)}&checkout_date=gt.${encodeURIComponent(booking.checkin_date)}&select=id`,
            { headers }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/host_blocked_dates?stay_id=eq.${encodeURIComponent(booking.stay_id)}&blocked_date=gte.${encodeURIComponent(booking.checkin_date)}&blocked_date=lt.${encodeURIComponent(booking.checkout_date)}&select=id`,
            { headers }
          ),
        ]);
        const [conflicts, blocked] = await Promise.all([conflictRes.json(), blockedRes.json()]);
        if ((Array.isArray(conflicts) && conflicts.length) || (Array.isArray(blocked) && blocked.length)) {
          res.status(409).json({ error: 'These dates were just booked or blocked by the host — please pick different dates, or message the host directly.' });
          return;
        }
      }

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(booking),
      });
      if (!insertRes.ok) {
        const errText = await insertRes.text();
        console.error('Booking insert failed:', errText);
        if (/duplicate|unique/i.test(errText)) {
          res.status(409).json({ error: 'Please tap Confirm again — your booking reference clashed with another one.' });
        } else {
          res.status(400).json({ error: 'Booking could not be saved. Please try again or message us on WhatsApp.' });
        }
        return;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_key: tsKey(booking.guest_phone), guest_name: booking.guest, phone_hint: booking.guest_phone }),
      });

      // Online payment: open a Razorpay order for the server-computed amount.
      // The booking stays "pending_payment" (dates held) until the payment is verified.
      if (pay.payOnline) {
        try {
          const order = await razorpay('/orders', 'POST', {
            amount: built.total * 100, currency: 'INR', receipt: booking.id,
            notes: { booking_ref: booking.id, stay: String(booking.stay_name).slice(0, 60) },
          });
          await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, {
            method: 'PATCH', headers, body: JSON.stringify({ razorpay_order_id: order.id }),
          });
          res.status(200).json({
            success: true, ref: booking.id, amount: booking.amount, paymentStatus: 'pending',
            payment: { orderId: order.id, keyId: pay.keyId, amount: order.amount, currency: 'INR', holdMinutes: pay.holdMinutes },
          });
        } catch (e) {
          console.error('Razorpay order failed', e.message);
          await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'expired' }) });
          res.status(502).json({ error: 'Payment could not be started. Please try again in a minute, or message us on WhatsApp.' });
        }
        return;
      }

      // Request-to-book: save the guest's first message, tell the host, and stop here.
      if (booking.status === 'requested') {
        await chat.addMessage(booking.id, 'system', `Request sent. The host has ${chat.REQUEST_HOURS} hours to accept or decline. Nothing is charged — once accepted, you pay the host directly or on arrival.`, headers, SUPABASE_URL).catch(() => {});
        let first = built.firstMessage || '';
        if (first) {
          const m = chat.maskContacts(first);
          await chat.addMessage(booking.id, 'guest', m.text, headers, SUPABASE_URL, m.masked).catch(e => console.error('first message failed', e.message));
          first = m.text;
        }
        const stay = await chat.getStay(booking.stay_id, headers, SUPABASE_URL);
        await chat.mailNewRequest(booking, stay, first).catch(e => console.warn('request email failed', e.message));
        res.status(200).json({
          success: true, requested: true, ref: booking.id, amount: booking.amount, paymentStatus: 'pay_at_stay',
          chatToken: chat.chatToken(booking.id), expiresAt: booking.request_expires_at,
        });
        return;
      }

      await notify.bookingConfirmed(booking, headers, SUPABASE_URL);

      const waText = encodeURIComponent(
        `✅ Booking Confirmed — PahariPath\n\n` +
        `Stay: ${booking.stay_name}\n` +
        `Dates: ${booking.dates || '—'}\n` +
        `Nights: ${booking.nights || '—'} · Guests: ${booking.guests || 1}\n` +
        `Amount: ${booking.amount || '—'}\n` +
        `Reference: ${booking.id}\n\n` +
        `Manage or cancel anytime at paharipath.in`
      );
      const whatsappUrl = `https://wa.me/91${booking.guest_phone}?text=${waText}`;

      res.status(200).json({ success: true, ref: booking.id, amount: booking.amount, paymentStatus: booking.payment_status, whatsappUrl });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'verify-payment' — after Razorpay checkout succeeds in the
    // browser. Confirms the booking only if Razorpay's signature checks out.
    // fields: bookingRef, razorpay_order_id, razorpay_payment_id, razorpay_signature
    // ═══════════════════════════════════════════════════════
    if (action === 'verify-payment') {
      const { bookingRef, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      if (!bookingRef || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) { res.status(400).json({ error: 'Missing payment details' }); return; }
      const br = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`, { headers });
      const [booking] = br.ok ? await br.json() : [];
      if (!booking || booking.razorpay_order_id !== razorpay_order_id) { res.status(400).json({ error: 'Payment does not match this booking' }); return; }
      if (!verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) { res.status(400).json({ error: 'Payment could not be verified. If money was taken, it will be refunded automatically — or contact us.' }); return; }
      if (booking.payment_status === 'paid') { res.status(200).json({ success: true, ref: booking.id, amount: booking.amount, paymentStatus: 'paid', already: true }); return; }
      // Amount actually paid, straight from Razorpay (never from the browser).
      let paidPaise = 0;
      try { paidPaise = (await razorpay(`/payments/${razorpay_payment_id}`, 'GET')).amount || 0; } catch (e) { paidPaise = rupees(booking.amount) * 100; }
      const done = await confirmPaidBooking(booking, razorpay_payment_id, paidPaise, headers, SUPABASE_URL);
      if (done && done.clash) { res.status(409).json({ error: 'Sorry — these dates were booked by someone else while you were paying. Your payment is being refunded in full.' }); return; }
      if (done) await notify.bookingConfirmed(done, headers, SUPABASE_URL);
      res.status(200).json({ success: true, ref: booking.id, amount: booking.amount, paymentStatus: 'paid' });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // Request-to-book + chat actions (logic in _lib/chat.js)
    // ═══════════════════════════════════════════════════════
    if (['messages', 'send', 'respond', 'host-inbox', 'admin-inbox'].includes(action)) {
      if (await ipThrottled(req, 'bk-chat', 120, headers)) { res.status(429).json({ error: 'Too many requests — please wait a few minutes and try again.' }); return; }
      const ctx = { headers, SUPABASE_URL, SUPABASE_ANON };
      const body = req.body || {};
      const [code, out] =
        action === 'messages' ? await chat.actionMessages(body, ctx) :
        action === 'send' ? await chat.actionSend(body, ctx) :
        action === 'respond' ? await chat.actionRespond(body, ctx, notify) :
        action === 'host-inbox' ? await chat.actionHostInbox(body, ctx) :
        await chat.actionAdminInbox(body, ctx);
      res.status(code).json(out);
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'cancel' — guest cancels their own booking
    // fields: bookingRef, phone
    // ═══════════════════════════════════════════════════════
    if (action === 'cancel') {
      if (await ipThrottled(req, 'bk-cancel', 10, headers)) { res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' }); return; }
      const { bookingRef } = req.body;
      let { phone } = req.body;
      if (!bookingRef || (!phone && !req.body.token)) { res.status(400).json({ error: 'Missing bookingRef or phone' }); return; }

      const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`, { headers });
      const bookings = await bookingRes.json();
      const booking = Array.isArray(bookings) ? bookings[0] : null;
      if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
      // The private chat link (emailed to the guest) may withdraw a still-open request.
      if (!phone && booking.status === 'requested' && chat.tokenOk(booking.id, req.body.token)) phone = booking.guest_phone;
      if (booking.guest_phone !== String(phone)) { res.status(403).json({ error: 'This phone number does not match the booking on record' }); return; }
      if (booking.status === 'cancelled') { res.status(200).json({ success: true, pointsReversed: 0, message: 'Already cancelled' }); return; }
      if (booking.status === 'completed') { res.status(400).json({ error: 'This stay has already been completed and cannot be cancelled' }); return; }
      if (['declined', 'expired'].includes(booking.status)) { res.status(200).json({ success: true, pointsReversed: 0, message: `This request is already ${booking.status}` }); return; }
      if (booking.status === 'requested') {
        // Withdrawing a request: nothing was paid and no points were given.
        await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&status=eq.requested`, {
          method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString() }),
        });
        await chat.addMessage(bookingRef, 'system', 'The guest withdrew this request.', headers, SUPABASE_URL).catch(() => {});
        res.status(200).json({ success: true, withdrawn: true, pointsReversed: 0, feePercent: 0, refundAmount: 0, feeAmount: 0, amountNum: 0, paymentStatus: 'pay_at_stay' });
        return;
      }

      const { feePercent } = calcCancellationFee(booking.checkin_date);
      // Only money actually paid online can be refunded; pay-at-stay bookings owe nothing.
      const paid = booking.payment_status === 'paid';
      const amountNum = paid ? (parseInt(booking.paid_amount) || rupees(booking.amount)) : 0;
      // Carbon offset contributions are non-refundable (Terms 5.3); the fee schedule applies to the rest.
      const refundable = Math.max(amountNum - (parseInt(booking.eco_amount) || 0), 0);
      const feeAmount = Math.round(refundable * feePercent / 100);
      const refundAmount = refundable - feeAmount;
      let refundId = null, refundStatus = null;
      if (paid && refundAmount > 0 && booking.payment_id) {
        try {
          const rf = await razorpay(`/payments/${booking.payment_id}/refund`, 'POST', { amount: refundAmount * 100, notes: { booking_ref: booking.id, reason: 'guest cancellation' } });
          refundId = rf.id; refundStatus = 'initiated';
        } catch (e) { console.error('refund failed', e.message); refundStatus = 'failed'; }
      }

               // Phase 1: take back every ledger award tied to this booking.
         // Bookings awarded before the ledger existed fall back to the old manual reversal below.
         let pointsReversed = 0;
         try { pointsReversed = Number(await reverseRef(bookingRef, 'Booking cancelled', headers, SUPABASE_URL)) || 0; }
         catch (e) { console.error('ledger reversal failed', e.message); }
         if (!pointsReversed && booking.points_awarded) {        const { pts, nights, pledgeCount } = calcPoints(booking);
        const key = tsKey(phone);
        const scoreRes = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=*`, { headers });
        const scoreRows = await scoreRes.json();
        const current = (Array.isArray(scoreRows) && scoreRows[0]) || null;
        if (current) {
          const updated = {
            user_key: key,
            points: Math.max(0, (current.points || 0) - pts),
            stays: Math.max(0, (current.stays || 0) - 1),
            nights: Math.max(0, (current.nights || 0) - nights),
            eco: Math.max(0, (current.eco || 0) - (booking.eco ? 1 : 0)),
            offbeat: Math.max(0, (current.offbeat || 0) - (booking.offbeat ? 1 : 0)),
            pledges: Math.max(0, (current.pledges || 0) - pledgeCount),
            history: (current.history || []).filter(h => h.ref !== bookingRef),
          };
          const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(updated),
          });
          if (!upsertRes.ok) throw new Error('Failed to reverse points: ' + await upsertRes.text());
          pointsReversed = pts;
        }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'cancelled', cancelled_at: new Date().toISOString(),
          points_reversed: pointsReversed > 0, points_awarded: false,
          cancellation_fee_percent: feePercent, refund_amount: refundAmount, cancellation_fee_amount: feeAmount,
          ...(paid ? { refund_id: refundId, refund_status: refundStatus, payout_status: feeAmount > 0 ? 'due' : 'none' } : {}),
        }),
      });
      await notify.bookingCancelled(booking, paid ? refundAmount : null, headers, SUPABASE_URL);
      await chat.addMessage(bookingRef, 'system', 'This booking was cancelled by the guest.', headers, SUPABASE_URL).catch(() => {});

      res.status(200).json({ success: true, pointsReversed, feePercent, refundAmount, feeAmount, amountNum, paymentStatus: booking.payment_status || 'pay_at_stay', refundStatus });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'lookup' — guest looks up their booking by ref + phone
    // fields: bookingRef, phone
    // ═══════════════════════════════════════════════════════
    if (action === 'lookup') {
      if (await ipThrottled(req, 'bk-lookup', 10, headers)) { res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' }); return; }
      const { bookingRef, phone } = req.body;
      if (!bookingRef || !phone) { res.status(400).json({ error: 'Missing bookingRef or phone' }); return; }

      const bookingRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests,payment_status,request_expires_at,decline_reason`,
        { headers }
      );
      const bookings = await bookingRes.json();
      const booking = Array.isArray(bookings) ? bookings[0] : null;
      if (!booking) { res.status(404).json({ error: 'No booking found with that reference' }); return; }

      const ownerRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&guest_phone=eq.${encodeURIComponent(phone)}&select=id`,
        { headers }
      );
      const ownerRows = await ownerRes.json();
      if (!Array.isArray(ownerRows) || !ownerRows.length) { res.status(403).json({ error: 'This phone number does not match the booking on record' }); return; }

      res.status(200).json({ booking });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'my-bookings' — traveller dashboard fetches all their bookings
    // fields: phone
    // ═══════════════════════════════════════════════════════
    if (action === 'my-bookings') {
      if (await ipThrottled(req, 'bk-my-bookings', 10, headers)) { res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' }); return; }
      const { phone } = req.body;
      if (!phone || !/^[6-9]\d{9}$/.test(phone)) { res.status(400).json({ error: 'Invalid phone number' }); return; }
      // Privacy: a phone number alone is not enough to see someone's trips.
      // The browser must also hold one booking reference of that phone
      // (saved after booking or after a "Manage / Cancel Booking" lookup).
      const proofRef = String(req.body.proofRef || '');
      const proof = proofRef ? await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(proofRef)}&guest_phone=eq.${phone}&select=id`, { headers }).then(r => r.json()).catch(() => []) : [];
      if (!Array.isArray(proof) || !proof.length) { res.status(200).json({ bookings: [], needsRef: true }); return; }
      const bookingsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(phone)}&select=id,stay_id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests,eco,guest_photo_url,payment_status,request_expires_at,decline_reason,guest_last_read_at&status=neq.expired&order=created_at.desc`,
        { headers }
      );
      let bookings = await bookingsRes.json();
      bookings = Array.isArray(bookings) ? bookings : [];
      try { bookings = await chat.withUnread(bookings, 'guest', headers, SUPABASE_URL); } catch (e) { console.warn('unread count failed', e.message); }
      // Which completed stays this guest already reviewed (the reviews table is no longer readable from the browser).
      try {
        const rv = await fetch(`${SUPABASE_URL}/rest/v1/stay_reviews?guest_phone=eq.${encodeURIComponent(phone)}&select=booking_ref`, { headers }).then(r => r.json());
        const done = new Set((Array.isArray(rv) ? rv : []).map(r => r.booking_ref));
        bookings = bookings.map(b => ({ ...b, reviewed: done.has(b.id) }));
      } catch (e) { console.warn('review lookup failed', e.message); }
      res.status(200).json({ bookings });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'host-bookings' — host views confirmed booking dates
    // for their own stay, to avoid double-blocking dates in their
    // calendar. Verified against their real login session.
    // fields: stayId, access_token
    // ═══════════════════════════════════════════════════════
    if (action === 'host-bookings') {
      const stayId = parseInt(req.body.stayId);
      const hostEmail = await verifyHostEmail(req.body.access_token);
      if (!hostEmail) { res.status(403).json({ error: 'Please log in again' }); return; }
      if (!stayId) { res.status(400).json({ error: 'Missing stayId' }); return; }

      const stayRes = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${stayId}&select=host_email`, { headers });
      const [stay] = await stayRes.json();
      if (!stay || stay.host_email !== hostEmail) { res.status(403).json({ error: 'This is not your listing' }); return; }

      const bkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${stayId}&status=in.(confirmed,completed)&select=id,guest,checkin_date,checkout_date,status,amount,created_at`,
        { headers }
      );
      const bookings = await bkRes.json();
      res.status(200).json({ success: true, bookings: Array.isArray(bookings) ? bookings : [] });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'submit-review' — guest reviews a stay AFTER checkout.
    // Verified against a real, completed booking so only actual
    // guests can leave a review (one per booking, enforced by a
    // unique constraint on booking_ref).
    // fields: bookingRef, phone, rating (1-5), comment
    // ═══════════════════════════════════════════════════════
    if (action === 'submit-review') {
      if (await ipThrottled(req, 'bk-submit-review', 10, headers)) { res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' }); return; }
      const { bookingRef, phone, rating, comment } = req.body;
      const ratingNum = parseInt(rating);
      if (!bookingRef || !phone || !ratingNum || ratingNum < 1 || ratingNum > 5) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
      }
      const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`, { headers });
      const bookings = await bookingRes.json();
      const booking = Array.isArray(bookings) ? bookings[0] : null;
      if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
      if (booking.guest_phone !== String(phone)) { res.status(403).json({ error: 'This phone number does not match the booking on record' }); return; }
      if (booking.status !== 'completed') { res.status(400).json({ error: 'You can review a stay after your check-out date has passed' }); return; }

      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/stay_reviews`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({
          stay_id: booking.stay_id, booking_ref: bookingRef, guest_name: booking.guest,
          guest_phone: String(phone), rating: ratingNum, comment: String(comment || '').slice(0, 1000),
        }),
      });
      if (!insRes.ok) {
        const errText = await insRes.text();
        if (errText.includes('duplicate') || errText.includes('unique')) {
          res.status(400).json({ error: 'You already reviewed this stay' });
        } else {
          console.error('Review save failed:', errText);
          res.status(400).json({ error: 'Review could not be saved — please try again.' });
        }
        return;
      }
      res.status(200).json({ success: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('bookings error:', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};
