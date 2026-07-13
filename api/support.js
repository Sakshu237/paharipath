// /api/support.js
// Customer care / support ticket system.
// Public: 'submit' — anyone can raise a ticket, no login required.
// Admin only: 'list', 'update' — reviewing and resolving tickets.
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
    // action: 'submit' — anyone raises a support ticket, no login needed
    // fields: name, contact, category, message, bookingRef (optional)
    // ═══════════════════════════════════════════════
    if (action === 'submit') {
      const b = req.body;
      if (!b.name || !b.contact || !b.message) {
        res.status(400).json({ error: 'Name, contact, and message are required' });
        return;
      }
      const payload = {
        name: b.name, contact: b.contact, category: b.category || 'general',
        message: b.message, booking_ref: b.bookingRef || null, status: 'open',
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Submit failed: ' + await insRes.text() }); return; }
      res.status(200).json({ success: true, message: "We've got your message — we'll get back to you soon." });
      return;
    }

    // Everything past this point is admin-only.
    const authResult = await verifyAdmin(req.body.access_token, adminEmail);
    if (!authResult.user) { res.status(403).json({ error: authResult.errorReason || 'Only the admin account can do that' }); return; }
    const user = authResult.user;

    // ═══════════════════════════════════════════════
    // action: 'list' — admin fetches tickets (optionally filtered by status)
    // fields: status (optional: 'open'|'in_progress'|'resolved')
    // ═══════════════════════════════════════════════
    if (action === 'list') {
      const status = req.body.status;
      const url = status
        ? `${SUPABASE_URL}/rest/v1/support_tickets?status=eq.${encodeURIComponent(status)}&order=created_at.desc`
        : `${SUPABASE_URL}/rest/v1/support_tickets?order=created_at.desc&limit=200`;
      const listRes = await fetch(url, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const tickets = await listRes.json();
      res.status(200).json({ success: true, tickets });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'update' — admin changes status / adds notes
    // fields: ticketId, status (optional), adminNotes (optional)
    // ═══════════════════════════════════════════════
    if (action === 'update') {
      const ticketId = parseInt(req.body.ticketId);
      if (!ticketId) { res.status(400).json({ error: 'Missing ticketId' }); return; }
      const fields = { updated_at: new Date().toISOString() };
      if (req.body.status) fields.status = req.body.status;
      if (req.body.adminNotes !== undefined) fields.admin_notes = req.body.adminNotes;
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${ticketId}`, {
        method: 'PATCH', headers: svcHeaders, body: JSON.stringify(fields),
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
