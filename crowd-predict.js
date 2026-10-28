/* ════════════════════════════════════════════════════════════════════
   PahariPath — Crowd Prediction Engine  (crowd-predict.js)
   ────────────────────────────────────────────────────────────────────
   Predicts how busy each destination will be on any date, using:
     1. CALENDAR  — weekends, gazetted holidays, long weekends (incl.
                    bridge days), North-India school vacations
     2. SEASON    — what kind of place it is (high pass / mid hills /
                    low-hill temple town) + its bestTime + snowbound months
     3. EVENTS    — HP fairs & festivals (Dussehra, Shivratri, Minjar,
                    Manimahesh Yatra, Navratri at Shakti temples, NYE…)
     4. NEWS      — live headlines from /api/crowd?action=news
                    (tourist rush, snowfall, road closures, weather alerts)

   The place's own `crowd` value (or the admin/host override from
   crowd_overrides) is the BASELINE = a normal in-season day. Everything
   above multiplies that baseline.

   Load BEFORE app.js:  <script src="/crowd-predict.js"></script>

   ✏️ YEARLY UPKEEP: add next year's holidays to HOLIDAYS and next year's
   movable festivals to EVENTS (search "2028" when the time comes).
   Fixed-date items (Republic Day, Aug 15, Oct 2, Christmas, New Year
   rush, school-vacation windows) repeat automatically every year.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────
  // 1. CALENDAR DATA
  // w = how "off" the day is for the North-Indian traveller (1 = full
  // holiday, 0.5 = partial/regional — many but not all people are off)
  // Source: DoPT gazetted list for 2027; 2026 dates from national calendar
  // ─────────────────────────────────────────────────────────────────
  const HOLIDAYS = {
    // ── 2026 (rest of year) ──
    '2026-11-08': { n: 'Diwali', w: 1, diwali: true },
    '2026-11-09': { n: 'Govardhan Puja', w: 0.5 },
    '2026-11-11': { n: 'Bhai Dooj', w: 0.4 },
    '2026-11-24': { n: 'Guru Nanak Jayanti', w: 1, gurpurab: true },
    '2026-12-25': { n: 'Christmas', w: 1 },
    // ── 2027 (DoPT gazetted) ──
    '2027-01-01': { n: 'New Year', w: 0.6 },
    '2027-01-26': { n: 'Republic Day', w: 1 },
    '2027-03-06': { n: 'Maha Shivratri', w: 0.5 },
    '2027-03-10': { n: 'Id-ul-Fitr', w: 1 },
    '2027-03-23': { n: 'Holi', w: 1 },
    '2027-03-26': { n: 'Good Friday', w: 1 },
    '2027-04-15': { n: 'Ram Navami', w: 1 },
    '2027-04-19': { n: 'Mahavir Jayanti', w: 1 },
    '2027-05-17': { n: 'Bakrid', w: 1 },
    '2027-05-20': { n: 'Buddha Purnima', w: 1 },
    '2027-06-16': { n: 'Muharram', w: 1 },
    '2027-08-15': { n: 'Independence Day', w: 1 },
    '2027-08-25': { n: 'Janmashtami', w: 1 },
    '2027-10-02': { n: 'Gandhi Jayanti', w: 1 },
    '2027-10-09': { n: 'Dussehra', w: 1 },
    '2027-10-29': { n: 'Diwali', w: 1, diwali: true },
    '2027-11-14': { n: 'Guru Nanak Jayanti', w: 1, gurpurab: true },
    '2027-12-25': { n: 'Christmas', w: 1 },
  };
  // Fixed-date holidays used automatically for any year not listed above
  const FIXED_HOLIDAYS = {
    '01-01': { n: 'New Year', w: 0.6 }, '01-26': { n: 'Republic Day', w: 1 },
    '08-15': { n: 'Independence Day', w: 1 }, '10-02': { n: 'Gandhi Jayanti', w: 1 },
    '12-25': { n: 'Christmas', w: 1 },
  };
  const HOLIDAY_YEARS = new Set(Object.keys(HOLIDAYS).map(k => +k.slice(0, 4)));

  // North-India school vacations (Delhi / Punjab / Haryana / Chandigarh).
  // Families are a core PahariPath segment — weekdays get busier too.
  // mmdd ranges repeat every year; u = weekday uplift.
  const SCHOOL_BREAKS = [
    { from: '05-11', to: '05-31', u: 0.10, n: 'School summer holidays starting (Delhi)' },
    { from: '06-01', to: '06-30', u: 0.20, n: 'School summer holidays (Delhi, Punjab, Haryana)' },
    { from: '12-24', to: '12-31', u: 0.15, n: 'School winter break (Punjab, Haryana)' },
    { from: '01-01', to: '01-15', u: 0.12, n: 'School winter break (Delhi)' },
  ];

  // ─────────────────────────────────────────────────────────────────
  // 2. EVENTS — fairs, festivals, pilgrimages
  // match: which places (by name regex, zone, or a predicate)
  // m: multiplier at the place (damped for remote places elsewhere)
  // yearly: true → from/to are MM-DD and repeat every year
  // ─────────────────────────────────────────────────────────────────
  const SHAKTI = /devi|chintpurni|jawalamukhi|chamunda|brajeshwari|bajreshwari|mata/i;
  const EVENTS = [
    // Christmas → New Year hill-station rush (every year)
    { yearly: true, from: '12-23', to: '12-29', icon: '🎄', n: 'Christmas–New Year holiday rush', m: 1.3, match: (p, t, closed) => t.type === 'mid' && !closed },
    { yearly: true, from: '12-30', to: '12-31', icon: '🎆', n: 'New Year\'s Eve rush', m: 1.5, match: (p, t, closed) => t.type === 'mid' && !closed },
    { yearly: true, from: '01-01', to: '01-02', icon: '🎆', n: 'New Year rush', m: 1.35, match: (p, t, closed) => t.type === 'mid' && !closed },
    // Gurpurab — Sikh pilgrimage sites
    { dates: ['2026-11-24', '2027-11-14'], icon: '🙏', n: 'Gurpurab pilgrims', m: 1.4, match: /manikaran|paonta/i },
    // Manali Winter Carnival (approx. dates)
    { from: '2027-01-02', to: '2027-01-06', icon: '🎭', n: 'Manali Winter Carnival (approx. dates)', m: 1.15, match: /manali|solang|vashisht/i },
    // International Shivratri Fair, Mandi
    { from: '2027-03-06', to: '2027-03-12', icon: '🔱', n: 'Mandi Shivratri Fair', m: 1.25, match: { zone: 'mandi' } },
    // Sujanpur Holi fair, Hamirpur
    { from: '2027-03-21', to: '2027-03-24', icon: '🎨', n: 'Sujanpur Holi Fair', m: 1.8, match: /sujanpur/i },
    { from: '2027-03-21', to: '2027-03-24', icon: '🎨', n: 'Holi fair season', m: 1.12, match: { zone: 'hamirpur' } },
    // Chaitra month — Baba Balak Nath peak
    { from: '2027-03-14', to: '2027-04-13', icon: '🛕', n: 'Chaitra mela at Baba Balak Nath', m: 1.4, match: /balak nath/i },
    // Chaitra Navratri — Shakti temples (ends on Ram Navami 15 Apr)
    { from: '2027-04-07', to: '2027-04-15', icon: '🛕', n: 'Chaitra Navratri pilgrims', m: 1.6, match: SHAKTI },
    // Minjar Mela, Chamba (approx. dates)
    { from: '2027-07-25', to: '2027-08-01', icon: '🌾', n: 'Minjar Mela, Chamba (approx. dates)', m: 1.5, match: /chamba town/i },
    { from: '2027-07-25', to: '2027-08-01', icon: '🌾', n: 'Minjar Mela season', m: 1.12, match: { zone: 'chamba' } },
    // Manimahesh Yatra — Janmashtami to Radhashtami (approx.)
    { from: '2027-08-25', to: '2027-09-08', icon: '🔱', n: 'Manimahesh Yatra (approx. dates)', m: 1.9, match: /manimahesh/i },
    { from: '2027-08-25', to: '2027-09-08', icon: '🔱', n: 'Manimahesh Yatra pilgrims passing through', m: 1.5, match: /bharmour/i },
    // Sharad Navratri — Shakti temples (Dussehra 9 Oct 2027)
    { from: '2027-09-30', to: '2027-10-08', icon: '🛕', n: 'Sharad Navratri pilgrims', m: 1.6, match: SHAKTI },
    // Kullu Dussehra — 7 days from Vijayadashami
    { from: '2027-10-09', to: '2027-10-15', icon: '🎉', n: 'Kullu Dussehra', m: 1.8, match: /kullu town/i },
    { from: '2027-10-09', to: '2027-10-15', icon: '🎉', n: 'Kullu Dussehra crowds in the valley', m: 1.2, match: { zone: 'kullu' } },
  ];

  // ─────────────────────────────────────────────────────────────────
  // 3. SEASON PROFILES — monthly demand index by place type (Jan..Dec)
  //   high : passes, Spiti/Lahaul, >3000m — summer only
  //   mid  : classic hill destinations — summer escape + Oct + snow/NYE
  //   low  : low-hill temple/fort towns (<1300m) — winter & festival
  //          season, quiet in summer heat & monsoon
  // ─────────────────────────────────────────────────────────────────
  const PROFILE = {
    high: [0.15, 0.15, 0.2, 0.3, 0.65, 1.15, 1.0, 0.95, 1.0, 0.65, 0.25, 0.15],
    mid:  [0.95, 0.7, 0.8, 0.95, 1.2, 1.3, 0.72, 0.68, 0.82, 1.0, 0.82, 1.0],
    low:  [1.0, 0.95, 1.0, 0.9, 0.72, 0.75, 0.72, 0.8, 0.85, 1.05, 1.0, 1.0],
  };
  const SNOW_BOOST = { 11: 1.15, 0: 1.15, 1: 0.95 }; // Dec, Jan, Feb for snow destinations

  // Hour-of-day curve for "right now" (softened: hotels still hold people at night)
  const HOUR = [.25, .22, .2, .2, .22, .28, .38, .52, .68, .82, .92, .98, 1, .98, .95, .9, .82, .72, .6, .5, .42, .36, .32, .28];

  // ─────────────────────────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────────────────────────
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const mmdd = d => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dayOnly = d => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const toDate = d => {
    if (d instanceof Date) return dayOnly(d);
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, 12); }
    return dayOnly(d ? new Date(d) : new Date());
  };
  const inMMDD = (d, from, to) => { const k = mmdd(d); return from <= to ? (k >= from && k <= to) : (k >= from || k <= to); };
  const fmt = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  // "Mar–Jun, Sep–Nov" / "Oct (Dussehra), Mar–Jun" / "Oct–Mar" → Set of month idx
  function parseBest(str) {
    const months = new Set();
    let snow = false;
    if (!str || /year|all/i.test(str)) { for (let i = 0; i < 12; i++) months.add(i); return { months, snow, any: true }; }
    if (/snow/i.test(str)) snow = true;
    const clean = str.replace(/\([^)]*\)/g, '');
    clean.split(',').forEach(part => {
      const tok = part.trim().toLowerCase().split(/\s*[–—-]\s*/).map(t => MONTHS[t.slice(0, 3)]).filter(v => v !== undefined);
      if (tok.length === 1) months.add(tok[0]);
      else if (tok.length >= 2) { let m = tok[0]; for (let i = 0; i < 12; i++) { months.add(m); if (m === tok[1]) break; m = (m + 1) % 12; } }
    });
    // months listed only with "(snow)" also count as snow months
    const snowMonths = new Set();
    (str.match(/([A-Za-z]{3}[^,(]*)\(snow\)/gi) || []).forEach(seg => {
      const tok = seg.replace(/\(snow\)/i, '').trim().toLowerCase().split(/\s*[–—-]\s*/).map(t => MONTHS[t.slice(0, 3)]).filter(v => v !== undefined);
      if (tok.length === 1) snowMonths.add(tok[0]);
      else if (tok.length >= 2) { let m = tok[0]; for (let i = 0; i < 12; i++) { snowMonths.add(m); if (m === tok[1]) break; m = (m + 1) % 12; } }
    });
    return { months, snow, snowMonths, any: months.size === 0 };
  }

  // Precompute static traits once per place (cached on a hidden key)
  function traits(p) {
    const sig = `${p.bestTime}|${p.altitude}|${p.zone}`;
    if (p.__pp && p.__pp.sig === sig) return p.__pp;
    const alt = parseInt(String(p.altitude || '').replace(/[^0-9]/g, ''), 10) || 1500;
    const best = parseBest(p.bestTime);
    let type = 'mid';
    if (alt >= 3000 || p.zone === 'spiti') type = 'high';
    else if (alt < 1300) type = 'low';
    const t = { sig, alt, best, type, nameRe: null };
    try { t.nameRe = new RegExp(`\\b${String(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'); } catch (e) { /* ignore */ }
    Object.defineProperty(p, '__pp', { value: t, writable: true, configurable: true, enumerable: false });
    return t;
  }

  // ─────────────────────────────────────────────────────────────────
  // 4. CALENDAR ENGINE — what kind of day is it?
  // ─────────────────────────────────────────────────────────────────
  function holidayOf(d) {
    const k = keyOf(d);
    if (HOLIDAYS[k]) return HOLIDAYS[k];
    if (!HOLIDAY_YEARS.has(d.getFullYear())) return FIXED_HOLIDAYS[mmdd(d)] || null;
    return null;
  }
  // off-weight of a single day before bridge logic (0..1)
  function offWeight(d) {
    const dow = d.getDay();
    const h = holidayOf(d);
    if (dow === 0 || dow === 6) return 1;
    return h ? h.w : 0;
  }

  const _dayCache = new Map();
  function dayInfo(dateLike) {
    const d = toDate(dateLike);
    const k = keyOf(d);
    if (_dayCache.has(k)) return _dayCache.get(k);

    const dow = d.getDay();
    const hol = holidayOf(d);
    let w = offWeight(d);
    let bridge = false;
    // bridge day: a working day squeezed between two off days → people take leave
    if (w < 0.5) {
      const prev = offWeight(addDays(d, -1)), next = offWeight(addDays(d, 1));
      const holidayNear = (holidayOf(addDays(d, -1)) || holidayOf(addDays(d, 1)));
      if (prev >= 0.5 && next >= 0.5 && holidayNear) { bridge = true; w = 0.6; }
    }
    // find the run of consecutive off days this date belongs to
    let run = null;
    if (w >= 0.4) {
      const isOff = x => {
        let ww = offWeight(x);
        if (ww < 0.5) {
          const p = offWeight(addDays(x, -1)), n = offWeight(addDays(x, 1));
          if (p >= 0.5 && n >= 0.5 && (holidayOf(addDays(x, -1)) || holidayOf(addDays(x, 1)))) ww = 0.6;
        }
        return ww >= 0.4;
      };
      let s = d, e = d;
      while (isOff(addDays(s, -1))) s = addDays(s, -1);
      while (isOff(addDays(e, 1))) e = addDays(e, 1);
      const len = Math.round((e - s) / 864e5) + 1;
      const names = [];
      let strength = 0, hasBridge = false;
      for (let x = s; x <= e; x = addDays(x, 1)) {
        const h = holidayOf(x);
        if (h && !names.includes(h.n)) names.push(h.n);
        const ow = offWeight(x);
        strength += ow >= 0.5 ? Math.min(1, ow) : 0.6;
        if (ow < 0.5) hasBridge = true;
      }
      run = { start: s, end: e, len, names, strength: strength / len, hasBridge, isLong: len >= 3 && names.length > 0 };
    }

    // school vacations
    const school = SCHOOL_BREAKS.find(b => inMMDD(d, b.from, b.to)) || null;

    // base day multiplier
    let m, label = null, icon = '📅';
    if (run && run.isLong) {
      const pos = keyOf(d) === keyOf(run.start) ? 'first' : keyOf(d) === keyOf(run.end) ? 'last' : 'mid';
      const peak = run.len >= 4 ? 1.55 : 1.45;
      m = pos === 'first' ? 1.38 : pos === 'last' ? 1.15 : peak;
      m = 1 + (m - 1) * clamp(run.strength, 0.6, 1);
      label = `Long weekend · ${run.names.join(' + ')}`;
    } else if (dow === 6) { m = 1.25; label = 'Saturday'; }
    else if (dow === 0) { m = 1.1; label = 'Sunday'; }
    else if (hol && hol.w >= 0.9) { m = 1.12; label = hol.n + ' holiday'; }
    else if (dow === 5) { m = 0.95; label = null; }
    else { m = 0.86; label = 'Weekday'; icon = '🗓'; }

    // evening-before departures: weekday just before a long weekend
    if (!(run && run.isLong) && dow >= 1 && dow <= 5) {
      const nxt = dayInfoLite(addDays(d, 1));
      if (nxt) { m = Math.max(m, 1.0); label = 'Eve of long weekend — arrivals begin'; icon = '🚗'; }
    }
    // Diwali day itself — people celebrate at home
    if (hol && hol.diwali) { m = 0.8; label = 'Diwali — most people celebrate at home'; icon = '🪔'; }

    const info = { date: d, key: k, dow, holiday: hol, bridge, run, school, m, label, icon };
    _dayCache.set(k, info);
    return info;
  }
  // cheap check: does a long weekend START on this date?
  function dayInfoLite(d) {
    if (offWeight(d) < 0.5 && !holidayOf(d)) return null;
    const di = dayInfo(d);
    return di.run && di.run.isLong && keyOf(di.run.start) === keyOf(d) ? di : null;
  }

  // ─────────────────────────────────────────────────────────────────
  // 5. NEWS LAYER
  // ─────────────────────────────────────────────────────────────────
  let NEWS = [];
  let NEWS_LOADED_AT = null;
  const NEWS_EFFECT = {
    rush:    { place: 1.30, zone: 1.15, icon: '📰', verb: 'Tourist rush reported' },
    event:   { place: 1.20, zone: 1.10, icon: '📰', verb: 'Festival / fair in the news' },
    snowfall:{ place: 1.20, zone: 1.15, icon: '❄️', verb: 'Fresh snowfall — snow-seekers heading up' },
    closure: { place: 0.55, zone: 0.78, icon: '🚧', verb: 'Road closure / landslide reported' },
    weather: { place: 0.85, zone: 0.88, icon: '⛈', verb: 'Weather alert' },
  };
  function newsWeight(item, target) {
    const pub = new Date(item.publishedAt).getTime();
    if (!pub) return 0;
    const hrs = (target.getTime() + 6 * 36e5 - pub) / 36e5; // target ≈ 6pm of that day
    if (hrs < 0) return 0;          // news is from after this date
    if (hrs <= 30) return 1;
    if (hrs <= 54) return 0.6;
    if (hrs <= 78) return 0.3;
    return 0;
  }
  function newsMatchesPlace(item, p) {
    const t = traits(p);
    const direct = t.nameRe && t.nameRe.test(item.title);
    const zone = (item.zones || []).includes(p.zone);
    return direct ? 'place' : zone ? 'zone' : null;
  }
  function newsFactor(p, d) {
    const t = traits(p);
    let m = 1;
    const used = [];
    for (const it of NEWS) {
      const w = newsWeight(it, d);
      if (!w) continue;
      const where = newsMatchesPlace(it, p);
      if (!where) continue;
      for (const kind of it.kinds || []) {
        const eff = NEWS_EFFECT[kind];
        if (!eff) continue;
        let mm = eff[where];
        if (kind === 'snowfall') {
          // snow pulls people to reachable snow spots, but pushes them away from high passes
          if (t.alt >= 3500) mm = 0.7;
          else if (!(t.best.snow || (t.alt >= 2000 && t.type === 'mid'))) continue;
        }
        m *= 1 + (mm - 1) * w;
        used.push({ item: it, kind, where, mm });
      }
    }
    return { m: clamp(m, 0.45, 1.5), used };
  }

  // ─────────────────────────────────────────────────────────────────
  // 6. THE PREDICTOR
  // ─────────────────────────────────────────────────────────────────
  function eventMatches(ev, p, t, closed) {
    if (ev.match instanceof RegExp) return ev.match.test(p.name);
    if (typeof ev.match === 'function') return ev.match(p, t, closed);
    if (ev.match && ev.match.zone) return p.zone === ev.match.zone;
    return false;
  }
  function eventActive(ev, d) {
    if (ev.dates) return ev.dates.includes(keyOf(d));
    if (ev.yearly) return inMMDD(d, ev.from, ev.to);
    const k = keyOf(d);
    return k >= ev.from && k <= ev.to;
  }

  /**
   * predict(place, date?, opts?)
   *   → { value, level, factors:[{icon,text,m,dir}], closed, news:[…], day }
   * value is the expected daytime crowd 0–100 for that date.
   */
  function predict(p, dateLike, opts) {
    opts = opts || {};
    const d = toDate(dateLike);
    const t = traits(p);
    const base = Math.max(1, +p.crowd || 20);
    const month = d.getMonth();
    const factors = [];
    const push = (icon, text, m) => { if (Math.abs(m - 1) >= 0.04) factors.push({ icon, text, m, dir: m > 1 ? 'up' : 'down' }); };

    // how strongly calendar swings affect this place (remote places swing less)
    const k = 0.4 + 0.6 * Math.min(1, base / 60);
    const damp = m => 1 + (m - 1) * k;

    // ── season ──
    let season = PROFILE[t.type][month];
    if (t.best.snow && SNOW_BOOST[month] !== undefined && t.type !== 'high') season = Math.max(season, SNOW_BOOST[month]);
    const inBest = t.best.any || t.best.months.has(month);
    // high & remote places: outside their window they are often snowbound
    const winterish = [10, 11, 0, 1, 2, 3].includes(month);
    let closed = false;
    const routeSensitive = t.alt >= 4300 || /pass|lake|tal\b|kund|peak|trek|bridge|yatra/i.test(p.name) || (p.vibes || []).includes('trek');
    if (t.alt >= 3500 && routeSensitive && !inBest && winterish) { closed = true; season = 0.12; }
    // offbeat places: bestTime ≈ when people actually go
    if (!closed && base < 45 && !t.best.any) season *= inBest ? 1.05 : 0.85;

    if (closed) push('❄️', 'Snowbound season — access usually closed', season);
    else if (season >= 1.12) push(t.best.snow && SNOW_BOOST[month] ? '🏂' : '🌸', t.best.snow && SNOW_BOOST[month] ? 'Snow season — peak demand' : (t.type === 'low' ? 'Peak pilgrimage / winter season' : 'Peak tourist season'), season);
    else if (season <= 0.78) push(month >= 6 && month <= 8 && t.type !== 'high' ? '🌧' : '🍂', month >= 6 && month <= 8 && t.type !== 'high' ? 'Monsoon — low season' : (t.type === 'low' && (month === 4 || month === 5) ? 'Summer heat — low season here' : inBest ? 'Shoulder season — few visitors' : 'Off season'), season);

    // ── day type (weekend / long weekend / weekday) ──
    const di = dayInfo(d);
    let dayM = damp(di.m);
    if (closed) dayM = 1 + (dayM - 1) * 0.2;
    if (di.label) push(di.icon, di.label, dayM);

    // ── school vacations ──
    let schoolM = 1;
    if (di.school && !closed && t.type !== 'low') {
      const isWknd = di.dow === 0 || di.dow === 6 || (di.run && di.run.isLong);
      schoolM = damp(1 + di.school.u * (isWknd ? 0.4 : 1));
      push('🎒', di.school.n, schoolM);
    }

    // ── festivals / fairs ──
    let eventM = 1;
    for (const ev of EVENTS) {
      if (!eventActive(ev, d) || !eventMatches(ev, p, t, closed)) continue;
      // direct-name events hit fully; zone/predicate-wide ones are damped by remoteness
      const direct = ev.match instanceof RegExp;
      const mm = direct ? ev.m : damp(ev.m);
      eventM *= mm;
      push(ev.icon, ev.n, mm);
    }

    // ── news ──
    const nf = opts.noNews ? { m: 1, used: [] } : newsFactor(p, d);
    if (nf.used.length) {
      const top = nf.used.slice().sort((x, y) => Math.abs(Math.log(y.mm)) - Math.abs(Math.log(x.mm)))[0];
      const eff = NEWS_EFFECT[top.kind];
      const verb = top.kind === 'snowfall' && top.mm < 1 ? 'Fresh snowfall — high routes may close' : eff.verb;
      push(eff.icon, `${verb}${top.where === 'place' ? ' here' : ' in the area'}`, nf.m);
    }

    const mult = season * dayM * schoolM * eventM * nf.m;
    let value = base * mult;
    // soft ceiling: above 70 the scale compresses instead of flat-lining at
    // 97, so a packed long weekend still reads busier than a normal Saturday
    if (value > 70) value = 70 + 27 * (1 - Math.exp(-(value - 70) / 30));
    value = clamp(value, 3, Math.max(base * 2, base + 30));
    if (closed) value = Math.min(value, 6);
    value = Math.round(value);

    factors.sort((a, b) => Math.abs(Math.log(b.m)) - Math.abs(Math.log(a.m)));
    return {
      value,
      level: value >= 80 ? 'Very Crowded' : value >= 60 ? 'Crowded' : value >= 40 ? 'Moderate' : value >= 20 ? 'Quiet' : 'Very Quiet',
      factors: factors.slice(0, 4),
      closed,
      inSeason: inBest && !closed,
      news: nf.used.map(u => u.item).filter((v, i, a) => a.indexOf(v) === i),
      day: di,
      base,
    };
  }

  // "right now" = day prediction × time-of-day curve (softened)
  const _nowCache = new Map();
  function now(p, at) {
    const d = at ? new Date(at) : new Date();
    const ck = at ? null : `${p.id}|${p.crowd}|${d.getHours()}|${keyOf(d)}|${NEWS_LOADED_AT ? NEWS_LOADED_AT.getTime() : 0}`;
    if (ck && _nowCache.has(ck)) return _nowCache.get(ck);
    const r = predict(p, d);
    const h = 0.55 + 0.45 * HOUR[d.getHours()];
    const out = Object.assign({}, r, { value: Math.max(3, Math.round(r.value * h)), dayValue: r.value });
    if (ck) { if (_nowCache.size > 2000) _nowCache.clear(); _nowCache.set(ck, out); }
    return out;
  }

  // average for a weekday within a month (for the heatmap). dowMon: 0=Mon..6=Sun
  function monthDowAvg(p, month, dowMon, monthOffset) {
    const today = new Date();
    const year = today.getFullYear() + (today.getMonth() + (monthOffset || 0) >= 12 ? 1 : 0);
    const jsDow = (dowMon + 1) % 7;
    let sum = 0, n = 0;
    for (let day = 1; day <= 31; day++) {
      const d = new Date(year, month, day, 12);
      if (d.getMonth() !== month) break;
      if (d.getDay() !== jsDow) continue;
      sum += predict(p, d).value; n++;
    }
    return n ? Math.round(sum / n) : Math.round(+p.crowd || 20);
  }

  // busiest day of a holiday run (skips e.g. Diwali day itself)
  function peakOf(run) {
    let best = run.start, bm = -1;
    for (let x = run.start; x <= run.end; x = addDays(x, 1)) { const m = dayInfo(x).m; if (m > bm) { bm = m; best = x; } }
    return best;
  }

  // upcoming long weekends from a date
  function upcomingLongWeekends(fromLike, withinDays) {
    const from = toDate(fromLike);
    const out = [];
    const seen = new Set();
    for (let i = 0; i <= (withinDays || 45); i++) {
      const di = dayInfo(addDays(from, i));
      if (di.run && di.run.isLong && !seen.has(keyOf(di.run.start))) {
        seen.add(keyOf(di.run.start));
        out.push({ start: di.run.start, end: di.run.end, len: di.run.len, names: di.run.names, hasBridge: di.run.hasBridge,
          label: `${fmt(di.run.start)} – ${fmt(di.run.end)}`, peakDay: peakOf(di.run) });
      }
    }
    return out;
  }

  // ─────────────────────────────────────────────────────────────────
  // 7. NEWS LOADING
  // ─────────────────────────────────────────────────────────────────
  function setNews(items) {
    NEWS = Array.isArray(items) ? items.filter(it => it && it.title && it.publishedAt) : [];
    NEWS_LOADED_AT = new Date();
  }
  async function loadNews() {
    try {
      const r = await fetch('/api/crowd?action=news', { headers: { Accept: 'application/json' } });
      if (!r.ok) return false;
      const j = await r.json();
      setNews(j.items || []);
      return NEWS.length > 0;
    } catch (e) { return false; }
  }
  function newsFor(p, limit) {
    const out = [];
    for (const it of NEWS) { if (newsMatchesPlace(it, p)) out.push(it); }
    out.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
    return out.slice(0, limit || 3);
  }
  function ago(iso) {
    const h = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 36e5));
    return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  }

  // ─────────────────────────────────────────────────────────────────
  // 8. SMALL UI HELPERS (used by app.js)
  // ─────────────────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lvlColor = v => v >= 70 ? '#c0392b' : v >= 45 ? '#b07d2a' : '#2d8a4e';

  // "Why this crowd level?" block on the place detail panel
  function renderWhy(p) {
    const host = document.getElementById('pdcpct');
    if (!host) return;
    const box = host.closest('.pd-box') || host.parentElement;
    let el = document.getElementById('pdwhy');
    if (!el) { el = document.createElement('div'); el.id = 'pdwhy'; box.appendChild(el); }
    const r = predict(p, new Date());
    const chips = r.factors.map(f => `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:3px 8px;border-radius:12px;margin:0 4px 4px 0;background:${f.dir === 'up' ? '#fdf0ec' : '#eaf5ee'};color:${f.dir === 'up' ? '#a8401f' : '#1e6b3e'}">${f.icon} ${esc(f.text)} ${f.dir === 'up' ? '↑' : '↓'}</span>`).join('');
    const news = newsFor(p, 3);
    const newsHtml = news.length ? `<div style="margin-top:8px;font-size:11px;font-weight:700;color:var(--stone);text-transform:uppercase;letter-spacing:.05em">In the news</div>` +
      news.map(n => `<a href="${esc(n.url)}" target="_blank" rel="noopener nofollow" style="display:block;font-size:12px;color:var(--ink);text-decoration:none;padding:5px 0;border-bottom:1px solid #f0f0ee">${(n.kinds || []).includes('closure') ? '🚧' : (n.kinds || []).includes('snowfall') ? '❄️' : (n.kinds || []).includes('weather') ? '⛈' : '📰'} ${esc(n.title)} <span style="color:var(--stone);font-size:10.5px">· ${esc(n.source || '')} · ${ago(n.publishedAt)}</span></a>`).join('') : '';
    const lw = upcomingLongWeekends(new Date(), 21).filter(w => w.start > new Date())[0];
    let lwHtml = '';
    if (lw) {
      const pv = predict(p, lw.peakDay);
      lwHtml = `<div style="margin-top:8px;font-size:12px;color:var(--stone)">📅 Next long weekend <b style="color:var(--ink)">${lw.label}</b>: expect <b style="color:${lvlColor(pv.value)}">${pv.value}% · ${pv.level}</b> here</div>`;
    }
    el.innerHTML = `<div style="margin-top:10px">${chips || '<span style="font-size:11px;color:var(--stone)">A typical day for this place</span>'}</div>${dayStripHtml(p)}${lwHtml}${newsHtml}
      <div style="margin-top:6px;font-size:10px;color:var(--stone);opacity:.8">Predicted from calendar, season, local festivals${NEWS.length ? ' &amp; today\'s news' : ''}${p.crowdNote ? ' + host report' : ''}</div>`;
    wireDayStrip(p);
  }

  // ── 14-day tappable strip: pick a day, see its crowd and why ──
  function dayStripHtml(p) {
    const today = dayOnly(new Date());
    const days = [];
    let best = 0;
    for (let i = 0; i < 14; i++) {
      const d = addDays(today, i);
      const r = predict(p, d, { noNews: i > 2 });
      days.push({ d, r });
      if (r.value < days[best].r.value) best = i;
    }
    const btn = (x, i) => {
      const h = Math.max(6, Math.round(x.r.value * 0.34));
      const lw = x.r.day.run && x.r.day.run.isLong;
      return `<button type="button" data-ppday="${i}" aria-label="${esc(fmt(x.d))}: ${x.r.value}% ${esc(x.r.level)}" style="flex:1 0 0;min-width:0;border:none;background:transparent;padding:4px 0 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px;border-radius:8px">
        <span style="display:flex;align-items:flex-end;height:34px"><span style="display:block;width:14px;height:${h}px;border-radius:3px;background:${lvlColor(x.r.value)};opacity:.85"></span></span>
        <span style="font-size:9.5px;font-weight:${i === 0 ? 700 : 500};color:${lw ? '#a8401f' : 'var(--stone)'}">${i === 0 ? 'Today' : x.d.toLocaleDateString('en-IN', { weekday: 'narrow' }) + x.d.getDate()}</span>
      </button>`;
    };
    return `<div style="margin-top:12px">
      <div style="font-size:11px;font-weight:700;color:var(--stone);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Pick a day · next 2 weeks</div>
      <div id="ppDayStrip" style="display:flex;gap:2px">${days.map(btn).join('')}</div>
      <div id="ppDayInfo" data-best="${best}" style="font-size:12px;margin-top:6px;min-height:34px"></div>
    </div>`;
  }
  function wireDayStrip(p) {
    const strip = document.getElementById('ppDayStrip');
    const info = document.getElementById('ppDayInfo');
    if (!strip || !info) return;
    const today = dayOnly(new Date());
    const best = +info.dataset.best || 0;
    const show = i => {
      const d = addDays(today, i);
      const r = predict(p, d, { noNews: i > 2 });
      strip.querySelectorAll('button').forEach((b, j) => { b.style.background = j === i ? '#eef3ef' : 'transparent'; b.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
      const why = r.factors.filter(f => f.icon !== '🗓').slice(0, 2).map(f => `${f.icon} ${esc(f.text)}`).join(' · ');
      info.innerHTML = `<b>${esc(fmt(d))}</b>: <b style="color:${lvlColor(r.value)}">${r.value}% · ${r.level}</b>${i === best ? ' <span style="color:#1e6b3e;font-weight:700">· quietest day</span>' : ''}${why ? `<div style="color:var(--stone);margin-top:2px">${why}</div>` : ''}`;
    };
    strip.addEventListener('click', e => { const b = e.target.closest('button[data-ppday]'); if (b) show(+b.dataset.ppday); });
    show(best);
  }

  // ── Crowd meter time switch: Right now / This weekend / Next long weekend ──
  const VIEW = { mode: 'now', date: null, label: '' };
  function viewOptions() {
    const today = dayOnly(new Date());
    const dow = today.getDay();
    const sat = dow === 6 || dow === 0 ? today : addDays(today, 6 - dow);
    const opts = [{ mode: 'now', label: 'Right now', date: null }, { mode: 'weekend', label: dow === 0 ? 'Today (Sunday)' : 'This weekend', date: sat }];
    const lw = upcomingLongWeekends(today, 60).filter(w => w.end >= today)[0];
    if (lw) opts.push({ mode: 'lw', label: 'Next long weekend', date: lw.peakDay, sub: lw.label });
    return opts;
  }
  function current(p) {
    if (VIEW.mode === 'now' || !VIEW.date) return now(p).value;
    return predict(p, VIEW.date).value;
  }
  // sort key for "quietest first" lists: closed & off-season places sink to the bottom
  function sortKey(p) {
    const r = predict(p, VIEW.date || new Date());
    return current(p) + (r.closed ? 200 : r.inSeason ? 0 : 60);
  }
  function setView(mode) {
    const o = viewOptions().find(x => x.mode === mode) || viewOptions()[0];
    VIEW.mode = o.mode; VIEW.date = o.date; VIEW.label = o.date ? fmt(o.date) : '';
    try { typeof renderCrowd === 'function' && renderCrowd(); } catch (e) { /* ignore */ }
    try { typeof renderMap === 'function' && renderMap(); } catch (e) { /* ignore */ }
  }
  function renderTimeSwitch() {
    const grid = document.getElementById('cgrid');
    if (!grid) return;
    let el = document.getElementById('ppTime');
    if (!el) { el = document.createElement('div'); el.id = 'ppTime'; grid.parentNode.insertBefore(el, document.getElementById('ppLW') || grid); }
    const opts = viewOptions();
    if (!opts.some(o => o.mode === VIEW.mode)) { VIEW.mode = 'now'; VIEW.date = null; }
    el.innerHTML = `<div role="group" aria-label="Show crowd for" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px">
      ${opts.map(o => `<button type="button" aria-pressed="${VIEW.mode === o.mode}" onclick="PP_CROWD.setView('${o.mode}')" style="min-height:40px;padding:8px 14px;border-radius:20px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid ${VIEW.mode === o.mode ? 'var(--pine)' : 'rgba(74,124,95,.25)'};background:${VIEW.mode === o.mode ? 'var(--pine)' : '#fff'};color:${VIEW.mode === o.mode ? '#fff' : 'var(--ink)'}">${o.label}${o.sub ? ` <span style="font-weight:400;opacity:.8">· ${esc(o.sub)}</span>` : ''}</button>`).join('')}
      ${VIEW.date ? `<span style="font-size:12px;color:var(--stone)">Forecast for ${esc(VIEW.label)}</span>` : ''}
    </div>`;
  }

  // Long-weekend heads-up above the crowd meter list
  function renderLWBanner() {
    const grid = document.getElementById('cgrid');
    if (!grid || typeof ALL === 'undefined') return;
    renderTimeSwitch();
    let el = document.getElementById('ppLW');
    const lw = upcomingLongWeekends(new Date(), 30).filter(w => w.end >= dayOnly(new Date()))[0];
    if (!lw) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'ppLW'; grid.parentNode.insertBefore(el, grid); }
    const stayIds = (typeof STAYS !== 'undefined' && Array.isArray(STAYS)) ? new Set(STAYS.map(s => s.placeid)) : new Set();
    const scored = ALL.map(p => ({ p, r: predict(p, lw.peakDay) }));
    const busy = scored.slice().sort((a, b) => b.r.value - a.r.value).slice(0, 3);
    // quiet picks must be in their own good season — no snowed-in lakes in November
    const quiet = scored.filter(x => x.r.inSeason && x.r.value < 35 && traits(x.p).alt < 3200)
      .sort((a, b) => (stayIds.has(b.p.id) - stayIds.has(a.p.id)) || (a.r.value - b.r.value)).slice(0, 4);
    const pill = x => `<span onclick="openPD(${x.p.id})" style="cursor:pointer;display:inline-block;font-size:12px;padding:4px 10px;border-radius:14px;margin:3px 4px 0 0;background:#fff;border:1px solid rgba(74,124,95,.25)">${x.p.emoji || '📍'} ${esc(x.p.name)} <b style="color:${lvlColor(x.r.value)}">${x.r.value}%</b>${stayIds.has(x.p.id) ? ' 🏡' : ''}</span>`;
    const isNow = lw.start <= dayOnly(new Date());
    el.innerHTML = `<div style="background:#fdf6ea;border:1px solid #f0dcb4;border-radius:12px;padding:12px 14px;margin:0 0 14px">
      <div style="font-size:13px;font-weight:700;color:#7a5410">📅 ${isNow ? 'Long weekend on now' : 'Long weekend ahead'}: ${lw.label} <span style="font-weight:500">· ${esc(lw.names.join(' + '))}${lw.hasBridge ? ' (with a bridge day)' : ''}</span></div>
      <div style="font-size:12px;color:#7a5410;margin-top:6px">Expect packed roads at: ${busy.map(pill).join('')}</div>
      ${quiet.length ? `<div style="font-size:12px;color:#1e6b3e;margin-top:6px">Go quiet instead: ${quiet.map(pill).join('')}</div>` : ''}
    </div>`;
  }

  // Short list of upcoming crowd drivers for the 4-week forecast tab
  function forecastNotes(p) {
    const today = dayOnly(new Date());
    const notes = [];
    const seen = new Set();
    for (let i = 0; i < 28; i++) {
      const d = addDays(today, i);
      const r = predict(p, d, { noNews: i > 2 });
      r.factors.forEach(f => {
        if (f.icon === '🗓' || f.text === 'Saturday' || f.text === 'Sunday' || seen.has(f.text)) return;
        if (Math.abs(f.m - 1) < 0.08) return;
        seen.add(f.text);
        notes.push(`<div style="font-size:12px;padding:4px 0;color:${f.dir === 'up' ? '#a8401f' : '#1e6b3e'}">${f.icon} <b>${fmt(d)}</b> — ${esc(f.text)} ${f.dir === 'up' ? '↑ busier' : '↓ quieter'}</div>`);
      });
      if (notes.length >= 5) break;
    }
    return notes.length ? `<div style="margin-bottom:12px;padding:12px;background:#fff;border-radius:10px;border:1px solid rgba(74,124,95,.15)"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--stone);margin-bottom:6px">What's driving the crowd</div>${notes.join('')}</div>` : '';
  }

  // ── Interactive crowd meter: summary panel + ring cards that open to a 7-day view ──
  const METER = { open: null };
  function meterCSS() {
    if (document.getElementById('ppMeterCSS')) return;
    const st = document.createElement('style');
    st.id = 'ppMeterCSS';
    st.textContent = `
      .pp-sum{background:var(--pine);color:#faf9f6;border-radius:16px;padding:14px 16px;margin:0 0 14px;display:flex;flex-direction:column;gap:10px}
      .pp-sum-l{font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#b9d0c0}
      .pp-sum-n{display:flex;gap:22px}.pp-sum-n div{display:flex;flex-direction:column}
      .pp-sum-n b{font-family:var(--fd);font-size:32px;line-height:1}.pp-sum-n span{font-size:12px;color:#d7e2da}
      .pp-sum-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px}.pp-sum-bar div{transition:flex-grow .5s}
      .pp-cc{background:#fff;border:1.5px solid rgba(74,124,95,.14);border-radius:16px;overflow:hidden;transition:border-color .25s}
      .pp-cc.open{border-color:var(--sage);grid-column:1/-1}
      .pp-cc-h{width:100%;display:flex;align-items:center;gap:14px;padding:12px 14px;border:none;background:none;cursor:pointer;text-align:left;font:inherit;color:var(--ink);min-height:72px}
      .pp-ring{position:relative;width:54px;height:54px;flex:none}
      .pp-ring svg{display:block;transform:rotate(-90deg)}.pp-ring circle:last-child{transition:stroke-dasharray .6s ease}
      .pp-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13.5px}
      .pp-cc-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
      .pp-cc-t strong{font-size:15.5px}.pp-cc-t span{font-size:12px;color:var(--stone);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pp-chip{font-size:11.5px;font-weight:700;padding:4px 9px;border-radius:12px;white-space:nowrap}
      .pp-cc-b{padding:0 14px 14px;display:flex;flex-direction:column;gap:10px}
      .pp-week{display:flex;align-items:flex-end;gap:6px;height:76px;padding:8px 10px 0;background:#f4f7f4;border-radius:10px}
      .pp-week div{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px}
      .pp-week i{display:block;width:100%;max-width:24px;border-radius:4px 4px 2px 2px}
      .pp-week em{font-style:normal;font-size:10px;font-weight:600;color:var(--stone);padding-bottom:4px}
      .pp-acts{display:flex;gap:8px;flex-wrap:wrap}
      .pp-acts button{flex:1;min-width:110px;min-height:42px;border-radius:10px;font:700 13px var(--fb);cursor:pointer}
      .pp-acts .p{background:var(--pine);color:#fff;border:none}.pp-acts .s{background:#fff;color:var(--pine);border:1.5px solid var(--pine)}
      .pp-acts .c{background:#a4532f;color:#fff;border:none}
      .pp-note{font-size:11.5px;color:#a8710a;background:#fdf3e3;border-radius:8px;padding:6px 9px}`;
    document.head.appendChild(st);
  }
  const lvl = v => v < 40 ? { c: '#3aab66', t: '#1e6b3e', bg: '#e5f2e9', l: 'Quiet' } : v < 70 ? { c: '#e8a020', t: '#8a5a06', bg: '#fbf1dc', l: 'Busy' } : { c: '#e24a4a', t: '#a3261f', bg: '#fde8e5', l: 'Packed' };

  function renderMeter() {
    const grid = document.getElementById('cgrid');
    if (!grid || typeof ALL === 'undefined') return false;
    meterCSS();
    renderLWBanner(); // also draws the time switch
    const when = VIEW.date || new Date();
    const stayIds = (typeof STAYS !== 'undefined' && Array.isArray(STAYS)) ? new Set(STAYS.map(s => s.placeid)) : new Set();
    const scored = ALL.map(p => ({ p, v: current(p), k: sortKey(p) })).sort((a, b) => a.k - b.k);
    // summary
    const inScope = scored.filter(x => x.k < 200);
    const cnt = { q: inScope.filter(x => x.v < 40).length, b: inScope.filter(x => x.v >= 40 && x.v < 70).length, k: inScope.filter(x => x.v >= 70).length };
    let sum = document.getElementById('ppSum');
    if (!sum) { sum = document.createElement('div'); sum.id = 'ppSum'; grid.parentNode.insertBefore(sum, grid); }
    sum.innerHTML = `<div class="pp-sum" role="status">
      <div class="pp-sum-l">${VIEW.date ? 'Forecast for ' + esc(fmt(VIEW.date)) : 'Right now across Himachal'}</div>
      <div class="pp-sum-n"><div><b style="color:#8fdcab">${cnt.q}</b><span>quiet</span></div><div><b style="color:#f3c46b">${cnt.b}</b><span>busy</span></div><div><b style="color:#ff9a8a">${cnt.k}</b><span>packed</span></div></div>
      <div class="pp-sum-bar" aria-hidden="true"><div style="background:#3aab66;flex-grow:${cnt.q}"></div><div style="background:#e8a020;flex-grow:${cnt.b}"></div><div style="background:#e24a4a;flex-grow:${cnt.k}"></div></div>
    </div>`;
    // cards
    const showAll = typeof crowdAll !== 'undefined' && crowdAll;
    const list = showAll ? scored : scored.slice(0, 16);
    const start = dayOnly(when);
    grid.innerHTML = list.map(({ p, v }) => {
      const L = lvl(v);
      const open = METER.open === p.id;
      const why = topReason(p);
      let body = '';
      if (open) {
        const wk = []; for (let i = 0; i < 7; i++) { const d = addDays(start, i); wk.push({ d, v: predict(p, d, { noNews: i > 2 }).value }); }
        let bi = 0; wk.forEach((x, i) => { if (x.v < wk[bi].v) bi = i; });
        body = `<div class="pp-cc-b">
          <div class="pp-week" aria-label="Next 7 days">${wk.map((x, i) => { const l2 = lvl(x.v); return `<div title="${esc(fmt(x.d))}: ${x.v}%"><i style="height:${Math.max(6, Math.round(x.v * 0.55))}px;background:${l2.c};opacity:${i === bi ? 1 : .55}"></i><em>${esc(x.d.toLocaleDateString('en-IN', { weekday: 'narrow' }))}${x.d.getDate()}</em></div>`; }).join('')}</div>
          <div style="font-size:13px"><b style="color:#1e6b3e">Quietest: ${esc(fmt(wk[bi].d))} (${wk[bi].v}%)</b>${p.bestTime ? ` <span style="color:var(--stone)">· Best season ${esc(p.bestTime)}</span>` : ''}</div>
          ${p.crowdNote ? `<div class="pp-note">⚠️ ${esc(p.crowdNote)}</div>` : ''}
          <div class="pp-acts">
            <button type="button" class="p" onclick="openPD(${p.id})">Explore</button>
            <button type="button" class="s" onclick="PP_CROWD.planFor(${p.id})">Plan days</button>
            ${stayIds.has(p.id) ? `<button type="button" class="c" onclick="openPD(${p.id})">See stays</button>` : ''}
          </div></div>`;
      }
      return `<div class="pp-cc${open ? ' open' : ''}">
        <button type="button" class="pp-cc-h" aria-expanded="${open}" onclick="PP_CROWD.toggleCard(${p.id})">
          <span class="pp-ring"><svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true"><circle cx="27" cy="27" r="23" fill="none" stroke="#edf0ed" stroke-width="6"></circle><circle cx="27" cy="27" r="23" fill="none" stroke="${L.c}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${Math.round(144.5 * v / 100)} 145"></circle></svg><b style="color:${L.t}">${v}%</b></span>
          <span class="pp-cc-t"><strong>${p.emoji || ''} ${esc(p.name)}</strong><span>${esc(p.district)}${why ? ' · ' + esc(why) : ''}</span></span>
          <span class="pp-chip" style="background:${L.bg};color:${L.t}">${L.l}</span>
        </button>${body}</div>`;
    }).join('');
    const more = document.getElementById('crowd-more-btn');
    more && (more.textContent = showAll ? 'Show less ↑' : 'Show all ' + ALL.length + ' places ↓');
    return true;
  }
  function toggleCard(id) { METER.open = METER.open === id ? null : id; renderMeter(); }
  function planFor(id) {
    const p = (typeof ALL !== 'undefined' ? ALL : []).find(x => x.id === id);
    if (!p) return;
    try { typeof selectPlanPlace === 'function' && selectPlanPlace(p.id, p.name); } catch (e) { /* ignore */ }
    const sec = document.getElementById('plansec');
    sec && sec.scrollIntoView({ behavior: 'smooth' });
  }

  // short reason for list rows
  function topReason(p) {
    const f = predict(p, VIEW.date || new Date()).factors.find(x => x.icon !== '🗓');
    return f ? `${f.icon} ${f.text}` : '';
  }

  window.PP_CROWD = {
    predict, now, current, setView, sortKey, renderMeter, toggleCard, planFor, dayInfo, monthDowAvg, upcomingLongWeekends,
    setNews, loadNews, newsFor, renderWhy, renderLWBanner, forecastNotes, topReason,
    get news() { return NEWS; }, get newsLoadedAt() { return NEWS_LOADED_AT; },
    _data: { HOLIDAYS, EVENTS, SCHOOL_BREAKS, PROFILE },
  };

  // Fetch news after the page settles, then refresh crowd views once.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const go = () => setTimeout(async () => {
      const ok = await loadNews();
      if (!ok) return;
      try { typeof renderCrowd === 'function' && renderCrowd(); } catch (e) { /* app not ready */ }
      try { typeof renderMap === 'function' && renderMap(); } catch (e) { /* ignore */ }
    }, 1500);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  }
})();
