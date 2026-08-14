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
      const payload = {
        traveller_name: b.travellerName || 'Unknown traveller',
        traveller_phone: b.travellerPhone || null,
        alert_target: b.alertTarget || 'support',
        place_name: b.placeName || null,
        lat: typeof b.lat === 'number' ? b.lat : null,
        lng: typeof b.lng === 'number' ? b.lng : null,
        notes: b.notes || null,
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
