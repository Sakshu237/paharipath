// /api/update-crowd.js
// Host crowd/road-condition submissions. These NO LONGER write live —
// they go into crowd_update_requests as 'pending' and only reach
// travellers once approved via /api/review-crowd.js. This is the
// approval-queue version, replacing the earlier instant-write one.
//
// Still verifies the host's real Supabase session and confirms their
// listing is actually tied to the destination they're submitting for
// — same checks as before, just no longer enough on their own to go
// live.
//
// REQUEST BODY (POST, JSON):
//   { place_id, place_name, crowd_value, note, access_token }
// RESPONSE: { success: true, status: 'pending' } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { place_id, place_name, crowd_value, note, access_token } = req.body || {};
  const pid = parseInt(place_id);
  const val = parseInt(crowd_value);
  if (!pid || isNaN(val) || val < 0 || val > 100 || !place_name || !access_token) {
    res.status(400).json({ error: 'Missing or invalid fields' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const svcHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Verify the session token is real and get the CONFIRMED email.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Session expired — please log in again' });
      return;
    }
    const user = await userRes.json();
    const hostEmail = user.email;
    if (!hostEmail) {
      res.status(401).json({ error: 'Could not verify host identity' });
      return;
    }

    // 2. Confirm this host's own listing is tied to this destination.
    // (Same string-based heuristic noted in the earlier version — the
    // real hardening for this is a `place_id` column on `stays`.)
    const stayRes = await fetch(
      `${SUPABASE_URL}/rest/v1/stays?host_email=eq.${encodeURIComponent(hostEmail)}&select=loc`,
      { headers: svcHeaders }
    );
    const stays = await stayRes.json();
    const owns = Array.isArray(stays) && stays.some(s => (s.loc || '').toLowerCase().includes(String(place_name).toLowerCase()));
    if (!owns) {
      res.status(403).json({ error: `This account isn't linked to ${place_name} — you can only submit updates for your own listed destination.` });
      return;
    }

    // 3. Insert as a PENDING request — does not touch crowd_overrides.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_update_requests`, {
      method: 'POST',
      headers: svcHeaders,
      body: JSON.stringify({ place_id: pid, place_name, crowd_value: val, note: note || null, host_email: hostEmail, status: 'pending' }),
    });
    if (!insertRes.ok) {
      const t = await insertRes.text();
      res.status(400).json({ error: 'Submission failed: ' + t });
      return;
    }

    res.status(200).json({ success: true, status: 'pending' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
