// /api/_lib/retention.js
// The repeat-customer engine. Called by /api/complete-stays.js (daily cron)
// and /api/award-points.js (same-day check-ins).
//
// 1. PAHARI PASSPORT — 32 sub-valley stamps in 13 regions (passport.json).
//    A stamp is earned when a stay in that sub-valley is completed.
//
// 2. PRIZES — unlocked automatically (checkPassportPrizes):
//      3 stamps   Ghumakkad badge + 150 points          (digital, instant)
//      10 stamps  Pahari Parcel + 300 points            (physical — admin posts it)
//      all 32     Himachal Complete + 1000 points       (physical — admin sends it)
//      a region   region badge + 100 points             (digital, regions with 2+ stamps)
//    Each prize can unlock only once per traveller (passport_prizes table).
//    Physical prizes appear in the admin Control Centre "Prizes to send" list
//    and the admin gets an email.
//
// 3. EMAILS — each at most once per booking (lifecycle_emails table):
//      pretrip      2 days before check-in   (booking email — always sent)
//      thanks       day after check-out      stamp, prizes, points, review, referral
//      nextstamp    ~45 days after check-out next stamps, in season (only if no newer trip)
//      anniversary  ~1 year after check-out  "a year since <place>"   (only if no newer trip)
//    Reminders respect a 20-day gap per inbox and a signed one-click unsubscribe.
//
// Lives under /api/_lib/ so Vercel never exposes it as an endpoint.

const crypto = require('crypto');
const { sendEmail } = require('./email');
const { tsKey, award, addBadge } = require('./points');
const { notifyEmail } = require('./admin');
const PLACES = require('../../places.json');
const PASSPORT = require('../../passport.json');

const SITE = 'https://paharipath.in';

// ── passport lookups ──
const STAMPS = [];                 // flat list: { key, name, icon, page, pageName, places }
const stampByPlace = new Map();    // placeId -> stamp
for (const pg of PASSPORT.pages) for (const s of pg.stamps) {
  const st = { ...s, page: pg.key, pageName: pg.name };
  STAMPS.push(st);
  for (const id of s.places) stampByPlace.set(id, st);
}
const STAMP_COUNT = STAMPS.length;
const MILESTONES = PASSPORT.milestones.slice().sort((a, b) => a.stamps - b.stamps);
const placeById = new Map(PLACES.map(p => [p.id, p]));

// Must match PAHADI_LADDER in app.js.
const LADDER = [
  { name: 'Pravaasi', min: 50 }, { name: 'Anveshak', min: 400 }, { name: 'Himveer', min: 1100 },
  { name: 'Aatmiya', min: 2000 }, { name: 'Dharohar Rakshak', min: 3200 }, { name: 'Icon of the Hills', min: 5000 },
];
function tierFor(points) {
  let cur = null, next = LADDER[0];
  for (const t of LADDER) { if (points >= t.min) { cur = t; next = null; } else { next = t; break; } }
  return { cur, next };
}

// Prizes a traveller holding these stamp keys has earned.
function earnedPrizes(stampKeys) {
  const out = MILESTONES.filter(m => stampKeys.size >= m.stamps).map(m => ({
    key: m.key, title: m.title, icon: m.icon, prize: m.prize, physical: !!m.physical, points: m.points || 0, badge: m.badge || null,
  }));
  for (const pg of PASSPORT.pages) {
    if (pg.stamps.length < 2 || !pg.stamps.every(s => stampKeys.has(s.key))) continue;
    out.push({ key: 'region-' + pg.key, title: `${pg.name} Complete`, icon: pg.icon, prize: PASSPORT.regionPrize.prize, physical: false, points: PASSPORT.regionPrize.points || 0, badge: `${pg.icon} ${pg.name} Complete` });
  }
  return out;
}
const nextMilestone = n => MILESTONES.find(m => n < m.stamps) || null;

// ── season check: does month m (0-11) fall in a bestTime string like "Mar–Jun, Sep–Nov"? ──
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function inSeason(bestTime, m) {
  if (!bestTime) return true;
  let parsed = false;
  for (const part of String(bestTime).toLowerCase().split(',')) {
    const ms = (part.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/g) || []).map(x => MON.indexOf(x));
    if (!ms.length) continue;
    parsed = true;
    const a = ms[0], b = ms[ms.length - 1];
    if (a <= b ? (m >= a && m <= b) : (m >= a || m <= b)) return true;
  }
  return !parsed; // "Year-round" and friends
}

// ── dates in India time ──
const istToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const prettyDate = ymd => { try { return new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch (e) { return ymd; } };

// ── unsubscribe tokens (signed, so nobody can unsubscribe someone else) ──
function unsubSecret() { return process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''; }
function unsubToken(email) {
  const e = String(email || '').trim().toLowerCase();
  const sig = crypto.createHmac('sha256', unsubSecret()).update('unsub:' + e).digest('base64url').slice(0, 22);
  return Buffer.from(e).toString('base64url') + '.' + sig;
}
function verifyUnsubToken(tok) {
  if (typeof tok !== 'string' || tok.length > 400 || !tok.includes('.') || !unsubSecret()) return null;
  const [b, sig] = tok.split('.');
  let email;
  try { email = Buffer.from(b, 'base64url').toString('utf8'); } catch (e) { return null; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const want = unsubToken(email).split('.')[1];
  if (!sig || sig.length !== want.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want)) ? email : null;
}

// ── small REST helpers (service-role headers passed in) ──
async function get(url, headers) {
  try { const r = await fetch(url, { headers }); return r.ok ? await r.json() : []; } catch (e) { return []; }
}

// Stamp keys a traveller holds (from completed stays).
async function stampsFor(phone, headers, U) {
  const done = await get(`${U}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(phone)}&status=eq.completed&select=stay_id`, headers);
  const ids = [...new Set(done.map(b => parseInt(b.stay_id)).filter(Boolean))];
  const stays = ids.length ? await get(`${U}/rest/v1/stays?id=in.(${ids.join(',')})&select=id,placeid`, headers) : [];
  const keys = new Set();
  for (const s of stays) { const st = stampByPlace.get(parseInt(s.placeid)); if (st) keys.add(st.key); }
  return keys;
}

// ── PRIZES: unlock anything newly earned. Safe to call any number of times. ──
async function checkPassportPrizes(booking, headers, U) {
  const phone = booking.guest_phone;
  if (!phone) return [];
  const keys = await stampsFor(phone, headers, U);
  const earned = earnedPrizes(keys);
  if (!earned.length) return [];
  const rows = earned.map(p => ({
    phone, prize_key: p.key, title: p.title, physical: p.physical, status: p.physical ? 'to_send' : 'given',
    guest_name: booking.guest || null, guest_email: booking.guest_email || null, stamps_at_unlock: keys.size,
  }));
  const r = await fetch(`${U}/rest/v1/passport_prizes?on_conflict=phone,prize_key`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error('passport_prizes not ready: ' + (await r.text()).slice(0, 200));
  const fresh = await r.json();
  const unlocked = [];
  for (const row of (Array.isArray(fresh) ? fresh : [])) {
    const p = earned.find(x => x.key === row.prize_key);
    if (!p) continue;
    unlocked.push(p);
    try {
      if (p.points) await award({ phone, actionKey: `passport:${p.key}:${phone}`, pts: p.points, reason: `Pahari Passport — ${p.title}`, ref: null, guestName: booking.guest }, headers, U);
      if (p.badge) await addBadge(phone, p.badge, headers, U);
    } catch (e) { console.error('prize points/badge failed', p.key, e.message); }
    if (p.physical && notifyEmail()) {
      await sendEmail({
        to: notifyEmail(), subject: `🎁 Prize to send: ${p.title} — ${booking.guest || phone}`,
        html: `<div style="font-family:sans-serif"><h3>${esc(p.icon)} ${esc(booking.guest || 'A traveller')} unlocked "${esc(p.title)}"</h3>
          <p>${esc(p.prize)}</p><p>Phone: <b>${esc(phone)}</b>${booking.guest_email ? ` · Email: ${esc(booking.guest_email)}` : ''}<br>Stamps: ${keys.size} of ${STAMP_COUNT}</p>
          <p>WhatsApp them for a postal address, send it, then mark it sent in Admin → Control Centre → Prizes to send.</p></div>`,
      });
    }
  }
  return unlocked;
}

// Claim an email slot BEFORE sending. Returns true only for the first caller.
async function claim(key, kind, ref, email, headers, U) {
  const r = await fetch(`${U}/rest/v1/lifecycle_emails?on_conflict=key`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ key, kind, booking_ref: ref, email }),
  });
  if (!r.ok) throw new Error('lifecycle_emails not ready: ' + (await r.text()).slice(0, 200));
  const rows = await r.json();
  return Array.isArray(rows) && rows.length > 0;
}
async function release(key, headers, U) {
  await fetch(`${U}/rest/v1/lifecycle_emails?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE', headers }).catch(() => {});
}

// ── email shell ──
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const btn = (href, label, solid = true) => `<a href="${href}" style="display:inline-block;margin:4px 6px 4px 0;padding:11px 18px;border-radius:9px;text-decoration:none;font-weight:700;font-size:14px;${solid ? 'background:#2d5a3d;color:#fff' : 'background:#fff;color:#2d5a3d;border:1px solid #2d5a3d'}">${esc(label)}</a>`;
function shell(body, email, marketing) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:540px;margin:0 auto;padding:24px;color:#1a1a1a;line-height:1.55">
  ${body}
  <p style="font-size:12px;color:#888;margin-top:26px;border-top:1px solid #eee;padding-top:12px">PahariPath · Responsible travel in the quieter Himachal · hello@paharipath.in
  ${marketing ? `<br><a href="${SITE}/?unsub=${encodeURIComponent(unsubToken(email))}" style="color:#888">Stop these trip reminders</a> (booking emails will still reach you)` : ''}</p></div>`;
}
// Compact passport: one dot per stamp, grouped by region.
function stampStrip(keys) {
  return PASSPORT.pages.map(pg => `<span style="display:inline-block;margin:3px 5px;white-space:nowrap" title="${esc(pg.name)}">${pg.stamps.map(s => {
    const got = keys.has(s.key);
    return `<span title="${esc(s.name)}" style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;margin:1px;border-radius:50%;font-size:13px;${got ? 'background:#e8f4ed;border:2px solid #2d5a3d' : 'background:#f4f4f4;border:2px dashed #ccc;filter:grayscale(1);opacity:.45'}">${s.icon}</span>`;
  }).join('')}</span>`).join('');
}
function prizeBlock(keys, justUnlocked) {
  const n = keys.size, nm = nextMilestone(n);
  const won = (justUnlocked || []).map(p => `<div style="background:#fff8e6;border:1px solid #f0d68a;border-radius:11px;padding:12px 14px;margin:10px 0">
      <b>${esc(p.icon)} You unlocked: ${esc(p.title)}!</b><br><span style="font-size:13px">${esc(p.prize)}${p.physical ? ' — we\'ll WhatsApp you for your address.' : ''}</span></div>`).join('');
  const next = nm ? `<p style="font-size:14px;margin:8px 0">${nm.icon} <b>${nm.stamps - n} more stamp${nm.stamps - n === 1 ? '' : 's'}</b> to unlock <b>${esc(nm.title)}</b>: ${esc(nm.prize)}.</p>` : '';
  return won + next;
}
function suggestionCards(list) {
  return list.map(p => {
    const st = stampByPlace.get(p.id);
    return `<a href="${SITE}/destination/${encodeURIComponent(p.slug || '')}" style="display:block;text-decoration:none;color:#1a1a1a;border:1px solid #e3ece6;border-radius:11px;padding:12px 14px;margin:8px 0">
    <b>${esc(p.emoji || '📍')} ${esc(p.name)}</b> <span style="color:#4a7c5f;font-size:12px">· ${esc(st ? st.name : p.district)} stamp</span><br>
    <span style="font-size:13px;color:#555">${esc(p.famousFor || p.desc || '')}</span>${p.bestTime ? `<br><span style="font-size:12px;color:#888">Best: ${esc(p.bestTime)}</span>` : ''}</a>`;
  }).join('');
}

// ── traveller context: stamps, points, referral code ──
async function travellerContext(phone, headers, U) {
  const [keys, score] = await Promise.all([
    stampsFor(phone, headers, U),
    get(`${U}/rest/v1/traveller_scores?user_key=eq.${tsKey(phone)}&select=points`, headers),
  ]);
  const points = (score[0] && score[0].points) || 0;
  let code = null;
  try {
    const r = await fetch(`${U}/rest/v1/rpc/my_referral_code`, { method: 'POST', headers, body: JSON.stringify({ p_phone: phone }) });
    if (r.ok) { const v = await r.json(); code = typeof v === 'string' ? v : null; }
  } catch (e) { /* referral link is optional */ }
  return { keys, points, code };
}

// Places for stamps this traveller hasn't got, in season, quiet, preferring ones with a real host.
// Prefers the same region first (explore the rest of a valley you liked), then new regions.
function pickNext(keys, bookablePlaceIds, monthIdx, n = 2, homePage = null) {
  const pool = PLACES.filter(p => { const st = stampByPlace.get(p.id); return st && !keys.has(st.key) && inSeason(p.bestTime, monthIdx) && (p.crowd == null || p.crowd <= 55); });
  const pageOf = p => stampByPlace.get(p.id).page;
  pool.sort((a, b) => ((homePage && pageOf(b) === homePage) - (homePage && pageOf(a) === homePage)) || (bookablePlaceIds.has(b.id) - bookablePlaceIds.has(a.id)) || ((a.crowd || 50) - (b.crowd || 50)));
  const out = [], seen = new Set();
  for (const p of pool) { const k = stampByPlace.get(p.id).key; if (seen.has(k)) continue; seen.add(k); out.push(p); if (out.length >= n) break; }
  return out;
}

// ── the four emails ──
function pretripEmail(b, stay, place) {
  const rows = [
    ['Stay', b.stay_name], ['Check-in', `${prettyDate(b.checkin_date)}${stay && stay.checkin_time ? ' · ' + stay.checkin_time : ''}`],
    ...(b.checkout_date ? [['Check-out', `${prettyDate(b.checkout_date)}${stay && stay.checkout_time ? ' · ' + stay.checkout_time : ''}`]] : []),
    ...(stay && stay.address ? [['Address', stay.address]] : []), ['Reference', b.id],
  ].map(([k, v]) => `<tr><td style="padding:5px 0;color:#666;width:95px">${esc(k)}</td><td style="padding:5px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  const st = place && stampByPlace.get(place.id);
  return {
    subject: `2 days to go — ${String(b.stay_name || 'your stay').slice(0, 60)} 🎒`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">The hills are getting ready for you</h2>
      <p>Hi ${esc(b.guest || 'traveller')}, your stay starts on <b>${prettyDate(b.checkin_date)}</b>.${st ? ` This trip earns your <b>${esc(st.name)}</b> ${st.icon} stamp in your Pahari Passport.` : ''}</p>
      <table style="width:100%;border-collapse:collapse;margin:10px 0">${rows}</table>
      <p style="margin:14px 0 6px"><b>Before you leave</b></p>
      <ul style="margin:0 0 12px;padding-left:20px;font-size:14px">
        <li>Message your host on PahariPath to share your arrival time.</li>
        <li>Carry a valid photo ID, warm layers and some cash — mountain ATMs and signal can be patchy.</li>
        <li>Download offline maps before the last town with network.</li>
        <li>Carry your waste back down — leave the valley cleaner than you found it.</li>
      </ul>
      ${btn(`${SITE}/?me=1`, '💬 Message your host')}
      ${place ? btn(`${SITE}/destination/${encodeURIComponent(place.slug || '')}`, `🗺️ ${place.name} itinerary`, false) : ''}`, b.guest_email, false),
  };
}

function thanksEmail(b, place, ctx, next, unlocked) {
  const st = place && stampByPlace.get(place.id);
  const { cur, next: nt } = tierFor(ctx.points);
  return {
    subject: unlocked && unlocked.length ? `${unlocked[0].icon} You unlocked ${unlocked[0].title} in your Pahari Passport!`
      : st ? `${st.icon} New stamp in your Pahari Passport — ${st.name}` : `Thank you for travelling with PahariPath 🏔️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">Thank you for staying gently, ${esc((b.guest || 'traveller').split(' ')[0])}</h2>
      <p>Your stay at <b>${esc(b.stay_name)}</b> supported a local family directly. That matters more than you know.</p>
      ${st ? `<div style="background:#f6faf7;border:1px solid #dbe9df;border-radius:12px;padding:14px;margin:14px 0;text-align:center">
        <div style="font-size:12px;letter-spacing:1px;color:#4a7c5f;font-weight:700">PAHARI PASSPORT · ${ctx.keys.size} OF ${STAMP_COUNT} STAMPS</div>
        <div style="margin:10px 0">${stampStrip(ctx.keys)}</div>
        <div style="font-size:14px">You collected the <b>${esc(st.name)}</b> stamp ${st.icon}</div></div>` : ''}
      ${prizeBlock(ctx.keys, unlocked)}
      <p style="font-size:14px">🏅 You have <b>${ctx.points} PAHADI points</b>${cur ? ` — <b>${esc(cur.name)}</b>` : ''}.${nt ? ` Just <b>${nt.min - ctx.points}</b> more to reach <b>${esc(nt.name)}</b>.` : ''}</p>
      <p style="margin:16px 0 4px"><b>Two minutes that help a lot</b></p>
      ${btn(`${SITE}/?me=1`, '⭐ Review your host')}
      ${ctx.code ? btn(`${SITE}/?ref=${encodeURIComponent(ctx.code)}`, '🎁 Invite a friend (+100 each)', false) : ''}
      ${next.length ? `<p style="margin:20px 0 2px"><b>Your next stamps</b> — quiet right now, and in season:</p>${suggestionCards(next)}` : ''}`, b.guest_email, true),
  };
}

function nextStampEmail(b, place, ctx, next) {
  const left = STAMP_COUNT - ctx.keys.size;
  return {
    subject: `${left} stamps still waiting in your Pahari Passport 🗺️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">Missing the hills yet?</h2>
      <p>It's been a few weeks since ${place ? esc(place.name) : 'your last trip'}. Your Pahari Passport has <b>${ctx.keys.size} of ${STAMP_COUNT}</b> stamps.</p>
      <div style="margin:10px 0;text-align:center">${stampStrip(ctx.keys)}</div>
      ${prizeBlock(ctx.keys, [])}
      ${next.length ? `<p style="margin:16px 0 2px">These are quiet and in season this month:</p>${suggestionCards(next)}` : ''}
      ${btn(`${SITE}/`, 'Find my next stamp')}`, b.guest_email, true),
  };
}

function anniversaryEmail(b, place, ctx, next) {
  const name = place ? place.name : (b.stay_name || 'the hills');
  return {
    subject: `A year ago, you were in ${String(name).slice(0, 50)} 🏔️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">One year since ${esc(name)}</h2>
      <p>Around this time last year you stayed at <b>${esc(b.stay_name)}</b>. The same season is coming back to the hills.</p>
      <p>Your host would be glad to see you again — or add a new stamp to your Pahari Passport (${ctx.keys.size} of ${STAMP_COUNT} so far).</p>
      ${prizeBlock(ctx.keys, [])}
      ${b.stay_id ? btn(`${SITE}/?stay=${parseInt(b.stay_id)}`, `🏡 Stay at ${String(b.stay_name || 'the same place').slice(0, 30)} again`) : ''}
      ${next.length ? `<p style="margin:18px 0 2px">Or try somewhere new this season:</p>${suggestionCards(next)}` : ''}`, b.guest_email, true),
  };
}

// ── main daily run ──
const MAX_SENDS_PER_RUN = 25;     // keeps the cron well inside Vercel's time limit
const REMINDER_GAP_DAYS = 20;     // never more than one reminder per inbox in this window

async function runLifecycle(headers, U, { dryRun = false } = {}) {
  const today = istToday();
  const month = new Date(today + 'T00:00:00Z').getUTCMonth();
  const stats = { pretrip: 0, thanks: 0, nextstamp: 0, anniversary: 0, skipped: 0, errors: 0 };
  let sends = 0;

  const SEL = 'id,guest,guest_phone,guest_email,stay_id,stay_name,checkin_date,checkout_date,nights,status,created_at';
  const [pre, thanks, nxt, ann, optouts, realStays] = await Promise.all([
    get(`${U}/rest/v1/bookings?status=eq.confirmed&guest_email=not.is.null&checkin_date=gte.${addDays(today, 1)}&checkin_date=lte.${addDays(today, 2)}&select=${SEL}`, headers),
    get(`${U}/rest/v1/bookings?status=eq.completed&guest_email=not.is.null&checkout_date=gte.${addDays(today, -7)}&checkout_date=lte.${addDays(today, -1)}&select=${SEL}`, headers),
    get(`${U}/rest/v1/bookings?status=eq.completed&guest_email=not.is.null&checkout_date=gte.${addDays(today, -52)}&checkout_date=lte.${addDays(today, -45)}&select=${SEL}`, headers),
    get(`${U}/rest/v1/bookings?status=eq.completed&guest_email=not.is.null&checkout_date=gte.${addDays(today, -342)}&checkout_date=lte.${addDays(today, -335)}&select=${SEL}`, headers),
    get(`${U}/rest/v1/email_optouts?select=email`, headers),
    get(`${U}/rest/v1/stays?host_email=not.is.null&host_email=neq.&status=neq.hidden&select=id,placeid,name,address,checkin_time,checkout_time`, headers),
  ]);
  const opted = new Set(optouts.map(o => String(o.email).toLowerCase()));
  const stayById = new Map(realStays.map(s => [s.id, s]));
  const bookablePlaceIds = new Set(realStays.map(s => parseInt(s.placeid)).filter(Boolean));

  async function stayFor(id) {
    if (!id) return null;
    if (stayById.has(id)) return stayById.get(id);
    const r = await get(`${U}/rest/v1/stays?id=eq.${parseInt(id)}&select=id,placeid,name,address,checkin_time,checkout_time`, headers);
    return r[0] || null;
  }
  async function recentlyReminded(email) {
    const since = new Date(Date.now() - REMINDER_GAP_DAYS * 864e5).toISOString();
    const r = await get(`${U}/rest/v1/lifecycle_emails?email=eq.${encodeURIComponent(email)}&kind=neq.pretrip&sent_at=gte.${encodeURIComponent(since)}&select=key&limit=1`, headers);
    return r.length > 0;
  }
  // A newer trip (booked after this one ended, or still upcoming) means no "come back" nudge is needed.
  async function hasNewerTrip(b) {
    const r = await get(`${U}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(b.guest_phone)}&id=neq.${encodeURIComponent(b.id)}&status=in.(requested,confirmed,completed)&or=(created_at.gte.${b.checkout_date},checkin_date.gte.${today})&select=id&limit=1`, headers);
    return r.length > 0;
  }
  // Prizes this traveller unlocked in the last 10 days (shown as "You unlocked …" in the thank-you email).
  async function recentPrizes(phone) {
    const since = new Date(Date.now() - 10 * 864e5).toISOString();
    const rows = await get(`${U}/rest/v1/passport_prizes?phone=eq.${encodeURIComponent(phone)}&created_at=gte.${encodeURIComponent(since)}&select=prize_key`, headers);
    const all = earnedPrizes(new Set(STAMPS.map(s => s.key)));
    return rows.map(r => all.find(p => p.key === r.prize_key)).filter(Boolean).sort((a, b) => (b.physical - a.physical) || (b.points - a.points));
  }

  async function send(kind, b, build, { marketing }) {
    if (sends >= MAX_SENDS_PER_RUN) return;
    const email = String(b.guest_email || '').trim().toLowerCase();
    if (!email) return;
    if (marketing && (opted.has(email) || await recentlyReminded(email))) { stats.skipped++; return; }
    if (marketing && kind !== 'thanks' && await hasNewerTrip(b)) { stats.skipped++; return; }
    const key = `${kind}:${b.id}`;
    if (dryRun) { const m = await build(); stats[kind]++; stats.preview = stats.preview || []; stats.preview.push({ key, to: email, subject: m.subject }); return; }
    if (!(await claim(key, kind, b.id, email, headers, U))) return; // already sent on an earlier day
    try {
      const m = await build();
      const ok = await sendEmail({ to: email, subject: m.subject, html: m.html });
      if (!ok) { await release(key, headers, U); stats.errors++; return; } // retry tomorrow
      sends++; stats[kind]++;
    } catch (e) { console.error('lifecycle email failed', key, e.message); await release(key, headers, U); stats.errors++; }
  }

  for (const b of pre) {
    await send('pretrip', b, async () => {
      const stay = await stayFor(b.stay_id);
      return pretripEmail(b, stay, stay && placeById.get(parseInt(stay.placeid)));
    }, { marketing: false });
  }
  for (const [kind, list, fn] of [['thanks', thanks, thanksEmail], ['nextstamp', nxt, nextStampEmail], ['anniversary', ann, anniversaryEmail]]) {
    for (const b of list) {
      await send(kind, b, async () => {
        const stay = await stayFor(b.stay_id);
        const place = stay && placeById.get(parseInt(stay.placeid));
        const ctx = await travellerContext(b.guest_phone, headers, U);
        const home = place && stampByPlace.get(place.id);
        const unlocked = kind === 'thanks' ? await recentPrizes(b.guest_phone) : [];
        return fn(b, place, ctx, pickNext(ctx.keys, bookablePlaceIds, month, 2, home && home.page), unlocked);
      }, { marketing: true });
    }
  }
  return stats;
}

module.exports = {
  runLifecycle, checkPassportPrizes, verifyUnsubToken, unsubToken, earnedPrizes, inSeason, tierFor, pickNext,
  STAMPS, STAMP_COUNT, MILESTONES, pretripEmail, thanksEmail, nextStampEmail, anniversaryEmail,
};
