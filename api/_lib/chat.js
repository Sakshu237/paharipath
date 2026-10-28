// /api/_lib/chat.js
// Request-to-book + guest/host chat. Used by /api/bookings.js (actions
// 'messages', 'send', 'respond', 'host-inbox', 'admin-inbox') and by the
// daily cron in /api/complete-stays.js (expiry sweep).
//
// How a request works:
//   requested  → guest sent a request, nothing charged, dates NOT blocked yet
//   confirmed  → host accepted; dates blocked; guest pays the host directly or on arrival
//   declined   → host said no (or another request for the same dates was accepted)
//   expired    → host did not answer within REQUEST_HOURS, or check-in date passed
//   cancelled  → guest withdrew the request / cancelled
//
// Who can read a thread:
//   guest — booking ref + the phone on the booking, OR the private chat link token from their email (HMAC of the ref)
//   host  — logged-in Supabase session whose email matches stays.host_email
//   admin — logged-in session whose email is in ADMIN_EMAIL
//
// Until a booking is confirmed, phone numbers, emails, UPI ids and links are
// hidden from messages so guests and hosts can't move the booking off PahariPath.
//
// Lives under /api/_lib/, so Vercel never turns it into its own function.

const crypto = require('crypto');
const { sendEmail } = require('./email');
const { isAdminEmail, notifyEmail } = require('./admin');

const SITE = 'https://paharipath.in';
const REQUEST_HOURS = 48;
const MAX_LEN = 1000;
const NOTIFY_GAP_MIN = 15; // at most one "new message" email per side every 15 minutes
const OPEN_STATUSES = ['requested', 'confirmed', 'completed'];

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The guest's private chat link token is derived from the booking ref with a
// server-only secret, so nothing secret is stored in the bookings table.
function chatSecret() { return process.env.CHAT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
function chatToken(ref) {
  const secret = chatSecret();
  if (!secret || !ref) return '';
  return crypto.createHmac('sha256', secret).update('chat:' + ref).digest('base64url').slice(0, 32);
}
function requestExpiry() { return new Date(Date.now() + REQUEST_HOURS * 3600 * 1000).toISOString(); }

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// ── contact masking ──────────────────────────────────────────────────────
const HIDDEN = '[contact hidden until the booking is confirmed]';
function maskContacts(text) {
  let t = String(text || '');
  const before = t;
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, HIDDEN);                                       // emails + UPI ids
  t = t.replace(/https?:\/\/\S+|www\.\S+|wa\.me\/\S+|\b[a-z0-9-]+\.(com|in|net|org|me|co)\b\S*/gi, HIDDEN); // links
  t = t.replace(/\+?\d(?:[\s\-().]*\d){7,}/g, HIDDEN);                                            // phone-like numbers (8+ digits)
  // Numbers spelled out digit by digit ("nine eight one ...")
  const words = '(zero|one|two|three|four|five|six|seven|eight|nine|shunya|ek|do|teen|char|paanch|chhe|saat|aath|nau)';
  t = t.replace(new RegExp(`(\\b${words}\\b[\\s,.-]*){7,}`, 'gi'), HIDDEN);
  return { text: t, masked: t !== before };
}

function clipMessage(text) {
  return String(text || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, MAX_LEN);
}

// ── auth ─────────────────────────────────────────────────────────────────
async function sessionEmail(access_token, SUPABASE_URL, SUPABASE_ANON) {
  if (!access_token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u.email ? String(u.email).toLowerCase() : null;
}

async function getBooking(ref, headers, SUPABASE_URL) {
  if (!/^PP[A-Z0-9]{6,12}$/.test(String(ref || ''))) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(ref)}&select=*`, { headers });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

async function getStay(stayId, headers, SUPABASE_URL) {
  if (!stayId) return null;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${parseInt(stayId)}&select=id,name,host_email,contact,address,checkin_time,checkout_time,house_rules`, { headers });
  const rows = r.ok ? await r.json() : [];
  return rows[0] || null;
}

// Returns 'guest' | 'host' | 'admin' | null for this booking.
async function whoIs(body, booking, stay, ctx) {
  const { SUPABASE_URL, SUPABASE_ANON } = ctx;
  if (body.access_token) {
    const email = await sessionEmail(body.access_token, SUPABASE_URL, SUPABASE_ANON);
    if (email && isAdminEmail(email)) return body.as === 'host' && stay && String(stay.host_email || '').toLowerCase() === email ? 'host' : 'admin';
    if (email && stay && String(stay.host_email || '').toLowerCase() === email) return 'host';
  }
  if (body.token && safeEqual(body.token, chatToken(booking.id))) return 'guest';
  if (body.phone && String(body.phone) === booking.guest_phone) return 'guest';
  return null;
}

// ── status helpers ───────────────────────────────────────────────────────
function todayIST() { return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10); }

function isStale(b) {
  if (b.status !== 'requested') return false;
  if (b.request_expires_at && Date.parse(b.request_expires_at) < Date.now()) return true;
  if (b.checkin_date && b.checkin_date < todayIST()) return true;
  return false;
}

// Marks a stale request expired (only if it is still 'requested'). Returns the updated row or the original.
async function expireIfStale(b, headers, SUPABASE_URL, notify = true) {
  if (!isStale(b)) return b;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}&status=eq.requested`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'expired', responded_at: new Date().toISOString() }),
  });
  const rows = r.ok ? await r.json() : [];
  if (rows[0]) {
    await addMessage(b.id, 'system', 'This request expired because the host did not reply in time. No money was charged — you can request another stay anytime.', headers, SUPABASE_URL);
    if (notify) await mailGuestOutcome(rows[0], null, 'expired');
    return rows[0];
  }
  return b;
}

async function addMessage(bookingId, sender, body, headers, SUPABASE_URL, masked = false) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/booking_messages`, {
    method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ booking_id: bookingId, sender, body, masked }),
  });
  if (!r.ok) throw new Error('message insert failed: ' + await r.text());
  return (await r.json())[0];
}

async function listMessages(bookingId, headers, SUPABASE_URL) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/booking_messages?booking_id=eq.${encodeURIComponent(bookingId)}&select=id,sender,body,masked,created_at&order=id.asc&limit=500`, { headers });
  return r.ok ? await r.json() : [];
}

// What each side may see about the booking.
function summary(b, stay, role) {
  const confirmed = b.status === 'confirmed' || b.status === 'completed';
  const out = {
    ref: b.id, status: b.status, stay_name: b.stay_name, dates: b.dates, checkin_date: b.checkin_date, checkout_date: b.checkout_date,
    nights: b.nights, guests: b.guests, amount: b.amount, guest: b.guest, payment_status: b.payment_status,
    request_expires_at: b.request_expires_at || null, decline_reason: b.decline_reason || null,
  };
  if (confirmed && role !== 'guest') out.guest_phone = b.guest_phone;
  if (confirmed && stay && role !== 'host') {
    out.host_contact = (stay.contact || '').replace(/[^0-9+]/g, '') || null;
    out.address = stay.address || null;
    out.checkin_time = stay.checkin_time || null;
    out.checkout_time = stay.checkout_time || null;
  }
  return out;
}

// ── emails ───────────────────────────────────────────────────────────────
const wrap = (title, html) => `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
  <h2 style="color:#2d5a3d;margin:0 0 12px">${esc(title)}</h2>${html}
  <p style="font-size:12px;color:#888;margin-top:18px">PahariPath · hello@paharipath.in</p></div>`;
const btn = (href, label) => `<p style="margin:18px 0"><a href="${href}" style="background:#2d5a3d;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;
const guestChatLink = b => `${SITE}/?chat=${encodeURIComponent(b.id)}&t=${encodeURIComponent(chatToken(b.id))}`;
const hostLink = `${SITE}/host-login`;
const details = b => `<p style="font-size:14px;line-height:1.6"><b>${esc(b.stay_name)}</b><br>${esc(b.dates || '')} · ${esc(b.nights || '—')} night(s) · ${esc(b.guests || 1)} guest(s)<br>Amount: ${esc(b.amount || '—')} — paid directly to the host or on arrival<br>Reference: ${esc(b.id)}</p>`;

async function mailNewRequest(b, stay, firstMessage) {
  const hostHtml = details(b) + `<p>Guest: <b>${esc(b.guest)}</b></p>` +
    (firstMessage ? `<p style="background:#f4f8f5;padding:12px;border-radius:8px">“${esc(firstMessage)}”</p>` : '') +
    `<p>Please accept or decline within ${REQUEST_HOURS} hours. You can chat with the guest first if you have questions.</p>` + btn(hostLink, 'Open host dashboard');
  const guestHtml = details(b) + `<p>Your request has been sent to the host. They usually reply within ${REQUEST_HOURS} hours. Nothing is charged now — once the host accepts, you pay them directly or on arrival.</p>` + btn(guestChatLink(b), 'Chat with your host');
  await Promise.all([
    stay && stay.host_email ? sendEmail({ to: stay.host_email, subject: `New booking request: ${b.guest} · ${b.dates || ''} (Ref: ${b.id})`, html: wrap('New booking request 🏔️', hostHtml) }) : null,
    b.guest_email ? sendEmail({ to: b.guest_email, subject: `Request sent — ${String(b.stay_name).slice(0, 80)} (Ref: ${b.id})`, html: wrap('Your request is with the host', guestHtml) }) : null,
    notifyEmail() ? sendEmail({ to: notifyEmail(), subject: `Request ${b.id} — ${b.stay_name}`, html: wrap('New booking request', details(b) + `<p>Guest: ${esc(b.guest)} · ${esc(b.guest_phone)}</p>` + (firstMessage ? `<p>“${esc(firstMessage)}”</p>` : '')) }) : null,
  ]);
}

async function mailGuestOutcome(b, stay, outcome) {
  if (!b.guest_email) return;
  const msgs = {
    declined: ['Your request was not accepted', `The host couldn't take this booking${b.decline_reason ? `: “${esc(b.decline_reason)}”` : '.'} No money was charged. Quieter stays nearby are waiting on paharipath.in.`],
    expired: ['Your request expired', `The host didn't reply in time, so the request has closed. No money was charged. You can request another stay on paharipath.in.`],
  };
  const [title, text] = msgs[outcome] || msgs.expired;
  await sendEmail({ to: b.guest_email, subject: `${title} — ${String(b.stay_name).slice(0, 80)} (Ref: ${b.id})`, html: wrap(title, details(b) + `<p>${text}</p>` + btn(SITE, 'Find another stay')) });
}

// "You have a new message" — throttled per side so a long chat doesn't flood inboxes.
async function mailNewMessage(b, stay, to, text, headers, SUPABASE_URL) {
  const col = to === 'host' ? 'host_notified_at' : 'guest_notified_at';
  if (b[col] && Date.now() - Date.parse(b[col]) < NOTIFY_GAP_MIN * 60 * 1000) return;
  const address = to === 'host' ? stay && stay.host_email : b.guest_email;
  if (!address) return;
  const link = to === 'host' ? hostLink : guestChatLink(b);
  const from = to === 'host' ? b.guest : (stay && stay.name) || 'your host';
  await sendEmail({
    to: address, subject: `New message from ${from} (Ref: ${b.id})`,
    html: wrap('You have a new message', `<p style="background:#f4f8f5;padding:12px;border-radius:8px">“${esc(String(text).slice(0, 300))}”</p>` + btn(link, 'Reply on PahariPath')),
  });
  await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', headers, body: JSON.stringify({ [col]: new Date().toISOString() }) });
}

// ── actions ──────────────────────────────────────────────────────────────

// action 'messages' — fields: bookingRef + (phone | token | access_token[, as:'host'])
async function actionMessages(body, ctx) {
  const { headers, SUPABASE_URL } = ctx;
  let b = await getBooking(body.bookingRef, headers, SUPABASE_URL);
  if (!b) return [404, { error: 'Booking not found' }];
  const stay = await getStay(b.stay_id, headers, SUPABASE_URL);
  const role = await whoIs(body, b, stay, ctx);
  if (!role) return [403, { error: 'You can only open chats for your own bookings' }];
  b = await expireIfStale(b, headers, SUPABASE_URL);
  const messages = await listMessages(b.id, headers, SUPABASE_URL);
  const readCol = role === 'host' ? 'host_last_read_at' : role === 'guest' ? 'guest_last_read_at' : null;
  if (readCol) await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}`, { method: 'PATCH', headers, body: JSON.stringify({ [readCol]: new Date().toISOString() }) });
  return [200, { role, booking: summary(b, stay, role), messages, canSend: OPEN_STATUSES.includes(b.status) }];
}

// action 'send' — fields: bookingRef, text + same auth as 'messages'
async function actionSend(body, ctx) {
  const { headers, SUPABASE_URL } = ctx;
  const text = clipMessage(body.text);
  if (!text) return [400, { error: 'Type a message first' }];
  let b = await getBooking(body.bookingRef, headers, SUPABASE_URL);
  if (!b) return [404, { error: 'Booking not found' }];
  const stay = await getStay(b.stay_id, headers, SUPABASE_URL);
  const role = await whoIs(body, b, stay, ctx);
  if (!role) return [403, { error: 'You can only send messages on your own bookings' }];
  b = await expireIfStale(b, headers, SUPABASE_URL);
  if (!OPEN_STATUSES.includes(b.status)) return [409, { error: 'This chat is closed because the booking is no longer active' }];

  // 30 messages per 10 minutes per booking and side.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const rc = await fetch(`${SUPABASE_URL}/rest/v1/booking_messages?booking_id=eq.${encodeURIComponent(b.id)}&sender=eq.${role}&created_at=gte.${encodeURIComponent(since)}&select=id`, { headers });
  if (rc.ok && (await rc.json()).length >= 30) return [429, { error: 'Too many messages — please wait a few minutes' }];

  const confirmed = b.status === 'confirmed' || b.status === 'completed';
  const { text: finalText, masked } = confirmed || role === 'admin' ? { text, masked: false } : maskContacts(text);
  const msg = await addMessage(b.id, role, finalText, headers, SUPABASE_URL, masked);
  if (role === 'guest') await mailNewMessage(b, stay, 'host', finalText, headers, SUPABASE_URL);
  else await mailNewMessage(b, stay, 'guest', finalText, headers, SUPABASE_URL);
  return [200, { success: true, message: msg, masked }];
}

// action 'respond' — host (or admin) accepts / declines. fields: bookingRef, decision ('accept'|'decline'), reason?, access_token
async function actionRespond(body, ctx, notify) {
  const { headers, SUPABASE_URL } = ctx;
  let b = await getBooking(body.bookingRef, headers, SUPABASE_URL);
  if (!b) return [404, { error: 'Booking not found' }];
  const stay = await getStay(b.stay_id, headers, SUPABASE_URL);
  const role = body.access_token ? await whoIs({ access_token: body.access_token, as: 'host' }, b, stay, ctx) : null;
  if (role !== 'host' && role !== 'admin') return [403, { error: 'Only the host of this stay can accept or decline' }];
  b = await expireIfStale(b, headers, SUPABASE_URL);
  if (b.status !== 'requested') return [409, { error: `This request is already ${b.status}` }];
  const now = new Date().toISOString();

  if (body.decision === 'decline') {
    const reason = clipMessage(body.reason).slice(0, 300) || null;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}&status=eq.requested`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'declined', responded_at: now, decline_reason: reason }),
    });
    const [done] = r.ok ? await r.json() : [];
    if (!done) return [409, { error: 'This request changed — please refresh' }];
    await addMessage(b.id, 'system', `The host declined this request${reason ? `: ${reason}` : '.'} No money was charged.`, headers, SUPABASE_URL);
    await mailGuestOutcome(done, stay, 'declined');
    return [200, { success: true, status: 'declined' }];
  }

  if (body.decision !== 'accept') return [400, { error: 'decision must be accept or decline' }];

  // Dates must still be free: no confirmed booking, live payment hold or host-blocked date overlaps.
  const [conf, blocked] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${b.stay_id}&id=neq.${encodeURIComponent(b.id)}&status=in.(confirmed,pending_payment)&checkin_date=lt.${b.checkout_date}&checkout_date=gt.${b.checkin_date}&select=id`, { headers }).then(r => r.json()),
    fetch(`${SUPABASE_URL}/rest/v1/host_blocked_dates?stay_id=eq.${b.stay_id}&blocked_date=gte.${b.checkin_date}&blocked_date=lt.${b.checkout_date}&select=id`, { headers }).then(r => r.json()),
  ]);
  if ((Array.isArray(conf) && conf.length) || (Array.isArray(blocked) && blocked.length)) {
    return [409, { error: 'These dates are already booked or blocked in your calendar. Unblock them first, or decline this request.' }];
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(b.id)}&status=eq.requested`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'confirmed', responded_at: now, confirmed_at: now }),
  });
  const [done] = r.ok ? await r.json() : [];
  if (!done) return [409, { error: 'This request changed — please refresh' }];
  await addMessage(b.id, 'system', 'The host accepted your request — your stay is confirmed! Pay the host directly or on arrival. Contact details are now visible in this chat.', headers, SUPABASE_URL);
  await notify.bookingConfirmed(done, headers, SUPABASE_URL);

  // Other open requests for overlapping dates at this stay can no longer happen.
  const clash = await fetch(`${SUPABASE_URL}/rest/v1/bookings?stay_id=eq.${b.stay_id}&id=neq.${encodeURIComponent(b.id)}&status=eq.requested&checkin_date=lt.${b.checkout_date}&checkout_date=gt.${b.checkin_date}&select=*`, { headers }).then(x => x.json()).catch(() => []);
  for (const other of Array.isArray(clash) ? clash : []) {
    const rr = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(other.id)}&status=eq.requested`, {
      method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'declined', responded_at: now, decline_reason: 'These dates were just booked by another guest' }),
    });
    const [od] = rr.ok ? await rr.json() : [];
    if (od) {
      await addMessage(od.id, 'system', 'Sorry — these dates were just booked by another guest. No money was charged.', headers, SUPABASE_URL);
      await mailGuestOutcome(od, stay, 'declined');
    }
  }
  return [200, { success: true, status: 'confirmed', booking: summary(done, stay, 'host') }];
}

// Adds an unread count to each booking row for one side.
async function withUnread(rows, side, headers, SUPABASE_URL) {
  if (!rows.length) return rows;
  const ids = rows.map(r => encodeURIComponent(r.id)).join(',');
  const other = side === 'host' ? 'guest' : 'host';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/booking_messages?booking_id=in.(${ids})&sender=in.(${other},system)&select=booking_id,created_at`, { headers });
  const msgs = r.ok ? await r.json() : [];
  const readCol = side === 'host' ? 'host_last_read_at' : 'guest_last_read_at';
  return rows.map(b => {
    const seen = b[readCol] ? Date.parse(b[readCol]) : 0;
    const mine = msgs.filter(m => m.booking_id === b.id);
    return { ...b, unread: mine.filter(m => Date.parse(m.created_at) > seen).length, message_count: mine.length };
  });
}

// action 'host-inbox' — every request and booking for the logged-in host's stays. fields: access_token
async function actionHostInbox(body, ctx) {
  const { headers, SUPABASE_URL, SUPABASE_ANON } = ctx;
  const email = await sessionEmail(body.access_token, SUPABASE_URL, SUPABASE_ANON);
  if (!email) return [403, { error: 'Please log in again' }];
  const sr = await fetch(`${SUPABASE_URL}/rest/v1/stays?host_email=ilike.${encodeURIComponent(email.replace(/[\\%_]/g, c => '\\' + c))}&select=id,name`, { headers });
  const stays = sr.ok ? await sr.json() : [];
  if (!stays.length) return [200, { bookings: [], stays: [] }];
  const ids = stays.map(s => s.id).join(',');
  const br = await fetch(`${SUPABASE_URL}/rest/v1/bookings?stay_id=in.(${ids})&status=in.(requested,confirmed,completed,declined,expired,cancelled)&select=id,stay_id,stay_name,guest,guest_phone,dates,checkin_date,checkout_date,nights,guests,amount,status,payment_status,request_message,request_expires_at,decline_reason,created_at,host_last_read_at&order=created_at.desc&limit=100`, { headers });
  let rows = br.ok ? await br.json() : [];
  for (let i = 0; i < rows.length; i++) if (isStale(rows[i])) rows[i] = await expireIfStale(rows[i], headers, SUPABASE_URL);
  rows = rows.map(b => (b.status === 'confirmed' || b.status === 'completed') ? b : { ...b, guest_phone: null });
  rows = await withUnread(rows, 'host', headers, SUPABASE_URL);
  return [200, { bookings: rows, stays }];
}

// action 'admin-inbox' — every open request plus recent threads. fields: access_token
async function actionAdminInbox(body, ctx) {
  const { headers, SUPABASE_URL, SUPABASE_ANON } = ctx;
  const email = await sessionEmail(body.access_token, SUPABASE_URL, SUPABASE_ANON);
  if (!email || !isAdminEmail(email)) return [403, { error: 'Admin only' }];
  const br = await fetch(`${SUPABASE_URL}/rest/v1/bookings?status=in.(requested,confirmed,declined,expired)&select=id,stay_id,stay_name,guest,guest_phone,dates,checkin_date,nights,guests,amount,status,request_message,request_expires_at,created_at&order=created_at.desc&limit=100`, { headers });
  return [200, { bookings: br.ok ? await br.json() : [] }];
}

// Daily cron: close every request that is past its deadline.
async function sweepExpired(headers, SUPABASE_URL) {
  const now = encodeURIComponent(new Date().toISOString());
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bookings?status=eq.requested&or=(request_expires_at.lt.${now},checkin_date.lt.${todayIST()})&select=*`, { headers });
  const rows = r.ok ? await r.json() : [];
  let n = 0;
  for (const b of rows) { const d = await expireIfStale(b, headers, SUPABASE_URL); if (d.status === 'expired') n++; }
  return n;
}

function tokenOk(ref, token) { return !!token && safeEqual(token, chatToken(ref)); }

module.exports = {
  REQUEST_HOURS, chatToken, tokenOk, requestExpiry, maskContacts, clipMessage, addMessage, mailNewRequest, getStay,
  actionMessages, actionSend, actionRespond, actionHostInbox, actionAdminInbox, sweepExpired, withUnread,
};
