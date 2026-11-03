/* PahariPath — Itinerary 2.0
 * ---------------------------------------------------------------------------
 * Renders the day-by-day plan inside the Trip Planner (#fcDays).
 * runFC() in app.js does the forecast and then calls ppRenderItinerary(ctx).
 *
 * What it does:
 *  - One card per day: arrival, the place's own written days, then nearby
 *    day trips once the place runs out, a "move base" day on long trips,
 *    and departure. Every night of the trip gets a day.
 *  - Morning / midday / afternoon / evening with times, tuned to who is
 *    travelling (family / friends & solo / couple) and the pace.
 *  - Uses the crowd model: weekend days are marked busier, and nearby day
 *    trips are moved onto the quietest weekdays.
 *  - A "Pahari moment" and a responsible task every day.
 *  - Nearby places (from /nearby.json) are tappable: a sheet shows what the
 *    place offers, its own itinerary, and "Add as a day trip".
 *  - Send the plan to WhatsApp.
 *
 * Data it reads: ALL (places, from app.js), _sb (Supabase client),
 * window._itnCache (place_itineraries cache shared with app.js),
 * /nearby.json (nearby places — edit that file to correct suggestions).
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  // ── small helpers ──────────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const clean = s => String(s || '').replace(/^[^\p{L}\p{N}"']+/u, '').trim();   // drop leading emoji/bullets
  const cleanTitle = s => clean(s).replace(/^day\s*\d+(\s*[-–]\s*\d+)?\s*[—–:-]\s*/i, '').trim();
  const place = id => (typeof ALL !== 'undefined' ? ALL : []).find(p => p.id === id);
  const fmtMins = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') + 'm' : ''}` : `${m} min`;
  const dayName = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const isArrival = t => /arriv/i.test(t || '');
  const isDeparture = t => /depart|return|head (home|back)|leave/i.test(t || '');
  // Same weekday factors the forecast uses (Sun..Sat).
  const WEEKDAY = [1.3, 1, 0.95, 0.95, 0.97, 1.15, 1.5];
  // Day busyness: uses the crowd prediction engine (holidays, long weekends,
  // bridge days) when loaded, else the simple weekday table above.
  const dayFactor = d => (window.PP_CROWD ? window.PP_CROWD.dayInfo(d).m : WEEKDAY[d.getDay()]);
  const isLongWeekend = d => !!(window.PP_CROWD && (window.PP_CROWD.dayInfo(d).run || {}).isLong);

  const TYPES = [['family', 'Family'], ['friends', 'Friends / solo'], ['couple', 'Couple']];
  const PACES = [['relaxed', 'Relaxed'], ['packed', 'Packed']];
  const TIMES = {
    family:  ['8:30 am', '11:30 am', '2:30 pm', '5:30 pm'],
    friends: ['7:30 am', '11:00 am', '2:00 pm', '6:00 pm'],
    couple:  ['9:00 am', '12:00 pm', '3:00 pm', '5:30 pm'],
  };
  const PARTS = ['Morning', 'Midday', 'Afternoon', 'Evening'];

  // ── same-day / time-aware arrival ─────────────────────────────────────
  const ymd = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  // The trip starts today (in the traveller's own time zone).
  const startsToday = c => !!(c && c.start && ymd(new Date(c.start)) === ymd(new Date()));
  // Rough sunset in Himachal by month (minutes after midnight, IST).
  const SUNSET = [1065, 1095, 1120, 1140, 1160, 1175, 1170, 1145, 1110, 1075, 1050, 1045];
  const sunsetOf = d => SUNSET[d.getMonth()];
  const fmtClock = m => {
    m = Math.round(m) % 1440; if (m < 0) m += 1440;
    const h = Math.floor(m / 60), mm = m % 60, h12 = h % 12 || 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  };
  const partOf = m => { m %= 1440; return m < 300 ? 'Night' : m < 690 ? 'Morning' : m < 840 ? 'Midday' : m < 1020 ? 'Afternoon' : m < 1230 ? 'Evening' : 'Night'; };
  const roundUp = (m, step) => Math.ceil(m / step) * step;
  // When a same-day trip can realistically begin: now + time to get ready.
  // 30 min for a short hop, 1 hour when a long drive needs packing/fuel.
  function sameDayStart(trip) {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const buffer = trip && trip.hours >= 3 ? 60 : 30;
    return roundUp(mins + buffer, 15);
  }
  // Default leave time for a future date when the drive is known.
  const plannedLeave = trip => trip.hours > 9 ? 330 : trip.hours > 5 ? 390 : trip.hours > 2 ? 480 : 540;

  const MOMENTS = [
    'Siddu is a steamed wheat bread stuffed with walnut or poppy-seed paste, eaten with ghee. Ask your host to show you how it is folded.',
    'Every village here has its own devta, and fairs are planned around them. Ask your host about theirs — and leave shoes and leather outside temple courtyards.',
    'Look closely at the old houses: layers of deodar wood and stone with no cement. It is called kath-kuni, and it is built to ride out earthquakes.',
    'Himachali dham is a festive meal cooked by hereditary cooks called botis and served on leaf plates. If there is a fair or wedding nearby, you may be invited.',
    'You will usually be offered chai the moment you arrive at a Pahari home. Accepting is the polite thing to do.',
    'Learn two words: "Ram Ram" for hello and "Kya haal?" for how are you. People light up when visitors try.',
    'Buy from the person who made it — a shawl from a weaver, honey from a beekeeper, pickle from a home kitchen.',
    'Ask an elder how the village lived before the road came. Many still remember walking days to the nearest market.',
  ];
  const BUDDHIST_ZONES = ['spiti', 'lahaul', 'kinnaur'];
  const TASKS = [
    'Refill your water bottle instead of buying plastic',
    'Buy one thing made locally, from the person who made it',
    'Carry all your trash back with you — there are few bins up here',
    'Ask before photographing people, homes or temples',
    'Eat at least one meal at a family-run place, not a chain',
    'Stay on marked trails and pick no plants or flowers',
    'Keep soap and shampoo out of streams and rivers',
  ];
  const SLOW_DAY = ['Long breakfast in the sun — no alarm today', 'Village walk — say "Ram Ram" to everyone you pass', 'Afternoon rest with a book and chai', 'Evening with your host family'];

  // ── state ──────────────────────────────────────────────────────────────
  const S = { ctx: null, type: null, pace: 'relaxed', added: [], nearby: null, nearbyLoading: null, lastKey: '', open: [0] };

  function loadNearby() {
    if (S.nearby) return Promise.resolve(S.nearby);
    if (!S.nearbyLoading) {
      S.nearbyLoading = fetch('/nearby.json').then(r => r.json()).then(j => (S.nearby = j)).catch(() => (S.nearby = {}));
    }
    return S.nearbyLoading;
  }

  function nearbyOf(id) {
    const e = S.nearby && S.nearby[String(id)];
    return e ? e.n.map(([pid, mins, hike, base]) => ({ id: pid, mins, hike: !!hike, base: !!base, p: place(pid) })).filter(x => x.p) : [];
  }

  // Fetch written itineraries (place_itineraries) for places not cached yet.
  function loadItins(ids) {
    window._itnCache = window._itnCache || {};
    const need = ids.filter(id => window._itnCache[id] === undefined);
    if (!need.length || typeof _sb === 'undefined') return Promise.resolve(false);
    return _sb.from('place_itineraries').select('place_id,days').in('place_id', need)
      .then(({ data }) => {
        need.forEach(id => { window._itnCache[id] = null; });
        (data || []).forEach(r => { window._itnCache[r.place_id] = r.days && r.days.length ? r.days : null; });
        return true;
      })
      .catch(() => { need.forEach(id => { window._itnCache[id] = null; }); return false; });
  }

  // ── building the days ──────────────────────────────────────────────────
  function middleDaysOf(days) {
    if (!days || !days.length) return [];
    return days.filter((d, i) => !(i === 0 && isArrival(d.title)) && !(i === days.length - 1 && i > 0 && isDeparture(d.title)));
  }

  function genericDaysFor(q, pool) {
    // Used when a place has no written itinerary: chunk the planner's activity pool.
    const items = (pool && pool.length ? pool : []).map(clean).filter(Boolean);
    const out = [];
    for (let i = 0; i < items.length && out.length < 2; i += 4) out.push({ title: out.length ? 'Local life' : `Around ${q.name}`, items: items.slice(i, i + 4) });
    if (!out.length) out.push({ title: `Around ${q.name}`, items: [`${clean((q.famousFor || '').split(',')[0]) || 'Explore ' + q.name}`, `Walk around ${q.name} and its village lanes`, 'Lunch at a local dhaba', 'Sunset — ask your host where locals watch it'] });
    return out;
  }

  // Highlights for a day trip: skip travel/arrival lines, which the trip already covers
  const TRAVEL_LINE = /^(arrive|arriving|drive|travel|reach|settle|check[ -]?in|begin|start the|head (back|home|down)|return|continue to|walk or drive (up )?to)\b/i;
  function tripHighlights(q) {
    const all = placeHighlights(q);
    const good = all.filter(x => !TRAVEL_LINE.test(x));
    return good.length >= 2 ? good : [...good, ...all.filter(x => !good.includes(x))];
  }

  function placeHighlights(q) {
    const w = window._itnCache && window._itnCache[q.id];
    const first = w && (middleDaysOf(w)[0] || w[0]);
    if (first && first.items && first.items.length) return first.items.map(clean);
    const fam = String(q.famousFor || '').split(',').map(s => s.trim()).filter(Boolean).map(s => s.charAt(0).toUpperCase() + s.slice(1));
    return [fam[0] ? `${fam[0]} — the main reason to go` : `Explore ${q.name}`, ...(fam[1] ? [fam[1]] : []), `Walk around ${q.name}`, 'Lunch at a local dhaba'];
  }

  function buildPlan() {
    const c = S.ctx, p = c.place, nights = Math.max(1, c.nights | 0);
    const written = c.written && c.written.length ? c.written : null;
    const mids = written ? middleDaysOf(written) : genericDaysFor(p, c.pool);
    const middleCount = nights - 1;
    const blocks = [];

    // 1. The place's own days.
    mids.slice(0, middleCount).forEach(d => blocks.push({ kind: 'local', pid: p.id, title: cleanTitle(d.title) || `Around ${p.name}`, items: (d.items || []).map(clean) }));
    let remaining = middleCount - blocks.length;

    // 2. Nearby: user-added first, then the list order. Skip snow-bound places in snow season.
    const snow = c.season === 'snow';
    const ownText = (written || []).map(d => [d.title, ...(d.items || [])].join(' ')).join(' ').toLowerCase();
    const covered = n => ownText.includes(n.p.name.toLowerCase());          // e.g. Jibhi's own plan already visits Chehni Kothi
    const snowBound = n => snow && (S.nearby[String(n.id)] || {}).t === 'seasonal';
    const near = nearbyOf(p.id).filter(n => S.added.includes(n.id) || (!snowBound(n) && !covered(n)));
    const trips = [...S.added.map(id => near.find(n => n.id === id)).filter(Boolean), ...near.filter(n => !n.base && n.mins <= 150 && !S.added.includes(n.id))];
    const baseCand = near.find(n => !n.hike && n.mins >= 40 && !S.added.includes(n.id));

    const dayTrip = n => ({
      kind: 'nearby', pid: n.id, mins: n.mins, hike: n.hike,
      title: `Day trip: ${n.p.name}`,
      items: [
        n.hike ? `Drive to the trailhead for ${n.p.name} (about ${fmtMins(n.mins)}), then hike in` : `Drive to ${n.p.name} — about ${fmtMins(n.mins)}`,
        ...tripHighlights(n.p).slice(0, 2),
        `Head back to ${p.name} before dark`,
      ],
      ...(snowBound(n) ? { warn: `${n.p.name} can be snowed in at this time of year — check the road with your host before you set off` } : {}),
    });

    let base = null;
    if (remaining > 0) {
      const useBase = remaining >= 4 && baseCand && !S.added.includes(baseCand.id);
      const tripSlots = useBase ? Math.min(2, remaining - 3) : remaining;
      const used = new Set();
      for (const n of trips) {
        if (blocks.length >= middleCount || used.size >= tripSlots) break;
        if (useBase && n.id === baseCand.id) continue;
        used.add(n.id); blocks.push(dayTrip(n));
      }
      remaining = middleCount - blocks.length;
      if (useBase && remaining >= 2) {
        base = baseCand;
        blocks.push({ kind: 'base', pid: base.id, mins: base.mins, title: `Move base to ${base.p.name}`,
          items: [`Check out and drive to ${base.p.name} — about ${fmtMins(base.mins)}`, 'Settle into your new stay', `Walk around ${base.p.name} and get your bearings`, 'Ask your new host what to do tomorrow'] });
        const bw = window._itnCache && window._itnCache[base.id];
        const bDays = bw ? middleDaysOf(bw) : genericDaysFor(base.p, []);
        bDays.forEach(d => { if (blocks.length < middleCount) blocks.push({ kind: 'basedLocal', pid: base.id, title: cleanTitle(d.title) || `Around ${base.p.name}`, items: (d.items || []).map(clean) }); });
        const usedIds = new Set([p.id, base.id, ...blocks.map(b => b.pid)]);
        nearbyOf(base.id).filter(n => !n.base && n.mins <= 120 && !usedIds.has(n.id) && !covered(n)).forEach(n => {
          if (blocks.length >= middleCount) return;
          blocks.push({ kind: 'nearby', pid: n.id, mins: n.mins, hike: n.hike, from: base.p.name, title: `Day trip: ${n.p.name}`,
            items: [n.hike ? `Drive to the trailhead for ${n.p.name} (about ${fmtMins(n.mins)}), then hike in` : `Drive to ${n.p.name} — about ${fmtMins(n.mins)}`,
              ...placeHighlights(n.p).slice(0, 2), `Head back to ${base.p.name} before dark`] });
        });
      }
      while (blocks.length < middleCount) blocks.push({ kind: 'slow', pid: base ? base.id : p.id, title: 'A slow day — nowhere to be', items: SLOW_DAY.slice() });
    }

    // 3. Every place the traveller added gets a day. It replaces, in order:
    //    a slow day, a day trip we picked, then the place's own later days —
    //    never another added place. No free day (short trip): a close place
    //    becomes a stop on the way home; a far one asks for one more night.
    const stopovers = [], unfit = [];
    const replaceable = ['slow', 'nearby', 'basedLocal', 'local'];
    S.added.forEach(id => {
      if (blocks.some(b => b.pid === id)) return;
      const n = near.find(x => x.id === id); if (!n) return;
      let at = -1;
      for (const kind of replaceable) {
        for (let i = blocks.length - 1; i >= 0; i--) {
          const b = blocks[i];
          if (b.kind !== kind || S.added.includes(b.pid)) continue;
          if (kind === 'local' && blocks.filter(x => x.kind === 'local').length <= 1 && blocks.length > 1) continue;   // keep one day at the place itself if we can
          at = i; break;
        }
        if (at >= 0) break;
      }
      if (at < 0 && blocks.some(b => b.kind === 'local' && !S.added.includes(b.pid))) at = blocks.findIndex(b => b.kind === 'local');
      if (at >= 0) blocks[at] = dayTrip(n);
      else if (n.mins <= 75 && !n.hike && !stopovers.length) stopovers.push(n);   // one short stop on the last morning, no more
      else unfit.push(n);
    });

    // 4. Crowd planning: before any base move, put day trips on the quietest dates.
    const preBase = blocks.findIndex(b => b.kind === 'base');
    const end = preBase === -1 ? blocks.length : preBase;
    const dates = Array.from({ length: end }, (_, i) => addDays(c.start, i + 1));
    const slots = dates.map((d, i) => ({ i, wf: dayFactor(d) }));
    const tripBlocks = blocks.slice(0, end).filter(b => b.kind === 'nearby');
    const otherBlocks = blocks.slice(0, end).filter(b => b.kind !== 'nearby');
    let moved = null;
    if (tripBlocks.length && otherBlocks.length) {
      const quiet = slots.slice().sort((a, b) => a.wf - b.wf || a.i - b.i).slice(0, tripBlocks.length).map(s => s.i).sort((a, b) => a - b);
      const arranged = new Array(end); let t = 0, o = 0;
      for (let i = 0; i < end; i++) arranged[i] = quiet.includes(i) ? tripBlocks[t++] : otherBlocks[o++];
      arranged.forEach((b, i) => { if (b !== blocks[i] && b.kind === 'nearby' && !moved) moved = { name: place(b.pid).name, day: dates[i] }; });
      for (let i = 0; i < end; i++) blocks[i] = arranged[i];
    }

    // 5. Arrival and departure.
    const first = written && isArrival(written[0].title) ? written[0] : null;
    const last = written && written.length > 1 && isDeparture(written[written.length - 1].title) ? written[written.length - 1] : null;
    // Journey from the traveller's city (only when they used "Suggest a place for me").
    const trip = window.PPTrip && window.PPTrip.travel ? window.PPTrip.travel(p) : null;
    const goLine = trip
      ? `Travel from ${trip.from} to ${p.name} — ${trip.label} ${trip.route}${startsToday(c) ? '' : trip.hours > 9 ? '. Start before sunrise, or break the journey overnight on the way' : trip.hours > 5 ? '. Leave early to reach by afternoon' : ''}`
      : `Travel to ${p.name}`;
    const arrival = { kind: 'arrival', pid: p.id, trip, title: `Arrive in ${p.name}`,
      items: [`${goLine}${c.high ? ' — you are above 3,000 m, so take it slow today' : ''}`, 'Check in and settle into your stay',
        ...(first ? first.items.map(clean).slice(-2) : [`Evening walk around ${p.name}`, 'Dinner at your stay — ask for a local dish'])] };
    const endPlace = base ? base.p : p;
    const back = trip ? window.PPTrip.travel(endPlace) : null;
    const homeLine = back
      ? `Head back to ${back.from} — ${back.label} ${back.route}; ${back.hours > 8 ? 'leave by 8 am or plan a night halt' : 'leave by noon to drive in daylight'}`
      : 'Head home — leave by noon to drive in daylight';
    const departure = { kind: 'departure', pid: endPlace.id, title: 'One last morning, then home',
      items: last ? ['Early walk at golden hour', ...last.items.map(clean).slice(0, 2), homeLine]
        : ['Early walk at golden hour', 'Breakfast and check-out', `Local shopping — ${c.shop || 'pickles, shawls and honey'}`, homeLine] };

    stopovers.forEach(n => { const h = clean(tripHighlights(n.p)[0] || '').split(/\s+—\s+/)[0];
      departure.items.splice(1, 0, `Stop at ${n.p.name} on your way home (about ${fmtMins(n.mins)} from ${p.name})${h ? ` — ${h.replace(/^./, ch => ch.toLowerCase())}` : ''}`); });
    departure.stops = stopovers.map(n => n.id);

    return { days: [arrival, ...blocks, departure], moved, base, stopovers, unfit };
  }

  // ── rendering ──────────────────────────────────────────────────────────
  function taskKey() { return 'pp_itn_' + S.ctx.place.id + '_' + S.ctx.start.toISOString().slice(0, 10); }
  const memDone = {};
  function getDone() { try { const v = localStorage.getItem(taskKey()); if (v) return JSON.parse(v); } catch (e) { /* storage blocked */ } return (memDone[taskKey()] || []).slice(); }
  function setDone(list) { memDone[taskKey()] = list.slice(); try { localStorage.setItem(taskKey(), JSON.stringify(list)); } catch (e) { /* storage blocked — memory copy kept */ } }

  // ── opening hours: never send people to a closed place ────────────────
  // First match wins, so specific places sit above the generic types.
  // m = minutes after midnight. closed = weekdays (0 = Sun … 6 = Sat).
  // dur = how long the visit takes (last sensible start = close - dur).
  // To fix a timing, edit this table — every itinerary uses it.
  const DOW = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const SUNRISE = [435, 425, 400, 365, 335, 320, 330, 350, 370, 390, 410, 430];
  const sunriseOf = d => SUNRISE[d.getMonth()];
  // National holidays most government museums shut on (MM-DD).
  const GAZETTED = ['01-26', '08-15', '10-02'];
  const mmdd = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const isoDay = d => `${d.getFullYear()}-${mmdd(d)}`;
  const inRange = (d, [a, b]) => { const x = mmdd(d); return a <= b ? x >= a && x <= b : x >= a || x <= b; };
  const monthsLabel = ms => { const s = [...ms].sort((a, b) => a - b); return `${MON[s[0] - 1]}–${MON[s[s.length - 1] - 1]}`; };

  /* Opening hours & rules for every timed thing in our itineraries.
   * First match wins, so specific places sit above generic types.
   *   open / close  minutes after midnight, or 'sunrise' / 'sunset'
   *   dur           minutes the visit takes (last start = close - dur)
   *   closed        weekdays shut (0 = Sun … 6 = Sat)
   *   breaks        [[from, to]] lunch breaks
   *   gaz           shut on 26 Jan, 15 Aug, 2 Oct
   *   dates         extra closed dates 'YYYY-MM-DD' (festivals)
   *   shut          closed date ranges every year ['MM-DD','MM-DD']
   *   months        months it runs (1-12); outside them:
   *     offText     replace the activity with this text, or
   *     warn        keep it but add this warning
   *   after         only after dark (stargazing, bonfire)
   *   first         must be the first thing in the day (trek starts, prayers)
   *   tip           always-shown practical tip
   *   soft          typical hours for the type, not verified for this place
   * To correct a timing, edit the line — every itinerary uses this table. */
  const VENUES = [
    // ── verified, named places ──
    { re: /s(h)?obha singh/i, name: 'Sobha Singh Art Gallery', open: 570, close: 1050, dur: 60 },
    { re: /andretta pottery|pottery (studio|society)|pottery studios?/i, name: 'the pottery studios', open: 600, close: 1020, dur: 45 },
    { re: /roerich/i, name: 'Roerich Art Gallery', open: 540, close: 1020, closed: [1], dur: 60 },
    { re: /bhuri singh/i, name: 'Bhuri Singh Museum', open: 600, close: 1020, closed: [1], gaz: true, dur: 60 },
    { re: /norbulingka/i, name: 'Norbulingka Institute', open: 540, close: 1020, dur: 75 },
    { re: /tibet(an)? museum/i, name: 'Tibet Museum', open: 540, close: 1020, closed: [6], breaks: [[780, 840]], gaz: true, dur: 60,
      dates: ['2026-11-01', '2026-12-10', '2026-12-15', '2026-12-16', '2027-01-01'] },
    { re: /kangra fort|largest fort in the himalayas|fort's long history/i, name: 'Kangra Fort', open: 540, close: 1050, dur: 90, tip: 'The small museum inside is shut on Fridays' },
    { re: /masroor|masrur|rock(-| )cut temple|ellora/i, name: 'Masroor Rock Temple', open: 'sunrise', close: 'sunset', dur: 60, tip: 'ASI site — small entry ticket' },
    { re: /hikkim|highest post office/i, name: 'Hikkim post office', open: 600, close: 1020, closed: [0], dur: 30, tip: 'Carry cash for postcards and stamps' },
    { re: /rohtang/i, name: 'Rohtang Pass', noHours: true, open: 'sunrise', close: 840, closed: [2], months: [5, 6, 7, 8, 9, 10], dur: 180, first: true,
      tip: 'Leave by 6 am, be back by afternoon · Permit needed (rohtangpermits.nic.in) — released 10 am & 4 pm, none on Tuesdays',
      offText: 'Rohtang is snowbound now — go to Gulaba or Solang for snow instead' },
    { re: /paragliders land|watch(ing)? (the )?paraglid/i, name: 'paraglider landings', open: 720, close: 'sunset', dur: 45, shut: ['07-15', '09-15'],
      offText: 'Paragliding is grounded 15 Jul – 15 Sep (monsoon ban) — evening walk through the Tibetan colony instead' },
    { re: /paraglid/i, name: 'paragliding', open: 570, close: 900, dur: 90, shut: ['07-15', '09-15'], tip: 'Calmest air is mid-morning — book your tandem a day ahead; flights stop in bad weather',
      offText: 'Paragliding is grounded 15 Jul – 15 Sep (monsoon ban) — ask your host about a valley walk instead' },
    { re: /monkey point/i, name: 'Monkey Point', open: 540, close: 1020, dur: 60, soft: true, tip: 'It is inside an Air Force area — carry photo ID' },
    { re: /toy train/i, name: 'the toy train', open: 420, close: 960, dur: 120, soft: true, tip: 'Runs to a fixed timetable — book on IRCTC and pick a morning train' },
    { re: /trout hatchery/i, name: 'the trout hatchery', open: 600, close: 1020, dur: 60, soft: true },
    { re: /fossil park/i, name: 'the fossil park', open: 600, close: 1050, dur: 60, soft: true },
    { re: /tea (factory|estate|garden)/i, name: 'the tea factory', open: 540, close: 1020, dur: 60, soft: true },
    { re: /bhakra dam/i, name: 'Bhakra Dam', open: 540, close: 1020, dur: 90, soft: true, tip: 'Entry is controlled — carry photo ID and check the visitor pass rules at Nangal' },
    { re: /malana/i, name: 'Malana', open: 'sunrise', close: 'sunset', dur: 120, tip: 'Village rule: never touch walls, shrines or people — fines apply' },
    // ── seasonal treks, passes & lakes: keep, but warn outside the season ──
    { re: /chandra ?tal/i, name: 'Chandratal', season: [6, 7, 8, 9, 10], warn: 'Road usually open only Jun–Oct' },
    { re: /kheerganga|kheer ganga/i, name: 'Kheerganga', season: [4, 5, 6, 7, 8, 9, 10, 11], warn: 'The trail is usually snowed in Dec–Mar' },
    { re: /suraj tal|kunzum|baralacha|sarchu/i, name: 'the high road', season: [6, 7, 8, 9, 10], warn: 'Usually snowbound Nov–May — check road status' },
    { re: /manimahesh/i, name: 'Manimahesh', season: [6, 7, 8, 9], warn: 'The trek is open roughly Jun–Sep only' },
    { re: /pin.?parvati/i, name: 'Pin Parvati Pass', season: [7, 8, 9], warn: 'Crossable only Jul–Sep' },
    { re: /kinner kailash/i, name: 'Kinner Kailash', season: [7, 8], warn: 'The parikrama is done in Jul–Aug only' },
    { re: /sar pass|hamta|indrahar|chanderkhani|bhrigu|beas kund/i, name: 'this pass', season: [5, 6, 7, 8, 9, 10], warn: 'Snowbound outside May–Oct — needs a guide and gear in shoulder season' },
    { re: /jalori|sereolesar/i, name: 'Jalori', season: [3, 4, 5, 6, 7, 8, 9, 10, 11], warn: 'Jalori road can close with snow Dec–Feb — check before you go' },
    { re: /migratory|pong (dam|wetland)/i, name: 'Pong wetlands', season: [11, 12, 1, 2], warn: 'Migratory birds are here Nov–Feb only' },
    { re: /\b(ski|skiing)\b|snow activit|snow-season/i, name: 'snow activities', season: [12, 1, 2, 3],
      offText: 'Snow play needs Dec–Mar — enjoy the ridge views and a slow walk instead' },
    { re: /trout fishing|rod-and-line|\bfishing\b/i, name: 'trout fishing', season: [3, 4, 5, 6, 7, 8, 9, 10],
      tip: 'Needs a fishing licence from the Fisheries office — your host can arrange it',
      offText: 'Trout fishing is closed for breeding (Nov–Feb) — riverside walk and a look at the trout farms instead' },
    // ── light & time of day ──
    { re: /morning prayers|early morning prayer|puja at dawn/i, name: 'morning prayers', fixed: 'dawn', first: true },
    { re: /aarti/i, name: 'aarti', fixed: 'sunset' },
    { re: /sunrise/i, fixed: 'sunrise', first: true },
    { re: /sunset/i, fixed: 'sunset' },
    { re: /stargaz|night sky|bonfire|campfire/i, name: 'stargazing', after: true },
    // ── trek starts must be the morning; descents must end in daylight ──
    { re: /\b(start|begin|early start|set off)\b(?![^.]*\b(back|down|return)\b)[^.]*\b(trek|hike|climb|pilgrimage)|^(trek|hike|climb) (up|to|toward|into)\b|^trek or drive up|^early climb|^gain altitude/i,
      name: 'the trek', open: 'sunrise', close: 660, dur: 0, first: true, trek: true },
    { re: /\b(trek|hike|walk) (back|down)|^descend|^return trek|trek back out/i, name: 'the descent', open: 'sunrise', close: 'sunset', dur: 180, trek: true },
    // A day trip takes the day: start in the morning, block ~4 hours.
    { re: /^day trip\b/i, name: 'the day trip', open: 'sunrise', close: 780, dur: 240, first: true, noHours: true },
    // ── generic types: typical hours, confirm locally ──
    { re: /museum|galler(y|ies)|exhibition/i, name: 'it', open: 600, close: 1020, dur: 60, soft: true, gaz: true },
    { re: /institute|workshop|weav|handloom|craft (centre|center|society)|co-?operative/i, name: 'it', open: 600, close: 1020, dur: 45, soft: true },
    { re: /\bfort\b|palace|castle/i, name: 'it', open: 570, close: 1050, dur: 75, soft: true },
    { re: /ropeway|cable car/i, name: 'the ropeway', open: 570, close: 1050, dur: 60, soft: true, tip: 'Shuts in high wind or bad weather' },
    { re: /\bzoo\b|sanctuary|nature park|deer park/i, name: 'it', open: 600, close: 1020, dur: 75, soft: true },
    { re: /monaster|gompa|nunnery/i, name: 'the monastery', open: 360, close: 1080, dur: 45, soft: true, tip: 'Walk clockwise, ask before photos inside' },
    { re: /hot spring|natural bath|ritual bath/i, name: 'the hot springs', open: 330, close: 1260, dur: 45, soft: true },
    { re: /gurudwara|langar/i, name: 'the gurudwara', open: 300, close: 1320, dur: 45, soft: true, tip: 'Cover your head; langar is free — help wash up if you can' },
    { re: /church/i, name: 'the church', open: 540, close: 1080, dur: 30, soft: true },
    { re: /temple|mandir|shrine|shaktipeeth|lingam/i, name: 'it', open: 330, close: 1260, dur: 45, soft: true },
    { re: /market|bazaar|shopping/i, name: 'the market', open: 600, close: 1230, dur: 60, soft: true },
    { re: /caf[eé]/i, name: 'the cafés', open: 570, close: 1290, dur: 60, soft: true },
    { re: /post office/i, name: 'the post office', open: 600, close: 1020, closed: [0], dur: 30, soft: true },
    { re: /waterfall|viewpoint|\bfalls\b|meadow|orchard|lakeside|riverside|valley views|forest/i, name: 'it', open: 'sunrise', close: 'sunset', dur: 60, daylight: true },
  ];
  const venueOf = text => VENUES.find(v => v.re.test(text || '')) || null;
  const tOf = (x, date) => x === 'sunrise' ? sunriseOf(date) : x === 'sunset' ? sunsetOf(date) : x;
  const parseClock = str => {
    const m = /(\d{1,2}):(\d{2})\s*(am|pm)/i.exec(str || '');
    if (!m) return null;
    let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12;
    return h * 60 + +m[2];
  };
  const shortClock = m => fmtClock(m).replace(':00', '');
  const hoursLabel = (v, date) => {
    if (v.open == null) return '';
    const o = v.open === 'sunrise' ? 'sunrise' : shortClock(tOf(v.open, date));
    const c = v.close === 'sunset' ? 'sunset' : shortClock(tOf(v.close, date));
    return `${o} – ${c}${v.breaks ? ` (lunch ${v.breaks.map(b => `${shortClock(b[0])}–${shortClock(b[1])}`).join(', ')})` : ''}${v.closed ? `, closed ${v.closed.map(d => DOW[d]).join(' & ')}` : ''}`;
  };
  // Is the place running on this date at all? Returns '' or why not.
  function closedOn(v, date) {
    if (v.closed && v.closed.includes(date.getDay())) return `closed on ${DOW[date.getDay()]}`;
    if (v.gaz && GAZETTED.includes(mmdd(date))) return 'closed for the national holiday';
    if (v.dates && v.dates.includes(isoDay(date))) return 'closed for a festival that day';
    if (v.shut && inRange(date, v.shut)) return 'not running on these dates';
    if (v.months && !v.months.includes(date.getMonth() + 1)) return 'out of season';
    return '';
  }
  // Can this activity happen at minute m on this date? Returns the time to use.
  function fitAt(v, m, date) {
    const why = closedOn(v, date);
    if (why) return { ok: false, why, season: !!(v.shut || v.months) };
    if (v.fixed) {
      const at = v.fixed === 'sunrise' ? sunriseOf(date) - 20 : v.fixed === 'dawn' ? Math.max(sunriseOf(date) - 30, 360) : sunsetOf(date) - 40;
      return { ok: true, m: at };
    }
    if (v.after) return { ok: true, m: Math.max(m, sunsetOf(date) + 75) };
    if (v.open == null) return { ok: true, m };
    const open = tOf(v.open, date), close = tOf(v.close, date);
    if (m < open) m = open;
    for (const [a, b] of v.breaks || []) if (m < b && m + v.dur > a) m = b;
    if (m > close - v.dur) return { ok: false, why: v.trek ? 'too late to start safely' : 'it shuts before you can get there' };
    return { ok: true, m };
  }
  const placeName = (v, text) => v.name && v.name !== 'it' && !/^(the|this) /.test(v.name) ? v.name : clean(text).replace(/^(visit|explore|see|stop (at|by)|walk (to|through)|head to)\s+(the\s+)?/i, '').split(/[,—–(]/)[0].trim();
  // Turn "If visiting in October…", "(June-September)", "in winter (Jan-Feb)"
  // into months, but only when the line is conditional on the season.
  const MONTHS_RE = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/gi;
  const monthNo = s => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(s.slice(0, 3).toLowerCase()) + 1;
  function seasonOf(text) {
    if (!/\bif\b|in season|season-|seasonal|skip it|outside this|optionally|\(\s*[a-z]+\s*[-–]\s*[a-z]+\s*\)/i.test(text)) return null;
    const ms = (text.match(MONTHS_RE) || []).map(monthNo).filter(Boolean);
    let set = null;
    if (ms.length >= 2) { set = []; for (let m = ms[0], k = 0; k < 12; k++, m = m % 12 + 1) { set.push(m); if (m === ms[1]) break; } }
    else if (ms.length === 1) set = [ms[0]];
    else if (/\bwinter\b/i.test(text)) set = [12, 1, 2];
    else if (/\bspring\b|blossom/i.test(text)) set = [3, 4];
    else if (/\bmonsoon\b/i.test(text)) set = [7, 8, 9];
    return set;
  }
  // Drop season-bound lines that don't apply on this date, and their
  // "Otherwise…/Or…" alternatives when the main line does apply.
  function seasonFilter(items, date) {
    const mo = date.getMonth() + 1, out = [];
    let prev = null;   // null = no conditional before, true = kept, false = dropped
    items.forEach(x => {
      if (/^(otherwise|or)\b/i.test(clean(x)) && prev !== null) { if (prev === false) out.push(clean(x).replace(/^(otherwise|or)\s*,?\s*/i, '').replace(/^./, c => c.toUpperCase())); prev = null; return; }
      const set = seasonOf(x);
      if (set) { prev = set.includes(mo); if (prev) out.push(x); return; }
      prev = null; out.push(x);
    });
    return out;
  }

  // Runs every day of the plan through the rules above. Anything closed
  // (or too late) moves to the next day it fits; out-of-season lines are
  // swapped for what works now; nothing is ever shown at a wrong time.
  function scheduleAll(plan) {
    const t = TIMES[S.type] || TIMES.couple;
    const out = [];
    const usedOff = new Set();
    let carry = [];
    const lower = x => clean(x).toLowerCase();
    const sameVenue = (it, text) => it.v.soft || it.v.daylight ? lower(text) === lower(it.text) : it.v.re.test(text);
    const alreadyPlanned = (it, i) => out.some(day => day.some(x => sameVenue(it, x.text)))
      || plan.days.slice(i + 1).some(d => d.items.some(x => sameVenue(it, x)));
    const info = (v, date, note) => {
      const parts = [note];
      if (v.open != null && !v.trek && !v.daylight && !v.noHours) parts.push(`Open ${hoursLabel(v, date)}${v.soft ? ' — usual hours, confirm with your host' : ''}`);
      if (v.tip) parts.push(v.tip);
      return parts.filter(Boolean).join(' · ');
    };
    const movedSlot = (it, m, i, date) => ({
      time: fmtClock(m), m, part: partOf(m),
      text: clean(it.text).replace(/^(early )?(morning|midday|afternoon|evening|late)\s+(visit|trip|walk)\s+(to|at)?\s*/i, 'Visit '),
      note: info(it.v, date, it.note),
      quiet: it.from === i ? `Planned earlier — ${it.why}` : `Moved from Day ${it.from + 1} — ${it.why}` });

    plan.days.forEach((d, i) => {
      const date = addDays(S.ctx.start, i);
      const sunset = sunsetOf(date);
      const raw = slotsFor(d, i);
      const bad = (raw.skipped || []).map(x => ({ ...x, from: i, pid: d.pid }));
      const slots = [];
      raw.forEach((s, k) => {
        s.m = parseClock(s.time);
        const v = venueOf(s.text);
        const fixedSlot = /dinner/i.test(s.part) || (d.kind === 'arrival' && k < 2) || s.m == null;
        if (!v || fixedSlot) {
          // Plain outdoor line after dark: say so.
          if (!fixedSlot && s.m >= sunset && /walk|trail|stroll|explore|wander/i.test(s.text) && !/dinner|night|lights|market|bazaar/i.test(s.text))
            s.note = [s.note, `Dark by ${fmtClock(sunset)} — keep it short and carry a torch`].filter(Boolean).join(' · ');
          slots.push(s); return;
        }
        // Season-only warnings (passes, lakes) never move the line.
        if (v.season) {
          if (!v.season.includes(date.getMonth() + 1)) {
            if (v.offText) { if (usedOff.has(v.offText)) return; usedOff.add(v.offText); s.text = v.offText; s.note = ''; s.off = true; }
            else s.note = [s.note, `⚠ ${v.warn} — check with your host before you plan this`].filter(Boolean).join(' · ');
          } else if (v.tip) s.note = [s.note, v.tip].filter(Boolean).join(' · ');
          slots.push(s); return;
        }
        if (v.first && k > 0 && raw[0] && parseClock(raw[0].time) < 720) { bad.push({ text: s.text, v, why: 'it has to be the first thing in the day', from: i, pid: d.pid, note: s.note }); return; }
        const f = fitAt(v, s.m, date);
        if (!f.ok) {
          if (f.season && v.offText) { if (!usedOff.has(v.offText)) { usedOff.add(v.offText); slots.push({ ...s, text: v.offText, note: '', off: true }); } return; }
          bad.push({ text: s.text, v, why: f.why, from: i, pid: d.pid, note: s.note, season: f.season }); return;
        }
        const next = raw[k + 1] && parseClock(raw[k + 1].time);
        if (f.m !== s.m && next != null && f.m + 30 > next && !(v.fixed || v.after)) {
          bad.push({ text: s.text, v, why: 'it shuts before you can get there', from: i, pid: d.pid, note: s.note }); return;
        }
        s.m = f.m; s.time = fmtClock(f.m);
        if (v.fixed) s.part = v.fixed === 'sunset' ? 'Sunset' : v.fixed === 'dawn' ? 'Dawn' : 'Sunrise';
        if (v.after) s.part = 'Night';
        const pw = /^(early )?(morning|afternoon|evening)\b/i.exec(clean(s.text));
        if (pw && !new RegExp(pw[2], 'i').test(partOf(s.m))) s.text = clean(s.text).replace(/^(early )?(morning|midday|afternoon|evening|late)\s+(visit|trip|walk)\s+(to|at)?\s*/i, 'Visit ');
        s.note = info(v, date, s.note);
        slots.push(s);
      });

      // Place carried-over and rejected visits into free times today.
      const pending = [...carry, ...bad];
      carry = [];
      const canTake = d.kind !== 'arrival';
      const cap = d.kind === 'departure' ? 5 : (S.pace === 'packed' ? 5 : 4);
      const candidates = d.kind === 'departure' ? [570, 600, 630, 660] : [...t.map(parseClock), 600, 660, 840, 900, 960];
      pending.forEach(it => {
        if (alreadyPlanned(it, i)) return;
        let placed = false;
        const sameDayClosed = it.from === i && closedOn(it.v, date);
        // Only on a day spent at the same place — never inside a day trip elsewhere.
        const samePlace = it.pid == null || (d.pid === it.pid && d.kind !== 'nearby' && d.kind !== 'base');
        if (canTake && samePlace && slots.length < cap && !sameDayClosed && !it.season) {
          if (it.v.first && d.kind !== 'departure') {
            // Trek starts / prayers: take the morning slot, push that line later.
            const f = fitAt(it.v, Math.min(...candidates), date);
            const firstSlot = slots.find(x => x.m != null && x.m < 720 && !venueOf(x.text));
            if (f.ok) {
              if (firstSlot) slots.splice(slots.indexOf(firstSlot), 1);
              slots.push(movedSlot(it, it.v.fixed ? f.m : Math.max(f.m, tOf(it.v.open, date) + 30), i, date));
              placed = true;
            }
          } else {
            for (const m0 of [...new Set(candidates)].sort((a, b) => a - b)) {
              const f = fitAt(it.v, m0, date);
              if (!f.ok) continue;
              const len = x => Math.max((venueOf(x.text) || {}).dur || 0, d.kind === 'departure' ? 45 : 60);
              const mine = Math.max(it.v.dur || 0, d.kind === 'departure' ? 45 : 60);
              if (slots.some(s => s.m != null && s.m < f.m + mine && f.m < s.m + len(s))) continue;
              if (d.kind === 'departure' && f.m > 690) continue;      // must leave by midday
              slots.push(movedSlot(it, f.m, i, date));
              placed = true; break;
            }
          }
        }
        // Last morning is full: swap out a plain item (never the drive home).
        if (!placed && samePlace && d.kind === 'departure' && !it.v.first) {
          const s2 = slots.find((x, k) => k > 0 && x.m != null && x.m <= 690 && !venueOf(x.text) && !/home|leave|depart|check.?out|drive|travel/i.test(x.text) && fitAt(it.v, x.m, date).ok);
          if (s2) { Object.assign(s2, movedSlot(it, fitAt(it.v, s2.m, date).m, i, date)); placed = true; }
        }
        if (!placed && !it.v.fixed) carry.push(it);
      });
      // Arrival evening never ends empty: keep dinner in.
      if (d.kind === 'arrival' && !slots.some(x => /dinner|meal/i.test(x.text + ' ' + x.part)))
        slots.push({ time: '7:30 pm', m: 1170, part: 'Dinner', text: 'Dinner at your stay — ask for a local dish', note: '', quiet: '' });
      slots.sort((a, b) => (a.m == null ? 9999 : a.m) - (b.m == null ? 9999 : b.m));
      out.push(slots);
    });
    // The destination itself is seasonal (high lakes, passes): warn on Day 1.
    const pv = venueOf(S.ctx.place && S.ctx.place.name);
    if (pv && pv.season && out[0] && out[0][0] && !pv.season.includes(S.ctx.start.getMonth() + 1) && pv.warn)
      out[0][0].quiet = [out[0][0].quiet, `⚠ ${pv.warn} — confirm the road/trail is open before you go`].filter(Boolean).join(' · ');
    // Whatever never fitted: say so plainly rather than show a wrong time.
    if (carry.length && out.length) {
      const last = out[out.length - 1];
      const endDate = addDays(S.ctx.start, out.length - 1);
      carry.filter(it => !/market|caf/.test(it.v.name || '') && !out.some(day => day.some(x => sameVenue(it, x.text)))).forEach(it => last.push({ time: '—', part: 'Missed',
        text: `${placeName(it.v, it.text)} didn't fit this trip${it.v.open != null ? ` (${hoursLabel(it.v, endDate)})` : ''}`,
        note: it.season ? `It isn't running on your dates — ${it.why}.` : 'Add a day, or ask your host if it can be squeezed in on the way.', quiet: '' }));
    }
    return out;
  }

  // Arrival day built on a real clock: from "now + getting ready" when the
  // trip starts today, or from a sensible leave time when the drive is known.
  function arrivalSlots(day, items, today) {
    const trip = day.trip;
    const date = new Date(S.ctx.start);
    const sunset = sunsetOf(date);
    const name = (place(day.pid) || {}).name || 'your stay';
    const [goText, checkIn, ...rest] = items;
    const out = [];
    const skipped = [];
    out.skipped = skipped;
    let t = today ? sameDayStart(trip) : plannedLeave(trip);

    // 1. Leave / travel
    const leave = { time: fmtClock(t), part: today ? 'Start' : partOf(t), text: goText, note: '', quiet: '' };
    if (today) leave.quiet = `Planned from now — leave by ${fmtClock(t)}`;
    if (today && !trip && t >= sunset - 30) leave.note = `It's dark by ${fmtClock(sunset)} — if you're more than an hour away, mountain roads at night aren't worth it; start tomorrow morning instead.`;
    out.push(leave);

    // 2. Reach + check in
    const travelMins = trip ? Math.round(trip.hours * 12) * 5 : 60;   // to the nearest 5 min; unknown origin: assume you're close by
    const reach = t + travelMins;
    if (trip) {
      // Minutes driven between sunset and roughly next sunrise (~6:40 am).
      const dark = Math.max(0, Math.min(reach, 1440 + 400) - Math.max(t, sunset));
      if (dark > 0) leave.note = dark > 120
        ? `About ${fmtMins(dark)} of this drive is after dark on mountain roads. Safer: halt overnight on the way, or move this trip to tomorrow and leave by ${fmtClock(plannedLeave(trip))}.`
        : t >= sunset ? 'This drive is after dark — go slow on the hill roads, avoid overtaking, and keep your host informed.'
          : `The last stretch will be after sunset (~${fmtClock(sunset)}) — drive slow and keep your host informed.`;
      if (reach >= 1440) {
        out.push({ time: fmtClock(reach), part: 'Next day', text: `Reach ${name} — this is past midnight, so plan a night halt on the way and continue at first light`, note: '', quiet: '' });
        return out;
      }
    }
    t = reach;
    out.push({ time: fmtClock(t), part: partOf(t), text: trip ? `Reach ${name}. ${checkIn}` : checkIn,
      note: t >= 1260 ? 'Late arrival — call your host before you leave so someone is up to receive you.' : '', quiet: '' });

    // 3. Fill the rest of the day only with what still fits before ~9:30 pm
    const cap = S.pace === 'packed' ? 3 : 2;
    let used = 0;
    t = roundUp(t + 60, 15);
    for (const x of rest) {
      if (used >= cap) break;
      const isFood = /dinner|\bmeal\b|\bdish\b/i.test(x) && !/market|bazaar|shop/i.test(x);
      if (!isFood && t > 1290) { const lv = venueOf(x); if (lv && lv.open != null && !lv.season) skipped.push({ text: x, v: lv, why: 'it shuts before you can get there' }); continue; }
      if (isFood && t > 1320) break;                   // past 10 pm — handled below
      if (isFood) t = Math.max(t, 1170);               // dinner not before 7:30 pm
      else if (/evening|sunset/i.test(x)) t = Math.max(t, sunset - 60);
      const v = !isFood && venueOf(x);
      if (v && v.season) { /* seasonal warning lines are handled by the scheduler */ }
      else if (v && (v.after || v.first)) { if (v.after) continue; skipped.push({ text: x, v, why: 'better done first thing tomorrow' }); continue; }
      else if (v && (v.open != null || v.fixed)) {
        const f = fitAt(v, t, date);
        if (!f.ok || (!v.fixed && f.m - t > 60)) { skipped.push({ text: x, v, why: f.ok ? 'it shuts before you can get there' : f.why, season: f.season }); continue; }
        if (v.fixed === 'sunset' && f.m < t) continue;   // sunset already gone
        t = f.m;
      }
      let text = x, note = '';
      if (!isFood && !v && t > sunset - 20 && /walk|trek|hike|viewpoint|explore|stroll|trail/i.test(x)) {
        text = `Short stroll near ${name} — it's dark by ${fmtClock(sunset)}, so save the walk for tomorrow morning`;
        note = 'Carry a torch; village lanes have no street lights.';
      }
      if (/sunset/i.test(x) && t > sunset) continue;   // sunset already gone
      out.push({ time: fmtClock(t), part: isFood ? 'Dinner' : partOf(t), text, note, quiet: '' });
      used++;
      t = roundUp(t + (isFood ? 60 : 90), 15);
    }
    // Always end with food if nothing else fit, and keep it sensible late at night.
    if (!out.some(s => s.part === 'Dinner')) {
      const dt = Math.max(t, reach + 30);
      out.push(dt > 1320
        ? { time: fmtClock(Math.min(dt, 1410)), part: 'Dinner', text: 'Late dinner — ask your host to keep a simple meal ready (dal-chawal is perfect)', note: '', quiet: '' }
        : { time: fmtClock(Math.max(dt, 1170)), part: 'Dinner', text: 'Dinner at your stay — ask for a local dish', note: '', quiet: '' });
    }
    return out;
  }

  function slotsFor(day, idx) {
    const t = TIMES[S.type] || TIMES.couple;
    let items = seasonFilter(day.items.filter(Boolean), addDays(S.ctx.start, idx));
    if (day.kind === 'arrival') {
      const today = startsToday(S.ctx);
      if (today || day.trip) return arrivalSlots(day, items, today);
      return items.slice(0, S.pace === 'packed' ? 4 : 3).map((x, i) => ({ time: ['1:00 pm', '3:30 pm', '5:00 pm', '7:30 pm'][i], part: ['Afternoon', 'Afternoon', 'Evening', 'Dinner'][i], text: x }));
    }
    if (day.kind === 'departure') return (items.length > 4 ? [...items.slice(0, 3), items[items.length - 1]] : items).map((x, i) => ({ time: ['7:30 am', '10:00 am', '11:00 am', '12:00 pm'][i], part: ['Morning', 'Morning', 'Late morning', 'Afternoon'][i], text: x }));
    if (S.type === 'couple' && S.pace === 'packed' && !items.some(x => /sunset/i.test(x))) items = [...items, 'Sunset — ask your host where locals watch it'];
    const n = S.pace === 'packed' ? 4 : 3;
    // Lines that say when they happen go to that part of the day.
    const rank = x => /^(early )?morning\b|^sunrise|^dawn|^day trip|^early\b/i.test(clean(x)) ? 0
      : /^(evening|night|sunset|dinner|stargaz|bonfire)\b|\bin the evening\b|\bafter dark\b/i.test(clean(x)) ? 3 : 1;
    items = items.map((x, k) => [x, k]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(a => a[0]);
    const fi = items.findIndex(x => { const v = venueOf(x); return v && v.first && !v.fixed; });
    if (fi > 0) items = [items[fi], ...items.slice(0, fi), ...items.slice(fi + 1)];
    const pick = items.slice(0, n);
    const order = pick.length === 3 ? [0, 2, 3] : pick.length === 2 ? [0, 2] : [0, 1, 2, 3];
    return pick.map((x, i) => {
      const s = { time: t[order[i]], part: PARTS[order[i]], text: x, note: '', quiet: '' };
      if (S.type === 'family' && /trek|hike|climb|summit/i.test(x)) s.note = 'With kids, take the shorter route and turn back early — carry water and snacks.';
      if (S.type === 'friends' && /trek|hike/i.test(x)) s.note = 'Start early to be back before dark.';
      return s;
    });
  }

  function render() {
    const el = document.getElementById('fcDays');
    if (!el || !S.ctx) return;
    const c = S.ctx, p = c.place;
    const plan = buildPlan();
    const sched = scheduleAll(plan);
    const done = getDone();
    const near = nearbyOf(p.id).filter(n => n.mins <= 300).slice(0, 5);
    const zone = String(p.zone || '').toLowerCase();
    const moments = [
      ...(c.food ? [`Try ${c.food} — ask your host where locals eat it.`] : []),
      ...(BUDDHIST_ZONES.includes(zone) ? ['In Buddhist areas, walk clockwise around monasteries, stupas and prayer wheels, and ask before photographing monks.'] : []),
      ...MOMENTS,
    ];

    const pills = (list, cur, act) => list.map(([k, l]) => `<button type="button" class="itn-pill${k === cur ? ' on' : ''}" onclick="ppItn.${act}('${k}')">${esc(l)}</button>`).join('');

    let html = `
      <div class="itn-controls">
        <div class="itn-ctl"><div class="itn-lbl">Who's travelling</div><div class="itn-pills">${pills(TYPES, S.type, 'setType')}</div></div>
        <div class="itn-ctl"><div class="itn-lbl">Pace</div><div class="itn-pills">${pills(PACES, S.pace, 'setPace')}</div></div>
      </div>`;

    if (near.length) {
      html += `<div class="itn-lbl" style="margin-top:14px">Nearby places — tap to see what's there</div>
        <div class="itn-near">${near.map(n => `<button type="button" class="itn-nchip${S.added.includes(n.id) ? ' on' : ''}" onclick="ppItn.peek(${n.id})">
          <span class="itn-nname">${esc(n.p.name)}</span><span class="itn-ntime">${esc(fmtMins(n.mins))}${n.hike ? ' + hike' : n.base ? ' · stay option' : ' drive'}</span></button>`).join('')}</div>`;
    }
    const notes = [];
    if (plan.moved) notes.push(`We put ${esc(plan.moved.name)} on ${esc(dayName(plan.moved.day))}, a quieter day than the weekend.`);
    if (plan.days.some(d => d.kind === 'nearby')) notes.push(`${esc(p.name)} is covered in the first days, so we added nearby day trips for the rest.`);
    if (plan.base) notes.push(`Halfway through, we move you to ${esc(plan.base.p.name)} — less driving and a new valley to wake up in.`);
    (plan.stopovers || []).forEach(n => notes.push(`No free day for ${esc(n.p.name)}, so it is a stop on your way home.`));
    if (notes.length) html += `<div class="itn-note">${notes.join(' ')}</div>`;
    (plan.unfit || []).forEach(n => { html += `<div class="itn-note itn-unfit">${esc(n.p.name)} needs a full day and your trip has none free. <button type="button" class="itn-addnight" onclick="ppItn.addNight(${n.id})">Add 1 night for it</button> <button type="button" class="itn-addnight ghost" onclick="ppItn.toggleAdd(${n.id})">Remove</button></div>`; });

    // trip summary: quiet / busier days, day trips, task progress, open-all
    const dayKind = plan.days.map((d, i) => {
      if (d.kind === 'arrival' || d.kind === 'departure') return 'edge';
      return dayFactor(addDays(c.start, i)) >= 1.08 ? 'busy' : 'calm';
    });
    const nQuiet = dayKind.filter(k => k === 'calm').length, nBusy = dayKind.filter(k => k === 'busy').length;
    const nTrips = plan.days.filter(d => d.kind === 'nearby').length;
    const pct = Math.round(100 * done.length / plan.days.length);
    const allOpen = S.open.length >= plan.days.length;
    html += `<div class="itn-summary">
        <div class="itn-chips">
          ${nQuiet ? `<span class="itn-chip calm">${nQuiet} quiet day${nQuiet > 1 ? 's' : ''}</span>` : ''}
          ${nBusy ? `<span class="itn-chip busy">${nBusy} busier day${nBusy > 1 ? 's' : ''}</span>` : ''}
          ${nTrips ? `<span class="itn-chip">${nTrips} nearby day trip${nTrips > 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="itn-prog"><div class="itn-pbar"><div style="width:${pct}%"></div></div><span>${done.length} of ${plan.days.length} responsible tasks</span></div>
        <button type="button" class="itn-openall" onclick="ppItn.openAll()">${allOpen ? 'Close all days' : 'Open all days'}</button>
      </div>`;

    html += plan.days.map((d, i) => {
      const date = addDays(c.start, i);
      const wf = dayFactor(date);
      const busy = d.kind !== 'arrival' && d.kind !== 'departure' && wf >= 1.08;
      const slots = sched[i];
      if (busy && slots[0] && d.kind !== 'base' && !slots[0].quiet) slots[0].quiet = isLongWeekend(date) ? 'Long weekend — roads and viewpoints fill up fast, leave before 8 am' : 'Weekend — start before 9 am, it gets busy by late morning';
      if (!busy && (d.kind === 'nearby' || d.kind === 'local') && slots[0] && wf <= 0.97) {
        const di = window.PP_CROWD ? window.PP_CROWD.dayInfo(date) : null;
        const dow = date.getDay();
        if (!slots[0].quiet) slots[0].quiet = di && di.holiday && di.holiday.diwali ? 'Diwali — most people are at home, so trails are quiet'
          : (dow === 0 || dow === 6) ? 'Quieter than a usual weekend' : 'Weekday — quieter than usual';
      }
      if (d.warn && slots[0]) slots[0].note = [slots[0].note, d.warn].filter(Boolean).join(' · ');
      const task = d.kind === 'departure' ? 'Leave an honest review for your host' : TASKS[i % TASKS.length];
      const isDone = done.includes(i);
      const q = place(d.pid);
      const tag = d.kind === 'nearby' ? `<button type="button" class="itn-tag" onclick="ppItn.peek(${d.pid})">Nearby · ${esc(q.name)} · ${esc(fmtMins(d.mins))}${d.hike ? ' + hike' : ''}${d.from ? ' from ' + esc(d.from) : ''} — see what's there ›</button>`
        : d.kind === 'base' ? `<button type="button" class="itn-tag base" onclick="ppItn.peek(${d.pid})">Change of base · ${esc(p.name)} → ${esc(q.name)} — see what's there ›</button>` : '';
      const open = S.open.includes(i);
      return `<div class="itn-day${open ? ' open' : ''}">
        <div class="itn-dhead">
          <div class="itn-drow"><span class="itn-dlabel">Day ${i + 1} · ${esc(dayName(date))}</span>
            <span style="display:flex;gap:6px;align-items:center">${d.kind === 'arrival' || d.kind === 'departure' ? '' : `<span class="itn-crowd ${busy ? 'busy' : 'calm'}">${busy ? 'Busier day' : 'Quiet day'}</span>`}${isDone ? '<span class="itn-donemark" title="Task done">✓</span>' : ''}</span></div>
          <button type="button" class="itn-dtoggle" aria-expanded="${open}" onclick="ppItn.toggleDay(${i})"><span class="itn-dtitle">${esc(d.title)}</span><span class="itn-chev" aria-hidden="true">${open ? '▴' : '▾'}</span></button>
          ${open ? tag : `<div class="itn-peek">${esc(slots.map(s => s.time).join(' · '))} · tap to see the day</div>`}
        </div>
        ${open ? `<div class="itn-slots">${slots.map(s => `<div class="itn-slot"><div><div class="itn-time">${esc(s.time)}</div><div class="itn-part">${esc(s.part)}</div></div>
          <div><div class="itn-text">${esc(s.text)}</div>${s.note ? `<div class="itn-snote">${esc(s.note)}</div>` : ''}${s.quiet ? `<span class="itn-quiet">${esc(s.quiet)}</span>` : ''}</div></div>`).join('')}</div>
        <div class="itn-moment"><div class="itn-mlbl">Pahari moment</div>${esc(moments[i % moments.length])}</div>
        <button type="button" class="itn-task${isDone ? ' done' : ''}" onclick="ppItn.toggleTask(${i})" aria-pressed="${isDone}">
          <span class="itn-box" aria-hidden="true">${isDone ? '✓' : ''}</span>
          <span class="itn-tbody"><span class="itn-tlbl">Responsible task</span><span>${esc(task)}</span></span>
        </button>` : ''}
      </div>`;
    }).join('');

    html += `<div class="itn-sum">PAHADI points for responsible tasks are coming soon</div>
      <button type="button" class="itn-share" onclick="ppItn.share()">Send this plan to WhatsApp</button>`;
    el.innerHTML = html;
    S.lastPlan = plan;
  }

  // ── nearby sheet ───────────────────────────────────────────────────────
  function closeSheet() { const s = document.getElementById('itnSheet'); if (s) s.remove(); document.removeEventListener('keydown', escClose); }
  function escClose(e) { if (e.key === 'Escape') closeSheet(); }

  function peek(id) {
    const q = place(id); if (!q || !S.ctx) return;
    const n = nearbyOf(S.ctx.place.id).find(x => x.id === id);
    const show = () => {
      closeSheet();
      const w = window._itnCache && window._itnCache[id];
      const plan = w ? (middleDaysOf(w)[0] || w[0]) : null;
      const items = plan ? plan.items.map(clean) : placeHighlights(q);
      const offers = [...String(q.famousFor || '').split(',').map(s => s.trim()).filter(Boolean), ...((q.vibes || []).slice(0, 2).map(v => v.charAt(0).toUpperCase() + v.slice(1)))];
      const crowd = typeof getCrowd === 'function' && typeof cLabel === 'function' ? cLabel(getCrowd(q.crowd, q.zone)) : '';
      const t = ((S.nearby || {})[String(id)] || {}).t;
      const warn = t === 'seasonal' ? 'Snow can close the road here in winter — check with your host before you go.'
        : n && n.hike ? 'The last stretch is on foot. Start early and carry water.' : '';
      const added = S.added.includes(id);
      const wrap = document.createElement('div');
      wrap.id = 'itnSheet';
      wrap.className = 'itn-sheet-bg';
      wrap.innerHTML = `<div class="itn-sheet" role="dialog" aria-modal="true" aria-label="${esc(q.name)}">
        <div class="itn-shead">
          <div class="itn-srow"><span class="itn-skick">${n ? `Nearby · ${esc(fmtMins(n.mins))} from ${esc(S.ctx.place.name)}` : 'Nearby'}</span>
            <button type="button" class="itn-close" aria-label="Close" onclick="ppItn.close()">×</button></div>
          <div class="itn-sname">${esc(q.name)}</div>
          <div class="itn-ssub">${esc(q.district)}${q.altitude ? ' · ' + esc(q.altitude) : ''}</div>
        </div>
        <div class="itn-sbody">
          <p>${esc(q.desc)}</p>
          <div class="itn-facts">
            ${crowd ? `<div class="itn-fact"><span>Crowd now</span><b>${esc(crowd)}</b></div>` : ''}
            ${q.bestTime ? `<div class="itn-fact warm"><span>Best time</span><b>${esc(q.bestTime)}</b></div>` : ''}
          </div>
          ${offers.length ? `<div class="itn-lbl dark">What's there</div><ul class="itn-offers">${offers.slice(0, 5).map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
          <div class="itn-lbl dark">${plan ? esc(cleanTitle(plan.title) || 'A day there') : 'A day there'}</div>
          <div class="itn-splan">${items.slice(0, 4).map(x => `<div>${esc(x)}</div>`).join('')}</div>
          ${warn ? `<div class="itn-warn">${esc(warn)}</div>` : ''}
        </div>
        <div class="itn-sact">
          ${n && !n.base ? `<button type="button" class="itn-add${added ? ' on' : ''}" onclick="ppItn.toggleAdd(${id})">${added ? 'Added to your trip ✓' : 'Add as a day trip'}</button>` : ''}
          <button type="button" class="itn-open" onclick="ppItn.close();openPD(${id})">Open the full ${esc(q.name)} page</button>
        </div>
      </div>`;
      wrap.addEventListener('click', e => { if (e.target === wrap) closeSheet(); });
      document.body.appendChild(wrap);
      document.addEventListener('keydown', escClose);
      const btn = wrap.querySelector('.itn-close'); if (btn) btn.focus();
    };
    loadItins([id]).then(show, show);
  }

  // ── public API ─────────────────────────────────────────────────────────
  const say = msg => { try { if (typeof toast === 'function') toast(msg); } catch (e) { /* toast is optional */ } };
  // After adding a nearby place: open the day it landed on and bring it into view.
  function showAdded(id) {
    const plan = S.lastPlan; if (!plan) return;
    const name = (place(id) || {}).name || 'This place';
    let di = plan.days.findIndex(d => d.kind === 'nearby' && d.pid === id);
    let msg = di >= 0 ? `${name} added — Day ${di + 1}, ${dayName(addDays(S.ctx.start, di))}` : '';
    if (di < 0 && (plan.stopovers || []).some(n => n.id === id)) { di = plan.days.length - 1; msg = `${name} added as a stop on your way home`; }
    if (di >= 0) {
      if (!S.open.includes(di)) S.open.push(di);
      render();
      setTimeout(() => { const el = document.querySelectorAll('#fcDays .itn-day')[di]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      say(msg);
    } else {
      setTimeout(() => { const el = document.querySelector('#fcDays .itn-unfit'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
      say(`${name} needs a full day — tap "Add 1 night for it"`);
    }
  }

  window.ppItn = {
    setType(k) { S.type = k; render(); },
    setPace(k) { S.pace = k; render(); },
    toggleTask(i) { const d = getDone(); const at = d.indexOf(i); at >= 0 ? d.splice(at, 1) : d.push(i); setDone(d); render(); },
    toggleDay(i) { const at = S.open.indexOf(i); at >= 0 ? S.open.splice(at, 1) : S.open.push(i); render(); },
    openAll() { const n = (S.lastPlan && S.lastPlan.days.length) || 0; S.open = S.open.length >= n ? [] : Array.from({ length: n }, (_, i) => i); render(); },
    toggleAdd(id) {
      const at = S.added.indexOf(id), adding = at < 0;
      adding ? S.added.push(id) : S.added.splice(at, 1);
      closeSheet(); render();
      const name = (place(id) || {}).name || 'This place';
      if (!adding) { say(`${name} removed from your trip`); return; }
      showAdded(id);
    },
    addNight(id) {
      const el = document.getElementById('ppNights');
      if (!el || typeof runFC !== 'function') return;
      el.value = Math.min(14, (parseInt(el.value, 10) || 2) + 1);
      S.added = [id, ...S.added.filter(x => x !== id)];   // the place you added the night for gets the new day
      S.focusAdded = id;
      runFC();
    },
    peek, close: closeSheet,
    share() {
      const plan = S.lastPlan; if (!plan) return;
      const c = S.ctx;
      const lines = [`🏔️ My ${c.place.name} trip — PahariPath`, ''];
      const sched = scheduleAll(plan);
      plan.days.forEach((d, i) => {
        lines.push(`Day ${i + 1} · ${dayName(addDays(c.start, i))} — ${d.title}`);
        sched[i].forEach(s => lines.push(`  ${s.time}: ${s.text}`));
        lines.push('');
      });
      lines.push('Plan yours at paharipath.in');
      window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank', 'noopener');
    },
  };

  // Called from runFC() in app.js.
  window.ppRenderItinerary = function (ctx) {
    const key = ctx.place.id + '|' + ctx.start.toISOString().slice(0, 10) + '|' + ctx.nights;
    if (key.split('|')[0] !== S.lastKey.split('|')[0]) { S.added = []; S.open = [0]; }   // new place → clear added trips, open day 1 only
    S.lastKey = key;
    S.ctx = ctx;
    if (window.PP_FINDER) { S.type = window.PP_FINDER.type || S.type; S.pace = window.PP_FINDER.pace || S.pace; window.PP_FINDER = null; }   // set by trip-finder.js
    if (!S.type) { const t = String(ctx.travellers || '2'); S.type = t === '1' ? 'friends' : t === '2' ? 'couple' : 'family'; }
    injectStyles();
    render();
    if (S.focusAdded) { const id = S.focusAdded; S.focusAdded = null; setTimeout(() => showAdded(id), 700); }
    // Nearby data and nearby places' own itineraries arrive asynchronously.
    loadNearby().then(() => {
      render();
      const ids = nearbyOf(ctx.place.id).map(n => n.id);
      return loadItins(ids);
    }).then(changed => { if (changed) render(); });
  };

  // ── styles (scoped to .itn-*) ──────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('itnStyles')) return;
    const st = document.createElement('style');
    st.id = 'itnStyles';
    st.textContent = `
      .itn-controls{display:flex;flex-wrap:wrap;gap:14px 24px;margin-bottom:6px}
      .itn-ctl{display:flex;flex-direction:column;gap:8px}
      .itn-lbl{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.6);margin-bottom:8px}
      .itn-lbl.dark{color:#4f5f52;margin:14px 0 8px}
      .itn-pills{display:flex;gap:8px;flex-wrap:wrap}
      .itn-pill{min-height:44px;padding:0 16px;border-radius:999px;border:1.5px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:600 14px var(--fb);cursor:pointer}
      .itn-pill.on{background:#fff;color:var(--pine);border-color:#fff}
      .itn-near{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:6px}
      .itn-nchip{flex:none;min-height:52px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;padding:8px 14px;border-radius:12px;background:rgba(255,255,255,.1);border:1.5px solid rgba(255,255,255,.22);color:#fff;cursor:pointer;font-family:var(--fb);text-align:left}
      .itn-nchip.on{border-color:#9fd3b0;background:rgba(159,211,176,.18)}
      .itn-nname{font-size:14px;font-weight:700}.itn-ntime{font-size:12px;color:rgba(255,255,255,.7)}
      .itn-note{background:rgba(255,255,255,.1);border-radius:12px;padding:12px 14px;font-size:13.5px;line-height:1.55;color:#fff;margin:8px 0 14px}
      .itn-day{background:#faf9f6;color:var(--ink);border-radius:16px;overflow:hidden;margin-bottom:16px;font-family:var(--fb)}
      .itn-dhead{padding:16px 16px 12px;border-bottom:1px solid #e6ece7;display:flex;flex-direction:column;gap:6px}
      .itn-drow{display:flex;justify-content:space-between;align-items:center;gap:8px}
      .itn-dlabel{font-size:13px;font-weight:700;color:var(--sage)}
      .itn-crowd{font-size:12px;font-weight:700;border-radius:999px;padding:4px 10px;white-space:nowrap}
      .itn-crowd.busy{background:#fbefe7;color:#8a4526}.itn-crowd.calm{background:#e3efe6;color:#1f4a32}
      .itn-dtitle{font-family:var(--fd);font-size:24px;font-weight:700;line-height:1.15;color:var(--pine)}
      .itn-tag{align-self:flex-start;min-height:36px;border:none;border-radius:999px;padding:6px 12px;font:700 12px var(--fb);background:#eaf0f6;color:#23466b;cursor:pointer;text-align:left}
      .itn-tag.base{background:#f6f1e7;color:#7a5a22}
      .itn-slots{margin:4px 16px 4px 24px;padding:0 0 0 14px;border-left:2px solid #dfe7e1}
      .itn-slot{position:relative;display:grid;grid-template-columns:70px minmax(0,1fr);gap:10px;padding:12px 0;border-bottom:1px dashed #e3e9e4}
      .itn-slot::before{content:'';position:absolute;left:-21px;top:16px;width:12px;height:12px;border-radius:50%;background:#fff;border:2px solid var(--sage)}
      .itn-dtoggle{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;min-height:44px;padding:0;border:none;background:none;cursor:pointer;text-align:left;font:inherit;color:inherit}
      .itn-chev{flex:none;width:32px;height:32px;border-radius:50%;background:#e6ece7;color:var(--pine);display:flex;align-items:center;justify-content:center;font-size:14px}
      .itn-day:not(.open) .itn-dhead{border-bottom:none}
      .itn-peek{font-size:12.5px;color:#5a6a5d}
      .itn-donemark{width:22px;height:22px;border-radius:50%;background:var(--pine);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}
      .itn-summary{background:rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;margin:8px 0 14px;display:flex;flex-direction:column;gap:10px}
      .itn-chips{display:flex;flex-wrap:wrap;gap:6px}
      .itn-chip{font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.16);color:#fff}
      .itn-chip.calm{background:#e3efe6;color:#1f4a32}.itn-chip.busy{background:#fbefe7;color:#8a4526}
      .itn-prog{display:flex;align-items:center;gap:10px;font-size:12.5px;color:rgba(255,255,255,.85)}
      .itn-pbar{flex:1;height:8px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden}.itn-pbar div{height:100%;background:#9fd3b0;transition:width .4s}
      .itn-openall{align-self:flex-start;min-height:40px;border:1.5px solid rgba(255,255,255,.35);background:none;color:#fff;border-radius:999px;padding:6px 14px;font:600 13px var(--fb);cursor:pointer}
      .itn-slot:last-child{border-bottom:none}
      .itn-time{font-size:14px;font-weight:700}.itn-part{font-size:11px;color:#5a6a5d;text-transform:uppercase;letter-spacing:.06em}
      .itn-text{font-size:15px;line-height:1.45}.itn-snote{font-size:13px;color:#4f5f52;margin-top:4px;line-height:1.45}
      .itn-quiet{display:inline-block;margin-top:6px;background:#e3efe6;color:#1f4a32;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600}
      .itn-moment{margin:6px 16px 0;background:#f6f1e7;border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.5}
      .itn-mlbl{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7a5a22;margin-bottom:4px}
      .itn-task{display:flex;align-items:center;gap:12px;width:calc(100% - 32px);margin:12px 16px 16px;min-height:56px;padding:12px 14px;border-radius:12px;background:#fff;border:1.5px dashed #b8c8bc;cursor:pointer;font-family:var(--fb);font-size:14px;color:var(--ink);text-align:left}
      .itn-task.done{background:#e3efe6;border:1.5px solid var(--sage)}
      .itn-box{width:24px;height:24px;flex:none;border-radius:6px;border:1.5px solid #9fb3a5;background:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
      .itn-task.done .itn-box{background:var(--pine);border-color:var(--pine);color:#fff}
      .itn-tbody{display:flex;flex-direction:column;gap:2px}.itn-tlbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--sage)}
      .itn-sum{font-size:13px;color:rgba(255,255,255,.75);margin:4px 0 12px}
      .itn-share{width:100%;min-height:50px;border:none;border-radius:12px;background:#fff;color:var(--pine);font:700 15px var(--fb);cursor:pointer}
      .itn-sheet-bg{position:fixed;inset:0;z-index:10000;background:rgba(28,36,32,.5);display:flex;align-items:flex-end;justify-content:center}
      .itn-sheet{width:100%;max-width:480px;max-height:88vh;overflow-y:auto;background:#faf9f6;border-radius:22px 22px 0 0;font-family:var(--fb);color:var(--ink)}
      @media(min-width:700px){.itn-sheet-bg{align-items:center}.itn-sheet{border-radius:22px}}
      .itn-shead{background:#23466b;color:#fff;padding:18px 20px;display:flex;flex-direction:column;gap:6px}
      .itn-srow{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
      .itn-skick{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#cfe0f0;font-weight:600}
      .itn-close{width:44px;height:44px;margin:-10px -10px 0 0;border-radius:999px;border:none;background:rgba(255,255,255,.16);color:#fff;font-size:22px;cursor:pointer}
      .itn-sname{font-family:var(--fd);font-size:32px;font-weight:700;line-height:1.05}.itn-ssub{font-size:14px;color:#dbe7f2}
      .itn-sbody{padding:16px 20px 0;font-size:15px;line-height:1.55}.itn-sbody p{margin:0 0 12px}
      .itn-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .itn-fact{background:#e3efe6;border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
      .itn-fact.warm{background:#f6f1e7}.itn-fact span{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4f5f52}.itn-fact b{font-size:14px}
      .itn-offers{margin:0;padding-left:20px}.itn-offers li{margin-bottom:4px}
      .itn-splan{background:#fff;border:1px solid #dfe6e0;border-radius:14px;padding:4px 14px}.itn-splan div{padding:10px 0;border-bottom:1px dashed #e3e9e4;font-size:14px}.itn-splan div:last-child{border-bottom:none}
      .itn-unfit{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
      .itn-addnight{min-height:40px;padding:0 14px;border-radius:999px;border:none;background:#fff;color:var(--pine);font:700 13px var(--fb);cursor:pointer}
      .itn-addnight.ghost{background:transparent;color:inherit;border:1px solid rgba(255,255,255,.4)}
      .itn-warn{margin-top:12px;background:#fbefe7;color:#6e3a20;border-radius:12px;padding:10px 12px;font-size:13px}
      .itn-sact{padding:16px 20px 24px;display:flex;flex-direction:column;gap:10px}
      .itn-add{min-height:50px;border-radius:12px;border:1.5px solid var(--pine);background:var(--pine);color:#fff;font:700 15px var(--fb);cursor:pointer}
      .itn-add.on{background:#e3efe6;color:#1f4a32;border-color:var(--sage)}
      .itn-open{min-height:48px;border-radius:12px;border:1.5px solid #23466b;background:#fff;color:#23466b;font:700 15px var(--fb);cursor:pointer}
    `;
    document.head.appendChild(st);
  }
})();
