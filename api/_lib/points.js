// /api/_lib/points.js
// Shared logic for calculating and awarding PAHADI points.
// Used by both award-points.js (manual/per-booking trigger, now gated
// on check-in date having passed) and complete-stays.js (the daily
// cron that sweeps all eligible bookings). Keeping this in one place
// means the point formula only ever needs to change in one file.
//
// NOTE: This file lives under /api/_lib/ — Vercel's file-based router
// ignores any path segment starting with an underscore, so this never
// becomes a public HTTP endpoint. It's a plain importable module.

function tsKey(phone) {
  if (!phone) return 'anon';
  let h = 5381;
  for (let i = 0; i < phone.length; i++) h = ((h << 5) + h) ^ phone.charCodeAt(i);
  return 'u' + (h >>> 0).toString(36);
}

function calcPoints(booking) {
  const nights = booking.nights || 1;
  let pts = 0;
  const reasons = [];
  pts += 100; reasons.push('+100 for completing a booking');
  pts += nights * 20; reasons.push(`+${nights * 20} for ${nights} night${nights !== 1 ? 's' : ''}`);
  if (booking.eco) { pts += 50; reasons.push('+50 carbon offset'); }
  const pledgeCount = booking.pledges_accepted || 0;
  if (pledgeCount > 0) { pts += pledgeCount * 10; reasons.push(`+${pledgeCount * 10} eco pledges`); }
  if (booking.offbeat) { pts += 50; reasons.push('+50 offbeat/village stay'); }
  return { pts, reasons, nights, pledgeCount };
}

// Returns true once the guest's check-in date has actually arrived —
// this is the gate that stops "book then cancel" from ever earning
// points, since nothing is credited until the stay has begun.
function checkinHasPassed(booking) {
  if (!booking.checkin_date) return true; // no date on record — don't block, fail open
  const today = new Date().toISOString().slice(0, 10);
  return booking.checkin_date <= today;
}

// Awards points for a single booking: loads/creates the traveller_scores
// row, adds this booking's points + stats, appends a history entry,
// upserts, then marks the booking as awarded + completed.
// `headers` must already carry the Supabase service-role auth.
async function awardPointsForBooking(booking, headers, SUPABASE_URL) {
  const { pts, reasons, nights, pledgeCount } = calcPoints(booking);
  const phone = booking.guest_phone;
  const key = tsKey(phone);

  const scoreRes = await fetch(
    `${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=*`,
    { headers }
  );
  const scoreRows = await scoreRes.json();
  const current = (Array.isArray(scoreRows) && scoreRows[0]) || {
    points: 0, stays: 0, nights: 0, eco: 0, offbeat: 0, pledges: 0, history: []
  };

  const updated = {
    user_key: key,
    guest_name: booking.guest || current.guest_name,
    phone_hint: phone,
    points: (current.points || 0) + pts,
    stays: (current.stays || 0) + 1,
    nights: (current.nights || 0) + nights,
    eco: (current.eco || 0) + (booking.eco ? 1 : 0),
    offbeat: (current.offbeat || 0) + (booking.offbeat ? 1 : 0),
    pledges: (current.pledges || 0) + pledgeCount,
    history: [...(current.history || []), {
      ref: booking.id, stay: booking.stay_name, pts,
      date: new Date().toLocaleDateString('en-IN'), reasons
    }],
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
    throw new Error('Failed to save points: ' + errText);
  }

  await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ points_awarded: true, status: 'completed' }),
    }
  );

  return { points: updated.points, awarded: pts, reasons };
}

module.exports = { tsKey, calcPoints, checkinHasPassed, awardPointsForBooking };
