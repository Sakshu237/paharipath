// /api/_lib/points.js
// Shared logic for calculating and awarding PAHADI points.
// Used by award-points.js (per-booking trigger + admin/host awards) and
// complete-stays.js (the daily cron that sweeps all eligible bookings).
//
// PHASE 1 — every point now goes through the points_ledger table via the
// award_points() SQL function (see supabase/phase1-points.sql). Each award
// has a unique action key, so the same action can never pay twice, and
// reverse_points() takes back everything tied to a booking when it is
// cancelled. The browser can no longer write points at all.
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
  // Fail CLOSED: a booking with no check-in date never earns points.
  if (!booking.checkin_date) return false;
  // Compare in India time — Vercel runs in UTC, 5h30m behind IST.
  const todayIST = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  return booking.checkin_date <= todayIST;
}

// Calls a Postgres function through PostgREST. `headers` must carry the
// service-role key (award_points / reverse_points are server-only).
async function rpc(fn, args, headers, SUPABASE_URL) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers, body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn} failed: ${text}`);
  try { return JSON.parse(text); } catch (e) { return text; }
}

// Award points once for an action. Returns true if points were added,
// false if this action key was already paid.
async function award({ phone, actionKey, pts, reason, ref, guestName }, headers, SUPABASE_URL) {
  return rpc('award_points', {
    p_user_key: tsKey(phone), p_action_key: actionKey, p_pts: pts, p_reason: reason,
    p_ref: ref || null, p_guest_name: guestName || null, p_phone: phone || null,
  }, headers, SUPABASE_URL);
}

// Take back every award tied to a ref (e.g. a cancelled booking). Returns points removed.
async function reverseRef(ref, reason, headers, SUPABASE_URL) {
  return rpc('reverse_points', { p_ref: ref, p_reason: reason || 'Booking cancelled' }, headers, SUPABASE_URL);
}

// Adds a badge to a traveller's badge list (no points — those go through award()).
async function addBadge(phone, badge, headers, SUPABASE_URL) {
  if (!badge) return;
  const key = tsKey(phone);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=badges`, { headers });
  const rows = r.ok ? await r.json() : [];
  const badges = (rows[0] && Array.isArray(rows[0].badges)) ? rows[0].badges : [];
  if (badges.includes(badge)) return;
  await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_key: key, phone_hint: phone, badges: [...badges, badge] }),
  });
}

// Referral bonus: paid to BOTH people only when the referred friend
// completes their first stay. Called after a booking's points are awarded.
const REFERRAL_PTS = 100;
async function payReferralIfDue(booking, headers, SUPABASE_URL) {
  const phone = booking.guest_phone;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/referrals?referee_phone=eq.${encodeURIComponent(phone)}&completed_at=is.null&select=id,referrer_phone&limit=1`, { headers });
  const rows = r.ok ? await r.json() : [];
  const ref = Array.isArray(rows) && rows[0];
  if (!ref || !ref.referrer_phone || ref.referrer_phone === phone) return 0;
  await award({ phone, actionKey: `referral-joined:${phone}`, pts: REFERRAL_PTS, reason: 'Welcome bonus — your first stay through a friend', ref: booking.id, guestName: booking.guest }, headers, SUPABASE_URL);
  await award({ phone: ref.referrer_phone, actionKey: `referral-by:${phone}`, pts: REFERRAL_PTS, reason: 'Your friend completed their first stay', ref: booking.id }, headers, SUPABASE_URL);
  await fetch(`${SUPABASE_URL}/rest/v1/referrals?id=eq.${ref.id}`, { method: 'PATCH', headers, body: JSON.stringify({ completed_at: new Date().toISOString(), bonus_awarded: true }) });
  return REFERRAL_PTS;
}

// Awards points for a single booking (after check-in): claims the booking,
// writes the award through the ledger, updates the stay counters, marks the
// booking completed, and pays any pending referral bonus.
async function awardPointsForBooking(booking, headers, SUPABASE_URL) {
  // Atomically claim this booking first: only the request that flips
  // points_awarded false→true goes on to credit points.
  const claimRes = await fetch(
    `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}&points_awarded=not.is.true`,
    { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify({ points_awarded: true }) }
  );
  const claimed = claimRes.ok ? await claimRes.json() : [];
  if (!Array.isArray(claimed) || !claimed.length) {
    return { points: null, awarded: 0, reasons: ['Points already awarded for this booking'] };
  }

  const { pts, reasons, nights, pledgeCount } = calcPoints(booking);
  const phone = booking.guest_phone;
  let added;
  try {
    added = await award({
      phone, actionKey: `booking:${booking.id}`, pts,
      reason: `Stay at ${booking.stay_name || 'PahariPath stay'}`, ref: booking.id, guestName: booking.guest,
    }, headers, SUPABASE_URL);
  } catch (e) {
    // Release the claim so the next cron run can retry this booking.
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ points_awarded: false }),
    });
    throw e;
  }

  // Stay counters (not points). Only when the ledger actually paid this booking.
  if (added) {
    const key = tsKey(phone);
    const sr = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=stays,nights,eco,offbeat,pledges`, { headers });
    const cur = (sr.ok ? (await sr.json())[0] : null) || {};
    await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        stays: (cur.stays || 0) + 1, nights: (cur.nights || 0) + nights,
        eco: (cur.eco || 0) + (booking.eco ? 1 : 0), offbeat: (cur.offbeat || 0) + (booking.offbeat ? 1 : 0),
        pledges: (cur.pledges || 0) + pledgeCount,
      }),
    });
  }

  await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(booking.id)}`, {
    method: 'PATCH', headers, body: JSON.stringify({ points_awarded: true, status: 'completed' }),
  });

  let referral = 0;
  try { referral = await payReferralIfDue(booking, headers, SUPABASE_URL); } catch (e) { console.warn('referral payout failed', e.message); }

  const tr = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${tsKey(phone)}&select=points`, { headers });
  const total = tr.ok ? ((await tr.json())[0] || {}).points : null;
  return { points: total, awarded: added ? pts + referral : 0, reasons: referral ? [...reasons, `+${referral} friend referral bonus`] : reasons };
}

module.exports = { tsKey, calcPoints, checkinHasPassed, awardPointsForBooking, award, reverseRef, addBadge };
