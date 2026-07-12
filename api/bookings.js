// /api/bookings.js
// Consolidates what were 4 separate serverless functions
// (create-booking, cancel-booking, lookup-booking, my-bookings) into
// one, routed by `action` — needed to stay under Vercel's Hobby-plan
// cap of 12 serverless functions per deployment (same pattern as
// /api/crowd.js and /api/dest-admin.js).
//
// complete-stays.js is deliberately NOT merged in here — it's a cron
// job invoked by Vercel Cron via GET + a secret query param, a
// different mechanism from everything else in this file, and merging
// it would mean touching vercel.json's cron config for one extra
// saved function slot. Not worth the risk to your points system.
//
// REQUEST BODY (POST, JSON): { action, ...fields }
//   action: 'create'      — create a new booking (rate-limited)
//   action: 'cancel'      — guest cancels their own booking
//   action: 'lookup'      — guest looks up their booking by ref+phone
//   action: 'my-bookings' — traveller dashboard fetches all their bookings

const { tsKey, calcPoints } = require('./_lib/points');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 10;

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
      const booking = req.body.booking || {};

      if (!booking.id || !booking.guest || !booking.guest_phone || !booking.stay_name) {
        res.status(400).json({ error: 'Missing required booking fields' });
        return;
      }
      if (!/^[6-9]\d{9}$/.test(booking.guest_phone)) {
        res.status(400).json({ error: 'Invalid phone number' });
        return;
      }

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

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(booking),
      });
      if (!insertRes.ok) {
        res.status(400).json({ error: 'Booking save failed: ' + await insertRes.text() });
        return;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ user_key: tsKey(booking.guest_phone), guest_name: booking.guest, phone_hint: booking.guest_phone }),
      });

      res.status(200).json({ success: true, ref: booking.id });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'cancel' — guest cancels their own booking
    // fields: bookingRef, phone
    // ═══════════════════════════════════════════════════════
    if (action === 'cancel') {
      const { bookingRef, phone } = req.body;
      if (!bookingRef || !phone) { res.status(400).json({ error: 'Missing bookingRef or phone' }); return; }

      const bookingRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`, { headers });
      const bookings = await bookingRes.json();
      const booking = Array.isArray(bookings) ? bookings[0] : null;
      if (!booking) { res.status(404).json({ error: 'Booking not found' }); return; }
      if (booking.guest_phone !== phone) { res.status(403).json({ error: 'This phone number does not match the booking on record' }); return; }
      if (booking.status === 'cancelled') { res.status(200).json({ success: true, pointsReversed: 0, message: 'Already cancelled' }); return; }
      if (booking.status === 'completed') { res.status(400).json({ error: 'This stay has already been completed and cannot be cancelled' }); return; }

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
        body: JSON.stringify({ status: 'cancelled', cancelled_at: new Date().toISOString(), points_reversed: pointsReversed > 0, points_awarded: false }),
      });

      res.status(200).json({ success: true, pointsReversed });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'lookup' — guest looks up their booking by ref + phone
    // fields: bookingRef, phone
    // ═══════════════════════════════════════════════════════
    if (action === 'lookup') {
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

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
