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

const { checkinHasPassed, awardPointsForBooking, award, addBadge, tsKey } = require('./_lib/points');

const { isAdminEmail, notifyEmail } = require('./_lib/admin');
const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';
const PHONE_RE = /^[6-9]\d{9}$/;
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

// PHASE 1: since the browser can no longer write traveller_scores,
// everything that used to do so goes through this endpoint:
//   (no action)      — award points for a booking after check-in (as before)
//   'profile'        — traveller saves name / photo (never points); optional
//                      referral code is recorded, paid when the friend completes a stay
//   'host-feedback'  — ADMIN logs host feedback; "excellent" = Responsible Guest badge
//   'ngo'            — ADMIN logs a clean-up / NGO activity and its points
async function verifyAdmin(access_token) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !access_token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email && isAdminEmail(u.email) ? u : null;
}

// This endpoint was previously wide open: no auth (fine, it's called by
// any traveller right after booking) but also no rate limit, so a known
// or guessed bookingRef could be hammered repeatedly, or used to probe
// which booking refs exist via the 404/200 response difference. It can't
// award points early or twice (see gates below), so the ceiling on abuse
// was always low, but there was no reason to leave it unthrottled.
const MAX_ATTEMPTS = 10;
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

  const serviceKeyEarly = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const action = (req.body || {}).action;
  if (action) {
    if (!serviceKeyEarly) { res.status(500).json({ error: 'Server not configured' }); return; }
    const h = { apikey: serviceKeyEarly, Authorization: `Bearer ${serviceKeyEarly}`, 'Content-Type': 'application/json' };
    try {
      await handleAction(action, req, res, h);
    } catch (err) {
      console.error('award-points action error:', err);
      res.status(500).json({ error: 'Something went wrong — please try again.' });
    }
    return;
  }

  const { bookingRef } = req.body || {};
  if (!bookingRef || typeof bookingRef !== 'string' || bookingRef.length > 40) {
    res.status(400).json({ error: 'Missing or invalid bookingRef' });
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
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const ipKey = `award-ip:${ip}`;
    const refKey = `award-ref:${bookingRef}`;
    const counts = await Promise.all([
      countRecentAttempts(ipKey, headers),
      countRecentAttempts(refKey, headers),
    ]);
    if (counts[0] >= MAX_ATTEMPTS || counts[1] >= MAX_ATTEMPTS) {
      res.status(429).json({ error: 'Too many requests — please slow down' });
      return;
    }
    await Promise.all([logAttempt(ipKey, headers), logAttempt(refKey, headers)]);

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
    console.error('award-points error:', err);
    res.status(500).json({ error: 'Something went wrong — please try again.' });
  }
};


async function handleAction(action, req, res, headers) {
  const b = req.body || {};
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // ── traveller profile (name, photo) — never touches points ─────────────
  if (action === 'profile') {
    const phone = String(b.phone || '');
    if (!PHONE_RE.test(phone)) { res.status(400).json({ error: 'Enter a valid 10-digit mobile' }); return; }
    if (await countRecentAttempts(`profile-ip:${ip}`, headers) >= 20) { res.status(429).json({ error: 'Too many requests — please slow down' }); return; }
    await logAttempt(`profile-ip:${ip}`, headers);
    // A profile that already has a name or photo belongs to whoever proved this phone
    // with a booking reference. Without that proof, anyone could rename or re-photo
    // another traveller just by knowing their number. Brand-new numbers can still set up a profile.
    const existing = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${encodeURIComponent(tsKey(phone))}&select=guest_name,photo_url&limit=1`, { headers }).then(r => r.json()).catch(() => []);
    const claimed = Array.isArray(existing) && existing[0] && (existing[0].guest_name || existing[0].photo_url);
    if (claimed) {
      const proofRef = String(b.proofRef || '');
      const proof = /^PP[A-Z0-9]{6,12}$/.test(proofRef)
        ? await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(proofRef)}&guest_phone=eq.${phone}&select=id`, { headers }).then(r => r.json()).catch(() => [])
        : [];
      if (!Array.isArray(proof) || !proof.length) {
        res.status(403).json({ error: 'For privacy, open “Manage / Cancel Booking” once with your booking reference on this device, then edit your profile.' });
        return;
      }
    }
    const row = { user_key: tsKey(phone), phone_hint: phone };
    const name = clip(b.name, 80).replace(/[<>]/g, '');
    if (name) row.guest_name = name;
    if (typeof b.photo_url === 'string' && b.photo_url.startsWith(SUPABASE_URL + '/storage/')) row.photo_url = b.photo_url.slice(0, 500);
    // Upsert only these columns; existing points, history and badges are never touched.
    const up = await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
      method: 'POST', headers: { ...headers, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(row),
    });
    if (!up.ok) { console.error('profile save failed', await up.text()); res.status(400).json({ error: 'Could not save your profile' }); return; }

    // Referral code: record it now, pay both people when this traveller completes a stay.
    let referral = null;
    const code = clip(b.referralCode, 20);
    if (code) {
      const rc = await fetch(`${SUPABASE_URL}/rest/v1/referral_codes?code=eq.${encodeURIComponent(code)}&select=phone&limit=1`, { headers });
      const owner = rc.ok ? (await rc.json())[0] : null;
      const already = await fetch(`${SUPABASE_URL}/rest/v1/referrals?referee_phone=eq.${phone}&select=id&limit=1`, { headers });
      const has = already.ok ? (await already.json()).length : 1;
      if (owner && owner.phone && owner.phone !== phone && !has) {
        await fetch(`${SUPABASE_URL}/rest/v1/referrals`, {
          method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ referrer_phone: owner.phone, referee_phone: phone, code_used: code, bonus_awarded: false }),
        });
        referral = 'pending';
      }
    }
    res.status(200).json({ success: true, referral });
    return;
  }

  // Everything below is admin-only.
  const admin = await verifyAdmin(b.access_token);
  if (!admin) { res.status(403).json({ error: 'Only the admin account can do that — please log in again' }); return; }

  // ── host feedback → Responsible Guest badge + points ───────────────────
  if (action === 'host-feedback') {
    const phone = String(b.phone || '');
    if (!PHONE_RE.test(phone)) { res.status(400).json({ error: 'Enter valid 10-digit phone' }); return; }
    const rating = ['excellent', 'good', 'poor'].includes(b.rating) ? b.rating : 'good';
    const pts = rating === 'excellent' ? 50 : rating === 'good' ? 20 : 0;
    const badge = rating === 'excellent' ? '🏅 Responsible Guest' : null;
    const row = {
      guest_name: clip(b.guestName, 80), phone, ref: clip(b.ref, 40), stay_name: clip(b.stayName, 120),
      comment: clip(b.comment, 1000), rating, behaviours: Array.isArray(b.behaviours) ? b.behaviours.slice(0, 10).map(x => clip(String(x), 80)) : [],
      badge_awarded: !!badge, pts, date: new Date().toLocaleDateString('en-IN'),
    };
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/host_feedbacks`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!ins.ok) { console.error('host feedback insert failed', await ins.text()); res.status(400).json({ error: 'Could not save feedback' }); return; }
    const [saved] = await ins.json();
    let added = false;
    if (pts > 0) {
      // One host-feedback award per booking ref (or per feedback row when no ref was given).
      const key = row.ref ? `host-feedback:${row.ref}` : `host-feedback-row:${saved && saved.id}`;
      added = await award({ phone, actionKey: key, pts, reason: badge ? 'Responsible Guest badge from your host' : 'Good-guest feedback from your host', ref: row.ref || null, guestName: row.guest_name }, headers, SUPABASE_URL);
      if (badge) await addBadge(phone, badge, headers, SUPABASE_URL);
    }
    res.status(200).json({ success: true, pts: added ? pts : 0, badge });
    return;
  }

  // ── NGO / clean-up activity → badge + points ───────────────────────────
  if (action === 'ngo') {
    const phone = String(b.phone || '');
    if (!PHONE_RE.test(phone)) { res.status(400).json({ error: 'Enter valid 10-digit phone' }); return; }
    const pts = Math.min(Math.max(parseInt(b.pts) || 0, 0), 500);
    const row = {
      name: clip(b.name, 80), phone, type: clip(b.type, 30), type_label: clip(b.typeLabel, 80), location: clip(b.location, 120),
      kg: Math.max(parseInt(b.kg) || 0, 0), hours: Math.max(parseInt(b.hours) || 1, 1), notes: clip(b.notes, 1000),
      badge: clip(b.badge, 60), pts, date: new Date().toLocaleDateString('en-IN'),
    };
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/ngo_activities`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
    if (!ins.ok) { console.error('ngo insert failed', await ins.text()); res.status(400).json({ error: 'Could not save activity' }); return; }
    const [saved] = await ins.json();
    const added = pts > 0 && await award({ phone, actionKey: `ngo:${saved && saved.id}`, pts, reason: `${row.type_label || 'Community activity'} at ${row.location}`, ref: `ngo:${saved && saved.id}`, guestName: row.name }, headers, SUPABASE_URL);
    if (row.badge) await addBadge(phone, row.badge, headers, SUPABASE_URL);
    res.status(200).json({ success: true, pts: added ? pts : 0 });
    return;
  }

  res.status(400).json({ error: 'Unknown action' });
}
