// /api/crowd-log.js
// Returns crowd_update_requests for the admin dashboard — pending
// items to review, plus the approved/rejected history. Restricted to
// ADMIN_EMAIL (set in Vercel env vars), not just "any logged-in
// session" — since hosts and the admin log in through the same
// mechanism, "logged in" alone isn't enough to prove it's you.
//
// REQUEST BODY (POST, JSON): { access_token }
// RESPONSE: { requests: [...] } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { access_token } = req.body || {};
  if (!access_token) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!serviceKey || !adminEmail) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY or ADMIN_EMAIL' });
    return;
  }
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
      res.status(403).json({ error: 'Only the admin account can view this' });
      return;
    }

    const reqRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crowd_update_requests?select=*&order=created_at.desc&limit=200`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const requests = await reqRes.json();
    res.status(200).json({ requests: Array.isArray(requests) ? requests : [] });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
