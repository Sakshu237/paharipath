// /api/_lib/host.js
// Everything a logged-in HOST does from their dashboard, plus the setup
// checklist that decides when a newly approved listing may go live.
// Routed from /api/bookings.js (actions starting with "host-") so we stay
// under Vercel's 12-function cap. Lives in /api/_lib, so it is not a function itself.
//
// Rules this file enforces (decided Oct–Nov 2026):
//   • A host only ever touches stays whose host_email matches their login.
//   • Price, name, location, type and badges stay admin-only.
//   • Description, amenities, check-in/out, house rules, rooms, max guests and
//     the private WhatsApp number are edited directly by the host.
//   • New photos wait in stays.pending_photos until PahariPath approves them.
//     Hosts may remove a live photo (keeping at least 2) or choose the cover.
//   • An approved listing starts hidden (setup_pending = true) and goes live
//     only when the host finishes the checklist below.

const { sendEmail } = require('./email');
const { notifyEmail } = require('./admin');
const { award, addBadge } = require('./points');

const SITE = 'https://paharipath.in';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

const AMENITIES = [
  'WiFi', 'Parking', 'Hot Water', 'Room Heater', 'Power Backup', 'Attached Bathroom',
  'Home-cooked Meals', 'Kitchen Access', 'Mountain View', 'Garden / Sit-out', 'Bonfire',
  'Workspace', 'Pet Friendly', 'Local Guide on Request',
];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MIN_DESC = 80;
const MAX_PHOTOS = 15;
const MAX_PENDING = 10;
const PHOTO_NAME_RE = /^[A-Za-z0-9._-]{1,160}$/;

// Fields a host may read back about their own stay (never other hosts').
const HOST_FIELDS = [
  'id', 'name', 'loc', 'type', 'pn', 'price', 'status', 'verified', 'eco', 'emoji', 'color', 'placeid',
  'photos', 'pending_photos', 'rooms', 'max_guests', 'address', 'map_url', 'checkin_time', 'checkout_time',
  'house_rules', 'description', 'amenities', 'host_phone', 'registration_no',
  'setup_pending', 'setup_steps', 'host_agreed_at', 'went_live_at',
];
const pick = (o, keys) => keys.reduce((a, k) => { if (o && o[k] !== undefined) a[k] = o[k]; return a; }, {});

function todayIST() { return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10); }

async function sessionEmail(access_token, SUPABASE_URL, SUPABASE_ANON) {
  if (!access_token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email ? String(u.email).toLowerCase() : null;
}

// Loads one stay (all columns) and checks it belongs to this host.
async function ownStay(stayId, email, ctx) {
  const id = parseInt(stayId);
  if (!id || !email) return null;
  const r = await fetch(`${ctx.SUPABASE_URL}/rest/v1/stays?id=eq.${id}&select=*`, { headers: ctx.headers });
  const rows = r.ok ? await r.json() : [];
  const s = rows[0];
  return s && String(s.host_email || '').toLowerCase() === email ? s : null;
}

async function patchStay(id, patch, ctx) {
  const r = await fetch(`${ctx.SUPABASE_URL}/rest/v1/stays?id=eq.${parseInt(id)}`, {
    method: 'PATCH', headers: { ...ctx.headers, Prefer: 'return=representation' }, body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const t = await r.text();
    console.error('host patchStay failed', t);
    return { error: /column/i.test(t) ? 'The database needs a one-time update (host-onboarding.sql) — please tell PahariPath' : 'Could not save — please try again' };
  }
  const rows = await r.json();
  return { stay: rows[0] };
}

const arr = v => (Array.isArray(v) ? v : []);
const stepsOf = s => (s && s.setup_steps && typeof s.setup_steps === 'object' ? s.setup_steps : {});

// The go-live checklist. Shared with the admin onboarding list (dest-admin.js).
function setupChecklist(s) {
  const steps = stepsOf(s);
  const amen = arr(s.amenities);
  return [
    { key: 'destination', who: 'pahari', label: 'PahariPath links your stay to its village on the map', done: parseInt(s.placeid) > 0 },
    { key: 'description', who: 'host', label: `Describe your stay (at least ${MIN_DESC} characters)`, done: String(s.description || '').trim().length >= MIN_DESC },
    { key: 'times', who: 'host', label: 'Set check-in and check-out times', done: !!(s.checkin_time && s.checkout_time) },
    { key: 'rules', who: 'host', label: 'Write your house rules', done: String(s.house_rules || '').trim().length >= 10 },
    { key: 'amenities', who: 'host', label: 'Tick what your stay offers (amenities)', done: amen.length > 0 },
    { key: 'photos', who: 'host', label: 'At least 2 approved photos', done: arr(s.photos).length >= 2 },
    { key: 'whatsapp', who: 'host', label: 'Confirm your private WhatsApp number', done: /^[6-9]\d{9}$/.test(String(s.host_phone || '')) },
    { key: 'calendar', who: 'host', label: 'Block the dates you are not available', done: !!steps.calendar_checked_at },
    { key: 'agreement', who: 'host', label: 'Accept the PahariPath host agreement', done: !!s.host_agreed_at },
  ];
}

function hostView(s) {
  const v = pick(s, HOST_FIELDS);
  v.photos = arr(s.photos);
  v.pending_photos = arr(s.pending_photos);
  v.amenities = arr(s.amenities);
  v.setup_pending = !!s.setup_pending;
  v.checklist = setupChecklist(s);
  return v;
}

// ── actions ────────────────────────────────────────────────────────────────

// 'host-stays' — every stay this login manages, with setup progress.
async function actionStays(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const pat = encodeURIComponent(email.replace(/[\\%_]/g, c => '\\' + c));
  const r = await fetch(`${ctx.SUPABASE_URL}/rest/v1/stays?host_email=ilike.${pat}&select=*&order=id.asc`, { headers: ctx.headers });
  if (!r.ok) return [500, { error: 'Could not load your listing — please try again' }];
  const rows = await r.json();
  return [200, { email, stays: rows.map(hostView), amenityOptions: AMENITIES }];
}

// 'host-dashboard' — bookings, reviews and guest-feedback status for one stay.
async function actionDashboard(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const stay = await ownStay(body.stayId, email, ctx);
  if (!stay) return [403, { error: 'This is not your listing' }];
  const U = ctx.SUPABASE_URL, H = { headers: ctx.headers };
  const fields = 'id,guest,guest_phone,dates,checkin_date,checkout_date,nights,guests,amount,base_amount,status,payment_status,payout_status,payout_ref,paid_out_at,created_at,request_expires_at';
  let br = await fetch(`${U}/rest/v1/bookings?stay_id=eq.${stay.id}&status=in.(requested,confirmed,completed,declined,expired,cancelled,no_show)&select=${fields}&order=checkin_date.desc&limit=300`, H);
  if (!br.ok) // older databases without the payout columns
    br = await fetch(`${U}/rest/v1/bookings?stay_id=eq.${stay.id}&status=in.(requested,confirmed,completed,declined,expired,cancelled,no_show)&select=id,guest,guest_phone,dates,checkin_date,checkout_date,nights,guests,amount,base_amount,status,payment_status,created_at,request_expires_at&order=checkin_date.desc&limit=300`, H);
  const bookings = (br.ok ? await br.json() : []).map(b => (b.status === 'confirmed' || b.status === 'completed') ? b : { ...b, guest_phone: null });
  const rr = await fetch(`${U}/rest/v1/stay_reviews?stay_id=eq.${stay.id}&select=*&order=created_at.desc&limit=50`, H);
  const reviews = (rr.ok ? await rr.json() : []).filter(x => x.status !== 'hidden')
    .map(x => ({ rating: x.rating, comment: x.comment, guest_name: x.guest_name, created_at: x.created_at, booking_ref: x.booking_ref }));
  const refs = bookings.filter(b => b.status === 'completed' || b.status === 'confirmed').map(b => b.id);
  let rated = [];
  if (refs.length) {
    const fr = await fetch(`${U}/rest/v1/host_feedbacks?ref=in.(${refs.map(encodeURIComponent).join(',')})&select=ref,rating`, H);
    rated = fr.ok ? await fr.json() : [];
  }
  return [200, { bookings, reviews, rated, today: todayIST() }];
}

// 'host-listing' — the listing fields a host edits directly.
async function actionListing(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const stay = await ownStay(body.stayId, email, ctx);
  if (!stay) return [403, { error: 'This is not your listing' }];
  const c = body.changes || {};
  const patch = {};
  if (c.description !== undefined) {
    const v = clip(String(c.description), 1500).replace(/[<>]/g, '');
    if (v.length < MIN_DESC) return [400, { error: `Please write at least ${MIN_DESC} characters about your stay — guests read this before they ask to book` }];
    patch.description = v;
  }
  if (c.house_rules !== undefined) {
    const v = clip(String(c.house_rules), 1000).replace(/[<>]/g, '');
    if (v.length < 10) return [400, { error: 'Please write your house rules (a line or two is enough)' }];
    patch.house_rules = v;
  }
  if (c.checkin_time !== undefined || c.checkout_time !== undefined) {
    const a = String(c.checkin_time || ''), b = String(c.checkout_time || '');
    if (!TIME_RE.test(a) || !TIME_RE.test(b)) return [400, { error: 'Please set both check-in and check-out times' }];
    patch.checkin_time = a; patch.checkout_time = b;
  }
  if (c.amenities !== undefined) {
    const list = arr(c.amenities).map(String).filter(x => AMENITIES.includes(x));
    patch.amenities = [...new Set(list)];
  }
  if (c.rooms !== undefined) {
    const v = parseInt(c.rooms);
    if (!(v >= 1 && v <= 6)) return [400, { error: 'Rooms must be between 1 and 6 for a homestay' }];
    patch.rooms = v;
  }
  if (c.max_guests !== undefined) {
    const v = parseInt(c.max_guests);
    if (!(v >= 1 && v <= 24)) return [400, { error: 'Maximum guests must be between 1 and 24' }];
    patch.max_guests = v;
  }
  if (c.host_phone !== undefined) {
    const v = String(c.host_phone).replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(v)) return [400, { error: 'Please enter a 10-digit mobile number' }];
    patch.host_phone = v;
  }
  if (!Object.keys(patch).length) return [400, { error: 'Nothing to change' }];
  const out = await patchStay(stay.id, patch, ctx);
  if (out.error) return [400, { error: out.error }];
  return [200, { success: true, stay: hostView(out.stay) }];
}

// 'host-photos' — op: 'submit' (new photos → approval queue), 'withdraw' (a pending one),
// 'remove' (a live one, keeping at least 2), 'cover' (make a live photo the first one).
async function actionPhotos(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const stay = await ownStay(body.stayId, email, ctx);
  if (!stay) return [403, { error: 'This is not your listing' }];
  const live = arr(stay.photos).slice(), pending = arr(stay.pending_photos).slice();
  const op = body.op;
  const publicUrl = name => `${ctx.SUPABASE_URL}/storage/v1/object/public/stay-photos/${name}`;
  let patch, mailAdmin = 0;

  if (op === 'submit') {
    const add = arr(body.photos).map(p => {
      const m = String(p || '').match(/^stay-photos\/(.+)$/);
      return m && PHOTO_NAME_RE.test(m[1]) && m[1].startsWith(`host-${stay.id}-`) ? publicUrl(m[1]) : null;
    }).filter(Boolean).filter(u => !pending.includes(u) && !live.includes(u));
    if (!add.length) return [400, { error: 'No photos were received — please try uploading again' }];
    if (pending.length + add.length > MAX_PENDING) return [400, { error: `You can have up to ${MAX_PENDING} photos waiting for review at once` }];
    if (live.length + pending.length + add.length > MAX_PHOTOS) return [400, { error: `A listing can have up to ${MAX_PHOTOS} photos — remove some old ones first` }];
    patch = { pending_photos: pending.concat(add) };
    mailAdmin = add.length;
  } else if (op === 'withdraw') {
    const u = String(body.photo || '');
    if (!pending.includes(u)) return [404, { error: 'That photo is not waiting for review' }];
    patch = { pending_photos: pending.filter(x => x !== u) };
  } else if (op === 'remove') {
    const u = String(body.photo || '');
    if (!live.includes(u)) return [404, { error: 'Photo not found on your listing' }];
    if (live.length <= 2) return [400, { error: 'Your listing needs at least 2 photos. Add a new one first, then remove this one.' }];
    patch = { photos: live.filter(x => x !== u) };
  } else if (op === 'cover') {
    const u = String(body.photo || '');
    if (!live.includes(u)) return [404, { error: 'Photo not found on your listing' }];
    patch = { photos: [u].concat(live.filter(x => x !== u)) };
  } else {
    return [400, { error: 'Unknown photo action' }];
  }
  const out = await patchStay(stay.id, patch, ctx);
  if (out.error) return [400, { error: out.error }];
  if (mailAdmin) {
    await sendEmail({
      to: notifyEmail(),
      subject: `New photos to review: ${stay.name}`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px"><p><b>${esc(stay.name)}</b> sent ${mailAdmin} new photo${mailAdmin > 1 ? 's' : ''}.</p><p>Approve or reject them in the admin panel → Host Onboarding.</p></div>`,
    });
  }
  return [200, { success: true, stay: hostView(out.stay) }];
}

// 'host-setup' — step: 'agree' | 'calendar' | 'go-live'
async function actionSetup(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const stay = await ownStay(body.stayId, email, ctx);
  if (!stay) return [403, { error: 'This is not your listing' }];
  const now = new Date().toISOString();
  let patch;
  if (body.step === 'agree') {
    if (body.accept !== true) return [400, { error: 'Please tick the box to accept the host agreement' }];
    patch = { host_agreed_at: now };
  } else if (body.step === 'calendar') {
    patch = { setup_steps: { ...stepsOf(stay), calendar_checked_at: now } };
  } else if (body.step === 'go-live') {
    if (!stay.setup_pending) return [409, { error: 'Your listing is already past setup' }];
    const missing = setupChecklist(stay).filter(x => !x.done);
    if (missing.length) return [400, { error: 'Almost there — still to do: ' + missing.map(x => x.label).join('; '), missing: missing.map(x => x.key) }];
    patch = { status: 'active', setup_pending: false, went_live_at: now };
  } else {
    return [400, { error: 'Unknown setup step' }];
  }
  const out = await patchStay(stay.id, patch, ctx);
  if (out.error) return [400, { error: out.error }];
  if (body.step === 'go-live') {
    await sendEmail({
      to: notifyEmail(),
      subject: `🟢 Now live: ${stay.name}`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px"><p><b>${esc(stay.name)}</b> (${esc(stay.loc)}) finished setup and is now live on PahariPath.</p><p><a href="${SITE}">${SITE}</a></p></div>`,
    });
    await sendEmail({
      to: email,
      subject: `${stay.name} is live on PahariPath 🎉`,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="color:#2d5a3d">You're live!</h2>
        <p>Travellers can now find <b>${esc(stay.name)}</b> and send you booking requests.</p>
        <p>When a request comes in we email you. Please accept or decline within 24 hours — you can chat with the guest first.</p>
        <p><a href="${SITE}/host-login" style="display:inline-block;background:#2d5a3d;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open host dashboard</a></p></div>`,
    });
  }
  return [200, { success: true, stay: hostView(out.stay) }];
}

// 'host-rate-guest' — host rates a guest after the stay. Once per booking.
// Same point rules as the admin's host-feedback: excellent = 50 pts + badge, good = 20, poor = 0.
async function actionRateGuest(body, ctx) {
  const email = await sessionEmail(body.access_token, ctx.SUPABASE_URL, ctx.SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const ref = String(body.bookingRef || '');
  if (!/^PP[A-Z0-9]{6,12}$/.test(ref)) return [400, { error: 'Missing booking' }];
  const U = ctx.SUPABASE_URL, headers = ctx.headers;
  const br = await fetch(`${U}/rest/v1/bookings?id=eq.${encodeURIComponent(ref)}&select=id,stay_id,stay_name,guest,guest_phone,status,checkout_date`, { headers });
  const b = (br.ok ? await br.json() : [])[0];
  if (!b) return [404, { error: 'Booking not found' }];
  const stay = await ownStay(b.stay_id, email, ctx);
  if (!stay) return [403, { error: 'This is not your booking' }];
  const stayed = b.status === 'completed' || (b.status === 'confirmed' && (b.checkout_date || '9999') <= todayIST());
  if (!stayed) return [400, { error: 'You can rate a guest after they check out' }];
  const dup = await fetch(`${U}/rest/v1/host_feedbacks?ref=eq.${encodeURIComponent(ref)}&select=id&limit=1`, { headers }).then(r => r.json()).catch(() => []);
  if (Array.isArray(dup) && dup.length) return [409, { error: 'You already rated this guest' }];

  const rating = ['excellent', 'good', 'poor'].includes(body.rating) ? body.rating : null;
  if (!rating) return [400, { error: 'Please choose a rating' }];
  const pts = rating === 'excellent' ? 50 : rating === 'good' ? 20 : 0;
  const badge = rating === 'excellent' ? '🏅 Responsible Guest' : null;
  const BEHAVIOURS = ['Kept the stay clean', 'Followed eco pledges', 'Respectful to locals', 'On time for check-in/out', 'No single-use plastic', 'Supported local vendors', 'Easy to communicate with'];
  const row = {
    guest_name: clip(b.guest, 80), phone: b.guest_phone, ref, stay_name: clip(b.stay_name || stay.name, 120),
    comment: clip(body.comment, 1000), rating,
    behaviours: arr(body.behaviours).map(String).filter(x => BEHAVIOURS.includes(x)).slice(0, 10),
    badge_awarded: !!badge, pts, date: new Date().toLocaleDateString('en-IN'),
  };
  const ins = await fetch(`${U}/rest/v1/host_feedbacks`, { method: 'POST', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(row) });
  if (!ins.ok) { console.error('host rate insert failed', await ins.text()); return [400, { error: 'Could not save — please try again' }]; }
  let added = false;
  if (pts > 0 && /^[6-9]\d{9}$/.test(String(b.guest_phone || ''))) {
    try {
      added = await award({ phone: b.guest_phone, actionKey: `host-feedback:${ref}`, pts, reason: badge ? 'Responsible Guest badge from your host' : 'Good-guest feedback from your host', ref, guestName: row.guest_name }, headers, U);
      if (badge) await addBadge(b.guest_phone, badge, headers, U);
    } catch (e) { console.error('host rate: points not awarded', e.message); } // the rating itself is already saved
  }
  return [200, { success: true, pts: added ? pts : 0, badge }];
}

// 'stay-info' — PUBLIC: the extra listing text guests see on the stay page.
async function actionStayInfo(body, ctx) {
  const id = parseInt(body.stayId);
  if (!id) return [400, { error: 'Missing stay' }];
  const r = await fetch(`${ctx.SUPABASE_URL}/rest/v1/stays?id=eq.${id}&select=*`, { headers: ctx.headers });
  const s = (r.ok ? await r.json() : [])[0];
  if (!s || s.status === 'hidden') return [404, { error: 'Not found' }];
  return [200, { description: s.description || '', amenities: arr(s.amenities) }];
}

const ACTIONS = {
  'host-stays': actionStays,
  'host-dashboard': actionDashboard,
  'host-listing': actionListing,
  'host-photos': actionPhotos,
  'host-setup': actionSetup,
  'host-rate-guest': actionRateGuest,
  'stay-info': actionStayInfo,
};

module.exports = { ACTIONS, AMENITIES, setupChecklist, hostView };
