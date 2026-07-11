// /api/award-points.js
// Manually-triggerable points award for a single booking. Points are
// ONLY awarded once the booking's check-in date has arrived — this is
// what stops someone from booking, instantly collecting points, and
// cancelling. The real, automatic path for most bookings is the daily
// cron in /api/complete-stays.js; this endpoint exists so points can
// still be awarded on-demand for same-day check-ins, or manually by
// an admin if needed.
//
// SETUP: needs SUPABASE_SERVICE_ROLE_KEY set in Vercel env vars.
//
// REQUEST BODY (POST, JSON): { "bookingRef": "PP482913" }
// RESPONSE:
//   Awarded now:  { points, awarded, reasons }
//   Not yet due:  { pending: true, message, checkinDate }
//   Already done: { points: null, awarded: 0, reasons: [...] }

const { checkinHasPassed, awardPointsForBooking } = require('./_lib/points');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { bookingRef } = req.body || {};
  if (!bookingRef) {
    res.status(400).json({ error: 'Missing bookingRef' });
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

  try {
    // 1. Verify a real, confirmed (not cancelled) booking exists for this reference.
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&status=eq.confirmed&select=*`,
      { headers }
    );
    const bookings = await bookingRes.json();
    const booking = Array.isArray(bookings) ? bookings[0] : null;

    if (!booking) {
      res.status(404).json({ error: 'No confirmed booking found for this reference' });
      return;
    }

    // 2. Idempotency — refuse to award points twice for the same booking.
    if (booking.points_awarded) {
      res.status(200).json({ points: null, awarded: 0, reasons: ['Points already awarded for this booking'] });
      return;
    }

    // 3. Check-in date gate — the core anti-abuse fix. No points until
    // the stay has actually started, so cancelling before check-in
    // earns nothing.
    if (!checkinHasPassed(booking)) {
      res.status(200).json({
        pending: true,
        checkinDate: booking.checkin_date,
        message: `Points will be credited automatically after check-in on ${booking.checkin_date}`,
      });
      return;
    }

    // 4. Award.
    const result = await awardPointsForBooking(booking, headers, SUPABASE_URL);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
