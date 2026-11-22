/* PahariPath — Things to do nearby
 * ---------------------------------------------------------------------------
 * Smaller spots around each destination (forests, waterfalls, old temples,
 * heritage, short hikes, local experiences). These are day spots, NOT
 * standalone destinations: they live inside a destination's page.
 *
 *  - A swipeable row of colourful cards placed right under the photos and
 *    name on the destination page (wraps openPD from app.js), so travellers
 *    run into it naturally. A small chip next to the name jumps to it.
 *  - Tapping a card opens a sheet with the full story, a practical tip,
 *    best months and a Google Maps link.
 *  - window.PPSpots is used by itinerary.js to turn spare days into real
 *    days around the place.
 *
 * Data: /spots.json (key = destination id). Edit that file to add spots.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';

  var DATA = null, LOADING = null;
  var KINDS = {
    forest:     { i: '🌲', en: 'Forest',     hi: 'जंगल',          c: ['#1f4a33', '#4f8a64'] },
    water:      { i: '💧', en: 'Water',      hi: 'झील / झरना',    c: ['#1d5675', '#58a2c4'] },
    temple:     { i: '🛕', en: 'Temple',     hi: 'मंदिर',          c: ['#9a4524', '#e0915f'] },
    heritage:   { i: '🏛', en: 'Heritage',   hi: 'विरासत',         c: ['#5b4330', '#a8875f'] },
    village:    { i: '🏡', en: 'Village',    hi: 'गाँव',           c: ['#6d5d1f', '#c2a94f'] },
    view:       { i: '⛰', en: 'Viewpoint',  hi: 'व्यू पॉइंट',     c: ['#33466e', '#7590c4'] },
    hike:       { i: '🥾', en: 'Hike',       hi: 'ट्रेक',          c: ['#3f5222', '#8aa34e'] },
    wildlife:   { i: '🦅', en: 'Wildlife',   hi: 'वन्यजीव',        c: ['#4d3460', '#9877b0'] },
    experience: { i: '🍎', en: 'Local life', hi: 'स्थानीय अनुभव', c: ['#8f3040', '#dd7584'] }
  };
  var TXT = {
    en: { title: 'Around', chip: function (n) { return '🧭 ' + n + ' things to do nearby'; }, walk: 'Walkable', away: function (m) { return fmt(m) + ' away'; }, busy: 'Busy', best: 'Best time', map: 'Get directions', close: 'Close', swipe: 'Swipe for more →' },
    hi: { title: 'आसपास —', chip: function (n) { return '🧭 पास में ' + n + ' जगहें'; }, walk: 'पैदल दूरी', away: function (m) { return fmt(m, 'hi') + ' दूर'; }, busy: 'भीड़', best: 'सबसे अच्छा समय', map: 'रास्ता देखें', close: 'बंद करें', swipe: 'और देखने के लिए स्वाइप करें →' }
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
      LOADING = fetch('/spots.json?v=20261122c').then(function (r) { return r.json(); })
        .then(function (j) { DATA = j || {}; return DATA; })
        .catch(function () { DATA = {}; return DATA; });
    }
    return LOADING;
  }
  function of(id) { var a = DATA && DATA[String(id)]; return Array.isArray(a) ? a : []; }
  // Quiet spots first, then by distance.
  function sorted(id) { return of(id).slice().sort(function (a, b) { return (a.busy ? 1 : 0) - (b.busy ? 1 : 0) || (a.m || 0) - (b.m || 0); }); }

  // ── styles ──────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('spotStyles')) return;
    var st = document.createElement('style');
    st.id = 'spotStyles';
    st.textContent =
      '#pdSpots{margin:4px 0 26px;scroll-margin-top:84px;min-width:0}' +
      '.pd-sp #pdSpots{margin:2px 0 4px}' +
      '#pd .pd-hg>*{min-width:0}#pd .pd-sp{min-width:0}#pdSpots{max-width:100%;overflow:hidden}' +
      '#pdSpots .sp2-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:10px}' +
      '#pdSpots .sp2-h b{font-family:var(--fd);font-size:24px;font-weight:600;color:var(--pine)}' +
      '#pdSpots .sp2-h b em{color:var(--clay)}' +
      '#pdSpots .sp2-h span{font-size:12px;color:var(--stone);white-space:nowrap}' +
      '#pdSpots .sp2-row{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 2px 10px;margin:0 -2px;-webkit-overflow-scrolling:touch;scrollbar-width:none}' +
      '#pdSpots .sp2-row::-webkit-scrollbar{display:none}' +
      '#pdSpots .sp2-c{flex:0 0 74%;max-width:270px;scroll-snap-align:start;border:0;padding:0;text-align:left;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 6px 18px rgba(26,61,43,.12);cursor:pointer;font-family:var(--fb);display:flex;flex-direction:column;transition:transform .15s}' +
      '#pdSpots .sp2-c:active{transform:scale(.98)}' +
      '#pdSpots .sp2-art{position:relative;height:118px;display:flex;align-items:flex-end;padding:12px;color:#fff}' +
      '#pdSpots .sp2-art .em{position:absolute;right:10px;top:4px;font-size:64px;line-height:1.2;opacity:.95;filter:drop-shadow(0 4px 8px rgba(0,0,0,.18))}' +
      '#pdSpots .sp2-art .kd{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.2);backdrop-filter:blur(4px);padding:4px 9px;border-radius:20px}' +
      '#pdSpots .sp2-art .bz{position:absolute;left:12px;top:12px;font-size:11px;font-weight:600;background:#fff;color:#a5502c;padding:3px 8px;border-radius:20px}' +
      '#pdSpots .sp2-b{padding:12px 14px 14px;display:flex;flex-direction:column;gap:5px;flex:1}' +
      '#pdSpots .sp2-n{font-size:16px;font-weight:600;color:var(--ink);line-height:1.3}' +
      '#pdSpots .sp2-m{font-size:12px;color:var(--stone)}' +
      '#pdSpots .sp2-d{font-size:13px;color:#4a5850;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '@media(min-width:900px){#pdSpots .sp2-c{flex-basis:260px}}' +
      '#pdSpotsChip{align-self:flex-start;border:0;background:linear-gradient(135deg,#1f4a33,#4f8a64);color:#fff;font:600 13px var(--fb);padding:9px 14px;border-radius:22px;cursor:pointer;box-shadow:0 4px 12px rgba(31,74,51,.25);min-height:38px}' +
      '#sp2Sheet{position:fixed;inset:0;z-index:10050;background:rgba(15,25,20,.45);display:flex;align-items:flex-end;justify-content:center;animation:sp2f .15s}' +
      '#sp2Sheet .sh{background:#fff;width:100%;max-width:520px;max-height:88vh;overflow:auto;border-radius:22px 22px 0 0;animation:sp2u .2s ease-out}' +
      '@media(min-width:700px){#sp2Sheet{align-items:center}#sp2Sheet .sh{border-radius:22px}}' +
      '#sp2Sheet .sp2-art{position:relative;height:150px;display:flex;align-items:flex-end;padding:16px;color:#fff}' +
      '#sp2Sheet .sp2-art .em{position:absolute;right:16px;top:8px;font-size:84px;line-height:1.2}' +
      '#sp2Sheet .sp2-art .kd{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:rgba(255,255,255,.22);padding:4px 10px;border-radius:20px}' +
      '#sp2Sheet .x{position:absolute;left:12px;top:12px;width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.9);font-size:16px;cursor:pointer}' +
      '#sp2Sheet .bd{padding:16px 18px 22px;display:flex;flex-direction:column;gap:10px;font-family:var(--fb)}' +
      '#sp2Sheet .nm{font-family:var(--fd);font-size:26px;font-weight:600;color:var(--pine);line-height:1.15}' +
      '#sp2Sheet .mt{display:flex;flex-wrap:wrap;gap:6px}' +
      '#sp2Sheet .mt span{font-size:12px;background:#eef3ef;color:#2d4a38;padding:5px 10px;border-radius:20px}' +
      '#sp2Sheet .mt span.bz{background:#fdeee6;color:#a5502c}' +
      '#sp2Sheet .ds{font-size:14.5px;color:#3c4a40;line-height:1.7}' +
      '#sp2Sheet .tp{font-size:13.5px;color:#5a4a1e;background:#fbf6e8;border-radius:10px;padding:10px 12px;line-height:1.55}' +
      '#sp2Sheet .go{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;background:var(--pine);color:#fff;font-weight:600;font-size:15px;text-decoration:none;margin-top:4px}' +
      '.sp2-art{overflow:hidden}' +
      '.sp2-art .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}' +
      '.sp2-art.has-ph .em{display:none}' +
      '.sp2-art.has-ph::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.55),rgba(0,0,0,0) 55%);pointer-events:none}' +
      '.sp2-art .kd,.sp2-art .bz,.sp2-art .cr,.sp2-art .x{z-index:2}' +
      '.sp2-art .kd{position:relative}' +
      '.sp2-art .cr{position:absolute;right:8px;bottom:6px;font-size:10px;color:rgba(255,255,255,.85);text-decoration:none;max-width:55%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#pdSpots .sp2-art{height:140px}#sp2Sheet .sp2-art{height:220px}' +
      '@keyframes sp2f{from{opacity:0}to{opacity:1}}@keyframes sp2u{from{transform:translateY(40px)}to{transform:none}}';
    document.head.appendChild(st);
  }

  // Photos come from Wikimedia Commons (free licences, credited to the author).
  // Special:FilePath serves a resized copy; if it fails, the coloured card stays.
  function photoUrl(f, w) { return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(f) + '?width=' + (w || 640); }
  function fileUrl(f) { return 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(String(f).replace(/ /g, '_')); }
  function art(s, big) {
    var k = KINDS[s.k] || KINDS.view, L = lang();
    var img = s.img ? '<img class="ph" src="' + esc(photoUrl(s.img, big ? 960 : 560)) + '" alt="' + esc(s.n) + '" loading="lazy" decoding="async" onerror="this.parentNode.classList.remove(\'has-ph\');this.remove()">' : '';
    var credit = s.img ? '<a class="cr" href="' + esc(fileUrl(s.img)) + '" target="_blank" rel="noopener" data-sp2cr="1">📷 ' + esc(s.by || 'Wikimedia Commons') + '</a>' : '';
    return '<div class="sp2-art' + (s.img ? ' has-ph' : '') + '" style="background:linear-gradient(135deg,' + k.c[0] + ',' + k.c[1] + ')">' + img +
      '<span class="em" aria-hidden="true">' + k.i + '</span>' +
      (s.busy && !big ? '<span class="bz">' + esc(T().busy) + '</span>' : '') +
      '<span class="kd">' + (s.img ? k.i + ' ' : '') + esc(k[L] || k.en) + '</span>' + credit + '</div>';
  }
  function dist(s) { var t = T(); return s.m > 0 ? t.away(s.m) : t.walk; }

  // ── destination page section ────────────────────────────────────────────
  var VIEW = { id: null };

  function host() {
    var pd = document.getElementById('pd'); if (!pd) return null;
    var el = document.getElementById('pdSpots');
    if (!el) { el = document.createElement('div'); el.id = 'pdSpots'; }
    // Phones: right under the name and the crowd meter, before facts and the
    // carbon box. Wide screens: full width under the photos + side panel.
    var narrow = window.matchMedia && window.matchMedia('(max-width: 899px)').matches;
    var crowdBox = pd.querySelector('.pd-sp .pd-box'), hg = pd.querySelector('.pd-hg'), desc = pd.querySelector('.pd-desc');
    var ref = narrow && crowdBox ? crowdBox.nextSibling : hg ? hg.nextSibling : desc;
    var parent = narrow && crowdBox ? crowdBox.parentNode : hg ? hg.parentNode : desc ? desc.parentNode : (pd.querySelector('.pd-in') || pd);
    if (el.parentNode !== parent || el.nextSibling !== ref) parent.insertBefore(el, ref || null);
    return el;
  }

  function chip(n) {
    var c = document.getElementById('pdSpotsChip');
    var sp = document.querySelector('#pd .pd-sp');
    if (!n || !sp) { if (c) c.style.display = 'none'; return; }
    if (!c) {
      c = document.createElement('button'); c.type = 'button'; c.id = 'pdSpotsChip';
      var first = sp.firstElementChild;
      if (first && first.nextSibling) sp.insertBefore(c, first.nextSibling); else sp.appendChild(c);
    }
    c.textContent = T().chip(n);
    c.style.display = '';
  }

  function render() {
    var el = host(); if (!el) return;
    var p = placeById(VIEW.id), list = sorted(VIEW.id);
    chip(p ? list.length : 0);
    if (!p || !list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    injectStyles();
    var t = T();
    el.style.display = '';
    el.innerHTML =
      '<div class="sp2-h"><b>' + esc(t.title) + ' <em>' + esc(p.name) + '</em></b>' + (list.length > 1 ? '<span>' + esc(t.swipe) + '</span>' : '') + '</div>' +
      '<div class="sp2-row">' + list.map(function (s, i) {
        return '<div class="sp2-c" role="button" tabindex="0" aria-label="' + esc(s.n) + '" data-sp2i="' + i + '">' + art(s) +
          '<div class="sp2-b"><div class="sp2-n">' + esc(s.n) + '</div>' +
          '<div class="sp2-m">' + esc(dist(s)) + (s.h ? ' · ' + esc(s.h) : '') + '</div>' +
          '<div class="sp2-d">' + esc(s.d) + '</div></div></div>';
      }).join('') + '</div>';
  }

  function openSheet(i) {
    var p = placeById(VIEW.id), s = sorted(VIEW.id)[i]; if (!s) return;
    var t = T(), q = s.q || (s.n + ', ' + (p ? p.name + ', ' : '') + 'Himachal Pradesh');
    closeSheet();
    var d = document.createElement('div');
    d.id = 'sp2Sheet'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', s.n);
    d.innerHTML = '<div class="sh">' + art(s, true).replace('</div>', '<button type="button" class="x" data-sp2x="1" aria-label="' + esc(t.close) + '">✕</button></div>') +
      '<div class="bd"><div class="nm">' + esc(s.n) + '</div>' +
      '<div class="mt"><span>📍 ' + esc(dist(s)) + '</span>' + (s.h ? '<span>⏱ ' + esc(s.h) + '</span>' : '') +
      (s.b ? '<span>🗓 ' + esc(t.best) + ': ' + esc(s.b) + '</span>' : '') + (s.busy ? '<span class="bz">' + esc(t.busy) + '</span>' : '') + '</div>' +
      '<div class="ds">' + esc(s.d) + '</div>' +
      (s.t ? '<div class="tp">💡 ' + esc(s.t) + '</div>' : '') +
      '<a class="go" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) + '" target="_blank" rel="noopener">' + esc(t.map) + ' →</a>' +
      '</div></div>';
    document.body.appendChild(d);
    try { if (window.plausible) window.plausible('Spot opened', { props: { spot: s.n, place: p ? p.name : '' } }); } catch (e) { /* ignore */ }
  }
  function closeSheet() { var d = document.getElementById('sp2Sheet'); if (d) d.remove(); }

  function onClick(e) {
    var tgt = e.target;
    if (!tgt.closest) return;
    var sh = document.getElementById('sp2Sheet');
    if (sh && (tgt === sh || tgt.closest('[data-sp2x]'))) { closeSheet(); return; }
    if (tgt.closest('#pdSpotsChip')) { var el = document.getElementById('pdSpots'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (tgt.closest('[data-sp2cr]')) return;   // photo credit link
    var c = tgt.closest('#pdSpots [data-sp2i]'); if (c) openSheet(+c.getAttribute('data-sp2i'));
  }

  function show(id) {
    VIEW = { id: +id };
    closeSheet();
    if (DATA) render();
    else { var el = host(); if (el) el.style.display = 'none'; chip(0); load().then(function () { if (VIEW.id === +id) render(); }); }
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSheet();
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('#pdSpots [data-sp2i]') && !e.target.closest('[data-sp2cr]')) { e.preventDefault(); openSheet(+e.target.closest('[data-sp2i]').getAttribute('data-sp2i')); }
    });
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
    var origClose = window.closePD;
    if (typeof origClose === 'function') window.closePD = function () { closeSheet(); return origClose.apply(this, arguments); };
    var origLang = window.ppSetLang;
    if (typeof origLang === 'function') window.ppSetLang = function () { var r = origLang.apply(this, arguments); try { if (VIEW.id) render(); } catch (e) { /* ignore */ } return r; };
    load();   // warm the cache for the itinerary planner
  }

  window.PPSpots = { ready: load, of: of, kinds: KINDS, refresh: function () { if (VIEW.id) render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
