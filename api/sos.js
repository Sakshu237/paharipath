// /api/sos.js
// Emergency SOS alert log.
// Public: 'submit' — anyone in the app can trigger this, no login required.
//   Called every time a traveller taps an SOS button, regardless of which
//   WhatsApp target (host or PahariPath support) they alerted — this is
//   what makes the alert show up in the admin dashboard even if the
//   traveller's WhatsApp never actually sent (app closed, no signal, etc).
// Admin only: 'list', 'resolve' — reviewing and closing out alerts.
//
// REQUEST BODY (POST, JSON): { action, ...fields, access_token }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

// SOS is public and unauthenticated by design (no login in an emergency),
// so it's rate-limited the same way as /api/bookings.js create-booking —
// shared rate_limit_log table, but with a distinct key prefix ('sos-...')
// so it never shares a bucket with booking attempts. Limits are looser
// than booking's (a panicking traveller may legitimately tap retry a few
// times) but still block scripted spam of the alert table.
const MAX_ATTEMPTS = 8;
const WINDOW_MINUTES = 10;

// Free-text fields are user-supplied and rendered directly in the admin
// dashboard (loadSOSAlerts in app.js) without sanitization on the way in,
// so cap their length here to limit abuse/payload size. Rendering-side
// escaping is handled separately (see loadSOSAlerts sanitize() fix).
const MAX_NAME_LEN = 100;
const MAX_PLACE_LEN = 120;
const MAX_NOTES_LEN = 500;
const MAX_PHONE_LEN = 20;

function clip(val, max) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
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

async function verifyAdmin(access_token, adminEmail) {
  if (!adminEmail) return { errorReason: 'ADMIN_EMAIL is not set on the server (Vercel env vars)' };
  if (!access_token) return { errorReason: 'No login session was sent with this request — please log out and back in' };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return { errorReason: 'Your login session has expired — please log out and back in' };
  const user = await userRes.json();
  if (!user.email) return { errorReason: 'Could not read the account email from this session' };
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    return { errorReason: `Logged in as ${user.email}, which does not match the ADMIN_EMAIL set on the server` };
  }
  return { user };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!serviceKey) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const svcHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const { action } = req.body || {};

  try {
    // ═══════════════════════════════════════════════
    // action: 'submit' — logged every time an SOS button is tapped, no login needed
    // fields: travellerName, travellerPhone, alertTarget ('host'|'support'),
    //         placeName (optional), lat, lng (optional), notes (optional)
    // ═══════════════════════════════════════════════
    if (action === 'submit') {
      const b = req.body;

      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const ipKey = `sos-ip:${ip}`;
      const phone = clip(b.travellerPhone, MAX_PHONE_LEN);
      const phoneKey = phone ? `sos-phone:${phone}` : null;

      const counts = await Promise.all([
        countRecentAttempts(ipKey, svcHeaders),
        phoneKey ? countRecentAttempts(phoneKey, svcHeaders) : Promise.resolve(0),
      ]);
      if (counts[0] >= MAX_ATTEMPTS || counts[1] >= MAX_ATTEMPTS) {
        // Still 429, not silently dropped — a real emergency should fall
        // back to the WhatsApp message (which sendSOS fires regardless of
        // this endpoint's result) or the 112 guidance shown in the SOS modal.
        res.status(429).json({ error: 'Too many SOS submissions from this device recently. If this is a real emergency, call 112 or use the WhatsApp button directly.' });
        return;
      }
      await Promise.all([logAttempt(ipKey, svcHeaders), phoneKey ? logAttempt(phoneKey, svcHeaders) : Promise.resolve()]);

      const payload = {
        traveller_name: clip(b.travellerName, MAX_NAME_LEN) || 'Unknown traveller',
        traveller_phone: phone,
        alert_target: b.alertTarget === 'host' ? 'host' : 'support',
        place_name: clip(b.placeName, MAX_PLACE_LEN),
        lat: typeof b.lat === 'number' ? b.lat : null,
        lng: typeof b.lng === 'number' ? b.lng : null,
        notes: clip(b.notes, MAX_NOTES_LEN),
        status: 'new',
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/sos_alerts`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Submit failed: ' + await insRes.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // Everything past this point is admin-only.
    const authResult = await verifyAdmin(req.body.access_token, adminEmail);
    if (!authResult.user) { res.status(403).json({ error: authResult.errorReason || 'Only the admin account can do that' }); return; }

    // ═══════════════════════════════════════════════
    // action: 'list' — admin fetches alerts (optionally filtered by status)
    // fields: status (optional: 'new'|'resolved')
    // ═══════════════════════════════════════════════
    if (action === 'list') {
      const status = req.body.status;
      const url = status
        ? `${SUPABASE_URL}/rest/v1/sos_alerts?status=eq.${encodeURIComponent(status)}&order=created_at.desc&limit=200`
        : `${SUPABASE_URL}/rest/v1/sos_alerts?order=created_at.desc&limit=200`;
      const listRes = await fetch(url, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const alerts = await listRes.json();
      res.status(200).json({ success: true, alerts });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'resolve' — admin marks an alert as handled
    // fields: alertId
    // ═══════════════════════════════════════════════
    if (action === 'resolve') {
      const alertId = parseInt(req.body.alertId);
      if (!alertId) { res.status(400).json({ error: 'Missing alertId' }); return; }
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/sos_alerts?id=eq.${alertId}`, {
        method: 'PATCH', headers: svcHeaders,
        body: JSON.stringify({ status: 'resolved', resolved_at: new Date().toISOString() }),
      });
      if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
