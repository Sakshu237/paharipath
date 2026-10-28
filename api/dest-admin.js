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

const { isAdminEmail, notifyEmail } = require('./_lib/admin');
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

// Must be logged in AND match ADMIN_EMAIL. Returns {user} on success,
// or {errorReason} with a specific, actionable cause on failure —
// so a mismatch is never a silent generic "not admin" error.
async function verifyAdmin(access_token, adminEmail) {
  if (!adminEmail) return { errorReason: 'ADMIN_EMAIL is not set on the server (Vercel env vars)' };
  if (!access_token) return { errorReason: 'No login session was sent with this request — please log out and back in' };
  const user = await verifyUser(access_token);
  if (!user) return { errorReason: 'Your login session has expired — please log out and back in' };
  if (!isAdminEmail(user.email)) {
    return { errorReason: `Logged in as ${user.email}, which does not match the ADMIN_EMAIL set on the server` };
  }
  return { user };
}

function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}


const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A stored file reference: a bare "bucket/filename" (new applications) or a full
// Supabase storage URL (older applications). Anything else is ignored.
function parseStorageRef(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim();
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/);
  if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { return null; } }
  else if (/^https?:\/\//i.test(s)) return null;
  const parts = s.split('/');
  if (parts.length !== 2 || !['stay-photos', 'host-verification'].includes(parts[0])) return null;
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(parts[1])) return null;
  return { bucket: parts[0], path: parts[1] };
}
// Short-lived signed link so private files (ID proofs) can be reviewed without a public bucket.
async function signStorageRef(ref, svcHeaders) {
  const r = parseStorageRef(ref);
  if (!r) return null;
  try {
    const sr = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${r.bucket}/${r.path}`, {
      method: 'POST', headers: svcHeaders, body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (sr.ok) {
      const j = await sr.json();
      const p = j.signedURL || j.signedUrl;
      if (p) return `${SUPABASE_URL}/storage/v1${p.startsWith('/') ? '' : '/'}${p}`;
    }
  } catch (e) { /* fall through */ }
  return r.bucket === 'stay-photos' ? `${SUPABASE_URL}/storage/v1/object/public/${r.bucket}/${r.path}` : null;
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
    const result = await verifyAdmin(access_token, adminEmail);
    if (!result.user) { res.status(403).json({ error: result.errorReason || 'Only the admin account can do that' }); return; }
    user = result.user;
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
      const rows = await listRes.json();
      const applications = await Promise.all((Array.isArray(rows) ? rows : []).map(async a => ({
        ...a,
        photo_urls: (await Promise.all((Array.isArray(a.property_photos) ? a.property_photos : []).slice(0, 8).map(p => signStorageRef(p, svcHeaders)))).filter(Boolean),
        id_url: a.id_document_url ? await signStorageRef(a.id_document_url, svcHeaders) : null,
        registration_url: a.registration_doc ? await signStorageRef(a.registration_doc, svcHeaders) : null,
        payout: await fetch(`${SUPABASE_URL}/rest/v1/host_payout_details?application_id=eq.${a.id}&select=upi_id,account_number,ifsc,account_holder&limit=1`, { headers: svcHeaders })
          .then(r => r.json()).then(rows => {
            const p = Array.isArray(rows) && rows[0];
            if (!p) return null;
            return p.upi_id ? `UPI ${p.upi_id}` : p.account_number ? `Bank ••••${String(p.account_number).slice(-4)} · ${p.ifsc} · ${p.account_holder}` : null;
          }).catch(() => null),
      })));
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
      const found = await getRes.json();
      const app = Array.isArray(found) ? found[0] : null;
      if (!app) { res.status(404).json({ error: 'Application not found' }); return; }
      if (app.status !== 'pending') { res.status(409).json({ error: `This application is already ${app.status}.` }); return; }
      if (!app.email) { res.status(400).json({ error: 'This application has no email on file — cannot create a host login. Contact them to get one, then retry.' }); return; }

      // Claim it first, so a double-click or a second admin tab can never create two listings.
      const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${appId}&status=eq.pending`, {
        method: 'PATCH', headers: { ...svcHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: user.email }),
      });
      const claimed = claimRes.ok ? await claimRes.json() : [];
      if (!Array.isArray(claimed) || !claimed.length) { res.status(409).json({ error: 'This application was just handled by someone else — refresh the list.' }); return; }
      const revert = () => fetch(`${SUPABASE_URL}/rest/v1/partner_applications?id=eq.${appId}`, {
        method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ status: 'pending', reviewed_at: null, reviewed_by: null }),
      }).catch(() => {});

      const tempPassword = require('crypto').randomBytes(12).toString('base64').replace(/[+/=]/g, '').slice(0, 14) + 'Aa!1';
      const createUserRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST', headers: svcHeaders,
        body: JSON.stringify({ email: app.email, password: tempPassword, email_confirm: true, user_metadata: { must_change_password: true } }),
      });
      const createdUser = await createUserRes.json().catch(() => ({}));
      let createdUserId = null, loginExisted = false;
      if (createUserRes.ok) {
        createdUserId = createdUser.id || null;
      } else {
        const msg = String(createdUser.msg || createdUser.error_description || createdUser.message || '');
        if (createdUser.error_code === 'email_exists' || /already (been )?registered|already exists/i.test(msg)) loginExisted = true;
        else { await revert(); res.status(400).json({ error: 'Could not create host login: ' + (msg || createUserRes.statusText) }); return; }
      }

      const colors = ['#d5e8d0', '#e4dcc8', '#d4e6da', '#e0dce8', '#dcd8e8', '#d4dce8', '#d8e4d4'];
      // Only the applicant's public property photos go live — never anything from the private ID bucket.
      const livePhotos = (Array.isArray(app.property_photos) ? app.property_photos : [])
        .map(parseStorageRef).filter(r => r && r.bucket === 'stay-photos').slice(0, 5)
        .map(r => `${SUPABASE_URL}/storage/v1/object/public/${r.bucket}/${r.path}`);
      const stayPayload = {
        name: app.property_name, loc: app.location, type: app.property_type || 'Homestay',
        eco: !!app.eco_friendly, pn: app.price_per_night || 0, price: '₹' + (app.price_per_night || 0).toLocaleString() + '/night',
        // No made-up rating: the site shows "New" until real guest reviews arrive.
        rating: null, emoji: '🏡', color: colors[appId % colors.length], contact: app.phone,
        nights: 2, placeid: 0, status: 'active', host_email: app.email, verified: false, photos: livePhotos,
        rooms: app.rooms || null, max_guests: app.max_guests || null, address: app.address || null, map_url: app.map_url || null,
        checkin_time: app.checkin_time || null, checkout_time: app.checkout_time || null, house_rules: app.house_rules || null,
        registration_no: app.registration_no || null, gstin: app.gstin || null,
      };
      const insStayRes = await fetch(`${SUPABASE_URL}/rest/v1/stays`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(stayPayload),
      });
      if (!insStayRes.ok) {
        // Undo everything so the admin can simply retry.
        if (createdUserId) await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${createdUserId}`, { method: 'DELETE', headers: svcHeaders }).catch(() => {});
        await revert();
        res.status(400).json({ error: 'Could not create the stay listing, so nothing was approved — you can retry. Details: ' + await insStayRes.text() });
        return;
      }
      const newStayRows = await insStayRes.json();
      const newStay = Array.isArray(newStayRows) ? newStayRows[0] : newStayRows;
      // Link the host's payout details to the new stay.
      if (newStay && newStay.id) {
        await fetch(`${SUPABASE_URL}/rest/v1/host_payout_details?application_id=eq.${appId}`, {
          method: 'PATCH', headers: svcHeaders, body: JSON.stringify({ stay_id: newStay.id, host_email: app.email }),
        }).catch(() => {});
      }

      const credentialsHtml = loginExisted
        ? `<p>You already have a PahariPath account with this email, so sign in with your existing password at paharipath.in → Host Login. Your listing will appear in your host dashboard.</p>`
        : `<p><b>Email:</b> ${esc(app.email)}<br/><b>Temporary password:</b> ${esc(tempPassword)}</p>
          <p style="font-size:13px;color:#666">Log in at paharipath.in → Host Login, and change your password from your host dashboard after your first login.</p>`;
      const emailSent = await sendEmail({
        to: app.email,
        subject: 'Welcome to PahariPath — your listing is live',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#2d5a3d">You're approved, ${esc(app.owner_name)}! 🎉</h2>
          <p>${esc(app.property_name)} is now live on PahariPath.</p>
          ${credentialsHtml}
        </div>`,
      });

      // sendEmail never throws (see _lib/email.js), so surface a failed send here and hand the
      // admin whatever they need to relay it manually.
      let warning;
      if (!emailSent) {
        warning = loginExisted
          ? `The stay is live, but the welcome email failed to send. ${app.email} already had a login — tell them to sign in with their existing password.`
          : `Login was created but the welcome email failed to send. Share this temporary password with ${app.email} manually: ${tempPassword}`;
      } else if (loginExisted) {
        warning = `The stay is live. ${app.email} already had a login, so no new password was created — they were told to use their existing one.`;
      }
      res.status(200).json({
        success: true, stay: newStay, emailSent, loginExisted,
        ...(warning ? { warning } : {}),
        ...(!emailSent && !loginExisted ? { tempPassword } : {}),
      });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'payouts-list' — paid bookings whose host payout is due or done
    // fields: status ('due' | 'paid', default 'due')
    // ═══════════════════════════════════════════════
    if (action === 'payouts-list') {
      const st = req.body.status === 'paid' ? 'paid' : 'due';
      const br = await fetch(`${SUPABASE_URL}/rest/v1/bookings?payout_status=eq.${st}&select=id,stay_id,stay_name,guest,dates,checkin_date,checkout_date,status,amount,base_amount,gst_amount,paid_amount,cancellation_fee_amount,payout_ref,paid_out_at&order=checkin_date.asc&limit=300`, { headers: svcHeaders });
      const rows = br.ok ? await br.json() : [];
      const stayIds = [...new Set(rows.map(r => r.stay_id).filter(Boolean))];
      const pd = stayIds.length ? await fetch(`${SUPABASE_URL}/rest/v1/host_payout_details?stay_id=in.(${stayIds.join(',')})&select=stay_id,upi_id,account_holder,account_number,ifsc`, { headers: svcHeaders }).then(r => r.json()).catch(() => []) : [];
      const byStay = {}; (Array.isArray(pd) ? pd : []).forEach(p => { byStay[p.stay_id] = p; });
      const payouts = rows.map(b => ({
        ...b,
        // Host gets the stay price; for a cancelled booking, the cancellation fee the guest paid.
        host_amount: b.status === 'cancelled' ? (parseInt(b.cancellation_fee_amount) || 0) : (parseInt(b.base_amount) || 0),
        payout_to: byStay[b.stay_id] || null,
      }));
      res.status(200).json({ success: true, payouts });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'payout-mark' — admin records a host payout as sent
    // fields: bookingId, payoutRef (UTR / UPI ref)
    // ═══════════════════════════════════════════════
    if (action === 'payout-mark') {
      const id = String(req.body.bookingId || '');
      const ref = String(req.body.payoutRef || '').trim().slice(0, 60);
      if (!id || !ref) { res.status(400).json({ error: 'Booking and payment reference are required' }); return; }
      const up = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&payout_status=eq.due`, {
        method: 'PATCH', headers: { ...svcHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ payout_status: 'paid', payout_ref: ref, paid_out_at: new Date().toISOString() }),
      });
      const done = up.ok ? await up.json() : [];
      if (!Array.isArray(done) || !done.length) { res.status(409).json({ error: 'Already marked paid, or not found' }); return; }
      res.status(200).json({ success: true });
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

    // ═══════════════════════════════════════════════════════════════
    // ADMIN CONTROL — runs with the service key, so it works on every
    // row no matter what the database's row rules say. Admin only.
    // ═══════════════════════════════════════════════════════════════

    // action: 'stays-list' — every stay, including hidden / paused ones
    if (action === 'stays-list') {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/stays?select=*&order=id.asc`, { headers: svcHeaders });
      if (!r.ok) { res.status(400).json({ error: 'Could not load stays: ' + await r.text() }); return; }
      res.status(200).json({ success: true, stays: await r.json() });
      return;
    }

    // action: 'stay-update' — fields: id, changes{ only the keys below }
    if (action === 'stay-update') {
      const id = parseInt(req.body.id);
      const c = req.body.changes || {};
      if (!id) { res.status(400).json({ error: 'Missing stay id' }); return; }
      const STATUSES = ['active', 'paused', 'full', 'hidden'];
      const patch = {};
      if (c.status !== undefined) {
        if (!STATUSES.includes(c.status)) { res.status(400).json({ error: 'Status must be one of: ' + STATUSES.join(', ') }); return; }
        patch.status = c.status;
      }
      if (c.verified !== undefined) patch.verified = !!c.verified;
      if (c.eco !== undefined) patch.eco = !!c.eco;
      if (c.name !== undefined) { const v = String(c.name).trim(); if (v.length < 2 || v.length > 80) { res.status(400).json({ error: 'Name must be 2–80 characters' }); return; } patch.name = v; }
      if (c.loc !== undefined) patch.loc = String(c.loc).trim().slice(0, 120);
      if (c.type !== undefined) patch.type = String(c.type).trim().slice(0, 40);
      if (c.contact !== undefined) patch.contact = String(c.contact).trim().slice(0, 40);
      if (c.host_email !== undefined) {
        const v = String(c.host_email).trim().toLowerCase();
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { res.status(400).json({ error: 'Host email looks wrong' }); return; }
        patch.host_email = v || null;
      }
      if (c.pn !== undefined) {
        const pn = parseInt(c.pn);
        if (!(pn >= 0 && pn <= 200000)) { res.status(400).json({ error: 'Price per night looks wrong' }); return; }
        patch.pn = pn; patch.price = '₹' + pn.toLocaleString('en-IN') + '/night';
      }
      if (c.placeid !== undefined) patch.placeid = parseInt(c.placeid) || 0;
      if (c.max_guests !== undefined) patch.max_guests = parseInt(c.max_guests) || null;
      if (!Object.keys(patch).length) { res.status(400).json({ error: 'Nothing to change' }); return; }
      const up = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${id}`, {
        method: 'PATCH', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(patch),
      });
      const rows = up.ok ? await up.json() : null;
      if (!up.ok || !rows || !rows.length) { res.status(400).json({ error: 'Update failed' + (up.ok ? ' — stay not found' : ': ' + await up.text()) }); return; }
      res.status(200).json({ success: true, stay: rows[0] });
      return;
    }

    // action: 'bookings-list' — every booking (newest first)
    // fields: status (optional filter), limit (default 300)
    if (action === 'bookings-list') {
      const lim = Math.min(1000, Math.max(1, parseInt(req.body.limit) || 300));
      const st = String(req.body.status || '').replace(/[^a-z_]/g, '');
      const q = `${SUPABASE_URL}/rest/v1/bookings?select=*${st ? '&status=eq.' + st : ''}&order=created_at.desc&limit=${lim}`;
      const r = await fetch(q, { headers: svcHeaders });
      if (!r.ok) { res.status(400).json({ error: 'Could not load bookings: ' + await r.text() }); return; }
      res.status(200).json({ success: true, bookings: await r.json() });
      return;
    }

    // action: 'booking-update' — fields: id, status
    // Admin can confirm a request, cancel, or mark a no-show.
    // ('completed' is set automatically after check-in by the daily job,
    //  which also awards PAHADI points — so it isn't set by hand here.)
    if (action === 'booking-update') {
      const id = String(req.body.id || '');
      const status = String(req.body.status || '');
      const ALLOWED = ['requested', 'confirmed', 'cancelled', 'no_show'];
      if (!id || !/^[A-Za-z0-9_-]{3,40}$/.test(id)) { res.status(400).json({ error: 'Missing or invalid booking reference' }); return; }
      if (!ALLOWED.includes(status)) { res.status(400).json({ error: 'Status must be one of: ' + ALLOWED.join(', ') }); return; }
      const patch = { status };
      if (status === 'cancelled') patch.cancelled_at = new Date().toISOString();
      const up = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(id)}&status=neq.completed`, {
        method: 'PATCH', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(patch),
      });
      const rows = up.ok ? await up.json() : null;
      if (!up.ok) { res.status(400).json({ error: 'Update failed: ' + await up.text() }); return; }
      if (!rows || !rows.length) { res.status(409).json({ error: 'Not found, or the stay is already completed' }); return; }
      res.status(200).json({ success: true, booking: rows[0] });
      return;
    }

    // action: 'dashboard' — what needs attention today
    if (action === 'dashboard') {
      const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date
      const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
      const get = async (path) => { try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders }); return r.ok ? await r.json() : []; } catch (e) { return []; } };
      const [requested, upcoming, recent, apps, stays] = await Promise.all([
        get(`bookings?status=eq.requested&select=id,stay_name,guest,guest_phone,dates,checkin_date,created_at&order=created_at.asc&limit=50`),
        get(`bookings?status=eq.confirmed&checkin_date=gte.${today}&select=id,stay_name,guest,guest_phone,dates,checkin_date&order=checkin_date.asc&limit=20`),
        get(`bookings?created_at=gte.${encodeURIComponent(weekAgo)}&select=id,status,amount&limit=500`),
        get(`partner_applications?status=eq.pending&select=id,created_at&limit=100`),
        get(`stays?select=id,status`),
      ]);
      const count = (arr, f) => (Array.isArray(arr) ? arr.filter(f).length : 0);
      res.status(200).json({
        success: true,
        today,
        requested: Array.isArray(requested) ? requested : [],
        upcoming: Array.isArray(upcoming) ? upcoming : [],
        bookingsThisWeek: Array.isArray(recent) ? recent.length : 0,
        cancelledThisWeek: count(recent, b => b.status === 'cancelled'),
        pendingHostApplications: Array.isArray(apps) ? apps.length : 0,
        staysLive: count(stays, s => (s.status || 'active') === 'active'),
        staysHidden: count(stays, s => s.status === 'hidden'),
      });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
