// /api/review-crowd.js
// Approve or reject a pending crowd update request. This is the ONLY
// path by which a host's submission can ever reach crowd_overrides
// (the live table travellers see). Restricted to your admin email —
// set ADMIN_EMAIL in Vercel's environment variables.
//
// REQUEST BODY (POST, JSON):
//   { request_id, action, access_token }
//   action = 'approve' | 'reject'
// RESPONSE: { success: true } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { request_id, action, access_token } = req.body || {};
  if (!request_id || !['approve', 'reject'].includes(action) || !access_token) {
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
    // 1. Verify the caller is really logged in, AND is specifically you.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Session expired — please log in again' });
      return;
    }
    const user = await userRes.json();
    if ((user.email || '').toLowerCase() !== adminEmail.toLowerCase()) {
      res.status(403).json({ error: 'Only the admin account can review crowd updates' });
      return;
    }

    // 2. Fetch the pending request.
    const reqRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crowd_update_requests?id=eq.${request_id}&select=*`,
      { headers: svcHeaders }
    );
    const rows = await reqRes.json();
    const reqRow = Array.isArray(rows) ? rows[0] : null;
    if (!reqRow) {
      res.status(404).json({ error: 'Request not found' });
      return;
    }
    if (reqRow.status !== 'pending') {
      res.status(400).json({ error: `Already ${reqRow.status}` });
      return;
    }

    // 3. If approving, push it live into crowd_overrides now.
    if (action === 'approve') {
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_overrides?on_conflict=place_id`, {
        method: 'POST',
        headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          place_id: reqRow.place_id,
          crowd_value: reqRow.crowd_value,
          note: reqRow.note,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!upsertRes.ok) {
        const t = await upsertRes.text();
        res.status(400).json({ error: 'Approve failed: ' + t });
        return;
      }
    }

    // 4. Mark the request reviewed either way.
    await fetch(`${SUPABASE_URL}/rest/v1/crowd_update_requests?id=eq.${request_id}`, {
      method: 'PATCH',
      headers: svcHeaders,
      body: JSON.stringify({
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.email,
      }),
    });

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
