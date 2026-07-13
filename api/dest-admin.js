// /api/dest-admin.js
// Consolidated endpoint for everything under "Destinations control":
// add / edit / delete destinations, and Plan-My-Journey verdict overrides.
// One file, routed by `action`, to stay under Vercel's Hobby 12-function cap
// (same pattern as /api/crowd.js).
//
// REQUEST BODY (POST, JSON): { action, ...fields, access_token }
//   action: 'add'            — create a brand-new destination
//   action: 'update'         — edit fields on an existing destination (built-in or added)
//   action: 'delete'         — remove a destination (soft-delete for built-ins)
//   action: 'restore'        — undo a delete
//   action: 'journey-set'    — force a Plan My Journey verdict for a destination
//   action: 'journey-clear'  — remove the override, go back to the formula

// /api/dest-admin.js
// Consolidated endpoint for "Destinations control" AND "PAHADI Task control".
// One file, routed by `action`, to stay under Vercel's Hobby 12-function cap
// (same pattern as /api/crowd.js).
//
// REQUEST BODY (POST, JSON): { action, ...fields, access_token }
//   -- Destinations (admin only) --
//   action: 'add'            — create a brand-new destination
//   action: 'update'         — edit fields on an existing destination (built-in or added)
//   action: 'delete'         — remove a destination (soft-delete for built-ins)
//   action: 'restore'        — undo a delete
//   action: 'journey-set'    — force a Plan My Journey verdict for a destination
//   action: 'journey-clear'  — remove the override, go back to the formula
//   -- PAHADI Tasks (admin only, except task-propose which any logged-in host can call) --
//   action: 'task-add'       — admin adds a task directly (goes live immediately)
//   action: 'task-update'    — admin edits a task (built-in or added)
//   action: 'task-delete'    — admin removes a task (soft-delete for built-ins)
//   action: 'task-restore'   — undo a soft-delete on a built-in task
//   action: 'task-propose'   — HOST submits a task idea for admin review (any logged-in user)
//   action: 'task-review'    — admin approves or rejects a pending proposal

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';
const { sendEmail } = require('./_lib/email');

// Any logged-in user (host or traveller) — just checks the token is valid.
async function verifyUser(access_token) {
  if (!access_token) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  return user.email ? user : null;
}

// Must be logged in AND match ADMIN_EMAIL.
async function verifyAdmin(access_token, adminEmail) {
  const user = await verifyUser(access_token);
  if (!user || !adminEmail) return null;
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
  return user;
}

function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const HOST_ONLY_ACTIONS = new Set(['task-propose']);

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

  const { action, access_token } = req.body || {};
  let user;
  if (HOST_ONLY_ACTIONS.has(action)) {
    user = await verifyUser(access_token);
    if (!user) { res.status(403).json({ error: 'Please log in to submit a task idea' }); return; }
  } else {
    user = await verifyAdmin(access_token, adminEmail);
    if (!user) { res.status(403).json({ error: 'Only the admin account can do that' }); return; }
  }

  try {
    // ═══════════════════════════════════════════════
    // action: 'add' — brand-new destination
    // fields: name, district, desc, emoji, crowd, vibes[], color,
    //         bestTime, altitude, famousFor, zone, mx, my, lat, lng
    // ═══════════════════════════════════════════════
    if (action === 'add') {
      const b = req.body;
      if (!b.name || !b.district) {
        res.status(400).json({ error: 'Name and district are required' });
        return;
      }
      // New ids start at 1000 to never collide with the 146 built-ins (1–146).
      const maxRes = await fetch(`${SUPABASE_URL}/rest/v1/destination_additions?select=id&order=id.desc&limit=1`, { headers: svcHeaders });
      const maxRows = await maxRes.json();
      const nextId = Array.isArray(maxRows) && maxRows[0] ? maxRows[0].id + 1 : 1000;

      const slug = slugify(b.slug || b.name) + '-' + nextId;
      const payload = {
        id: nextId, name: b.name, district: b.district, description: b.desc || '',
        emoji: b.emoji || '📍', crowd: parseInt(b.crowd) || 20,
        vibes: Array.isArray(b.vibes) ? b.vibes : [],
        color: b.color || '#dde8d4', best_time: b.bestTime || '',
        altitude: b.altitude || '', famous_for: b.famousFor || '',
        zone: b.zone || '', mx: parseInt(b.mx) || null, my: parseInt(b.my) || null,
        lat: b.lat ? parseFloat(b.lat) : null, lng: b.lng ? parseFloat(b.lng) : null,
        slug, updated_at: new Date().toISOString(),
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/destination_additions`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Add failed: ' + await insRes.text() }); return; }
      const [row] = await insRes.json();
      res.status(200).json({ success: true, destination: row });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'update' — edit any field on a built-in (1–146) or an
    // admin-added (1000+) destination
    // fields: id, isBuiltIn, + any of the editable fields above
    // ═══════════════════════════════════════════════
    if (action === 'update') {
      const b = req.body;
      const id = parseInt(b.id);
      if (!id) { res.status(400).json({ error: 'Missing destination id' }); return; }

      const fieldMap = {
        name: b.name, district: b.district, description: b.desc, emoji: b.emoji,
        vibes: Array.isArray(b.vibes) ? b.vibes : undefined,
        best_time: b.bestTime, altitude: b.altitude, famous_for: b.famousFor, zone: b.zone,
      };
      const fields = {};
      Object.entries(fieldMap).forEach(([k, v]) => { if (v !== undefined) fields[k] = v; });

      if (id >= 1000) {
        // Admin-added destination — update in place.
        const upd = await fetch(`${SUPABASE_URL}/rest/v1/destination_additions?id=eq.${id}`, {
          method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
        });
        if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      } else {
        // Built-in destination — upsert an override row.
        const upd = await fetch(`${SUPABASE_URL}/rest/v1/destination_overrides?on_conflict=place_id`, {
          method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ place_id: id, ...fields, updated_at: new Date().toISOString() }),
        });
        if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'delete' — soft-delete a built-in, hard-delete an added one
    // fields: id
    // ═══════════════════════════════════════════════
    if (action === 'delete') {
      const id = parseInt(req.body.id);
      if (!id) { res.status(400).json({ error: 'Missing destination id' }); return; }

      if (id >= 1000) {
        const del = await fetch(`${SUPABASE_URL}/rest/v1/destination_additions?id=eq.${id}`, { method: 'DELETE', headers: svcHeaders });
        if (!del.ok) { res.status(400).json({ error: 'Delete failed: ' + await del.text() }); return; }
      } else {
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/destination_deletions?on_conflict=place_id`, {
          method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ place_id: id, deleted_at: new Date().toISOString(), deleted_by: user.email }),
        });
        if (!ins.ok) { res.status(400).json({ error: 'Delete failed: ' + await ins.text() }); return; }
      }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'restore' — undo a soft-delete on a built-in
    // fields: id
    // ═══════════════════════════════════════════════
    if (action === 'restore') {
      const id = parseInt(req.body.id);
      if (!id) { res.status(400).json({ error: 'Missing destination id' }); return; }
      const del = await fetch(`${SUPABASE_URL}/rest/v1/destination_deletions?place_id=eq.${id}`, { method: 'DELETE', headers: svcHeaders });
      if (!del.ok) { res.status(400).json({ error: 'Restore failed: ' + await del.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'journey-set' — force a Plan My Journey verdict
    // fields: id, verdict ('good'|'caution'|'not_recommended'), reason
    // ═══════════════════════════════════════════════
    if (action === 'journey-set') {
      const id = parseInt(req.body.id);
      const verdict = req.body.verdict;
      if (!id || !['good', 'caution', 'not_recommended'].includes(verdict)) {
        res.status(400).json({ error: 'Missing or invalid fields' });
        return;
      }
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/journey_overrides?on_conflict=place_id`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ place_id: id, verdict, reason: req.body.reason || '', active: true, updated_at: new Date().toISOString(), updated_by: user.email }),
      });
      if (!upd.ok) { res.status(400).json({ error: 'Save failed: ' + await upd.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'journey-clear' — remove the override
    // fields: id
    // ═══════════════════════════════════════════════
    if (action === 'journey-clear') {
      const id = parseInt(req.body.id);
      if (!id) { res.status(400).json({ error: 'Missing destination id' }); return; }
      const del = await fetch(`${SUPABASE_URL}/rest/v1/journey_overrides?place_id=eq.${id}`, { method: 'DELETE', headers: svcHeaders });
      if (!del.ok) { res.status(400).json({ error: 'Clear failed: ' + await del.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-add' — admin adds a task directly, goes live immediately
    // fields: tierIdx, icon, taskText, points
    // ═══════════════════════════════════════════════
    if (action === 'task-add') {
      const b = req.body;
      const tierIdx = parseInt(b.tierIdx);
      if (isNaN(tierIdx) || !b.taskText) { res.status(400).json({ error: 'Tier and task text are required' }); return; }
      const payload = {
        tier_idx: tierIdx, icon: b.icon || '⭐', task_text: b.taskText,
        points: parseInt(b.points) || 20, source: 'admin', submitted_by: user.email,
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_additions`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Add failed: ' + await insRes.text() }); return; }
      const [row] = await insRes.json();
      res.status(200).json({ success: true, task: row });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-update' — edit a task (built-in via task_key, or added via dbId)
    // fields: taskKey (for built-ins) OR dbId (for admin/host-added), icon, taskText, points
    // ═══════════════════════════════════════════════
    if (action === 'task-update') {
      const b = req.body;
      const fields = {};
      if (b.icon !== undefined) fields.icon = b.icon;
      if (b.taskText !== undefined) fields.task_text = b.taskText;
      if (b.points !== undefined) fields.points = parseInt(b.points);

      if (b.dbId) {
        const upd = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_additions?id=eq.${parseInt(b.dbId)}`, {
          method: 'PATCH', headers: svcHeaders, body: JSON.stringify(fields),
        });
        if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      } else if (b.taskKey) {
        const upd = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_overrides?on_conflict=task_key`, {
          method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ task_key: b.taskKey, ...fields, updated_at: new Date().toISOString() }),
        });
        if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      } else {
        res.status(400).json({ error: 'Missing taskKey or dbId' }); return;
      }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-delete' — soft-delete a built-in, hard-delete an added one
    // fields: taskKey (for built-ins) OR dbId (for added)
    // ═══════════════════════════════════════════════
    if (action === 'task-delete') {
      const b = req.body;
      if (b.dbId) {
        const del = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_additions?id=eq.${parseInt(b.dbId)}`, { method: 'DELETE', headers: svcHeaders });
        if (!del.ok) { res.status(400).json({ error: 'Delete failed: ' + await del.text() }); return; }
      } else if (b.taskKey) {
        const ins = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_deletions?on_conflict=task_key`, {
          method: 'POST', headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ task_key: b.taskKey, deleted_at: new Date().toISOString(), deleted_by: user.email }),
        });
        if (!ins.ok) { res.status(400).json({ error: 'Delete failed: ' + await ins.text() }); return; }
      } else {
        res.status(400).json({ error: 'Missing taskKey or dbId' }); return;
      }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-restore' — undo a soft-delete on a built-in task
    // fields: taskKey
    // ═══════════════════════════════════════════════
    if (action === 'task-restore') {
      const taskKey = req.body.taskKey;
      if (!taskKey) { res.status(400).json({ error: 'Missing taskKey' }); return; }
      const del = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_deletions?task_key=eq.${encodeURIComponent(taskKey)}`, { method: 'DELETE', headers: svcHeaders });
      if (!del.ok) { res.status(400).json({ error: 'Restore failed: ' + await del.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-propose' — HOST submits a task idea for review
    // fields: tierIdx, icon, taskText, points
    // ═══════════════════════════════════════════════
    if (action === 'task-propose') {
      const b = req.body;
      const tierIdx = parseInt(b.tierIdx);
      if (isNaN(tierIdx) || !b.taskText) { res.status(400).json({ error: 'Tier and task text are required' }); return; }
      const payload = {
        tier_idx: tierIdx, icon: b.icon || '⭐', task_text: b.taskText,
        points: parseInt(b.points) || 20, host_email: user.email, status: 'pending',
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_proposals`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Submit failed: ' + await insRes.text() }); return; }
      res.status(200).json({ success: true, message: 'Submitted for admin review' });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-review' — admin approves or rejects a pending proposal
    // fields: proposalId, decision ('approve'|'reject')
    // ═══════════════════════════════════════════════
    if (action === 'task-review') {
      const proposalId = parseInt(req.body.proposalId);
      const decision = req.body.decision;
      if (!proposalId || !['approve', 'reject'].includes(decision)) { res.status(400).json({ error: 'Missing or invalid fields' }); return; }

      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_proposals?id=eq.${proposalId}&select=*`, { headers: svcHeaders });
      const [proposal] = await getRes.json();
      if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

      if (decision === 'approve') {
        const insRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_additions`, {
          method: 'POST', headers: svcHeaders,
          body: JSON.stringify({
            tier_idx: proposal.tier_idx, icon: proposal.icon, task_text: proposal.task_text,
            points: proposal.points, source: 'host', submitted_by: proposal.host_email,
          }),
        });
        if (!insRes.ok) { res.status(400).json({ error: 'Approve failed: ' + await insRes.text() }); return; }
      }
      const updRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_proposals?id=eq.${proposalId}`, {
        method: 'PATCH', headers: svcHeaders,
        body: JSON.stringify({ status: decision === 'approve' ? 'approved' : 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.email }),
      });
      if (!updRes.ok) { res.status(400).json({ error: 'Review save failed: ' + await updRes.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'task-proposals-list' — admin fetches the pending queue
    // ═══════════════════════════════════════════════
    if (action === 'task-proposals-list') {
      const listRes = await fetch(`${SUPABASE_URL}/rest/v1/pahadi_task_proposals?status=eq.pending&order=created_at.desc`, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const proposals = await listRes.json();
      res.status(200).json({ success: true, proposals });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'review-list' — admin fetches all reviews for a stay (or all stays)
    // fields: stayId (optional)
    // ═══════════════════════════════════════════════
    if (action === 'review-list') {
      const stayId = req.body.stayId;
      const url = stayId
        ? `${SUPABASE_URL}/rest/v1/stay_reviews?stay_id=eq.${parseInt(stayId)}&order=created_at.desc`
        : `${SUPABASE_URL}/rest/v1/stay_reviews?order=created_at.desc&limit=200`;
      const listRes = await fetch(url, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const reviews = await listRes.json();
      res.status(200).json({ success: true, reviews });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'review-moderate' — admin hides or restores a review
    // fields: reviewId, status ('published'|'hidden')
    // ═══════════════════════════════════════════════
    if (action === 'review-moderate') {
      const reviewId = parseInt(req.body.reviewId);
      const status = req.body.status;
      if (!reviewId || !['published', 'hidden'].includes(status)) { res.status(400).json({ error: 'Missing or invalid fields' }); return; }
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/stay_reviews?id=eq.${reviewId}`, {
        method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status }),
      });
      if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'host-app-list' — admin fetches partner applications
    // fields: status (optional: 'pending'|'approved'|'rejected')
    // ═══════════════════════════════════════════════
    if (action === 'host-app-list') {
      const status = req.body.status;
      const url = status
        ? `${SUPABASE_URL}/rest/v1/partner_applications?status=eq.${encodeURIComponent(status)}&order=created_at.desc`
        : `${SUPABASE_URL}/rest/v1/partner_applications?order=created_at.desc&limit=200`;
      const listRes = await fetch(url, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const applications = await listRes.json();
      res.status(200).json({ success: true, applications });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'host-app-approve' — creates a real login for the host,
    // a live stays listing, and emails them their credentials.
    // fields: applicationId
    // ═══════════════════════════════════════════════
    if (action === 'host-app-approve') {
      const appId = parseInt(req.body.applicationId);
      if (!appId) { res.status(400).json({ error: 'Missing applicationId' }); return; }
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${appId}&select=*`, { headers: svcHeaders });
      const [app] = await getRes.json();
      if (!app) { res.status(404).json({ error: 'Application not found' }); return; }
      if (!app.email) { res.status(400).json({ error: 'This application has no email on file — cannot create a host login. Contact them to get one, then retry.' }); return; }

      const tempPassword = Math.random().toString(36).slice(-6) + Math.random().toString(36).slice(-4).toUpperCase() + '!1';
      const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST', headers: svcHeaders,
        body: JSON.stringify({ email: app.email, password: tempPassword, email_confirm: true }),
      });
      const createdUser = await createUserRes.json();
      if (!createUserRes.ok && !String(createdUser.msg || createdUser.error_description || '').includes('already registered')) {
        res.status(400).json({ error: 'Could not create host login: ' + (createdUser.msg || createUserRes.statusText) });
        return;
      }

      const colors = ['#d5e8d0', '#e4dcc8', '#d4e6da', '#e0dce8', '#dcd8e8', '#d4dce8', '#d8e4d4'];
      const stayPayload = {
        name: app.property_name, loc: app.location, type: app.property_type || 'Homestay',
        eco: !!app.eco_friendly, pn: app.price_per_night || 0, price: '₹' + (app.price_per_night || 0).toLocaleString() + '/night',
        rating: '4.5', emoji: '🏡', color: colors[appId % colors.length], contact: app.phone,
        nights: 2, placeid: 0, status: 'active', host_email: app.email, verified: false,
      };
      const insStayRes = await fetch(`${SUPABASE_URL}/rest/v1/stays`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(stayPayload),
      });
      if (!insStayRes.ok) { res.status(400).json({ error: 'Host login created, but stay listing failed: ' + await insStayRes.text() }); return; }
      const [newStay] = await insStayRes.json();

      await fetch(`${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${appId}`, {
        method: 'PATCH', headers: svcHeaders,
        body: JSON.stringify({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.email }),
      });

      await sendEmail({
        to: app.email,
        subject: 'Welcome to PahariPath — your host account is ready',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#2d5a3d">You're approved, ${app.owner_name}! 🎉</h2>
          <p>${app.property_name} is now live on PahariPath. Here's your host login:</p>
          <p><b>Email:</b> ${app.email}<br/><b>Temporary password:</b> ${tempPassword}</p>
          <p style="font-size:13px;color:#666">Log in at paharipath.in → Host Login, and change your password from your host dashboard after your first login.</p>
        </div>`,
      });

      res.status(200).json({ success: true, stay: newStay });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'host-app-reject' — fields: applicationId, notes
    // ═══════════════════════════════════════════════
    if (action === 'host-app-reject') {
      const appId = parseInt(req.body.applicationId);
      if (!appId) { res.status(400).json({ error: 'Missing applicationId' }); return; }
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${appId}`, {
        method: 'PATCH', headers: svcHeaders,
        body: JSON.stringify({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: user.email, admin_notes: req.body.notes || '' }),
      });
      if (!upd.ok) { res.status(400).json({ error: 'Reject failed: ' + await upd.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
