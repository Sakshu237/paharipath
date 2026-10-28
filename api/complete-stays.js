// /api/complete-stays.js
// Runs once a day via Vercel Cron (see vercel.json). Finds every
// confirmed booking whose check-in date has arrived and whose points
// haven't been awarded yet, awards points for each, and marks the
// booking as 'completed'. This is the primary path points get
// credited through — /api/award-points.js is just the on-demand
// single-booking version of the same logic for same-day check-ins.
//
// Protected by a shared secret so randoms can't hit this URL and
// force-run it. Set CRON_SECRET in Vercel env vars to any random
// string — Vercel automatically sends it as `Authorization: Bearer
// <CRON_SECRET>` on every scheduled invocation, so the secret never
// needs to appear in vercel.json or anywhere else in the repo.

const { checkinHasPassed, awardPointsForBooking } = require('./_lib/points');
const { sweepExpired } = require('./_lib/chat');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

module.exports = async (req, res) => {
  const cronSecret = process.env.CRON_SECRET;
  // Fail CLOSED: if CRON_SECRET is missing from Vercel env vars, refuse
  // to run instead of letting anyone trigger it.
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: 'Unauthorized' });
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
    // India date — Vercel runs in UTC.
    const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

    // Close booking requests the host never answered (also done lazily whenever a chat or inbox is opened).
    let expiredRequests = 0;
    try { expiredRequests = await sweepExpired(headers, SUPABASE_URL); } catch (e) { console.error('request expiry sweep failed', e.message); }

    // All confirmed, not-yet-awarded bookings whose check-in date has
    // arrived (lte today). Cancelled bookings are excluded by the
    // status=eq.confirmed filter — a cancelled booking never reaches
    // 'completed' or gets points, regardless of its check-in date.
    const bookingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?status=eq.confirmed&points_awarded=eq.false&checkin_date=lte.${today}&select=*`,
      { headers }
    );
    const bookings = await bookingsRes.json();

    if (!Array.isArray(bookings) || !bookings.length) {
      res.status(200).json({ processed: 0, results: [], expiredRequests });
      return;
    }

    const results = [];
    for (const booking of bookings) {
      if (!checkinHasPassed(booking)) continue; // safety net, should already be filtered by the query
      try {
        const r = await awardPointsForBooking(booking, headers, SUPABASE_URL);
        results.push({ ref: booking.id, ...r });
      } catch (e) {
        results.push({ ref: booking.id, error: e.message });
      }
    }

    res.status(200).json({ processed: results.length, results, expiredRequests });
  } catch (err) {
    console.error('complete-stays error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
