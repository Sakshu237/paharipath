/* PahariPath — Things to do nearby
 * ---------------------------------------------------------------------------
 * Smaller spots around each destination (forests, waterfalls, old temples,
 * heritage, short hikes, local experiences). These are day spots, NOT
 * standalone destinations: they live inside a destination's page.
 *
 *  - Adds a "Things to do around <place>" section to the destination page
 *    (wraps openPD from app.js), with a filter by type when there are many.
 *  - Each spot: how far, how long, what it is, a practical tip, best months,
 *    a "busy spot" tag for popular places, and a Google Maps link.
 *  - window.PPSpots is used by itinerary.js to turn empty "slow days" into
 *    real days around the place.
 *
 * Data: /spots.json (key = destination id). Edit that file to add spots.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var DATA = null, LOADING = null;
  var KINDS = {
    forest:     { i: '🌲', en: 'Forest',      hi: 'जंगल' },
    water:      { i: '💧', en: 'Water',       hi: 'झील / झरना' },
    temple:     { i: '🛕', en: 'Temple',      hi: 'मंदिर' },
    heritage:   { i: '🏛', en: 'Heritage',    hi: 'विरासत' },
    village:    { i: '🏡', en: 'Village',     hi: 'गाँव' },
    view:       { i: '⛰', en: 'Viewpoint',   hi: 'व्यू पॉइंट' },
    hike:       { i: '🥾', en: 'Hike',        hi: 'ट्रेक' },
    wildlife:   { i: '🦅', en: 'Wildlife',    hi: 'वन्यजीव' },
    experience: { i: '🍎', en: 'Local life',  hi: 'स्थानीय अनुभव' }
  };
  var TXT = {
    en: { title: 'Things to do around', sub: 'Smaller places close by — walk, drive or hike out and come back the same day.', all: 'All', walk: 'Walkable', drive: function (m) { return 'about ' + fmt(m) + ' away'; }, busy: 'Busy spot', best: 'Best', map: 'Directions', more: function (n) { return 'Show ' + n + ' more'; } },
    hi: { title: 'आसपास क्या करें —', sub: 'पास की छोटी जगहें — पैदल, गाड़ी या ट्रेक से जाएँ और उसी दिन लौट आएँ।', all: 'सभी', walk: 'पैदल दूरी', drive: function (m) { return 'लगभग ' + fmt(m, 'hi') + ' दूर'; }, busy: 'भीड़ वाली जगह', best: 'सबसे अच्छा समय', map: 'रास्ता देखें', more: function (n) { return n + ' और देखें'; } }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); }
  function fmt(m, lang) {
    var h = Math.floor(m / 60), r = m % 60;
    if (lang === 'hi') return h ? h + ' घंटे' + (r ? ' ' + r + ' मिनट' : '') : m + ' मिनट';
    return h ? h + 'h' + (r ? ' ' + r + 'm' : '') : m + ' min';
  }
  function lang() { try { var v = localStorage.getItem('pp_lang') || 'en'; return /hi/.test(v) ? 'hi' : 'en'; } catch (e) { return 'en'; } }
  function T() { return TXT[lang()] || TXT.en; }
  function placeById(id) { try { return (typeof ALL !== 'undefined' ? ALL : []).find(function (p) { return p.id === +id; }); } catch (e) { return null; } }

  function load() {
    if (DATA) return Promise.resolve(DATA);
    if (!LOADING) {
      LOADING = fetch('/spots.json?v=20261122a').then(function (r) { return r.json(); })
        .then(function (j) { DATA = j || {}; return DATA; })
        .catch(function () { DATA = {}; return DATA; });
    }
    return LOADING;
  }
  function of(id) { var a = DATA && DATA[String(id)]; return Array.isArray(a) ? a : []; }

  // ── styles ──────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('spotStyles')) return;
    var st = document.createElement('style');
    st.id = 'spotStyles';
    st.textContent =
      '#pdSpots{margin:26px 0 30px}' +
      '#pdSpots .sp2-h{font-family:var(--fd);font-size:22px;color:var(--pine);margin-bottom:4px}' +
      '#pdSpots .sp2-h em{color:var(--clay)}' +
      '#pdSpots .sp2-s{font-size:13px;color:var(--stone);margin-bottom:12px}' +
      '#pdSpots .sp2-f{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}' +
      '#pdSpots .sp2-f button{min-height:34px;padding:0 12px;border-radius:17px;border:1px solid rgba(74,124,95,.25);background:#fff;color:var(--ink);font:500 12px var(--fb);cursor:pointer}' +
      '#pdSpots .sp2-f button.on{background:var(--pine);border-color:var(--pine);color:#fff}' +
      '#pdSpots .sp2-g{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}' +
      '#pdSpots .sp2-c{background:#fff;border:1px solid rgba(74,124,95,.14);border-radius:14px;padding:14px 15px;display:flex;flex-direction:column;gap:6px}' +
      '#pdSpots .sp2-k{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--sage,#4a7c5f);display:flex;gap:6px;align-items:center;flex-wrap:wrap}' +
      '#pdSpots .sp2-busy{background:#fdeee6;color:#a5502c;border-radius:6px;padding:2px 7px;text-transform:none;letter-spacing:0}' +
      '#pdSpots .sp2-n{font-size:16px;font-weight:600;color:var(--ink);line-height:1.3}' +
      '#pdSpots .sp2-m{font-size:12px;color:var(--stone)}' +
      '#pdSpots .sp2-d{font-size:13.5px;color:#3c4a40;line-height:1.6}' +
      '#pdSpots .sp2-t{font-size:12.5px;color:#5a4a1e;background:#fbf6e8;border-radius:8px;padding:7px 9px;line-height:1.5}' +
      '#pdSpots .sp2-a{margin-top:auto;padding-top:4px}' +
      '#pdSpots .sp2-a a{font-size:13px;font-weight:600;color:var(--pine);text-decoration:none;display:inline-flex;align-items:center;min-height:36px}' +
      '#pdSpots .sp2-more{margin-top:12px;min-height:40px;padding:0 16px;border-radius:10px;border:1px solid rgba(74,124,95,.3);background:#fff;color:var(--pine);font:600 13px var(--fb);cursor:pointer}';
    document.head.appendChild(st);
  }

  // ── destination page section ────────────────────────────────────────────
  var VIEW = { id: null, kind: 'all', all: false };

  function host() {
    var el = document.getElementById('pdSpots');
    if (el) return el;
    var pd = document.getElementById('pd'); if (!pd) return null;
    var anchor = pd.querySelector('.pd-desc');
    el = document.createElement('div');
    el.id = 'pdSpots';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling);
    else (pd.querySelector('.pd-in') || pd).appendChild(el);
    return el;
  }

  function card(s, p, t) {
    var k = KINDS[s.k] || KINDS.view, L = lang();
    var q = s.q || (s.n + ', ' + (p ? p.name + ', ' : '') + 'Himachal Pradesh');
    var dist = s.m > 0 ? t.drive(s.m) : t.walk;
    return '<div class="sp2-c">' +
      '<div class="sp2-k"><span>' + k.i + ' ' + esc(k[L] || k.en) + '</span>' + (s.busy ? '<span class="sp2-busy">' + esc(t.busy) + '</span>' : '') + '</div>' +
      '<div class="sp2-n">' + esc(s.n) + '</div>' +
      '<div class="sp2-m">' + esc(dist) + (s.h ? ' · ' + esc(s.h) : '') + (s.b ? ' · ' + esc(t.best) + ': ' + esc(s.b) : '') + '</div>' +
      '<div class="sp2-d">' + esc(s.d) + '</div>' +
      (s.t ? '<div class="sp2-t">💡 ' + esc(s.t) + '</div>' : '') +
      '<div class="sp2-a"><a href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">📍 ' + esc(t.map) + ' →</a></div>' +
      '</div>';
  }

  function render() {
    var el = host(); if (!el) return;
    var p = placeById(VIEW.id), list = of(VIEW.id);
    if (!p || !list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    injectStyles();
    var t = T(), L = lang();
    // Quiet spots first, then by distance.
    var sorted = list.slice().sort(function (a, b) { return (a.busy ? 1 : 0) - (b.busy ? 1 : 0) || (a.m || 0) - (b.m || 0); });
    var kinds = []; sorted.forEach(function (s) { if (kinds.indexOf(s.k) < 0) kinds.push(s.k); });
    if (VIEW.kind !== 'all' && kinds.indexOf(VIEW.kind) < 0) VIEW.kind = 'all';
    var shown = VIEW.kind === 'all' ? sorted : sorted.filter(function (s) { return s.k === VIEW.kind; });
    var LIMIT = 6, cut = !VIEW.all && shown.length > LIMIT ? shown.length - LIMIT : 0;
    var filters = sorted.length > 4 && kinds.length > 1
      ? '<div class="sp2-f">' + ['all'].concat(kinds).map(function (k) {
          var lab = k === 'all' ? t.all : ((KINDS[k] || {}).i + ' ' + ((KINDS[k] || {})[L] || (KINDS[k] || {}).en || k));
          return '<button type="button" data-sp2k="' + esc(k) + '" class="' + (VIEW.kind === k ? 'on' : '') + '">' + esc(lab) + '</button>';
        }).join('') + '</div>'
      : '';
    el.style.display = '';
    el.innerHTML =
      '<div class="sp2-h">' + esc(t.title) + ' <em>' + esc(p.name) + '</em></div>' +
      '<div class="sp2-s">' + esc(t.sub) + '</div>' + filters +
      '<div class="sp2-g">' + shown.slice(0, cut ? LIMIT : shown.length).map(function (s) { return card(s, p, t); }).join('') + '</div>' +
      (cut ? '<button type="button" class="sp2-more" data-sp2more="1">' + esc(t.more(cut)) + '</button>' : '');
  }

  function onClick(e) {
    var b = e.target.closest && e.target.closest('#pdSpots button'); if (!b) return;
    if (b.getAttribute('data-sp2more')) { VIEW.all = true; render(); return; }
    var k = b.getAttribute('data-sp2k'); if (k) { VIEW.kind = k; VIEW.all = false; render(); }
  }

  function show(id) {
    VIEW = { id: +id, kind: 'all', all: false };
    if (DATA) render();
    else { var el = host(); if (el) el.style.display = 'none'; load().then(function () { if (VIEW.id === +id) render(); }); }
  }

  function init() {
    document.addEventListener('click', onClick);
    var orig = window.openPD;
    if (typeof orig === 'function' && !orig._spots) {
      var wrapped = function (id) {
        var r = orig.apply(this, arguments);
        try { show(id); } catch (e) { /* never break the page */ }
        return r;
      };
      wrapped._spots = true;
      window.openPD = wrapped;
    }
    var origLang = window.ppSetLang;
    if (typeof origLang === 'function') window.ppSetLang = function () { var r = origLang.apply(this, arguments); try { if (VIEW.id) render(); } catch (e) { /* ignore */ } return r; };
    load();   // warm the cache for the itinerary planner
  }

  window.PPSpots = { ready: load, of: of, kinds: KINDS, refresh: function () { if (VIEW.id) render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
