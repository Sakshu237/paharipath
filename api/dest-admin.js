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

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

async function verifyAdmin(access_token, adminEmail) {
  if (!access_token || !adminEmail) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user.email || user.email.toLowerCase() !== adminEmail.toLowerCase()) return null;
  return user;
}

function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

  const { action, access_token } = req.body || {};
  const user = await verifyAdmin(access_token, adminEmail);
  if (!user) {
    res.status(403).json({ error: 'Only the admin account can manage destinations' });
    return;
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

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
