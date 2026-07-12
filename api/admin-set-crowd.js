// /api/admin-set-crowd.js
// Your own direct crowd editor (the bulk slider grid in the admin
// dashboard) — no approval needed since it's already you, but it now
// has to go through the server too, because crowd_overrides no longer
// accepts ANY direct browser writes, including yours. Restricted to
// ADMIN_EMAIL, same as review-crowd.js.
//
// REQUEST BODY (POST, JSON): { updates: [{place_id, crowd_value}, ...], access_token }
// RESPONSE: { success: true } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { updates, access_token } = req.body || {};
  if (!Array.isArray(updates) || updates.length === 0 || !access_token) {
    res.status(400).json({ error: 'Missing or invalid fields' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!serviceKey || !adminEmail) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY or ADMIN_EMAIL' });
    return;
  }
  const svcHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Session expired — please log in again' });
      return;
    }
    const user = await userRes.json();
    if ((user.email || '').toLowerCase() !== adminEmail.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can do this' });
      return;
    }

    const payload = updates
      .map(u => ({ place_id: parseInt(u.place_id), crowd_value: parseInt(u.crowd_value), updated_at: new Date().toISOString() }))
      .filter(u => u.place_id && !isNaN(u.crowd_value) && u.crowd_value >= 0 && u.crowd_value <= 100);

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_overrides?on_conflict=place_id`, {
      method: 'POST',
      headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(payload),
    });
    if (!upsertRes.ok) {
      const t = await upsertRes.text();
      res.status(400).json({ error: 'Save failed: ' + t });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
