// /api/_lib/retention.js
// The repeat-customer engine. Called once a day by /api/complete-stays.js.
//
// Sends four emails over a traveller's life with PahariPath, each one
// at most once per booking (lifecycle_emails table — see supabase/retention.sql):
//
//   pretrip      2 days before check-in   directions, check-in time, itinerary link   (booking email — always sent)
//   thanks       the day after check-out  Pahari Passport stamp, points, review, referral (reminder — respects unsubscribe)
//   nextstamp    ~45 days after check-out next valley to stamp, picked for the season  (reminder — only if no newer trip)
//   anniversary  ~1 year after check-out  "a year since <place>", same season again    (reminder — only if no newer trip)
//
// Reminder emails also respect a 20-day gap per inbox so nobody is spammed,
// and each one carries a one-click unsubscribe link.
//
// Lives under /api/_lib/ so Vercel never exposes it as an endpoint
// (keeps PahariPath inside the Hobby plan's 12-function cap).

const crypto = require('crypto');
const { sendEmail } = require('./email');
const { tsKey } = require('./points');
const PLACES = require('../../places.json');

const SITE = 'https://paharipath.in';

// ── Pahari Passport: one stamp per valley (the `zone` already on every destination) ──
const VALLEYS = {
  kullu:    { name: 'Kullu–Manali',        icon: '🏔️' },
  parvati:  { name: 'Parvati Valley',      icon: '🌲' },
  tirthan:  { name: 'Tirthan & Banjar',    icon: '🎣' },
  lahaul:   { name: 'Lahaul',              icon: '🧗' },
  spiti:    { name: 'Spiti',               icon: '🏜️' },
  kinnaur:  { name: 'Kinnaur',             icon: '🍎' },
  chamba:   { name: 'Chamba & Pangi',      icon: '🛕' },
  kangra:   { name: 'Kangra & Dhauladhar', icon: '🪂' },
  mandi:    { name: 'Mandi & Seraj',       icon: '🌄' },
  shimla:   { name: 'Shimla Hills',        icon: '🚂' },
  sirmaur:  { name: 'Sirmaur',             icon: '🌿' },
  solan:    { name: 'Solan Hills',         icon: '🍄' },
  bilaspur: { name: 'Bilaspur',            icon: '🌊' },
  hamirpur: { name: 'Hamirpur',            icon: '🏡' },
  una:      { name: 'Una',                 icon: '🙏' },
};
const VALLEY_COUNT = Object.keys(VALLEYS).length;

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

const placeById = new Map(PLACES.map(p => [p.id, p]));

// ── season check: does month m (0-11) fall in a bestTime string like "Mar–Jun, Sep–Nov"? ──
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function inSeason(bestTime, m) {
  if (!bestTime) return true;
  const parts = String(bestTime).toLowerCase().split(',');
  let parsed = false;
  for (const part of parts) {
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
function stampStrip(zones) {
  return Object.entries(VALLEYS).map(([z, v]) => {
    const got = zones.has(z);
    return `<span title="${esc(v.name)}" style="display:inline-block;width:34px;height:34px;line-height:34px;text-align:center;margin:2px;border-radius:50%;font-size:17px;${got ? 'background:#e8f4ed;border:2px solid #2d5a3d' : 'background:#f4f4f4;border:2px dashed #ccc;filter:grayscale(1);opacity:.45'}">${v.icon}</span>`;
  }).join('');
}
function suggestionCards(list) {
  return list.map(p => `<a href="${SITE}/destination/${encodeURIComponent(p.slug || '')}" style="display:block;text-decoration:none;color:#1a1a1a;border:1px solid #e3ece6;border-radius:11px;padding:12px 14px;margin:8px 0">
    <b>${esc(p.emoji || '📍')} ${esc(p.name)}</b> <span style="color:#4a7c5f;font-size:12px">· ${esc(VALLEYS[p.zone] ? VALLEYS[p.zone].name : p.district)} stamp</span><br>
    <span style="font-size:13px;color:#555">${esc(p.famousFor || p.desc || '')}</span>${p.bestTime ? `<br><span style="font-size:12px;color:#888">Best: ${esc(p.bestTime)}</span>` : ''}</a>`).join('');
}

// ── traveller context: stamps, points, referral code ──
async function travellerContext(phone, stayPlace, headers, U) {
  const [done, score] = await Promise.all([
    get(`${U}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(phone)}&status=eq.completed&select=stay_id`, headers),
    get(`${U}/rest/v1/traveller_scores?user_key=eq.${tsKey(phone)}&select=points`, headers),
  ]);
  const ids = [...new Set(done.map(b => b.stay_id).filter(Boolean))];
  const stays = ids.length ? await get(`${U}/rest/v1/stays?id=in.(${ids.map(n => parseInt(n)).join(',')})&select=id,placeid`, headers) : [];
  const zones = new Set();
  for (const s of stays) { const p = placeById.get(parseInt(s.placeid)); if (p && p.zone) zones.add(p.zone); }
  if (stayPlace && stayPlace.zone) zones.add(stayPlace.zone);
  const points = (score[0] && score[0].points) || 0;
  let code = null;
  try {
    const r = await fetch(`${U}/rest/v1/rpc/my_referral_code`, { method: 'POST', headers, body: JSON.stringify({ p_phone: phone }) });
    if (r.ok) { const v = await r.json(); code = typeof v === 'string' ? v : null; }
  } catch (e) { /* referral link is optional */ }
  return { zones, points, code };
}

// Places from valleys this traveller hasn't stamped, in season, quiet, preferring ones with a real host.
function pickNext(zones, bookablePlaceIds, monthIdx, n = 2) {
  const pool = PLACES.filter(p => p.zone && !zones.has(p.zone) && inSeason(p.bestTime, monthIdx) && (p.crowd == null || p.crowd <= 55));
  pool.sort((a, b) => (bookablePlaceIds.has(b.id) - bookablePlaceIds.has(a.id)) || ((a.crowd || 50) - (b.crowd || 50)));
  const out = [], seen = new Set();
  for (const p of pool) { if (seen.has(p.zone)) continue; seen.add(p.zone); out.push(p); if (out.length >= n) break; }
  return out;
}

// ── the four emails ──
function pretripEmail(b, stay, place) {
  const rows = [
    ['Stay', b.stay_name], ['Check-in', `${prettyDate(b.checkin_date)}${stay && stay.checkin_time ? ' · ' + stay.checkin_time : ''}`],
    ...(b.checkout_date ? [['Check-out', `${prettyDate(b.checkout_date)}${stay && stay.checkout_time ? ' · ' + stay.checkout_time : ''}`]] : []),
    ...(stay && stay.address ? [['Address', stay.address]] : []), ['Reference', b.id],
  ].map(([k, v]) => `<tr><td style="padding:5px 0;color:#666;width:95px">${esc(k)}</td><td style="padding:5px 0;font-weight:600">${esc(v)}</td></tr>`).join('');
  return {
    subject: `2 days to go — ${String(b.stay_name || 'your stay').slice(0, 60)} 🎒`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">The hills are getting ready for you</h2>
      <p>Hi ${esc(b.guest || 'traveller')}, your stay starts on <b>${prettyDate(b.checkin_date)}</b>.</p>
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

function thanksEmail(b, place, ctx, next) {
  const v = place && VALLEYS[place.zone];
  const { cur, next: nt } = tierFor(ctx.points);
  return {
    subject: v ? `${v.icon} New stamp in your Pahari Passport — ${v.name}` : `Thank you for travelling with PahariPath 🏔️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">Thank you for staying gently, ${esc((b.guest || 'traveller').split(' ')[0])}</h2>
      <p>Your stay at <b>${esc(b.stay_name)}</b> supported a local family directly. That matters more than you know.</p>
      ${v ? `<div style="background:#f6faf7;border:1px solid #dbe9df;border-radius:12px;padding:14px;margin:14px 0;text-align:center">
        <div style="font-size:12px;letter-spacing:1px;color:#4a7c5f;font-weight:700">PAHARI PASSPORT · ${ctx.zones.size} OF ${VALLEY_COUNT} VALLEYS</div>
        <div style="margin:10px 0">${stampStrip(ctx.zones)}</div>
        <div style="font-size:14px">You collected the <b>${esc(v.name)}</b> stamp ${v.icon}</div></div>` : ''}
      <p style="font-size:14px">🏅 You have <b>${ctx.points} PAHADI points</b>${cur ? ` — <b>${esc(cur.name)}</b>` : ''}.${nt ? ` Just <b>${nt.min - ctx.points}</b> more to reach <b>${esc(nt.name)}</b>.` : ''}</p>
      <p style="margin:16px 0 4px"><b>Two minutes that help a lot</b></p>
      ${btn(`${SITE}/?me=1`, '⭐ Review your host')}
      ${ctx.code ? btn(`${SITE}/?ref=${encodeURIComponent(ctx.code)}`, '🎁 Invite a friend (+100 each)', false) : ''}
      ${next.length ? `<p style="margin:20px 0 2px"><b>Your next stamps</b> — quiet right now, and in season:</p>${suggestionCards(next)}` : ''}`, b.guest_email, true),
  };
}

function nextStampEmail(b, place, ctx, next) {
  const left = VALLEY_COUNT - ctx.zones.size;
  return {
    subject: `${left} valleys still waiting for your stamp 🗺️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">Missing the hills yet?</h2>
      <p>It's been a few weeks since ${place ? esc(place.name) : 'your last trip'}. Your Pahari Passport has <b>${ctx.zones.size} of ${VALLEY_COUNT}</b> stamps.</p>
      <div style="margin:10px 0;text-align:center">${stampStrip(ctx.zones)}</div>
      ${next.length ? `<p style="margin:16px 0 2px">These are quiet and in season this month:</p>${suggestionCards(next)}` : ''}
      <p style="font-size:13px;color:#555;margin-top:14px">Every new valley adds +50 PAHADI points for an offbeat stay, plus points for every night.</p>
      ${btn(`${SITE}/`, 'Find my next valley')}`, b.guest_email, true),
  };
}

function anniversaryEmail(b, place, ctx, next) {
  const name = place ? place.name : (b.stay_name || 'the hills');
  return {
    subject: `A year ago, you were in ${String(name).slice(0, 50)} 🏔️`,
    html: shell(`
      <h2 style="color:#2d5a3d;margin:0 0 6px">One year since ${esc(name)}</h2>
      <p>Around this time last year you stayed at <b>${esc(b.stay_name)}</b>. The same season is coming back to the hills.</p>
      ${place ? `<p>Your host would be glad to see you again — or you could add a new stamp to your Pahari Passport (${ctx.zones.size} of ${VALLEY_COUNT} so far).</p>` : ''}
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
        const ctx = await travellerContext(b.guest_phone, place, headers, U);
        return fn(b, place, ctx, pickNext(ctx.zones, bookablePlaceIds, month));
      }, { marketing: true });
    }
  }
  return stats;
}

module.exports = { runLifecycle, verifyUnsubToken, unsubToken, VALLEYS, inSeason, tierFor, pickNext, pretripEmail, thanksEmail, nextStampEmail, anniversaryEmail };
