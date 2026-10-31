/*!
 * PahariPath Trip Finder — "I don't know where to go"
 * Second mode inside "Plan your trip" (#plansec).
 * The traveller gives: starting city, date, nights, who is going, interests,
 * how far they're happy to travel and whether they want it quiet.
 * We score all 146 places (season, travel time from their city, crowd
 * prediction, interests, group type) and suggest the best few. "Plan this
 * trip" fills the normal planner and runs runFC(), so the forecast and the
 * day-by-day itinerary appear — with the journey from their city on day 1
 * and the last day (itinerary.js reads window.PPTrip.travel()).
 *
 * Uses from app.js: ALL, PLACE_COORDS, ZS, JOURNEY_OVR, selectPlanPlace, toast.
 * Uses window.PP_CROWD (crowd-predict.js) when loaded.
 * Travel times are estimates from straight-line distance with road factors —
 * tune ROAD below if they feel off.
 */
(function () {
  'use strict';

  /* ---------- tuning ---------- */
  var ROAD = {
    PLAINS_FACTOR: 1.25, PLAINS_KMH: 55,   // highways outside HP
    HILL_FACTOR: 1.6, HILL_KMH: 30,        // hill roads inside HP
    HIGH_EXTRA: 1.35                       // Spiti, Lahaul, high Kinnaur/Chamba
  };

  // Where people start from. kind: hill = inside HP, road = drive in, far = fly/train in.
  var ORIGINS = [
    ['Delhi', 28.61, 77.21, 'road'], ['Gurugram', 28.46, 77.03, 'road'], ['Noida', 28.54, 77.39, 'road'],
    ['Chandigarh', 30.73, 76.78, 'road'], ['Ambala', 30.38, 76.78, 'road'], ['Ludhiana', 30.90, 75.85, 'road'],
    ['Jalandhar', 31.33, 75.58, 'road'], ['Amritsar', 31.63, 74.87, 'road'], ['Pathankot', 32.27, 75.65, 'road'],
    ['Jammu', 32.73, 74.86, 'road'], ['Dehradun', 30.32, 78.03, 'road'], ['Jaipur', 26.91, 75.79, 'road'],
    ['Mumbai', 19.08, 72.88, 'far'], ['Bengaluru', 12.97, 77.59, 'far'], ['Hyderabad', 17.39, 78.49, 'far'],
    ['Kolkata', 22.57, 88.36, 'far'], ['Chennai', 13.08, 80.27, 'far'], ['Pune', 18.52, 73.86, 'far'],
    ['Ahmedabad', 23.02, 72.57, 'far'], ['Lucknow', 26.85, 80.95, 'far'],
    ['Shimla', 31.10, 77.17, 'hill'], ['Manali', 32.24, 77.19, 'hill'], ['Kullu', 31.96, 77.11, 'hill'],
    ['Dharamshala', 32.22, 76.32, 'hill'], ['Palampur', 32.11, 76.54, 'hill'], ['Mandi', 31.71, 76.93, 'hill'],
    ['Hamirpur', 31.68, 76.52, 'hill'], ['Nadaun', 31.78, 76.35, 'hill'], ['Una', 31.47, 76.27, 'hill'],
    ['Bilaspur', 31.33, 76.76, 'hill'], ['Solan', 30.91, 77.10, 'hill'], ['Chamba', 32.55, 76.13, 'hill'],
    ['Nahan', 30.56, 77.30, 'hill']
  ];
  // Where drive-in travellers enter the hills.
  var GATEWAYS = [
    ['Kiratpur', 31.18, 76.57], ['Parwanoo', 30.84, 76.96], ['Una', 31.47, 76.27],
    ['Pathankot', 32.27, 75.65], ['Paonta Sahib', 30.44, 77.62]
  ];
  // Airports for travellers from far cities. min = hours saved before we suggest it over Chandigarh.
  var AIRPORTS = [
    ['Chandigarh airport', 30.67, 76.79, 'plains', 0],
    ['Dharamshala (Gaggal) airport', 32.16, 76.26, 'hill', 3],
    ['Kullu (Bhuntar) airport', 31.88, 77.15, 'hill', 4]
  ];

  var INTERESTS = [
    ['nature', '🌲 Nature'], ['offbeat', '🧭 Offbeat'], ['adventure', '🧗 Adventure'],
    ['trek', '🥾 Treks'], ['spiritual', '🛕 Spiritual'], ['culture', '🎭 Culture'], ['snow', '❄️ Snow']
  ];
  var WHO = [['couple', 'Couple', '2'], ['family', 'Family', '4'], ['friends', 'Friends', '3'], ['solo', 'Solo', '1']];
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var HIGH_ZONES = { spiti: 1, lahaul: 1 };

  var st = { mode: 'know', origin: null, who: 'couple', interests: [], maxH: 'auto', quiet: true, pace: 'relaxed', results: [], showAll: false };

  /* ---------- app.js globals (shared top-level bindings between classic scripts) ---------- */
  /* global ALL, PLACE_COORDS, ZS, JOURNEY_OVR, selectPlanPlace, toast, runFC */
  function places() { try { return ALL || []; } catch (e) { return []; } }
  function coords() { try { return PLACE_COORDS || {}; } catch (e) { return {}; } }
  function seasons() { try { return ZS || {}; } catch (e) { return {}; } }
  function overrides() { try { return JOURNEY_OVR || {}; } catch (e) { return {}; } }

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); }
  function km(a, b, c, d) {
    var R = 6371, r = Math.PI / 180, dl = (c - a) * r, dn = (d - b) * r;
    var x = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dn / 2) * Math.sin(dn / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function alt(p) { var m = String(p.altitude || '').replace(/,/g, '').match(/\d+/); return m ? +m[0] : 1500; }
  function fmtH(h) { if (h < 1) return 'under 1h'; var r = Math.round(h * 2) / 2; return '~' + (r % 1 ? Math.floor(r) + '½' : r) + 'h'; }
  function todayISO() { var d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }

  function bestMonths(txt) {
    var set = {}, any = false;
    String(txt || '').replace(/\([^)]*\)/g, '').split(',').forEach(function (seg) {
      var m = seg.toLowerCase().match(/[a-z]{3}/g);
      if (!m) return;
      m = m.filter(function (x) { return x in MONTHS; });
      if (!m.length) return;
      var a = MONTHS[m[0]], b = MONTHS[m[m.length - 1]];
      for (var i = a; ; i = (i + 1) % 12) { set[i] = 1; any = true; if (i === b) break; }
    });
    return any ? set : null;
  }

  /* ---------- travel time ---------- */
  function hillHours(aLat, aLng, p, c) {
    var f = ROAD.HILL_FACTOR;
    var z = String(p.zone || '').toLowerCase();
    if (HIGH_ZONES[z] || (alt(p) > 2600 && (z === 'kinnaur' || z === 'chamba'))) f *= ROAD.HIGH_EXTRA;
    return km(aLat, aLng, c[0], c[1]) * f / ROAD.HILL_KMH;
  }
  function plainsHours(a, b, c, d) { return km(a, b, c, d) * ROAD.PLAINS_FACTOR / ROAD.PLAINS_KMH; }

  // origin: {name, lat, lng, kind}. Returns {hours, route, far} or null.
  function travelFrom(o, p) {
    var c = coords()[p.id];
    if (!o || !c) return null;
    if (o.kind === 'hill') return { hours: hillHours(o.lat, o.lng, p, c), route: 'by road' };
    if (o.kind === 'road') {
      var best = null;
      GATEWAYS.forEach(function (gw) {
        var h = plainsHours(o.lat, o.lng, gw[1], gw[2]) + hillHours(gw[1], gw[2], p, c);
        if (!best || h < best.hours) best = { hours: h, route: 'by road via ' + gw[0] };
      });
      return best;
    }
    // far: fly in, then drive
    var base = null, opts = [];
    AIRPORTS.forEach(function (ap) {
      var h = ap[3] === 'plains'
        ? Math.min.apply(null, GATEWAYS.map(function (gw) { return plainsHours(ap[1], ap[2], gw[1], gw[2]) + hillHours(gw[1], gw[2], p, c); }))
        : hillHours(ap[1], ap[2], p, c);
      opts.push({ ap: ap, h: h });
    });
    base = opts[0];
    opts.slice(1).forEach(function (x) { if (base.h - x.h >= x.ap[4] && x.h < base.h) base = x; });
    var hub = base.ap[0] + (base.ap[0].indexOf('Chandigarh') === 0 ? ' (or a train to Chandigarh/Kalka)' : ' (flights via Delhi)');
    return { hours: base.h, route: 'by road after you fly into ' + hub, far: true, hub: hub };
  }

  function maxHoursFor(nights) {
    if (st.maxH !== 'auto') return +st.maxH;
    return nights <= 1 ? 6 : nights === 2 ? 8 : nights === 3 ? 10 : nights <= 5 ? 12 : 16;
  }

  /* ---------- scoring ---------- */
  function score(p, o, date, nights) {
    var m = date.getMonth(), a = alt(p), z = String(p.zone || '').toLowerCase();
    var ovr = overrides()[p.id];
    if (ovr && ovr.verdict === 'not_recommended') return null;
    var tr = travelFrom(o, p);
    if (!tr) return null;
    var cap = maxHoursFor(nights);
    if (tr.hours > cap) return null;

    var wantSnow = st.interests.indexOf('snow') >= 0;
    var winter = [10, 11, 0, 1, 2].indexOf(m) >= 0;
    var zs = (seasons()[z] || seasons().kullu || [])[m] || 'good';
    var closedHigh = HIGH_ZONES[z] && zs === 'snow';
    if (closedHigh && (st.who === 'family' || !wantSnow)) return null;

    var s = 0, why = [];
    var bm = bestMonths(p.bestTime);
    var inBest = bm ? !!bm[m] : false;
    if (inBest) { s += 30; why.push('Best season'); } else s -= 10;
    s += ({ good: 15, dry: 10, warn: 0, warm: 0, rain: -35 })[zs] || 0;
    if (zs === 'rain') why.push('Monsoon — check roads');
    if (zs === 'snow') s += wantSnow ? 10 : (a > 2500 ? -30 : -10);
    if (closedHigh) s -= 40;
    if (ovr && ovr.verdict === 'caution') s -= 20;

    var snowChance = winter && a >= 2000;
    if (wantSnow) { if (snowChance) { s += 25; why.push('Snow likely'); } else s -= 20; }

    var vibes = p.vibes || [];
    var picked = st.interests.filter(function (i) { return i !== 'snow'; });
    var hits = picked.filter(function (i) { return vibes.indexOf(i) >= 0; });
    s += hits.length * 15;
    if (picked.length && !hits.length) s -= 25;
    hits.forEach(function (h) { why.push(h.charAt(0).toUpperCase() + h.slice(1)); });

    var crowd = p.crowd || 30;
    try { if (window.PP_CROWD) crowd = window.PP_CROWD.predict(p, date).value; } catch (e) { /* fall back to base crowd */ }
    if (st.quiet) { s += (60 - crowd) * 0.5; if (crowd < 35) why.push('Quiet · ' + Math.round(crowd) + '% crowd'); }
    else s += crowd * 0.05;

    s -= tr.hours * (nights <= 2 ? 4 : 2);
    if (nights < 3 && a > 3000) s -= 20;
    if (st.who === 'family') { if (a > 3500) s -= 25; if (a > 2700 && (p.crowd || 30) < 10) s -= 10; }
    if (st.who === 'couple' && (vibes.indexOf('nature') >= 0 || vibes.indexOf('offbeat') >= 0)) s += 5;
    if ((st.who === 'friends' || st.who === 'solo') && (vibes.indexOf('adventure') >= 0 || vibes.indexOf('trek') >= 0)) s += 6;

    return { p: p, s: s, tr: tr, crowd: crowd, why: why.slice(0, 4) };
  }

  function suggest() {
    var o = st.origin, date = new Date(val('tfDate') || todayISO()), nights = Math.max(1, Math.min(14, parseInt(val('tfNights'), 10) || 2));
    var list = places().map(function (p) { return score(p, o, date, nights); }).filter(Boolean).sort(function (a, b) { return b.s - a.s; });
    // Spread the top picks across valleys.
    var top = [], zones = {};
    var bar = list.length ? list[0].s - 25 : 0;   // only spread out among genuinely good options
    list.forEach(function (r) { var z = r.p.zone || ''; if (top.length < 3 && !zones[z] && r.s >= bar) { zones[z] = 1; top.push(r); } });
    list.forEach(function (r) { if (top.indexOf(r) < 0) top.push(r); });
    return top.slice(0, 8);
  }

  /* ---------- itinerary hook ---------- */
  window.PPTrip = {
    // Used by itinerary.js: travel from the chosen city to this place, or null.
    travel: function (p) {
      if (!st.origin || st.mode !== 'suggest' || !p) return null;
      var t = travelFrom(st.origin, p);
      return t ? { from: st.origin.name, hours: t.hours, label: fmtH(t.hours), route: t.route, far: !!t.far } : null;
    },
    setMode: setMode, run: run, plan: plan, pick: pick, toggle: toggle, more: function () { st.showAll = true; renderResults(); },
    _score: score, _travelFrom: travelFrom, _state: st, _origins: ORIGINS
  };

  /* ---------- UI ---------- */
  function val(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function injectStyles() {
    if (document.getElementById('tfStyles')) return;
    var s = document.createElement('style');
    s.id = 'tfStyles';
    s.textContent = [
      '.tf-modes{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}',
      '.tf-mode{min-height:44px;padding:0 18px;border-radius:999px;border:1.5px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:600 14px var(--fb);cursor:pointer}',
      '.tf-mode.on{background:#fff;color:var(--pine);border-color:#fff}',
      '#tfForm{display:none;margin-bottom:18px}',
      '.tf-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}',
      '@media(max-width:768px){.tf-grid{grid-template-columns:1fr 1fr}}',
      '.tf-grid .pi,.tf-grid .psel{width:100%;box-sizing:border-box;font-size:16px}',
      '.tf-grid select option{color:#1c2420}',
      '.tf-lbl{display:block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:rgba(255,255,255,.55);margin:0 0 8px}',
      '.tf-pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}',
      '.tf-pill{min-height:40px;padding:0 14px;border-radius:999px;border:1.5px solid rgba(255,255,255,.25);background:transparent;color:#fff;font:600 13px var(--fb);cursor:pointer}',
      '.tf-pill.on{background:#9fd3b0;border-color:#9fd3b0;color:#123222}',
      '.tf-go{width:100%;min-height:50px;margin-top:4px}',
      '#tfResults{display:none;margin-bottom:18px}',
      '.tf-head{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.5);margin:0 0 12px}',
      '.tf-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}',
      '@media(max-width:900px){.tf-cards{grid-template-columns:1fr}}',
      '.tf-card{background:#faf9f6;color:var(--ink);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px;font-family:var(--fb);border:2px solid transparent}',
      '.tf-card.on{border-color:#9fd3b0}',
      '.tf-top{display:flex;gap:12px;align-items:flex-start}',
      '.tf-emo{font-size:34px;line-height:1}',
      '.tf-name{font-family:var(--fd);font-size:22px;font-weight:700;color:var(--pine);line-height:1.1}',
      '.tf-dist{font-size:12.5px;color:#5a6a5d;margin-top:2px}',
      '.tf-desc{font-size:13.5px;line-height:1.5;color:#3d4a40}',
      '.tf-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.tf-chip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;background:#e3efe6;color:#1f4a32}',
      '.tf-chip.warn{background:#fbefe7;color:#8a4526}',
      '.tf-route{font-size:13px;line-height:1.45;background:#eaf0f6;color:#23466b;border-radius:10px;padding:8px 10px}',
      '.tf-plan{min-height:46px;border:none;border-radius:10px;background:var(--pine);color:#fff;font:700 14px var(--fb);cursor:pointer;margin-top:auto}',
      '.tf-more{margin-top:12px;min-height:42px;border:1.5px solid rgba(255,255,255,.35);background:none;color:#fff;border-radius:999px;padding:0 16px;font:600 13px var(--fb);cursor:pointer}',
      '.tf-empty{background:rgba(255,255,255,.08);border-radius:12px;padding:16px;color:#fff;font-size:14px;line-height:1.5}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function originOptions() {
    var groups = [['road', 'Drive in from'], ['far', 'Fly / train in from'], ['hill', 'Already in Himachal']];
    return '<option value="">Select your city…</option><option value="__loc">📍 My current location</option>' +
      groups.map(function (gp) {
        return '<optgroup label="' + gp[1] + '">' + ORIGINS.filter(function (o) { return o[3] === gp[0]; })
          .map(function (o) { return '<option value="' + esc(o[0]) + '">' + esc(o[0]) + '</option>'; }).join('') + '</optgroup>';
      }).join('');
  }

  function build() {
    var sec = document.getElementById('plansec');
    var form = sec && sec.querySelector('.plan-form');
    if (!form || document.getElementById('tfForm')) return;
    injectStyles();

    var modes = document.createElement('div');
    modes.className = 'tf-modes';
    modes.innerHTML = '<button type="button" class="tf-mode on" id="tfModeKnow" onclick="PPTrip.setMode(\'know\')">📍 I know where to go</button>' +
      '<button type="button" class="tf-mode" id="tfModeSuggest" onclick="PPTrip.setMode(\'suggest\')">✨ Suggest a place for me</button>';
    form.parentNode.insertBefore(modes, form);

    var box = document.createElement('div');
    box.id = 'tfForm';
    box.innerHTML =
      '<div class="tf-grid">' +
        '<div class="pg"><label for="tfOrigin">Starting from</label><select class="psel" id="tfOrigin" onchange="PPTrip.pick(this.value)">' + originOptions() + '</select></div>' +
        '<div class="pg"><label for="tfDate">Travel date</label><input type="date" class="pi" id="tfDate"/></div>' +
        '<div class="pg"><label for="tfNights">Nights</label><input type="number" class="pi" id="tfNights" value="3" min="1" max="14"/></div>' +
        '<div class="pg"><label for="tfMax">Max travel one way</label><select class="psel" id="tfMax" onchange="PPTrip._state.maxH=this.value">' +
          '<option value="auto">Auto (fits the trip)</option><option value="4">Up to 4 hours</option><option value="6">Up to 6 hours</option><option value="8">Up to 8 hours</option><option value="12">Up to 12 hours</option><option value="99">Any distance</option></select></div>' +
      '</div>' +
      '<span class="tf-lbl">Who is going</span><div class="tf-pills" id="tfWho">' +
        WHO.map(function (w) { return '<button type="button" class="tf-pill' + (w[0] === st.who ? ' on' : '') + '" data-v="' + w[0] + '" onclick="PPTrip.toggle(\'who\',\'' + w[0] + '\')">' + w[1] + '</button>'; }).join('') + '</div>' +
      '<span class="tf-lbl">What do you enjoy? (pick any)</span><div class="tf-pills" id="tfInt">' +
        INTERESTS.map(function (i) { return '<button type="button" class="tf-pill" data-v="' + i[0] + '" onclick="PPTrip.toggle(\'int\',\'' + i[0] + '\')">' + i[1] + '</button>'; }).join('') + '</div>' +
      '<span class="tf-lbl">Trip style</span><div class="tf-pills" id="tfStyle">' +
        '<button type="button" class="tf-pill on" data-v="quiet" onclick="PPTrip.toggle(\'quiet\',true)">🤫 Quiet &amp; offbeat</button>' +
        '<button type="button" class="tf-pill" data-v="any" onclick="PPTrip.toggle(\'quiet\',false)">Crowds are fine</button>' +
        '<button type="button" class="tf-pill on" data-v="relaxed" onclick="PPTrip.toggle(\'pace\',\'relaxed\')">🧘 Relaxed pace</button>' +
        '<button type="button" class="tf-pill" data-v="packed" onclick="PPTrip.toggle(\'pace\',\'packed\')">⚡ Packed days</button>' +
      '</div>' +
      '<button type="button" class="pfbtn tf-go" onclick="PPTrip.run()">Suggest places →</button>';
    form.parentNode.insertBefore(box, form.nextSibling);

    var res = document.createElement('div');
    res.id = 'tfResults';
    box.parentNode.insertBefore(res, box.nextSibling);

    var d = document.getElementById('tfDate');
    if (d) { d.value = todayISO(); d.min = new Date().toISOString().slice(0, 10); }
  }

  function setMode(m) {
    st.mode = m;
    var sec = document.getElementById('plansec');
    var form = sec && sec.querySelector('.plan-form');
    var sug = m === 'suggest';
    if (form) form.style.display = sug ? 'none' : '';
    document.getElementById('tfForm').style.display = sug ? 'block' : 'none';
    document.getElementById('tfResults').style.display = sug && st.results.length ? 'block' : 'none';
    document.getElementById('tfModeKnow').classList.toggle('on', !sug);
    document.getElementById('tfModeSuggest').classList.toggle('on', sug);
    if (!sug) { // back to normal planner: forget the start city so it isn't added to other plans
      var pr = document.getElementById('planRes');
      if (pr && pr.classList.contains('show') && document.getElementById('ppPlace').value) { try { runFC(); } catch (e) { /* planner not ready */ } }
    } else {
      var pr2 = document.getElementById('planRes');
      if (pr2 && !st.chosen) pr2.classList.remove('show');
    }
  }

  function toggle(kind, v) {
    if (kind === 'who') st.who = v;
    if (kind === 'int') { var i = st.interests.indexOf(v); if (i >= 0) st.interests.splice(i, 1); else st.interests.push(v); }
    if (kind === 'quiet') st.quiet = v;
    if (kind === 'pace') st.pace = v;
    var mark = function (id, on) { var w = document.getElementById(id); if (w) w.querySelectorAll('.tf-pill').forEach(function (b) { b.classList.toggle('on', on(b.getAttribute('data-v'))); }); };
    mark('tfWho', function (x) { return x === st.who; });
    mark('tfInt', function (x) { return st.interests.indexOf(x) >= 0; });
    mark('tfStyle', function (x) { return x === 'quiet' ? st.quiet : x === 'any' ? !st.quiet : x === st.pace; });
  }

  function pick(v) {
    if (!v) { st.origin = null; return; }
    if (v === '__loc') {
      if (!navigator.geolocation) { notify('Location is not available on this device — pick your city instead'); return; }
      notify('Finding your location…');
      navigator.geolocation.getCurrentPosition(function (pos) {
        var la = pos.coords.latitude, ln = pos.coords.longitude;
        var inHP = la > 30.3 && la < 33.3 && ln > 75.6 && ln < 79.1;
        var far = km(la, ln, 30.73, 76.78) > 700;
        st.origin = { name: 'your location', lat: la, lng: ln, kind: inHP ? 'hill' : far ? 'far' : 'road' };
        notify('Got it — starting from your location');
      }, function () {
        notify('Could not get your location — pick your city instead');
        var sel = document.getElementById('tfOrigin'); if (sel) sel.value = '';
        st.origin = null;
      }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
      return;
    }
    var o = ORIGINS.filter(function (x) { return x[0] === v; })[0];
    st.origin = o ? { name: o[0], lat: o[1], lng: o[2], kind: o[3] } : null;
  }

  function notify(msg) { try { toast(msg); } catch (e) { /* toast not loaded */ } }

  function run() {
    if (!st.origin) { notify('Please choose where you are starting from'); var s = document.getElementById('tfOrigin'); if (s) s.focus(); return; }
    st.results = suggest();
    st.showAll = false;
    st.chosen = null;
    renderResults();
    var r = document.getElementById('tfResults');
    if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderResults() {
    var el = document.getElementById('tfResults');
    if (!el) return;
    el.style.display = 'block';
    var nights = parseInt(val('tfNights'), 10) || 2;
    if (!st.results.length) {
      el.innerHTML = '<div class="tf-empty">No place fits all of that for these dates within ' + (st.maxH === '99' ? 'reach' : maxHoursFor(nights) + ' hours of ' + esc(st.origin.name)) +
        '. Try more nights, a longer travel limit, or fewer interests.</div>';
      return;
    }
    var list = st.showAll ? st.results : st.results.slice(0, 3);
    el.innerHTML = '<div class="tf-head">✨ Our picks for you · from ' + esc(st.origin.name) + ' · ' + nights + ' night' + (nights > 1 ? 's' : '') + '</div>' +
      '<div class="tf-cards">' + list.map(card).join('') + '</div>' +
      (!st.showAll && st.results.length > 3 ? '<button type="button" class="tf-more" onclick="PPTrip.more()">Show ' + (st.results.length - 3) + ' more ideas</button>' : '');
  }

  function card(r) {
    var p = r.p, tr = r.tr, long = tr.hours > 9;
    var chips = r.why.map(function (w) { return '<span class="tf-chip' + (/monsoon/i.test(w) ? ' warn' : '') + '">' + esc(w) + '</span>'; }).join('');
    return '<div class="tf-card' + (st.chosen === p.id ? ' on' : '') + '">' +
      '<div class="tf-top"><div class="tf-emo">' + esc(p.emoji || '🏔️') + '</div><div><div class="tf-name">' + esc(p.name) + '</div>' +
      '<div class="tf-dist">' + esc(p.district) + ' · ' + esc(p.altitude || '') + '</div></div></div>' +
      '<div class="tf-desc">' + esc(p.famousFor || p.desc || '') + '</div>' +
      '<div class="tf-chips">' + chips + '</div>' +
      '<div class="tf-route">' + (tr.far ? '✈️ Fly into ' + esc(tr.hub) + ', then 🚗 ' + fmtH(tr.hours) + ' by road' : '🚗 ' + fmtH(tr.hours) + ' from ' + esc(st.origin.name) + ' ' + esc(tr.route)) +
        (long ? '. Long drive: start before sunrise or break it overnight.' : '') + '</div>' +
      '<button type="button" class="tf-plan" onclick="PPTrip.plan(' + Number(p.id) + ')">Plan this trip →</button>' +
      '</div>';
  }

  function plan(id) {
    var p = places().filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    st.chosen = id;
    renderResults();
    var who = WHO.filter(function (w) { return w[0] === st.who; })[0] || WHO[0];
    window.PP_FINDER = { type: st.who === 'solo' ? 'friends' : st.who, pace: st.pace };
    var set = function (i, v) { var e = document.getElementById(i); if (e) e.value = v; };
    set('ppDate', val('tfDate') || todayISO());
    set('ppNights', Math.max(1, Math.min(14, parseInt(val('tfNights'), 10) || 2)));
    set('ppTravellers', who[2]);
    try { selectPlanPlace(p.id, p.name + ' — ' + p.district); } catch (e) { notify('Could not open the planner — please refresh'); }
    setTimeout(function () { var r = document.getElementById('planRes'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
