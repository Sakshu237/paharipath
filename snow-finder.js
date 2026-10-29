/*!
 * PahariPath Snow Finder
 * "Where can I see snow?" for a chosen travel date.
 *  - Date within 15 days -> live forecast (fresh snowfall + snow on the ground)
 *  - Date further away   -> estimate from each place's altitude and the season
 * Uses ALL, PLACE_COORDS, _lmap, _markers, openPD, initMap and mapFilter from app.js.
 * Weather data: Open-Meteo.com (CC BY 4.0, attribution shown in the finder).
 */
(function () {
  'use strict';

  var CONFIG = {
    OPEN_METEO_KEY: '', // leave '' for testing; add the paid commercial key before taking real bookings
    LIVE_DAYS: 15        // dates up to this many days ahead use the live forecast
  };

  var TZ = 'Asia/Kolkata';
  var DAY = 864e5;
  var state = {
    date: null,
    places: null,
    forecast: null,
    forecastFailed: false,
    loading: null,
    showAll: false,
    layer: null,
    layerOn: false
  };

  /* ---------- access to app.js globals (top-level let/const are shared between classic scripts) ---------- */
  function appPlaces() { try { return ALL; } catch (e) { return []; } }
  function appCoords() { try { return PLACE_COORDS; } catch (e) { return {}; } }
  function appMap() { try { return _lmap; } catch (e) { return null; } }
  function appMarkers() { try { return _markers; } catch (e) { return {}; } }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
  function toUTC(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromUTC(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(d, n) { return fromUTC(toUTC(d) + n * DAY); }
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / DAY); }
  function fmt(d, opts) { return new Date(toUTC(d)).toLocaleDateString('en-IN', Object.assign({ timeZone: 'UTC' }, opts)); }
  function sessionGet(k) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
  function parseAlt(s) { var m = String(s || '').replace(/,/g, '').match(/\d+/); return m ? +m[0] : NaN; }

  /* ---------- data ---------- */
  function buildPlaces() {
    var coords = appCoords();
    return appPlaces().map(function (p) {
      var c = coords[p.id] || (isFinite(p.lat) && isFinite(p.lng) ? [p.lat, p.lng] : null);
      if (!c) return null;
      return { id: p.id, name: p.name, district: p.district || '', lat: +c[0], lng: +c[1], alt: parseAlt(p.altitude) };
    }).filter(Boolean);
  }

  function loadForecast(places) {
    var key = 'ppsf_fc_v1_' + todayStr() + '_' + places.length;
    var cached = sessionGet(key);
    if (cached) return Promise.resolve(cached);
    var base = CONFIG.OPEN_METEO_KEY ? 'https://customer-api.open-meteo.com/v1/forecast' : 'https://api.open-meteo.com/v1/forecast';
    var keyParam = CONFIG.OPEN_METEO_KEY ? '&apikey=' + encodeURIComponent(CONFIG.OPEN_METEO_KEY) : '';
    var result = { dates: null, byIndex: new Array(places.length) };
    var groups = chunk(places.map(function (p, i) { return { p: p, i: i }; }), 50);
    return Promise.all(groups.map(function (group) {
      var url = base +
        '?latitude=' + group.map(function (g) { return g.p.lat; }).join(',') +
        '&longitude=' + group.map(function (g) { return g.p.lng; }).join(',') +
        '&daily=snowfall_sum&hourly=snow_depth&timezone=' + encodeURIComponent(TZ) +
        '&forecast_days=16' + keyParam;
      return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('Open-Meteo ' + r.status); return r.json(); })
        .then(function (j) {
          var list = Array.isArray(j) ? j : [j];
          list.forEach(function (loc, k) {
            if (!result.dates) result.dates = loc.daily.time;
            var noon = loc.daily.time.map(function (d) {
              var h = loc.hourly.time.indexOf(d + 'T12:00');
              return h >= 0 ? loc.hourly.snow_depth[h] : null;
            });
            result.byIndex[group[k].i] = { fresh: loc.daily.snowfall_sum, depthNoon: noon };
          });
        });
    })).then(function () { sessionSet(key, result); return result; });
  }

  function ensureData() {
    if (state.places) return Promise.resolve();
    if (state.loading) return state.loading;
    var places = buildPlaces();
    if (!places.length) return Promise.reject(new Error('Places not loaded yet'));
    state.loading = loadForecast(places)
      .then(function (fc) { state.forecast = fc; })
      .catch(function (e) { state.forecastFailed = true; console.warn('[SnowFinder] forecast unavailable, using estimates', e); })
      .then(function () { state.places = places; });
    return state.loading;
  }

  /* ---------- snow chance ---------- */
  // Altitude (m) above which snow is likely / possible in each month, Himachal.
  var BANDS = {
    1: [2200, 1800], 2: [2300, 1900], 3: [2900, 2400], 4: [3800, 3200],
    5: [4500, 4000], 6: [5500, 5000], 7: [6000, 5500], 8: [6000, 5500],
    9: [5000, 4500], 10: [4200, 3600], 11: [3300, 2800], 12: [2600, 2000]
  };

  function isLive(date) {
    var dd = diffDays(todayStr(), date);
    return dd >= 0 && dd <= CONFIG.LIVE_DAYS && !!state.forecast && !state.forecastFailed &&
      !!state.forecast.dates && state.forecast.dates.indexOf(date) >= 0;
  }

  function assess(p, i, date) {
    if (isLive(date)) {
      var di = state.forecast.dates.indexOf(date);
      var f = state.forecast.byIndex[i] || { fresh: [], depthNoon: [] };
      var fresh = f.fresh[di] || 0;              // cm
      var depth = (f.depthNoon[di] || 0) * 100;  // m -> cm
      if (fresh >= 2) return { lvl: 3, score: 1000 + fresh + depth, badge: 'Snow forecast', note: 'About ' + Math.round(fresh) + ' cm of fresh snow expected.' };
      if (depth >= 5) return { lvl: 3, score: 500 + depth, badge: 'Snow on ground', note: 'About ' + Math.round(depth) + ' cm of snow likely on the ground.' };
      if (fresh >= 0.2) return { lvl: 2, score: 100 + fresh, badge: 'Light snow', note: 'Light snowfall possible on this day.' };
      if (depth >= 1) return { lvl: 2, score: depth, badge: 'Patchy snow', note: 'Some old snow may still be lying around.' };
      return { lvl: 1, score: 0, badge: 'No snow', note: 'No snow expected on this date.' };
    }
    var b = BANDS[+date.slice(5, 7)];
    var alt = isFinite(p.alt) ? p.alt : 0;
    if (alt >= b[0]) return { lvl: 3, score: alt, badge: 'High chance', note: 'Places this high usually have snow at this time of year.' };
    if (alt >= b[1]) return { lvl: 2, score: alt, badge: 'Medium chance', note: 'Snow here in some years at this time, not every year.' };
    return { lvl: 1, score: alt, badge: 'Low chance', note: 'Snow is rare here at this time of year.' };
  }

  function results(date) {
    return state.places.map(function (p, i) { return Object.assign({}, p, assess(p, i, date)); })
      .sort(function (a, b) { return b.lvl - a.lvl || b.score - a.score; });
  }

  /* ---------- styles (uses the site's --pine, --fb, --fd variables) ---------- */
  var CSS = '' +
    '.ppsf-overlay{position:fixed;inset:0;z-index:100000;background:rgba(10,20,15,.55);display:flex;justify-content:center;align-items:flex-start;overflow-y:auto;-webkit-overflow-scrolling:touch}' +
    '.ppsf-overlay[hidden]{display:none}' +
    '.ppsf-dialog{font-family:var(--fb,"DM Sans",sans-serif);background:#f4f6f4;color:#1c2420;width:100%;max-width:460px;min-height:100%;box-sizing:border-box}' +
    '@media(min-width:520px){.ppsf-overlay{padding:32px 16px}.ppsf-dialog{min-height:0;border-radius:20px;overflow:hidden}}' +
    '.ppsf-head{background:var(--pine,#1a3d2b);color:#fff;padding:16px 20px 22px;display:flex;flex-direction:column;gap:10px}' +
    '.ppsf-headrow{display:flex;justify-content:space-between;align-items:center}' +
    '.ppsf-brand{font-size:13px;font-weight:700;letter-spacing:.02em}' +
    '.ppsf-close{width:44px;height:44px;margin:-10px -12px -10px 0;border:0;background:transparent;color:#fff;cursor:pointer;font-size:26px;line-height:1}' +
    '.ppsf-head h2{margin:0;font-family:var(--fd,Georgia,serif);font-size:30px;line-height:1.1;font-weight:600;color:#fff}' +
    '.ppsf-head p{margin:0;font-size:14px;line-height:1.5;color:#d6e6dc}' +
    '.ppsf-body{padding:18px 20px 26px;display:flex;flex-direction:column;gap:12px}' +
    '.ppsf-label{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4c5a51}' +
    '.ppsf-chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}' +
    '.ppsf-chip{min-height:56px;padding:8px 6px;border-radius:12px;cursor:pointer;font:inherit;text-align:center;background:#fff;color:#1c2420;border:1.5px solid rgba(74,124,95,.22)}' +
    '.ppsf-chip[aria-pressed="true"]{background:var(--pine,#1a3d2b);color:#fff;border-color:var(--pine,#1a3d2b)}' +
    '.ppsf-chip b{display:block;font-size:14px}.ppsf-chip span{display:block;font-size:11px;margin-top:2px}' +
    '.ppsf-datepick{display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid rgba(74,124,95,.22);border-radius:12px;padding:10px 12px;font-size:13px;color:#4c5a51}' +
    '.ppsf-datepick input{margin-left:auto;font:inherit;font-size:14px;border:0;background:transparent;color:#1c2420;min-height:28px}' +
    '.ppsf-mode{padding:12px 14px;border-radius:12px;font-size:12px;line-height:1.45;color:#36423e;background:#eef1f7}' +
    '.ppsf-mode.live{background:#e3efe8}.ppsf-mode b{display:block;font-size:13px;color:#1c2420;margin-bottom:2px}' +
    '.ppsf-listhead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-top:4px}' +
    '.ppsf-listhead h3{margin:0;font-size:17px;font-weight:700;color:#1c2420}.ppsf-listhead span{font-size:12px;color:#4c5a51;white-space:nowrap}' +
    '.ppsf-list{display:flex;flex-direction:column;gap:10px}' +
    '.ppsf-item{display:flex;flex-direction:column;gap:8px;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer;background:#fff;border:1.5px solid #dde4df;border-radius:14px;padding:14px}' +
    '.ppsf-item:hover{border-color:var(--sage,#4a7c5f)}' +
    '.ppsf-item.l3{border-color:#b9d0ee}.ppsf-item.l1{opacity:.75}' +
    '.ppsf-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;width:100%}' +
    '.ppsf-name{font-size:16px;font-weight:700;color:#1c2420}' +
    '.ppsf-meta{display:block;font-size:12px;color:#4c5a51;margin-top:2px}' +
    '.ppsf-badge{flex-shrink:0;font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;background:#eceeed;color:#4c5a51}' +
    '.ppsf-item.l3 .ppsf-badge{background:#dce9fa;color:#1a4a85}.ppsf-item.l2 .ppsf-badge{background:#fcebcf;color:#7a4300}' +
    '.ppsf-note{font-size:13px;line-height:1.4;color:#26322e}' +
    '.ppsf-road{font-size:12px;font-weight:600;color:#8a3b00}' +
    '.ppsf-msg{padding:20px;text-align:center;font-size:14px;color:#4c5a51;background:#fff;border-radius:14px}' +
    '.ppsf-more{min-height:44px;border:1.5px solid rgba(74,124,95,.22);background:#fff;border-radius:12px;font:inherit;font-size:14px;font-weight:600;color:var(--pine,#1a3d2b);cursor:pointer}' +
    '.ppsf-mapbtn{min-height:48px;border:0;border-radius:12px;background:var(--pine,#1a3d2b);color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}' +
    '.ppsf-fine{margin:0;font-size:11px;line-height:1.5;color:#5a6662;text-align:center}.ppsf-fine a{color:var(--pine,#1a3d2b)}' +
    '.ppsf-maplegend{position:absolute;top:12px;left:56px;z-index:999;background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.18);padding:10px 12px;font-family:var(--fb,sans-serif);font-size:12px;color:#1c2420;display:flex;flex-direction:column;gap:5px;max-width:200px}' +
    '.ppsf-maplegend[hidden]{display:none}' +
    '.ppsf-maplegend b{font-size:13px}' +
    '.ppsf-maplegend button{margin-top:4px;min-height:32px;border:1.5px solid rgba(74,124,95,.22);border-radius:16px;background:#fff;color:var(--pine,#1a3d2b);font:inherit;font-weight:600;cursor:pointer}' +
    '.ppsf-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}' +
    '.ppsf-pop{font-family:var(--fb,sans-serif)}.ppsf-pop b{font-size:14px;color:#1c2420}.ppsf-pop span{display:block;font-size:12px;margin-top:4px;color:#36423e}' +
    '.ppsf-pop button{margin-top:8px;padding:5px 12px;border:0;border-radius:8px;background:var(--pine,#1a3d2b);color:#fff;font:inherit;font-size:12px;font-weight:600;cursor:pointer}' +
    '.map-filter-btn.snow-btn.act{background:#1a4a85;border-color:#1a4a85;color:#fff}';

  var COLORS = { 3: ['#1A4A85', '#5B9BE6'], 2: ['#9A5300', '#F2A541'], 1: ['#7C8783', '#C9D0CD'] };

  function injectCSS() {
    if (document.getElementById('ppsf-css')) return;
    var s = document.createElement('style');
    s.id = 'ppsf-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- date chips ---------- */
  function chips() {
    var today = todayStr();
    var dow = new Date(toUTC(today)).getUTCDay();
    var sat = addDays(today, (6 - dow + 7) % 7);
    var list = [
      { d: sat, sub: sat === today ? 'Today' : 'This weekend' },
      { d: addDays(sat, 7), sub: 'Next weekend' }
    ];
    [[12, 25, 'Christmas'], [1, 10, 'Mid winter'], [2, 14, 'Valentine’s'], [3, 15, 'Late winter']].forEach(function (s) {
      var y = +today.slice(0, 4);
      var d = y + '-' + String(s[0]).padStart(2, '0') + '-' + String(s[1]).padStart(2, '0');
      if (d < today) d = (y + 1) + d.slice(4);
      if (diffDays(today, d) > 14) list.push({ d: d, sub: s[2] });
    });
    list.sort(function (a, b) { return a.d < b.d ? -1 : 1; });
    return list.slice(0, 6);
  }

  /* ---------- finder (modal) ---------- */
  var el = {};
  function buildModal() {
    if (el.overlay) return;
    injectCSS();
    var o = document.createElement('div');
    o.className = 'ppsf-overlay';
    o.hidden = true;
    o.innerHTML =
      '<div class="ppsf-dialog" role="dialog" aria-modal="true" aria-labelledby="ppsf-title">' +
        '<div class="ppsf-head">' +
          '<div class="ppsf-headrow"><span class="ppsf-brand">❄️ PahariPath Snow Finder</span>' +
          '<button type="button" class="ppsf-close" aria-label="Close">×</button></div>' +
          '<h2 id="ppsf-title">Where can I see snow?</h2>' +
          '<p>Pick your travel date. We’ll show which places are most likely to have snow that day.</p>' +
        '</div>' +
        '<div class="ppsf-body">' +
          '<div class="ppsf-label">Your travel date</div>' +
          '<div class="ppsf-chips"></div>' +
          '<label class="ppsf-datepick">📅 <span>Or choose any date</span><input type="date" class="ppsf-date"></label>' +
          '<div class="ppsf-mode" aria-live="polite"></div>' +
          '<div class="ppsf-listhead"><h3></h3><span></span></div>' +
          '<div class="ppsf-list"></div>' +
          '<button type="button" class="ppsf-more" hidden></button>' +
          '<button type="button" class="ppsf-mapbtn">🗺️ Show these on the map</button>' +
          '<p class="ppsf-fine">Snow chance is a guide, not a promise. Weather in the hills changes fast.<br>Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a></p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(o);
    el.overlay = o;
    el.chips = o.querySelector('.ppsf-chips');
    el.date = o.querySelector('.ppsf-date');
    el.mode = o.querySelector('.ppsf-mode');
    el.h = o.querySelector('.ppsf-listhead h3');
    el.count = o.querySelector('.ppsf-listhead span');
    el.list = o.querySelector('.ppsf-list');
    el.more = o.querySelector('.ppsf-more');
    el.mapbtn = o.querySelector('.ppsf-mapbtn');

    o.querySelector('.ppsf-close').addEventListener('click', close);
    o.addEventListener('click', function (e) { if (e.target === o) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !o.hidden) close(); });
    el.date.addEventListener('change', function () { if (el.date.value) setDate(el.date.value); });
    el.more.addEventListener('click', function () { state.showAll = !state.showAll; render(); });
    el.mapbtn.addEventListener('click', function () { close(); showOnMap(); });
    el.chips.addEventListener('click', function (e) {
      var b = e.target.closest('.ppsf-chip');
      if (b) setDate(b.getAttribute('data-d'));
    });
    el.list.addEventListener('click', function (e) {
      var b = e.target.closest('.ppsf-item');
      if (!b) return;
      var id = +b.getAttribute('data-id');
      close();
      if (typeof openPD === 'function') openPD(id);
    });
  }

  var lastFocus = null;
  function open() {
    buildModal();
    lastFocus = document.activeElement;
    if (!state.date) state.date = chips()[0].d;
    el.overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    el.overlay.querySelector('.ppsf-close').focus();
    render();
    ensureData().then(function () { render(); }, function () { render(true); });
  }
  function close() {
    if (!el.overlay) return;
    el.overlay.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function setDate(d) {
    state.date = d;
    state.showAll = false;
    if (el.overlay && !el.overlay.hidden) render();
    if (state.layerOn) drawLayer(false);
  }

  function render(failed) {
    var today = todayStr();
    el.date.min = today;
    el.date.max = addDays(today, 365);
    el.date.value = state.date;
    el.chips.innerHTML = chips().map(function (c) {
      return '<button type="button" class="ppsf-chip" data-d="' + c.d + '" aria-pressed="' + (c.d === state.date) + '">' +
        '<b>' + esc(fmt(c.d, { day: 'numeric', month: 'short' })) + '</b><span>' + esc(c.sub) + '</span></button>';
    }).join('');

    el.h.textContent = 'Best snow bets · ' + fmt(state.date, { weekday: 'short', day: 'numeric', month: 'short' });

    if (failed || !state.places) {
      el.list.innerHTML = '<div class="ppsf-msg">' + (failed ? 'Sorry, places are still loading. Please try again in a moment.' : 'Checking the mountains…') + '</div>';
      el.count.textContent = '';
      el.more.hidden = true;
      el.mode.className = 'ppsf-mode';
      el.mode.innerHTML = '';
      if (failed) { state.loading = null; }
      return;
    }

    var live = isLive(state.date);
    var near = diffDays(today, state.date) <= CONFIG.LIVE_DAYS;
    el.mode.className = 'ppsf-mode' + (live ? ' live' : '');
    el.mode.innerHTML = live
      ? '<b>Live forecast (date is within ' + CONFIG.LIVE_DAYS + ' days)</b>Based on the latest weather forecast for each place. Forecasts more than a week ahead can still change.'
      : (near
        ? '<b>Estimate (forecast not available right now)</b>Showing the usual snow chance for this time of year, based on each place’s altitude.'
        : '<b>Estimate (date is far away)</b>No one can forecast snow this far ahead, so we show the usual snow chance for this time of year, based on each place’s altitude.');

    var res = results(state.date);
    var good = res.filter(function (r) { return r.lvl >= 2; });
    var shown = state.showAll || !good.length ? res : good;
    el.count.textContent = good.length + ' of ' + res.length + ' with snow';

    el.list.innerHTML = (good.length ? '' : '<div class="ppsf-msg">Snow is unlikely anywhere on this date. Try a date between December and March.</div>') +
      shown.map(function (r) {
        var meta = [r.district, isFinite(r.alt) ? r.alt.toLocaleString('en-IN') + ' m' : ''].filter(Boolean).join(' · ');
        return '<button type="button" class="ppsf-item l' + r.lvl + '" data-id="' + r.id + '">' +
          '<span class="ppsf-top"><span><span class="ppsf-name">' + esc(r.name) + '</span>' +
          (meta ? '<span class="ppsf-meta">' + esc(meta) + '</span>' : '') + '</span>' +
          '<span class="ppsf-badge">' + esc(r.badge) + '</span></span>' +
          '<span class="ppsf-note">' + esc(r.note) + '</span>' +
          (r.lvl === 3 && r.alt >= 2400 ? '<span class="ppsf-road">⚠️ Roads can be blocked for a day or two after heavy snow. Check before you go.</span>' : '') +
          '</button>';
      }).join('');

    var hidden = res.length - good.length;
    el.more.hidden = !good.length || !hidden;
    el.more.textContent = state.showAll ? 'Hide places with low chance' : 'Show ' + hidden + ' more places with low chance';
  }

  /* ---------- map ---------- */
  var legend = null;
  function buildLegend() {
    if (legend) return legend;
    var wrap = document.getElementById('lfmap-wrap');
    if (!wrap) return null;
    injectCSS();
    legend = document.createElement('div');
    legend.className = 'ppsf-maplegend';
    legend.hidden = true;
    legend.innerHTML =
      '<b class="ppsf-when"></b>' +
      '<span><i class="ppsf-dot" style="background:' + COLORS[3][1] + ';border:1px solid ' + COLORS[3][0] + '"></i>Snow likely</span>' +
      '<span><i class="ppsf-dot" style="background:' + COLORS[2][1] + ';border:1px solid ' + COLORS[2][0] + '"></i>Possible</span>' +
      '<span><i class="ppsf-dot" style="background:' + COLORS[1][1] + ';border:1px solid ' + COLORS[1][0] + '"></i>Unlikely</span>' +
      '<button type="button">📅 Change date</button>';
    legend.querySelector('button').addEventListener('click', open);
    wrap.appendChild(legend);
    return legend;
  }

  function snowButton() { return document.getElementById('snowMapBtn'); }

  function waitForMap() {
    return new Promise(function (resolve, reject) {
      if (appMap()) return resolve(appMap());
      try { if (typeof initMap === 'function') initMap(); } catch (e) { /* ignore */ }
      var n = 0;
      var t = setInterval(function () {
        if (appMap()) { clearInterval(t); resolve(appMap()); }
        else if (++n > 100) { clearInterval(t); reject(new Error('Map not ready')); }
      }, 100);
    });
  }

  function hideCrowdMarkers(map) {
    var m = appMarkers();
    Object.keys(m).forEach(function (k) { if (map.hasLayer(m[k])) map.removeLayer(m[k]); });
  }

  function layerOff(restoreMarkers) {
    var map = appMap();
    state.layerOn = false;
    if (state.layer && map) map.removeLayer(state.layer);
    state.layer = null;
    if (legend) legend.hidden = true;
    var b = snowButton();
    if (b) b.classList.remove('act');
    if (restoreMarkers && typeof mapFilter === 'function') {
      var allBtn = document.querySelector('.map-filter-btn');
      if (allBtn) mapFilter('all', allBtn);
    }
  }

  function showOnMap() {
    var wrap = document.getElementById('mapwrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!state.date) state.date = chips()[0].d;
    waitForMap().then(function (map) {
      document.querySelectorAll('.map-filter-btn').forEach(function (b) { b.classList.remove('act'); });
      var b = snowButton();
      if (b) b.classList.add('act');
      state.layerOn = true;
      return ensureData().then(function () { drawLayer(true); });
    }).catch(function (e) {
      console.warn('[SnowFinder]', e);
      layerOff(false);
    });
  }

  function mapToggle() {
    if (state.layerOn) layerOff(true);
    else showOnMap();
  }

  function drawLayer(fit) {
    var map = appMap();
    if (!map || !state.places || !state.layerOn) return;
    hideCrowdMarkers(map);
    if (state.layer) map.removeLayer(state.layer);
    var res = results(state.date);
    var group = L.layerGroup();
    var snowy = [];
    res.slice().reverse().forEach(function (r) {
      var c = COLORS[r.lvl];
      var m = L.circleMarker([r.lat, r.lng], {
        radius: r.lvl === 3 ? 9 : 7, color: c[0], weight: 2, fillColor: c[1], fillOpacity: r.lvl === 1 ? 0.45 : 0.9
      });
      m.bindPopup('<div class="ppsf-pop"><b>' + esc(r.name) + '</b><span>' + esc(r.badge) + '</span><span>' + esc(r.note) + '</span>' +
        '<button type="button" onclick="_lmap&&_lmap.closePopup();openPD(' + r.id + ')">View place →</button></div>');
      m.bindTooltip(r.name, { direction: 'top', offset: [0, -8], className: 'lf-tip' });
      group.addLayer(m);
      if (r.lvl >= 2) snowy.push([r.lat, r.lng]);
    });
    state.layer = group.addTo(map);
    var lg = buildLegend();
    if (lg) {
      lg.querySelector('.ppsf-when').textContent = '❄️ ' + fmt(state.date, { weekday: 'short', day: 'numeric', month: 'short' });
      lg.hidden = false;
    }
    if (fit && snowy.length) map.fitBounds(snowy, { padding: [40, 40], maxZoom: 9 });
  }

  // Any other map filter button turns the snow layer off (mapFilter restores the crowd pins itself).
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.map-filter-btn');
    if (!b || b.id === 'snowMapBtn' || !state.layerOn) return;
    // mapFilter buttons restore the pins themselves; others (e.g. Near Me) need them back.
    layerOff(String(b.getAttribute('onclick') || '').indexOf('mapFilter') === -1);
  }, true);

  /* ---------- Explore section "❄️ Snow" filter ---------- */
  // Returns the ids of places with snow likely or possible this coming weekend.
  // Uses the live forecast once loaded; until then the altitude estimate, then refreshes the grid.
  function snowSet() {
    var date = chips()[0].d;
    var places = state.places || buildPlaces();
    var out = new Set();
    places.forEach(function (p, i) { if (assess(p, i, date).lvl >= 2) out.add(p.id); });
    if (!state.places) {
      ensureData().then(function () {
        var b = document.querySelector('.pf-btn.act');
        if (b && /plFilter\('snow'/.test(b.getAttribute('onclick') || '') && typeof plFilter === 'function') plFilter('snow', b);
      }, function () { /* keep the estimate */ });
    }
    return out;
  }

  /* ---------- public API ---------- */
  window.PPSnow = { open: open, showOnMap: showOnMap, mapToggle: mapToggle, setDate: setDate, snowSet: snowSet };
})();
