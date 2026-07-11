// /api/cancel-booking.js
// Lets a guest cancel their own booking (verified by matching phone
// number to the booking's guest_phone — not full auth, but enough to
// stop a stranger cancelling someone else's stay from the booking ref
// alone). If points were already awarded for this booking (i.e. the
// check-in date had already passed before cancellation), those exact
// points and stats are clawed back from traveller_scores.
//
// REQUEST BODY (POST, JSON): { "bookingRef": "PP482913", "phone": "9876543210" }
// RESPONSE: { success: true, pointsReversed: 0 } or { error: "..." }

const { tsKey, calcPoints } = require('./_lib/points');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { bookingRef, phone } = req.body || {};
  if (!bookingRef || !phone) {
    res.status(400).json({ error: 'Missing bookingRef or phone' });
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
    // 1. Load the booking and verify ownership via phone match.
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=*`,
      { headers }
    );
    const bookings = await bookingRes.json();
    const booking = Array.isArray(bookings) ? bookings[0] : null;

    if (!booking) {
      res.status(404).json({ error: 'Booking not found' });
      return;
    }
    if (booking.guest_phone !== phone) {
      res.status(403).json({ error: 'This phone number does not match the booking on record' });
      return;
    }
    if (booking.status === 'cancelled') {
      res.status(200).json({ success: true, pointsReversed: 0, message: 'Already cancelled' });
      return;
    }
    if (booking.status === 'completed') {
      res.status(400).json({ error: 'This stay has already been completed and cannot be cancelled' });
      return;
    }

    let pointsReversed = 0;

    // 2. Claw back points ONLY if they were actually awarded already
    // (this only happens if the check-in date had passed before the
    // guest cancelled — an edge case, since most cancellations will
    // happen pre-checkin where nothing was ever awarded to reverse).
    if (booking.points_awarded) {
      const { pts, nights, pledgeCount } = calcPoints(booking);
      const key = tsKey(phone);

      const scoreRes = await fetch(
        `${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=*`,
        { headers }
      );
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

        const upsertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`,
          {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(updated),
          }
        );
        if (!upsertRes.ok) {
          const errText = await upsertRes.text();
          throw new Error('Failed to reverse points: ' + errText);
        }
        pointsReversed = pts;
      }
    }

    // 3. Mark the booking cancelled.
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          points_reversed: pointsReversed > 0,
          points_awarded: false,
        }),
      }
    );

    res.status(200).json({ success: true, pointsReversed });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
