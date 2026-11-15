/*!
 * PahariPath — simplified app shell
 * ------------------------------------------------------------------
 * One short screen per job instead of one very long page:
 *   Home · Explore · Crowd · Plan · Saved   (bottom tabs on phones, top links on desktop)
 * A "Going:" date bar drives every crowd level, the snow line and the plan.
 * A "From:" city drives travel times (trip-finder.js engine).
 *
 * Reuses everything that already works in app.js and friends:
 *   ALL, MEDIA, openPD, closePD, getSaved, saveSaved, toast, selectPlanPlace, runFC,
 *   initMap, PP_CROWD (crowd-predict.js), PPTrip (trip-finder.js), PPSnow (snow-finder.js).
 * Old home sections stay in the page (their code still runs) and are shown
 * only on their own tab: Plan → #plansec, Map → #mapwrap, Stays → #stays-bg.
 *
 * Load AFTER app.js, trip-finder.js and snow-finder.js.
 */
/* global ALL, MEDIA, openPD, closePD, getSaved, saveSaved, toast, selectPlanPlace, runFC, initMap, _lmap, renderAll, goTo */
(function () {
  'use strict';

  var WA_NUMBER = '919317110366'; // PahariPath support WhatsApp (same as Help & Support)

  /* ---------------- text (English / Hindi) ---------------- */
  var T = {
    en: {
      going: 'Going:', from: 'From', today: 'Today', weekend: 'This weekend', nextWeekend: 'Next weekend', pick: 'Pick date',
      h1a: 'Same Himachal.', h1b: 'Without the crowd.',
      sub: 'Crowd forecasts for 146 offbeat places — pick a quiet one for your dates.',
      searchPh: 'Search a place, e.g. Tirthan', go: 'Go',
      helpTitle: 'Not sure where to go?', helpSub: 'Find your place in 3 taps',
      step: function (n) { return 'Question ' + n + ' of 3'; }, close: 'Close',
      q1: 'Where are you coming from?', q2: 'How many days do you have?', q3: 'What would make the trip?',
      d2: '2–3 days', d4: '4–5 days', d6: '6 days or more',
      likeVillage: 'Quiet village life', likeNature: 'Forest, rivers, nature', likeSnow: 'Snow', likeTrek: 'Treks & adventure', likeTemple: 'Temples & culture',
      otherCity: 'Another city…', inHP: 'I’m already in Himachal',
      forYou: 'Picked for you', change: 'Change answers', withKids: 'Travelling with kids or elders',
      seePlace: 'See place', planTrip: 'Plan trip', noPicks: 'Nothing fits all of that. Try more days or another interest.',
      quietOn: 'Quiet on', leastBusy: 'Least busy on', quietToday: 'Quiet today', seeAll: 'See all',
      snowOn: 'Snow likely on', snowToday: 'Snow likely today', snowNone: 'No snow expected at places you can drive to on these dates.', snowMore: 'Open snow finder',
      stayTitle: 'Need a homestay?', staySub: 'Tell us where and when. We’ll WhatsApp you 2–3 local homestays within 24 hours.',
      stayBtn: 'Find me a stay', stayBrowse: 'Browse homestay previews',
      trust: 'Built by a small Himachali team from Hamirpur, for travellers who want the real hills — not the traffic jams.',
      trust1: 'Udyam registered', trust2: 'Prices kept low', trust3: 'Live crowd forecasts',
      exploreTitle: 'Explore', all: 'All', quiet: 'Quiet', near: 'Close to me', snow: 'Snow', temples: 'Temples',
      mapView: 'Map view', showMore: 'Show more', places: function (n) { return n === 1 ? '1 place' : n + ' places'; },
      noResults: 'No places match. Try another word or filter.',
      crowdTitle: 'How busy is it?', quietest: 'Quietest', avoid: 'Busiest — avoid if you can',
      planIntro: 'Plan your trip',
      savedTitle: 'Saved', savedEmpty: 'Tap ♡ on any place to save it here. Then send your shortlist to family on WhatsApp.',
      sendFamily: 'Send shortlist to family', plansTitle: 'My plans (work offline)', remove: 'Remove',
      savePlan: 'Save this plan', planSaved: 'Plan saved — open it from Saved, even offline', sharePlan: 'Send plan to family',
      planHere: 'Plan my trip here', stayHere: 'Find me a stay here',
      vq: 'Very quiet', q: 'Quiet', m: 'Moderate', c: 'Crowded', p: 'Packed', closed: 'Closed (snow)',
      hrsFrom: function (h, c) { return h + ' from ' + c; }, fly: function (hub, h) { return 'Fly to ' + hub + ' + ' + h; },
      formTitle: 'Find me a stay', fName: 'Your name', fPhone: 'WhatsApp number', fWhere: 'Where', wherePh: 'e.g. Tirthan Valley — or “anywhere quiet”', fWhen: 'When', fGuests: 'Guests',
      fBudget: 'Budget per night', b1: 'Under ₹2,000', b2: '₹2,000–3,500', b3: '₹3,500+', fNote: 'Anything else? (optional)',
      send: 'Send request', free: 'Free. No payment now.', sending: 'Sending…',
      sentTitle: 'Request sent', sentSub: 'We’ll WhatsApp you 2–3 local homestays within 24 hours. You choose, then book.',
      done: 'Done', needName: 'Please add your name', needPhone: 'Please add a 10-digit WhatsApp number', failed: 'Couldn’t send. Please try again or WhatsApp us.',
      tabs: ['Home', 'Explore', 'Crowd', 'Plan', 'Saved'], stays: 'Stays', blog: 'Blog',
      waList: function (d) { return 'Where should we go? (' + d + ')'; }, waVote: 'Reply with the number you like 👆'
    },
    hi: {
      going: 'कब:', from: 'कहाँ से', today: 'आज', weekend: 'इस वीकेंड', nextWeekend: 'अगला वीकेंड', pick: 'तारीख चुनें',
      h1a: 'वही हिमाचल,', h1b: 'बिना भीड़ के।',
      sub: '146 अनछुई जगहों पर भीड़ का अनुमान — अपनी तारीखों के लिए शांत जगह चुनें।',
      searchPh: 'जगह खोजें, जैसे Tirthan', go: 'खोजें',
      helpTitle: 'कहाँ जाएँ, तय नहीं?', helpSub: '3 टैप में अपनी जगह पाएँ',
      step: function (n) { return 'सवाल ' + n + ' / 3'; }, close: 'बंद करें',
      q1: 'आप कहाँ से आ रहे हैं?', q2: 'आपके पास कितने दिन हैं?', q3: 'यात्रा में क्या चाहिए?',
      d2: '2–3 दिन', d4: '4–5 दिन', d6: '6 दिन या ज़्यादा',
      likeVillage: 'शांत गाँव', likeNature: 'जंगल, नदी, प्रकृति', likeSnow: 'बर्फ़', likeTrek: 'ट्रेक और एडवेंचर', likeTemple: 'मंदिर और संस्कृति',
      otherCity: 'कोई और शहर…', inHP: 'मैं हिमाचल में ही हूँ',
      forYou: 'आपके लिए चुनी गई', change: 'जवाब बदलें', withKids: 'बच्चों या बुज़ुर्गों के साथ',
      seePlace: 'जगह देखें', planTrip: 'प्लान बनाएँ', noPicks: 'इन सब से मेल खाती जगह नहीं मिली। ज़्यादा दिन या दूसरी पसंद चुनें।',
      quietOn: 'शांत जगहें:', leastBusy: 'सबसे कम भीड़:', quietToday: 'आज शांत जगहें', seeAll: 'सभी देखें',
      snowOn: 'बर्फ़ की संभावना:', snowToday: 'आज बर्फ़ की संभावना', snowNone: 'इन तारीखों पर सड़क से पहुँचने वाली जगहों पर बर्फ़ की उम्मीद नहीं।', snowMore: 'स्नो फ़ाइंडर खोलें',
      stayTitle: 'होमस्टे चाहिए?', staySub: 'बताइए कहाँ और कब। हम 24 घंटे में WhatsApp पर 2–3 स्थानीय होमस्टे भेजेंगे।',
      stayBtn: 'मेरे लिए होमस्टे ढूँढें', stayBrowse: 'होमस्टे की झलक देखें',
      trust: 'हमीरपुर की एक छोटी हिमाचली टीम ने बनाया — उन यात्रियों के लिए जो असली पहाड़ चाहते हैं, ट्रैफ़िक जाम नहीं।',
      trust1: 'Udyam रजिस्टर्ड', trust2: 'कम दाम', trust3: 'भीड़ का लाइव अनुमान',
      exploreTitle: 'जगहें खोजें', all: 'सभी', quiet: 'शांत', near: 'मेरे पास', snow: 'बर्फ़', temples: 'मंदिर',
      mapView: 'मैप देखें', showMore: 'और देखें', places: function (n) { return n + ' जगहें'; },
      noResults: 'कोई जगह नहीं मिली। दूसरा शब्द या फ़िल्टर आज़माएँ।',
      crowdTitle: 'कितनी भीड़ है?', quietest: 'सबसे शांत', avoid: 'सबसे ज़्यादा भीड़ — हो सके तो बचें',
      planIntro: 'अपनी यात्रा प्लान करें',
      savedTitle: 'सेव की गई', savedEmpty: 'किसी भी जगह पर ♡ दबाएँ, वो यहाँ सेव होगी। फिर लिस्ट परिवार को WhatsApp पर भेजें।',
      sendFamily: 'लिस्ट परिवार को भेजें', plansTitle: 'मेरे प्लान (ऑफ़लाइन भी)', remove: 'हटाएँ',
      savePlan: 'प्लान सेव करें', planSaved: 'प्लान सेव हो गया — Saved में खोलें, ऑफ़लाइन भी', sharePlan: 'प्लान परिवार को भेजें',
      planHere: 'यहाँ का प्लान बनाएँ', stayHere: 'यहाँ होमस्टे ढूँढें',
      vq: 'बहुत शांत', q: 'शांत', m: 'ठीक-ठाक', c: 'भीड़', p: 'बहुत भीड़', closed: 'बंद (बर्फ़)',
      hrsFrom: function (h, c) { return c + ' से ' + h; }, fly: function (hub, h) { return hub + ' तक फ़्लाइट + ' + h; },
      formTitle: 'मेरे लिए होमस्टे ढूँढें', fName: 'आपका नाम', fPhone: 'WhatsApp नंबर', fWhere: 'कहाँ', wherePh: 'जैसे Tirthan Valley — या “कोई भी शांत जगह”', fWhen: 'कब', fGuests: 'मेहमान',
      fBudget: 'प्रति रात बजट', b1: '₹2,000 से कम', b2: '₹2,000–3,500', b3: '₹3,500+', fNote: 'कुछ और? (ज़रूरी नहीं)',
      send: 'रिक्वेस्ट भेजें', free: 'मुफ़्त। अभी कोई पेमेंट नहीं।', sending: 'भेज रहे हैं…',
      sentTitle: 'रिक्वेस्ट भेज दी', sentSub: 'हम 24 घंटे में WhatsApp पर 2–3 स्थानीय होमस्टे भेजेंगे। आप चुनें, फिर बुक करें।',
      done: 'ठीक है', needName: 'कृपया अपना नाम लिखें', needPhone: 'कृपया 10 अंकों का WhatsApp नंबर लिखें', failed: 'भेज नहीं पाए। फिर कोशिश करें या WhatsApp करें।',
      tabs: ['होम', 'खोजें', 'भीड़', 'प्लान', 'सेव'], stays: 'होमस्टे', blog: 'ब्लॉग',
      waList: function (d) { return 'कहाँ चलें? (' + d + ')'; }, waVote: 'जो पसंद हो उसका नंबर भेजें 👆'
    }
  };

  var TABS = ['home', 'explore', 'crowd', 'plan', 'saved'];
  var CITY_QUICK = [['Delhi', 'Delhi NCR'], ['Chandigarh', 'Chandigarh / Punjab'], ['Mumbai', 'Mumbai / Pune'], ['Bengaluru', 'Bengaluru / South']];
  var LIKES = { village: ['offbeat', 'culture'], nature: ['nature'], snow: ['snow'], trek: ['trek', 'adventure'], temple: ['spiritual'] };

  /* ---------------- state ---------------- */
  var S = {
    tab: 'home', lang: load('pp_lang', 'en'), dateKey: 'now', customDate: null,
    origin: load('pp_origin', 'Delhi'),
    help: { step: 0, city: null, days: null, like: null, kids: false },
    q: '', chip: 'all', exploreN: 20, stayDone: false, budget: 'b2'
  };
  function load(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function t() { return T[S.lang] || T.en; }

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"'`]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]; }); }
  function $(id) { return document.getElementById(id); }
  function places() { try { return ALL || []; } catch (e) { return []; } }
  function media() { try { return MEDIA || {}; } catch (e) { return {}; } }
  function saved() { try { return getSaved(); } catch (e) { return []; } }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function fmtDay(d) {
    try { return d.toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch (e) { return d.toDateString().slice(0, 10); }
  }
  function fmtRange(a, b) {
    if (a.getMonth() === b.getMonth()) { return a.getDate() + '–' + fmtShort(b); }
    return fmtShort(a) + '–' + fmtShort(b);
  }
  function fmtShort(d) {
    try { return d.toLocaleDateString(S.lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' }); }
    catch (e) { return d.toDateString().slice(4, 10); }
  }

  /* ---------------- dates ---------------- */
  // Memoised: building the long-weekend list walks 75 days of calendar, so it must not run
  // inside per-place crowd lookups or sort comparators (that froze the page for seconds).
  var _dopts = null, _doptsKey = '';
  function dateOptions() {
    var key = S.lang + '|' + ymd(new Date()) + '|' + (S.customDate ? ymd(S.customDate) : '');
    if (_dopts && _doptsKey === key) return _dopts;
    _doptsKey = key;
    return (_dopts = buildDateOptions());
  }
  function buildDateOptions() {
    var now = new Date(), opts = [{ key: 'now', label: t().today, d: null }];
    var dow = now.getDay();
    // Next Saturday (on Sunday the weekend is over, so look at the coming one).
    var sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (dow === 0 ? 6 : (6 - dow)));
    var lws = [];
    try { lws = window.PP_CROWD ? PP_CROWD.upcomingLongWeekends(now, 75) : []; } catch (e) { /* calendar not ready */ }
    var inLW = lws.some(function (lw) { return sat >= new Date(lw.start.getFullYear(), lw.start.getMonth(), lw.start.getDate()) && sat <= lw.end; });
    if (!inLW && dow !== 6) opts.push({ key: 'wk', label: (dow === 0 ? t().nextWeekend : t().weekend) + ' · ' + fmtShort(sat), short: fmtShort(sat), d: sat });
    try {
      lws.slice(0, 2).forEach(function (lw, i) {
        var nm = lw.names && lw.names[0] ? ' · ' + lw.names[0] : '';
        opts.push({ key: 'lw' + i, label: fmtRange(lw.start, lw.end) + nm, short: fmtRange(lw.start, lw.end), names: (lw.names || []).join(', '), d: lw.peakDay || lw.start });
      });
    } catch (e) { /* calendar not ready */ }
    if (S.customDate) opts.push({ key: 'custom', label: fmtDay(S.customDate), short: fmtShort(S.customDate), d: S.customDate });
    return opts;
  }
  function curDate() {
    var o = dateOptions().find(function (x) { return x.key === S.dateKey; }) || dateOptions()[0];
    return o;
  }
  function dateLabelShort() { var o = curDate(); return o.key === 'now' ? t().today : (o.short || o.label); }
  function planDate() { var o = curDate(); if (o.d) return new Date(o.d); var d = new Date(); return d; }

  /* ---------------- crowd ---------------- */
  var _cc = {};
  function crowd(p) {
    var k = p.id + '|' + S.dateKey;
    if (_cc[k]) return _cc[k];
    var o = curDate();
    var r = { value: p.crowd || 30, closed: false, inSeason: true };
    try {
      if (window.PP_CROWD) r = o.key === 'now' ? PP_CROWD.now(p) : PP_CROWD.predict(p, o.d);
    } catch (e) { /* fall back to base crowd */ }
    return (_cc[k] = r);
  }
  function word(p) {
    var r = crowd(p), v = r.value, tt = t();
    if (r.closed) return { w: tt.closed, fg: '#3b4a7a', bg: '#eef0f6', v: v };
    if (v < 20) return { w: tt.vq, fg: '#245c3a', bg: '#dcefe2', v: v };
    if (v < 40) return { w: tt.q, fg: '#2d5a40', bg: '#e7f1ea', v: v };
    if (v < 60) return { w: tt.m, fg: '#7a5410', bg: '#f6ecd6', v: v };
    if (v < 80) return { w: tt.c, fg: '#9b3a1e', bg: '#f6e1d8', v: v };
    return { w: tt.p, fg: '#8a2412', bg: '#f3d5ca', v: v };
  }
  function sortVal(p) { var r = crowd(p); return r.value + (r.closed ? 200 : r.inSeason === false ? 60 : 0); }
  // Sort by a key computed once per item (not inside the comparator).
  function sortBy(list, fn) {
    return list.map(function (p) { return [fn(p), p]; }).sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });
  }

  /* ---------------- travel ---------------- */
  function originObj(name) {
    var list = (window.PPTrip && PPTrip.origins) || [];
    var o = list.find(function (x) { return x[0] === name; }) || list[0];
    return o ? { name: o[0], lat: o[1], lng: o[2], kind: o[3] } : null;
  }
  function fmtH(h) { if (window.PPTrip && PPTrip.fmtH) return PPTrip.fmtH(h); return '~' + Math.round(h) + 'h'; }
  var _tc = {};
  function travel(p) {
    var k = p.id + '|' + S.origin;
    if (_tc[k] !== undefined) return _tc[k];
    var out = null;
    try {
      var o = originObj(S.origin);
      var r = o && PPTrip.travelFrom(o, p);
      if (r) out = { hours: r.hours, far: !!r.far, hub: r.hub ? String(r.hub).split(' (')[0] : '' };
    } catch (e) { /* engine not loaded */ }
    return (_tc[k] = out);
  }
  function reach(p) {
    var r = travel(p); if (!r) return p.district || '';
    var h = fmtH(r.hours);
    if (S.lang === 'hi') h = h.replace('h', ' घंटे');
    return r.far ? t().fly(r.hub.replace(' airport', ''), h) : t().hrsFrom(h, S.origin);
  }
  function tier(p) { try { return PPTrip.tierOf(p.id); } catch (e) { return 'A'; } }

  /* ---------------- pieces ---------------- */
  function img(p) {
    var m = media()[p.id], src = m && m.images && m.images[0];
    return src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.remove()">' : '<span aria-hidden="true">' + esc(p.emoji || '⛰️') + '</span>';
  }
  function pill(p) { var w = word(p); return '<span class="sp-pill" style="background:' + w.bg + ';color:' + w.fg + '">' + esc(w.w) + '</span>'; }
  function heart(p) {
    var on = saved().indexOf(p.id) >= 0;
    return '<button class="sp-heart" data-act="save" data-id="' + p.id + '" aria-label="' + (on ? 'Remove from saved' : 'Save') + '" aria-pressed="' + on + '">' + (on ? '❤️' : '🤍') + '</button>';
  }
  function tile(p) {
    return '<button class="sp-tile" data-act="open" data-id="' + p.id + '"><div class="sp-img">' + img(p) + '</div><div class="sp-tb">' +
      pill(p) + '<span class="sp-name">' + esc(p.name) + '</span><span class="sp-small">' + esc(reach(p)) + '</span></div></button>';
  }
  function item(p) {
    return '<div class="sp-item"><button class="sp-open" data-act="open" data-id="' + p.id + '"><span class="sp-img">' + img(p) + '</span><span class="sp-tx">' +
      '<span class="sp-name">' + esc(p.name) + '</span><span class="sp-small">' + esc(reach(p)) + '</span>' + pill(p) + '</span></button>' + heart(p) + '</div>';
  }

  /* ---------------- screens ---------------- */
  function renderBar() {
    var el = $('spBar'); if (!el) return;
    var opts = dateOptions(), tt = t();
    var origins = (window.PPTrip && PPTrip.origins) || [['Delhi'], ['Chandigarh'], ['Mumbai'], ['Bengaluru']];
    el.innerHTML = '<div class="sp-bar-in"><span class="sp-bar-lbl">' + esc(tt.going) + '</span><div class="sp-scroll">' +
      opts.map(function (o) { return '<button class="sp-chip' + (o.key === S.dateKey ? ' on' : '') + '" data-act="date" data-key="' + o.key + '">' + esc(o.label) + '</button>'; }).join('') +
      '<button class="sp-chip" data-act="pickdate">📅 ' + esc(tt.pick) + '</button><input type="date" id="spDateIn" class="sp-datein" min="' + ymd(new Date()) + '" aria-label="' + esc(tt.pick) + '">' +
      '<label class="sp-bar-lbl" for="spFrom" style="margin-left:6px">' + esc(tt.from) + '</label><select id="spFrom" class="sp-from">' +
      origins.map(function (o) { return '<option' + (o[0] === S.origin ? ' selected' : '') + '>' + esc(o[0]) + '</option>'; }).join('') +
      '</select></div></div>';
  }

  function renderHome() {
    var tt = t(), h = S.help, el = $('spHome'); if (!el) return;
    var html = '<div class="sp-wrap"><h1 class="sp-h1">' + esc(tt.h1a) + ' <em>' + esc(tt.h1b) + '</em></h1><p class="sp-sub">' + esc(tt.sub) + '</p>' +
      '<form class="sp-search" data-form="search" role="search"><span aria-hidden="true">🔍</span><label for="spQ" class="sp-datein">' + esc(tt.searchPh) + '</label>' +
      '<input id="spQ" type="search" placeholder="' + esc(tt.searchPh) + '" value="' + esc(S.q) + '" autocomplete="off"><button class="sp-btn" type="submit">' + esc(tt.go) + '</button></form>';

    // help me choose
    if (h.step === 0) {
      html += '<button class="sp-help-cta" data-act="help-open"><span style="font-size:26px" aria-hidden="true">🧭</span><span style="flex:1"><b>' + esc(tt.helpTitle) + '</b><span>' + esc(tt.helpSub) + '</span></span><span aria-hidden="true">›</span></button>';
    } else if (h.step <= 3) {
      var opts = h.step === 1
        ? CITY_QUICK.map(function (c) { return [c[0], c[1]]; }).concat([['__hp', tt.inHP], ['__other', tt.otherCity]])
        : h.step === 2 ? [['2', tt.d2], ['4', tt.d4], ['6', tt.d6]]
          : [['village', tt.likeVillage], ['nature', tt.likeNature], ['snow', tt.likeSnow], ['trek', tt.likeTrek], ['temple', tt.likeTemple]];
      html += '<div class="sp-card" style="max-width:560px;margin-top:18px"><div style="display:flex;justify-content:space-between;align-items:center"><span class="sp-muted" style="font-weight:600">' + esc(tt.step(h.step)) +
        '</span><button class="sp-link" data-act="help-close">' + esc(tt.close) + '</button></div><div class="sp-steps"><i class="on"></i><i class="' + (h.step >= 2 ? 'on' : '') + '"></i><i class="' + (h.step >= 3 ? 'on' : '') + '"></i></div>' +
        '<div class="sp-q">' + esc(tt['q' + h.step]) + '</div>' +
        opts.map(function (o) { return '<button class="sp-opt" data-act="help-answer" data-val="' + esc(o[0]) + '">' + esc(o[1]) + '</button>'; }).join('') +
        (h.step === 1 && h.city === '__other' ? '' : '') + '</div>';
    } else {
      html += '<div class="sp-sec" style="max-width:720px"><div class="sp-row"><h2 class="sp-h2">' + esc(tt.forYou) + '</h2><button class="sp-link" data-act="help-restart">' + esc(tt.change) + '</button></div>' +
        '<label style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:15px;margin-bottom:8px"><input type="checkbox" id="spKids"' + (h.kids ? ' checked' : '') + ' style="width:20px;height:20px"> ' + esc(tt.withKids) + '</label>';
      var picks = suggestions();
      if (!picks.length) html += '<div class="sp-empty">' + esc(tt.noPicks) + '</div>';
      picks.forEach(function (r) {
        var p = r.p;
        html += '<div class="sp-pick"><div class="sp-top"><span class="sp-img">' + img(p) + '</span><span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px"><span class="sp-name">' + esc(p.name) + '</span>' +
          '<span class="sp-small">' + esc(reach(p)) + '</span>' + pill(p) + '</span>' + heart(p) + '</div>' +
          (r.why && r.why.length ? '<div class="sp-why">' + r.why.map(function (w) { return '<span>' + esc(w) + '</span>'; }).join('') + '</div>' : '') +
          '<div class="sp-2"><button class="sp-btn ghost" data-act="open" data-id="' + p.id + '">' + esc(tt.seePlace) + '</button><button class="sp-btn" data-act="plan" data-id="' + p.id + '">' + esc(tt.planTrip) + '</button></div></div>';
      });
      html += '</div>';
    }

    // quiet on your dates
    // Trip-worthy, open, in season — quietest first. On peak dates (Christmas, New Year) few
    // places stay under 40%, so top up with the least busy of the rest rather than show 2 cards.
    var pool = sortBy(places().filter(function (p) { var r = crowd(p); return tier(p) === 'A' && !r.closed && r.inSeason !== false; }), sortVal);
    var quiet = pool.filter(function (p) { return crowd(p).value < 40; });
    var topped = quiet.length < 6;
    if (topped) quiet = pool.slice(0, 6);
    quiet = quiet.slice(0, 10);
    html += '<div class="sp-sec"><div class="sp-row"><h2 class="sp-h2">' + esc(topped ? tt.leastBusy + ' ' + dateLabelShort() : S.dateKey === 'now' ? tt.quietToday : tt.quietOn + ' ' + dateLabelShort()) + '</h2><button class="sp-link" data-act="tab" data-tab="crowd">' + esc(tt.seeAll) + '</button></div>' +
      '<div class="sp-hlist">' + quiet.map(tile).join('') + '</div></div>';

    // snow
    var snow = snowNames();
    html += '<div class="sp-sec"><div class="sp-snow"><b>❄️ ' + esc(S.dateKey === 'now' ? tt.snowToday : tt.snowOn + ' ' + dateLabelShort()) + '</b><p>' + esc(snow.length ? snow.slice(0, 6).join(', ') : tt.snowNone) + '</p>' +
      '<button class="sp-link" data-act="snow" style="color:#24406b">' + esc(tt.snowMore) + ' ›</button></div></div>';

    // stay concierge
    html += '<div class="sp-sec"><div class="sp-dark"><h3>' + esc(tt.stayTitle) + '</h3><p>' + esc(tt.staySub) + '</p><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
      '<button class="sp-btn light" data-act="stay">' + esc(tt.stayBtn) + '</button><button class="sp-link" data-act="tab" data-tab="stays" style="color:#f3c9b4">' + esc(tt.stayBrowse) + ' ›</button></div></div></div>';

    // trust
    html += '<div class="sp-sec"><div class="sp-trust">' + esc(tt.trust) + '<div class="sp-tags"><span>' + esc(tt.trust1) + '</span><span>' + esc(tt.trust2) + '</span><span>' + esc(tt.trust3) + '</span></div></div></div></div>';
    el.innerHTML = html;
  }

  function suggestions() {
    var h = S.help;
    if (!window.PPTrip || !PPTrip.suggestFor) return [];
    var name = h.city === '__hp' ? 'Hamirpur' : h.city && h.city !== '__other' ? h.city : S.origin;
    var o = originObj(name); if (!o) return [];
    try {
      return PPTrip.suggestFor({ origin: o, date: planDate(), nights: +h.days || 2, interests: LIKES[h.like] || [], who: h.kids ? 'family' : 'couple', limit: 3 });
    } catch (e) { console.warn('[simple] suggest failed', e); return []; }
  }

  function snowNames() {
    try {
      if (!window.PPSnow || !PPSnow.snowFor) return [];
      var set = PPSnow.snowFor(ymd(planDate()));
      return places().filter(function (p) { return set.has(p.id); }).map(function (p) { return p.name; });
    } catch (e) { return []; }
  }

  function exploreList() {
    var q = S.q.trim().toLowerCase(), tt = t();
    var snowSet = null;
    if (S.chip === 'snow') { try { snowSet = PPSnow.snowFor(ymd(planDate())); } catch (e) { snowSet = new Set(); } }
    return sortBy(places().filter(function (p) {
      if (q && (p.name + ' ' + (p.district || '') + ' ' + (p.famousFor || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.chip === 'quiet') return crowd(p).value < 30 && !crowd(p).closed;
      if (S.chip === 'near') { var r = travel(p); return r && r.hours <= (r.far ? 5 : 8); }
      if (S.chip === 'snow') return snowSet.has(p.id);
      if (S.chip === 'temples') return (p.vibes || []).indexOf('spiritual') >= 0;
      return true;
    }), sortVal);
  }

  function renderExplore() {
    var tt = t(), el = $('spExplore'); if (!el) return;
    var chips = [['all', tt.all], ['quiet', tt.quiet], ['near', tt.near], ['snow', tt.snow], ['temples', tt.temples]];
    el.innerHTML = '<div class="sp-wrap"><div class="sp-row"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.exploreTitle) + '</h1><button class="sp-btn ghost" data-act="tab" data-tab="map" style="min-height:42px">🗺️ ' + esc(tt.mapView) + '</button></div>' +
      '<form class="sp-search" data-form="search" role="search" style="margin-top:4px"><span aria-hidden="true">🔍</span><label for="spQ2" class="sp-datein">' + esc(tt.searchPh) + '</label>' +
      '<input id="spQ2" type="search" placeholder="' + esc(tt.searchPh) + '" value="' + esc(S.q) + '" autocomplete="off"></form>' +
      '<div class="sp-scroll" style="margin:14px -16px 0;padding:0 16px">' + chips.map(function (c) { return '<button class="sp-chip big' + (S.chip === c[0] ? ' on' : '') + '" data-act="chip" data-chip="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      '<div id="spExList"></div></div>';
    renderExploreList();
  }
  function renderExploreList() {
    var el = $('spExList'); if (!el) return;
    var tt = t(), list = exploreList();
    el.innerHTML = '<p class="sp-muted" style="margin:14px 0 10px">' + esc(tt.places(list.length)) + ' · ' + esc(dateLabelShort()) + '</p>' +
      (list.length ? '<div class="sp-grid">' + list.slice(0, S.exploreN).map(item).join('') + '</div>' : '<div class="sp-empty">' + esc(tt.noResults) + '</div>') +
      (list.length > S.exploreN ? '<button class="sp-btn ghost full" data-act="more" style="margin-top:6px">' + esc(tt.showMore) + '</button>' : '');
  }

  function renderCrowd() {
    var tt = t(), el = $('spCrowd'); if (!el) return;
    var list = sortBy(places(), sortVal);
    var open = list.filter(function (p) { return !crowd(p).closed; });
    var busiest = sortBy(open, function (p) { return -crowd(p).value; }).slice(0, 5);
    var o = curDate(), note = o.names || '';
    if (!note) {
      try {
        var di = PP_CROWD.dayInfo(o.d || new Date());
        if (di && di.run && di.run.isLong) note = (di.run.names || []).join(', ') + ' · ' + fmtRange(di.run.start, di.run.end);
      } catch (e) { /* no calendar */ }
    }
    el.innerHTML = '<div class="sp-wrap"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.crowdTitle) + '</h1><p class="sp-sub">' + esc(dateLabelShort()) + (note ? ' · ' + esc(note) : '') + '</p>' +
      '<div class="sp-sec"><h2 class="sp-h2" style="font-size:22px;margin-bottom:12px">' + esc(tt.avoid) + '</h2><div class="sp-grid">' + busiest.map(item).join('') + '</div></div>' +
      '<div class="sp-sec"><h2 class="sp-h2" style="font-size:22px;margin-bottom:12px">' + esc(tt.quietest) + '</h2><div class="sp-grid">' + open.filter(function (p) { return tier(p) === 'A'; }).slice(0, 20).map(item).join('') + '</div></div></div>';
  }

  function plans() { try { return JSON.parse(localStorage.getItem('pp_plans') || '[]'); } catch (e) { return []; } }
  function renderSaved() {
    var tt = t(), el = $('spSaved'); if (!el) return;
    var ids = saved(), list = places().filter(function (p) { return ids.indexOf(p.id) >= 0; });
    var html = '<div class="sp-wrap"><h1 class="sp-h1" style="font-size:34px">' + esc(tt.savedTitle) + '</h1><div class="sp-sec">';
    if (!list.length) html += '<div class="sp-empty">' + esc(tt.savedEmpty) + '</div>';
    else html += '<div class="sp-grid">' + list.map(item).join('') + '</div><button class="sp-btn full" data-act="share-list" style="margin-top:6px;background:#1f8f4e">💬 ' + esc(tt.sendFamily) + '</button>';
    html += '</div>';
    var pl = plans();
    if (pl.length) {
      html += '<div class="sp-sec"><h2 class="sp-h2" style="font-size:22px;margin-bottom:12px">' + esc(tt.plansTitle) + '</h2>' + pl.map(function (x, i) {
        return '<details class="sp-plan"><summary style="cursor:pointer;font-weight:600;min-height:32px">' + esc(x.name) + ' · ' + esc(x.nights) + 'N · ' + esc(x.date) + '</summary><pre>' + esc(x.text) + '</pre>' +
          '<button class="sp-link" data-act="plan-del" data-i="' + i + '">' + esc(tt.remove) + '</button></details>';
      }).join('') + '</div>';
    }
    el.innerHTML = html + '</div>';
  }

  /* ---------------- tabs / routing ---------------- */
  var OLD = { plan: 'plansec', map: 'mapwrap', stays: 'stays-bg' };
  function show(tab, opts) {
    opts = opts || {};
    if (['home', 'explore', 'crowd', 'plan', 'saved', 'map', 'stays'].indexOf(tab) < 0) tab = 'home';
    S.tab = tab;
    try {
      var pd = $('pd');
      if (pd && getComputedStyle(pd).display !== 'none' && typeof closePD === 'function' && !opts.keepPD) closePD();
    } catch (e) { /* ignore */ }
    var home = $('view-home');
    if (home && !home.classList.contains('active')) {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
      home.classList.add('active');
    }
    ['spHome', 'spExplore', 'spCrowd', 'spSaved'].forEach(function (id) { var e = $(id); if (e) e.classList.toggle('on', id === 'sp' + tab.charAt(0).toUpperCase() + tab.slice(1)); });
    Object.keys(OLD).forEach(function (k) { var e = $(OLD[k]); if (e) e.classList.toggle('sp-show', k === tab); });
    var foot = document.querySelector('#view-home > footer'); if (foot) foot.classList.toggle('sp-show', tab === 'home');
    var legal = foot && foot.nextElementSibling; if (legal && legal.classList.contains('sp-old')) legal.classList.toggle('sp-show', tab === 'home');
    if (tab === 'plan') preparePlan();
    if (tab === 'map') setTimeout(function () { try { initMap(); _lmap && _lmap.invalidateSize(); } catch (e) { /* map not ready */ } }, 60);
    render();
    updateTabs();
    var hash = tab === 'home' ? '' : '#/' + tab;
    if (!opts.fromHash && location.hash !== hash) { try { history.pushState(null, '', location.pathname + location.search + hash); } catch (e) { /* ignore */ } }
    if (!opts.keepScroll) window.scrollTo(0, 0);
  }
  function updateTabs() {
    var active = S.tab === 'map' ? 'explore' : S.tab === 'stays' ? 'home' : S.tab;
    var tabs = $('spTabs');
    if (tabs) tabs.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === active); b.setAttribute('aria-current', b.dataset.tab === active ? 'page' : 'false'); });
    document.querySelectorAll('nav .nl a[data-tab]').forEach(function (a) { a.classList.toggle('on', a.dataset.tab === S.tab); });
  }
  function render() {
    _cc = {};
    renderBar();
    if (S.tab === 'home') renderHome();
    else if (S.tab === 'explore') renderExplore();
    else if (S.tab === 'crowd') renderCrowd();
    else if (S.tab === 'saved') renderSaved();
  }

  var ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    explore: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
    crowd: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/>',
    plan: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    saved: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'
  };
  function renderChrome() {
    var tt = t();
    var tabs = $('spTabs');
    if (tabs) tabs.innerHTML = TABS.map(function (k, i) {
      var n = k === 'saved' && saved().length ? ' (' + saved().length + ')' : '';
      return '<button data-tab="' + k + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>' + esc(tt.tabs[i] + n) + '</button>';
    }).join('');
    var nl = document.querySelector('nav .nl');
    if (nl) nl.innerHTML = ['explore', 'crowd', 'plan', 'saved'].map(function (k) { return '<li><a data-tab="' + k + '" href="#/' + k + '">' + esc(tt.tabs[TABS.indexOf(k)]) + '</a></li>'; }).join('') +
      '<li><a data-tab="stays" href="#/stays">' + esc(tt.stays) + '</a></li><li><a href="/blog">' + esc(tt.blog) + '</a></li>';
    var lang = $('spLang');
    if (lang) lang.innerHTML = '<button data-lang="en" class="' + (S.lang === 'en' ? 'on' : '') + '" aria-pressed="' + (S.lang === 'en') + '">EN</button><button data-lang="hi" lang="hi" class="' + (S.lang === 'hi' ? 'on' : '') + '" aria-pressed="' + (S.lang === 'hi') + '">हिंदी</button>';
    document.documentElement.lang = S.lang === 'hi' ? 'hi' : 'en';
    updateTabs();
  }

  /* ---------------- plan tab ---------------- */
  var _planTouched = false;
  function preparePlan() {
    var d = $('ppDate');
    if (d && !_planTouched) d.value = ymd(planDate());
    if (!$('spPlanBar')) {
      var res = $('planRes'), bar = document.createElement('div');
      bar.id = 'spPlanBar';
      if (res && res.parentNode) res.parentNode.insertBefore(bar, res.nextSibling);
    }
    renderPlanBar();
  }
  function renderPlanBar() {
    var bar = $('spPlanBar'); if (!bar) return;
    var id = +(($('ppPlace') || {}).value || 0), tt = t();
    bar.style.display = id ? 'flex' : 'none';
    bar.innerHTML = '<button class="sp-btn light" data-act="plan-save">💾 ' + esc(tt.savePlan) + '</button><button class="sp-btn" style="background:#1f8f4e" data-act="plan-share">💬 ' + esc(tt.sharePlan) + '</button>' +
      '<button class="sp-btn clay" data-act="stay" data-id="' + id + '">' + esc(tt.stayHere) + '</button>';
  }
  function planFor(id) {
    var p = places().find(function (x) { return x.id === +id; }); if (!p) return;
    show('plan');
    var d = $('ppDate'); if (d) d.value = ymd(planDate());
    var n = $('ppNights'); if (n && S.help.days) n.value = S.help.days;
    try { selectPlanPlace(p.id, p.name); } catch (e) { console.warn('[simple] plan failed', e); }
    renderPlanBar();
    setTimeout(function () { var r = $('planRes'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
  }
  function savePlan() {
    var id = +(($('ppPlace') || {}).value || 0), p = places().find(function (x) { return x.id === id; }); if (!p) return;
    var res = $('planRes');
    var text = res ? res.innerText.replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000) : '';
    var list = plans().filter(function (x) { return !(x.id === id && x.date === ($('ppDate') || {}).value); });
    list.unshift({ id: id, name: p.name, date: ($('ppDate') || {}).value || '', nights: ($('ppNights') || {}).value || '2', text: text, at: Date.now() });
    store('pp_plans', JSON.stringify(list.slice(0, 10)));
    try { toast('✓ ' + t().planSaved); } catch (e) { /* ignore */ }
  }
  function sharePlan() {
    var id = +(($('ppPlace') || {}).value || 0), p = places().find(function (x) { return x.id === id; }); if (!p) return;
    var txt = '🏔️ ' + p.name + ' · ' + (($('ppNights') || {}).value || 2) + ' nights · ' + (($('ppDate') || {}).value || '') + '\n' + word(p).w + ' · ' + reach(p) +
      '\nhttps://paharipath.in/destination/' + (p.slug || '');
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }
  function shareList() {
    var ids = saved(), list = places().filter(function (p) { return ids.indexOf(p.id) >= 0; }); if (!list.length) return;
    var tt = t();
    var txt = '🏔️ ' + tt.waList(dateLabelShort()) + '\n\n' + list.map(function (p, i) {
      return (i + 1) + ') ' + p.name + ' — ' + word(p).w + ', ' + reach(p) + '\nhttps://paharipath.in/destination/' + (p.slug || '');
    }).join('\n\n') + '\n\n' + tt.waVote;
    window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
  }

  /* ---------------- stay request sheet ---------------- */
  function openStay(id) {
    var tt = t(), sheet = $('spSheet'); if (!sheet) return;
    var p = places().find(function (x) { return x.id === +id; });
    var name = load('pp_name', ''), phone = load('pp_phone', '');
    var budgets = [['b1', tt.b1], ['b2', tt.b2], ['b3', tt.b3]];
    sheet.innerHTML = '<div class="sp-sheet" role="dialog" aria-modal="true" aria-labelledby="spStayT"><div style="display:flex;justify-content:space-between;align-items:center"><h2 id="spStayT" class="sp-h2">' + esc(tt.formTitle) + '</h2>' +
      '<button class="sp-x" data-act="sheet-close" aria-label="' + esc(tt.close) + '">✕</button></div><p class="sp-muted" style="line-height:1.5;margin:6px 0 0">' + esc(tt.staySub) + '</p>' +
      '<form data-form="stay" novalidate>' +
      '<label class="sp-field">' + esc(tt.fWhere) + '<input name="where" list="spPlaceList" placeholder="' + esc(tt.wherePh) + '" value="' + esc(p ? p.name : '') + '" required maxlength="80"></label>' +
      '<datalist id="spPlaceList">' + places().slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>' +
      '<div class="sp-2"><label class="sp-field">' + esc(tt.fWhen) + '<input name="when" type="date" min="' + ymd(new Date()) + '" value="' + ymd(curDate().d || new Date(Date.now() + 7 * 864e5)) + '"></label>' +
      '<label class="sp-field">' + esc(tt.fGuests) + '<input name="guests" type="number" min="1" max="20" value="2" inputmode="numeric"></label></div>' +
      '<div class="sp-field">' + esc(tt.fBudget) + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + budgets.map(function (b) {
        return '<button type="button" class="sp-chip big' + (S.budget === b[0] ? ' on' : '') + '" data-act="budget" data-b="' + b[0] + '">' + esc(b[1]) + '</button>';
      }).join('') + '</div></div>' +
      '<label class="sp-field">' + esc(tt.fName) + '<input name="name" autocomplete="name" value="' + esc(name) + '" required maxlength="100"></label>' +
      '<label class="sp-field">' + esc(tt.fPhone) + '<input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98xxxxxxxx" value="' + esc(phone) + '" required maxlength="13"></label>' +
      '<label class="sp-field">' + esc(tt.fNote) + '<input name="note" maxlength="300"></label>' +
      '<button class="sp-btn clay full" type="submit" style="margin-top:16px;min-height:52px">' + esc(tt.send) + '</button><p class="sp-muted" style="text-align:center;margin:10px 0 0">' + esc(tt.free) + '</p></form></div>';
    sheet.classList.add('on');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { var f = sheet.querySelector('input[name="' + (p ? 'name' : 'where') + '"]'); if (f && !f.value) f.focus(); }, 50);
  }
  function closeSheet() { var s = $('spSheet'); if (s) { s.classList.remove('on'); s.innerHTML = ''; } document.body.style.overflow = ''; }
  function sendStay(form) {
    var tt = t(), f = form.elements, btn = form.querySelector('button[type="submit"]');
    var name = f.name.value.trim(), phone = f.phone.value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
    if (!name) { toast(tt.needName); f.name.focus(); return; }
    if (!/^\d{10}$/.test(phone)) { toast(tt.needPhone); f.phone.focus(); return; }
    store('pp_name', name); store('pp_phone', phone);
    var budget = { b1: 'Under ₹2,000', b2: '₹2,000–3,500', b3: '₹3,500+' }[S.budget];
    var msg = 'STAY REQUEST\nWhere: ' + f.where.value.trim() + '\nCheck-in: ' + f.when.value + '\nGuests: ' + f.guests.value + '\nBudget/night: ' + budget +
      '\nComing from: ' + S.origin + (f.note.value.trim() ? '\nNote: ' + f.note.value.trim() : '') + '\nLanguage: ' + (S.lang === 'hi' ? 'Hindi' : 'English');
    btn.disabled = true; btn.textContent = tt.sending;
    fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit', name: name, contact: phone, category: 'stay-request', message: msg }) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || j.error) throw new Error(j.error || 'failed'); return j; }); })
      .then(function () {
        try { if (window.plausible) plausible('Stay request'); } catch (e) { /* analytics optional */ }
        $('spSheet').querySelector('.sp-sheet').innerHTML = '<div style="padding:8px 0"><div style="width:52px;height:52px;border-radius:26px;background:#dcefe2;display:flex;align-items:center;justify-content:center;font-size:26px">✓</div>' +
          '<h2 class="sp-h2" style="margin-top:12px">' + esc(tt.sentTitle) + '</h2><p style="font-size:15px;line-height:1.5;color:#2b3830">' + esc(tt.sentSub) + '</p><button class="sp-btn full" data-act="sheet-close">' + esc(tt.done) + '</button></div>';
      })
      .catch(function (e) {
        btn.disabled = false; btn.textContent = tt.send;
        toast((e && e.message && e.message !== 'failed' ? e.message : tt.failed));
      });
  }

  /* ---------------- place page bar (inside existing #pd overlay) ---------------- */
  function addPdBar(id) {
    var pd = $('pd'); if (!pd) return;
    var bar = $('spPdBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'spPdBar'; pd.appendChild(bar); }
    var tt = t();
    bar.innerHTML = '<button class="sp-btn ghost" data-act="stay" data-id="' + id + '">' + esc(tt.stayHere) + '</button><button class="sp-btn clay" data-act="plan" data-id="' + id + '">' + esc(tt.planHere) + '</button>';
  }

  /* ---------------- events ---------------- */
  function onClick(e) {
    var b = e.target.closest('[data-act],[data-tab],[data-lang]'); if (!b) return;
    if (b.dataset.lang) { S.lang = b.dataset.lang; store('pp_lang', S.lang); renderChrome(); render(); return; }
    var act = b.dataset.act;
    if (!act && b.dataset.tab) { e.preventDefault(); show(b.dataset.tab); return; }
    var id = b.dataset.id ? +b.dataset.id : null;
    switch (act) {
      case 'tab': show(b.dataset.tab); break;
      case 'date': S.dateKey = b.dataset.key; _planTouched = false; render(); break;
      case 'pickdate': var di = $('spDateIn'); if (di) { try { di.showPicker(); } catch (x) { di.style.pointerEvents = 'auto'; di.focus(); di.click(); } } break;
      case 'open': try { openPD(id); addPdBar(id); } catch (x) { console.warn(x); } break;
      case 'plan': planFor(id); break;
      case 'save': toggleSaved(id); break;
      case 'help-open': S.help.step = 1; renderHome(); break;
      case 'help-close': S.help.step = 0; renderHome(); break;
      case 'help-restart': S.help = { step: 1, city: null, days: null, like: null, kids: S.help.kids }; renderHome(); break;
      case 'help-answer': helpAnswer(b.dataset.val); break;
      case 'chip': S.chip = b.dataset.chip; S.exploreN = 20; renderExplore(); break;
      case 'more': S.exploreN += 20; renderExploreList(); break;
      case 'snow': try { PPSnow.open(); } catch (x) { /* ignore */ } break;
      case 'stay': openStay(id); break;
      case 'sheet-close': closeSheet(); break;
      case 'budget': S.budget = b.dataset.b; b.parentNode.querySelectorAll('.sp-chip').forEach(function (c) { c.classList.toggle('on', c === b); }); break;
      case 'share-list': shareList(); break;
      case 'plan-save': savePlan(); break;
      case 'plan-share': sharePlan(); break;
      case 'plan-del': var pl = plans(); pl.splice(+b.dataset.i, 1); store('pp_plans', JSON.stringify(pl)); renderSaved(); break;
    }
  }
  function helpAnswer(v) {
    var h = S.help;
    if (h.step === 1) {
      if (v === '__other') { var sel = $('spFrom'); if (sel) { sel.focus(); try { sel.showPicker(); } catch (x) { /* older browsers */ } } h.city = S.origin; }
      else { h.city = v; if (v !== '__hp') { S.origin = v; store('pp_origin', v); _tc = {}; renderBar(); } }
    } else if (h.step === 2) h.days = v;
    else h.like = v;
    h.step++;
    try { if (h.step === 4 && window.plausible) plausible('Help me choose', { props: { like: h.like, days: h.days } }); } catch (x) { /* optional */ }
    renderHome();
  }
  function toggleSaved(id) {
    var list = saved().slice(), i = list.indexOf(id), p = places().find(function (x) { return x.id === id; });
    if (i >= 0) list.splice(i, 1); else list.push(id);
    try { saveSaved(list); } catch (e) { /* ignore */ }
    try { toast(i >= 0 ? 'Removed ' + (p ? p.name : '') : '❤️ ' + (p ? p.name : '')); } catch (e) { /* ignore */ }
    renderChrome(); render();
  }
  function onInput(e) {
    if (e.target.id === 'spQ2') { S.q = e.target.value; S.exploreN = 20; renderExploreList(); }
    else if (e.target.id === 'spQ') { S.q = e.target.value; }
  }
  function onChange(e) {
    var tg = e.target;
    if (tg.id === 'spFrom') { S.origin = tg.value; store('pp_origin', S.origin); _tc = {}; render(); }
    else if (tg.id === 'spDateIn' && tg.value) { var p = tg.value.split('-'); S.customDate = new Date(+p[0], +p[1] - 1, +p[2]); S.dateKey = 'custom'; _dopts = null; _planTouched = false; render(); }
    else if (tg.id === 'spKids') { S.help.kids = tg.checked; renderHome(); }
    else if (tg.id === 'ppDate' || tg.id === 'ppNights') { _planTouched = true; }
    else if (tg.id === 'ppPlace') renderPlanBar();
  }
  function onSubmit(e) {
    var f = e.target.closest('form[data-form]'); if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'search') { var i = f.querySelector('input'); S.q = i ? i.value : ''; S.chip = 'all'; S.exploreN = 20; show('explore'); }
    else if (f.dataset.form === 'stay') sendStay(f);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    var home = $('view-home'); if (!home || $('spRoot')) return;
    document.body.classList.add('sp');
    // Hide the old long homepage; keep it in the DOM so its code still works.
    Array.prototype.forEach.call(home.children, function (c) { c.classList.add('sp-old'); });
    var root = document.createElement('div');
    root.id = 'spRoot';
    root.innerHTML = '<div id="spBar"></div><div id="spHome" class="sp-screen on"></div><div id="spExplore" class="sp-screen"></div><div id="spCrowd" class="sp-screen"></div><div id="spSaved" class="sp-screen"></div>';
    home.insertBefore(root, home.firstChild);
    var tabs = document.createElement('div'); tabs.id = 'spTabs'; tabs.setAttribute('role', 'navigation'); tabs.setAttribute('aria-label', 'Main'); document.body.appendChild(tabs);
    var sheet = document.createElement('div'); sheet.id = 'spSheet'; document.body.appendChild(sheet);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });
    // Header: language switch, hide duplicate stay buttons.
    var nr = document.querySelector('nav .nr');
    if (nr) {
      var lang = document.createElement('div'); lang.id = 'spLang'; lang.className = 'sp-lang'; lang.setAttribute('role', 'group'); lang.setAttribute('aria-label', 'Language');
      nr.insertBefore(lang, nr.firstChild);
      Array.prototype.forEach.call(nr.querySelectorAll('.nb'), function (b) { if (/Find Stays|Book a Stay/.test(b.textContent)) b.classList.add('sp-hide-btn'); });
    }
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('spSheet') && $('spSheet').classList.contains('on')) closeSheet(); });
    window.addEventListener('popstate', fromHash);
    // Track which view is active so the tab bar hides on host/admin screens.
    var syncView = function () { document.body.classList.toggle('sp-home-view', home.classList.contains('active')); };
    new MutationObserver(syncView).observe(home, { attributes: true, attributeFilter: ['class'] });
    syncView();

    // Old navigation calls goTo('crowd') etc. — send them to the new tabs.
    var origGoTo = window.goTo;
    window.goTo = function (id) {
      var map = { crowd: 'crowd', explore: 'explore', plansec: 'plan', mapwrap: 'map', 'stays-bg': 'stays' };
      if (map[id]) return show(map[id]);
      return origGoTo && origGoTo.apply(this, arguments);
    };
    // Re-render when app data (places, photos, crowd news) finishes loading.
    var origRenderAll = window.renderAll;
    if (typeof origRenderAll === 'function') window.renderAll = function () { var r = origRenderAll.apply(this, arguments); _cc = {}; _tc = {}; render(); return r; };
    var origOpenPD = window.openPD;
    if (typeof origOpenPD === 'function') window.openPD = function (id) { var r = origOpenPD.apply(this, arguments); try { addPdBar(id); } catch (e) { /* ignore */ } return r; };
    var origRunFC = window.runFC;
    if (typeof origRunFC === 'function') window.runFC = function () { var r = origRunFC.apply(this, arguments); setTimeout(renderPlanBar, 0); return r; };
    try { if (window.PPSnow && PPSnow.ready) PPSnow.ready().then(function () { if (S.tab === 'home') renderHome(); }, function () { /* estimates */ }); } catch (e) { /* ignore */ }

    renderChrome();
    fromHash();
  }
  function fromHash() {
    var m = (location.hash || '').match(/^#\/(\w+)/);
    show(m ? m[1] : 'home', { fromHash: true, keepScroll: !m });
  }

  window.PPSimple = { show: show, render: render, planFor: planFor, openStay: openStay, state: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
