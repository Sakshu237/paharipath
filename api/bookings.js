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

const { tsKey, calcPoints } = require('./_lib/points');
const { sendEmail } = require('./_lib/email');

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

// Sends a booking confirmation email via your existing Zoho Mail
// (hello@paharipath.in). Never throws — a failed email should never
// fail a booking, so callers just fire-and-forget this.
async function sendConfirmationEmail(booking) {
  if (!booking.guest_email) return;
  await sendEmail({
    to: booking.guest_email,
    subject: `Booking Confirmed — ${String(booking.stay_name).slice(0, 80)} (Ref: ${booking.id})`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
        <h2 style="color:#2d5a3d">Your stay is confirmed 🏔️</h2>
        <p>Hi ${esc(booking.guest || 'traveller')}, here's your booking summary:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:6px 0;color:#666">Stay</td><td style="padding:6px 0;font-weight:600">${esc(booking.stay_name)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Dates</td><td style="padding:6px 0;font-weight:600">${esc(booking.dates || '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Nights</td><td style="padding:6px 0;font-weight:600">${esc(booking.nights || '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Guests</td><td style="padding:6px 0;font-weight:600">${esc(booking.guests || 1)}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Amount</td><td style="padding:6px 0;font-weight:600">${esc(booking.amount || '—')}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Reference</td><td style="padding:6px 0;font-weight:600">${esc(booking.id)}</td></tr>
        </table>
        <p style="font-size:13px;color:#666">Need to manage or cancel this booking? Visit paharipath.in and use "Manage / Cancel Booking" in the footer with this reference and your phone number.</p>
        <p style="font-size:13px;color:#666">Questions? Just reply to this email or reach us at hello@paharipath.in</p>
      </div>`,
  });
}

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
  const stayRes = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${stayId}&select=id,name,pn,type,status`, { headers });
  const [stay] = stayRes.ok ? await stayRes.json() : [];
  if (!stay) return { error: 'This stay could not be found', status: 404 };
  if (stay.status && stay.status !== 'active') return { error: 'This stay is not taking bookings right now', status: 409 };
  const pn = parseInt(stay.pn) || 0;
  if (pn <= 0) return { error: 'This stay has no price set yet — please message us on WhatsApp to book', status: 409 };

  // Same formula as recalcBooking() in app.js: stay + 5% + optional eco offset.
  const eco = input.eco === true;
  const eco_amount = eco ? Math.min(Math.max(parseInt(input.eco_amount) || 0, 0), 5000) : 0;
  const eco_trees = eco ? Math.min(Math.max(parseInt(input.eco_trees) || 0, 0), 100) : 0;
  const base = pn * nights;
  const total = base + Math.round(0.05 * base) + eco_amount;

  const guests = Math.min(Math.max(parseInt(input.guests) || 1, 1), 20);
  const pledges_accepted = Math.min(Math.max(parseInt(input.pledges_accepted) || 0, 0), 4);
  const offbeat = (stay.type || '').toLowerCase().includes('village') || pn < 1500;
  const fmt = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  if (input.privacy_consent !== true || input.terms_consent !== true) {
    return { error: 'Please accept the Privacy Policy and Terms of Service', status: 400 };
  }
  const now = new Date().toISOString();

  return {
    row: {
      id, guest, guest_phone, guest_email,
      guest_photo_url: typeof input.guest_photo_url === 'string' && input.guest_photo_url.startsWith(SUPABASE_URL + '/storage/') ? input.guest_photo_url.slice(0, 500) : null,
      stay_id: stay.id, stay_name: stay.name,
      dates: fmt(checkin_date) + ' – ' + fmt(checkout_date),
      checkin_date, checkout_date, nights, guests,
      amount: '₹' + total.toLocaleString('en-IN'),
      eco, eco_amount, eco_trees, offbeat, pledges_accepted,
      privacy_consent: true, privacy_consent_at: now, terms_consent: true, terms_consent_at: now,
      // Forced server-side. payment_id is NOT accepted from the browser —
      // it must come from a verified Razorpay signature once payments go live.
      status: 'confirmed', points_awarded: false, payment_id: null,
    },
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
            `${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${encodeURIComponent(booking.stay_id)}&status=eq.confirmed&checkin_date=lt.${encodeURIComponent(booking.checkout_date)}&checkout_date=gt.${encodeURIComponent(booking.checkin_date)}&select=id`,
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

      sendConfirmationEmail(booking); // fire-and-forget, never blocks the response

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

      res.status(200).json({ success: true, ref: booking.id, whatsappUrl });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'cancel' — guest cancels their own booking
    // fields: bookingRef, phone
    // ═══════════════════════════════════════════════════════
    if (action === 'cancel') {
      if (await ipThrottled(req, 'bk-cancel', 10, headers)) { res.status(429).json({ error: 'Too many attempts — please wait a few minutes and try again.' }); return; }
      const { bookingRef, phone } = req.body;
      if (!bookingRef || !phone) { res.status(400).json({ error: 'Missing bookingRef or phone' }); return; }

      const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`, { headers });
      const bookings = await bookingRes.json();
      const booking = Array.isArray(bookings) ? bookings[0] : null;
      if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
      if (booking.guest_phone !== String(phone)) { res.status(403).json({ error: 'This phone number does not match the booking on record' }); return; }
      if (booking.status === 'cancelled') { res.status(200).json({ success: true, pointsReversed: 0, message: 'Already cancelled' }); return; }
      if (booking.status === 'completed') { res.status(400).json({ error: 'This stay has already been completed and cannot be cancelled' }); return; }

      const { feePercent } = calcCancellationFee(booking.checkin_date);
      const amountNum = parseInt((booking.amount || '0').replace(/[^0-9]/g, '')) || 0;
      const feeAmount = Math.round(amountNum * feePercent / 100);
      const refundAmount = amountNum - feeAmount;

      let pointsReversed = 0;
      if (booking.points_awarded) {
        const { pts, nights, pledgeCount } = calcPoints(booking);
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
        }),
      });

      res.status(200).json({ success: true, pointsReversed, feePercent, refundAmount, feeAmount, amountNum });
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
        `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests`,
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
      const bookingsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(phone)}&select=id,stay_id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests,eco,guest_photo_url&order=created_at.desc`,
        { headers }
      );
      const bookings = await bookingsRes.json();
      res.status(200).json({ bookings: Array.isArray(bookings) ? bookings : [] });
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
