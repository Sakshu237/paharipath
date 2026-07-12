// /api/crowd.js
// Consolidates what were 4 separate serverless functions
// (update-crowd, review-crowd, admin-set-crowd, crowd-log) into one,
// routed internally by `action` — needed to stay under Vercel's
// Hobby-plan cap of 12 serverless functions per deployment.
//
// REQUEST BODY (POST, JSON): { action, ...fields }
//   action: 'submit'    — host submits a pending crowd update
//   action: 'review'    — admin approves/rejects a pending request
//   action: 'admin-set' — admin's own direct bulk crowd edit
//   action: 'log'       — admin fetches the pending queue + history
//
// See the bottom of this file for the exact fields each action needs.

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

async function verifyUser(access_token) {
  if (!access_token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  return user.email ? user : null;
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
    // ═══════════════════════════════════════════════════════
    // action: 'submit' — host submits a pending crowd update
    // fields: place_id, place_name, crowd_value, note, access_token
    // ═══════════════════════════════════════════════════════
    if (action === 'submit') {
      const { place_id, place_name, crowd_value, note, access_token } = req.body;
      const pid = parseInt(place_id);
      const val = parseInt(crowd_value);
      if (!pid || isNaN(val) || val < 0 || val > 100 || !place_name || !access_token) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
      }
      const user = await verifyUser(access_token);
      if (!user) { res.status(401).json({ error: 'Session expired — please log in again' }); return; }
      const hostEmail = user.email;

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

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_update_requests`, {
        method: 'POST',
        headers: svcHeaders,
        body: JSON.stringify({ place_id: pid, place_name, crowd_value: val, note: note || null, host_email: hostEmail, status: 'pending' }),
      });
      if (!insertRes.ok) { res.status(400).json({ error: 'Submission failed: ' + await insertRes.text() }); return; }
      res.status(200).json({ success: true, status: 'pending' });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'review' — admin approves/rejects a pending request
    // fields: request_id, review_action ('approve'|'reject'), access_token
    // ═══════════════════════════════════════════════════════
    if (action === 'review') {
      const { request_id, review_action, access_token } = req.body;
      if (!request_id || !['approve', 'reject'].includes(review_action) || !access_token) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
      }
      if (!adminEmail) { res.status(500).json({ error: 'Server not configured — missing ADMIN_EMAIL' }); return; }
      const user = await verifyUser(access_token);
      if (!user) { res.status(401).json({ error: 'Session expired — please log in again' }); return; }
      if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
        res.status(403).json({ error: 'Only the admin account can review crowd updates' });
        return;
      }

      const reqRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_update_requests?id=eq.${request_id}&select=*`, { headers: svcHeaders });
      const rows = await reqRes.json();
      const reqRow = Array.isArray(rows) ? rows[0] : null;
      if (!reqRow) { res.status(404).json({ error: 'Request not found' }); return; }
      if (reqRow.status !== 'pending') { res.status(400).json({ error: `Already ${reqRow.status}` }); return; }

      if (review_action === 'approve') {
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/crowd_overrides?on_conflict=place_id`, {
          method: 'POST',
          headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ place_id: reqRow.place_id, crowd_value: reqRow.crowd_value, note: reqRow.note, updated_at: new Date().toISOString() }),
        });
        if (!upsertRes.ok) { res.status(400).json({ error: 'Approve failed: ' + await upsertRes.text() }); return; }
      }

      await fetch(`${SUPABASE_URL}/rest/v1/crowd_update_requests?id=eq.${request_id}`, {
        method: 'PATCH',
        headers: svcHeaders,
        body: JSON.stringify({ status: review_action === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.email }),
      });
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'admin-set' — admin's own direct bulk crowd edit
    // fields: updates: [{place_id, crowd_value}, ...], access_token
    // ═══════════════════════════════════════════════════════
    if (action === 'admin-set') {
      const { updates, access_token } = req.body;
      if (!Array.isArray(updates) || updates.length === 0 || !access_token) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
      }
      if (!adminEmail) { res.status(500).json({ error: 'Server not configured — missing ADMIN_EMAIL' }); return; }
      const user = await verifyUser(access_token);
      if (!user) { res.status(401).json({ error: 'Session expired — please log in again' }); return; }
      if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
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
      if (!upsertRes.ok) { res.status(400).json({ error: 'Save failed: ' + await upsertRes.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════════════
    // action: 'log' — admin fetches pending queue + history
    // fields: access_token
    // ═══════════════════════════════════════════════════════
    if (action === 'log') {
      const { access_token } = req.body;
      if (!access_token) { res.status(401).json({ error: 'Not logged in' }); return; }
      if (!adminEmail) { res.status(500).json({ error: 'Server not configured — missing ADMIN_EMAIL' }); return; }
      const user = await verifyUser(access_token);
      if (!user) { res.status(401).json({ error: 'Session expired — please log in again' }); return; }
      if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
        res.status(403).json({ error: 'Only the admin account can view this' });
        return;
      }
      const reqRes = await fetch(
        `${SUPABASE_URL}/rest/v1/crowd_update_requests?select=*&order=created_at.desc&limit=200`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      const requests = await reqRes.json();
      res.status(200).json({ requests: Array.isArray(requests) ? requests : [] });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
