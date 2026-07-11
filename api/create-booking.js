// /api/create-booking.js
// Moves booking creation server-side so rate limiting can actually be
// enforced — the previous approach used localStorage on the client,
// which anyone can clear or bypass entirely via incognito mode. This
// endpoint tracks attempts in a `rate_limit_log` table keyed by BOTH
// the guest's phone number and their IP address, so someone can't get
// around a phone-based limit just by using a different number from
// the same IP, or vice versa.
//
// Also does basic server-side field validation, since a client-only
// check can always be skipped by calling the API directly.
//
// SETUP: needs SUPABASE_SERVICE_ROLE_KEY (already set for the points
// endpoints) and the rate_limit_log table (see migration provided).
//
// REQUEST BODY (POST, JSON): the full bookingRow object built by
// processPayment() in index.html.
// RESPONSE: { success: true, ref } or { error: "message" }

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
  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_log`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ rl_key: key }),
  });
}

function tsKey(phone) {
  if (!phone) return 'anon';
  let h = 5381;
  for (let i = 0; i < phone.length; i++) h = ((h << 5) + h) ^ phone.charCodeAt(i);
  return 'u' + (h >>> 0).toString(36);
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

  const booking = req.body || {};

  // Basic server-side validation — never trust the client alone.
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

  try {
    // Rate limit check — both the phone number AND the IP are checked
    // independently; either one hitting the cap blocks the request.
    const [phoneCount, ipCount] = await Promise.all([
      countRecentAttempts(phoneKey, headers),
      countRecentAttempts(ipKey, headers),
    ]);

    if (phoneCount >= MAX_ATTEMPTS || ipCount >= MAX_ATTEMPTS) {
      res.status(429).json({
        error: `Too many booking attempts. Please wait ${WINDOW_MINUTES} minutes and try again, or contact us on WhatsApp to book directly.`,
      });
      return;
    }

    // Log this attempt before proceeding, so it counts toward the
    // limit regardless of whether the insert below succeeds.
    await Promise.all([logAttempt(phoneKey, headers), logAttempt(ipKey, headers)]);

    // Insert the booking.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/bookings`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(booking),
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      res.status(400).json({ error: 'Booking save failed: ' + errText });
      return;
    }

    // Save the guest's name against their phone hint (same upsert that
    // used to run client-side).
    await fetch(`${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        user_key: tsKey(booking.guest_phone),
        guest_name: booking.guest,
        phone_hint: booking.guest_phone,
      }),
    });

    res.status(200).json({ success: true, ref: booking.id });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
