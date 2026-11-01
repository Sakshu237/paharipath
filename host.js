/* ════════════════════════════════════════════════════════════════════
   PahariPath — Host journey  (host.js)
   ────────────────────────────────────────────────────────────────────
   From "approved" to running the homestay day to day:
     • Host login: proper "set your password" screen, Forgot password,
       "Continue as …", and "Check application status" for applicants
     • Setup checklist → Go live (approved stays start hidden)
     • Overview: today & next 7 days, real numbers, to-dos
     • My Listing: host edits description, amenities, times, rules,
       rooms, guests, WhatsApp; photos go to an approval queue
     • Guests & Reviews: rate guests after checkout (PAHADI points),
       read what guests said
     • Earnings: per-booking money and payout status, fee dates
     • Admin: approve with destination, ask for more info, reject with
       email, Host Onboarding tab (setup progress + photo approvals)
   Server: /api/bookings (host-* actions, see api/_lib/host.js),
           /api/dest-admin (admin), /api/support (partner-status)
   Load after app.js and admin-control.js:  <script src="/host.js"></script>
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const E = s => String(s == null ? '' : s).replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
  const H = { stays: [], data: null, dataFor: null, amenities: [], email: '' };
  // The cookie banner (z-index 99999) used to cover the chat's message box and these
  // pop-ups on phones. Keep both above it.
  (function () {
    const st = document.createElement('style');
    st.textContent = '#ppChatMo{z-index:100000!important}';
    document.head.appendChild(st);
  })();
  const WAS_RECOVERY = /type=recovery/.test(location.hash || '');
  const FEE_START = '1 March 2027';
  const FREE_UNTIL = '28 February 2027';

  // ── small helpers ────────────────────────────────────────────────────
  const rupees = v => Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0;
  const inr = n => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  const istToday = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const fmtD = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
  const stay = () => (typeof _hostStay !== 'undefined' ? _hostStay : null);
  const card = (inner, extra) => `<div class="h-card"${extra ? ` style="${extra}"` : ''}>${inner}</div>`;
  const title = (t, sub) => `<h2 style="font-family:var(--fd);font-size:22px;color:var(--pine);margin-bottom:${sub ? 6 : 18}px">${t}</h2>${sub ? `<p style="font-size:13px;color:var(--stone);margin:0 0 18px;line-height:1.6">${sub}</p>` : ''}`;
  const label = t => `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--stone);margin-bottom:8px">${t}</div>`;
  const btn = (t, on, kind, extra) => {
    const k = { main: 'background:var(--pine);color:#fff;border:none', plain: 'background:#fff;color:var(--pine);border:1.5px solid rgba(74,124,95,.35)', warn: 'background:#fff;color:#b3261e;border:1px solid #e9b9b4' }[kind || 'main'];
    return `<button type="button" onclick="${on}" style="${k};padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--fb);min-height:40px${extra ? ';' + extra : ''}">${t}</button>`;
  };
  const fld = (lab, inner, hint) => `<div class="fg"><label>${lab}</label>${inner}${hint ? `<div style="font-size:11px;color:var(--stone);margin-top:4px">${hint}</div>` : ''}</div>`;

  async function token() {
    const { data: { session } } = await _sb.auth.getSession();
    return session ? session.access_token : null;
  }
  async function api(action, payload) {
    const t = await token();
    if (!t) return { error: 'Your session has expired — please log in again' };
    return ppApi(Object.assign({ action, access_token: t }, payload || {}));
  }

  // A simple bottom-sheet / centred modal used for passwords, agreement, admin prompts.
  function modal(html, opts) {
    closeModal();
    const ov = document.createElement('div');
    ov.id = 'hjMo';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,30,22,.55);display:flex;align-items:center;justify-content:center;padding:16px';
    ov.innerHTML = `<div role="dialog" aria-modal="true" style="background:#fff;border-radius:18px;width:100%;max-width:${(opts && opts.width) || 420}px;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25);position:relative">${opts && opts.noClose ? '' : '<button type="button" aria-label="Close" onclick="hjCloseModal()" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:20px;cursor:pointer;color:var(--stone)">✕</button>'}${html}</div>`;
    if (!(opts && opts.noClose)) ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }
  function closeModal() { const m = document.getElementById('hjMo'); if (m) m.remove(); }
  window.hjCloseModal = closeModal;

  // ════════════════════════════════════════════════════════════════════
  // 1. LOGIN, PASSWORDS, APPLICATION STATUS
  // ════════════════════════════════════════════════════════════════════

  // Resolves true once a new password is saved, false if the host backs out.
  function askNewPassword(reason) {
    return new Promise(resolve => {
      modal(`<div style="font-size:30px;margin-bottom:6px">🔑</div>
        <div style="font-family:var(--fd);font-size:21px;color:var(--pine);margin-bottom:6px">Choose your password</div>
        <p style="font-size:13px;color:var(--stone);line-height:1.6;margin-bottom:16px">${E(reason)}</p>
        ${fld('New password', '<input class="fi" type="password" id="hjPw1" autocomplete="new-password" placeholder="At least 8 characters"/>')}
        ${fld('Type it again', '<input class="fi" type="password" id="hjPw2" autocomplete="new-password" onkeydown="if(event.key===\'Enter\')document.getElementById(\'hjPwSave\').click()"/>')}
        <div id="hjPwErr" style="display:none;font-size:12.5px;color:#9b2020;background:#fdeaea;border-radius:8px;padding:8px 10px;margin-bottom:10px"></div>
        <button type="button" id="hjPwSave" class="pp-btn" style="width:100%;padding:13px;background:var(--pine);color:#fff;border:none;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer;font-family:var(--fb)">Save password</button>
        <button type="button" id="hjPwCancel" style="width:100%;background:none;border:none;color:var(--stone);font-size:13px;margin-top:10px;cursor:pointer;font-family:var(--fb)">Cancel</button>`, { noClose: true });
      const err = t => { const e = document.getElementById('hjPwErr'); e.textContent = t; e.style.display = 'block'; };
      document.getElementById('hjPwCancel').onclick = () => { closeModal(); resolve(false); };
      document.getElementById('hjPwSave').onclick = async () => {
        const a = document.getElementById('hjPw1').value, b = document.getElementById('hjPw2').value;
        if (a.length < 8) return err('Please use at least 8 characters.');
        if (a !== b) return err('The two passwords do not match.');
        const s = document.getElementById('hjPwSave'); s.disabled = true; s.textContent = 'Saving…';
        const { error } = await _sb.auth.updateUser({ password: a, data: { must_change_password: false } });
        if (error) { s.disabled = false; s.textContent = 'Save password'; return err('Could not save: ' + error.message); }
        closeModal(); toast('Password saved ✓'); resolve(true);
      };
      setTimeout(() => { const i = document.getElementById('hjPw1'); i && i.focus(); }, 50);
    });
  }

  async function enterDashboard(email) {
    // Start loading the last-used stay's dashboard at the same time as the stay list.
    let keep0 = '';
    try { keep0 = localStorage.getItem('pp_host_stay') || ''; } catch (e) { /* private mode */ }
    H.data = null; H.dataFor = null;
    if (parseInt(keep0)) fetchData(parseInt(keep0));
    const d = await api('host-stays');
    if (d.error) { toast(d.error); return false; }
    H.email = d.email || email || '';
    H.stays = d.stays || [];
    H.amenities = d.amenityOptions || [];
    _hostUser = (await _sb.auth.getUser()).data.user;
    _hostStays = H.stays;
    let keep = '';
    try { keep = localStorage.getItem('pp_host_stay') || ''; } catch (e) { /* private mode */ }
    _hostStay = H.stays.find(x => String(x.id) === keep) || H.stays.find(x => x.setup_pending) || H.stays[0] || null;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-host').classList.add('active');
    window.scrollTo(0, 0);
    const w = document.getElementById('hostWelcome');
    if (w) w.textContent = _hostStay ? 'Managing: ' + _hostStay.name : 'Welcome, ' + H.email.split('@')[0];
    hostRenderSwitcher();
    hTab('overview');
    return true;
  }

  window.doHostLogin = async function () {
    const email = (document.getElementById('hostEmail')?.value || '').trim().toLowerCase();
    const pass = document.getElementById('hostPass')?.value || '';
    const errBox = document.getElementById('hostLoginErr');
    const fail = t => { errBox.textContent = t; errBox.style.display = 'block'; };
    if (!email || !pass) return fail('Please enter your email and password');
    errBox.style.display = 'none';
    const { data, error } = await _sb.auth.signInWithPassword({ email, password: pass });
    if (error) return fail(/confirm/i.test(error.message) ? 'Please confirm your email first, then sign in' : 'Incorrect email or password');
    if (data.user && data.user.user_metadata && data.user.user_metadata.must_change_password) {
      const ok = await askNewPassword('This is your first login with the temporary password from your welcome email. Please choose your own password to continue.');
      if (!ok) { await _sb.auth.signOut(); return fail('You need to choose a new password to continue'); }
    }
    document.getElementById('hostPass').value = '';
    await enterDashboard(email);
  };
  doHostLogin = window.doHostLogin;

  window.hjForgotPassword = function () {
    const pre = (document.getElementById('hostEmail')?.value || '').trim();
    modal(`<div style="font-family:var(--fd);font-size:21px;color:var(--pine);margin-bottom:6px">Reset your password</div>
      <p style="font-size:13px;color:var(--stone);line-height:1.6;margin-bottom:14px">Enter your host login email. We'll send a link to set a new password.</p>
      ${fld('Email', `<input class="fi" type="email" id="hjFpEmail" value="${E(pre)}" placeholder="you@email.com"/>`)}
      ${btn('Send reset link', 'hjSendReset()', 'main', 'width:100%')}`);
  };
  window.hjSendReset = async function () {
    const email = (document.getElementById('hjFpEmail')?.value || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Enter a valid email');
    const { error } = await _sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/host-login' });
    if (error && /rate|seconds/i.test(error.message)) return toast('Please wait a minute before asking again');
    closeModal();
    toast('If this email has a host login, a reset link is on its way. Check spam too.');
  };

  async function handleRecovery() {
    setView('host-login');
    const ok = await askNewPassword('Choose a new password for your host login.');
    if (!ok) return;
    const { data: { user } } = await _sb.auth.getUser();
    if (user) enterDashboard(user.email);
  }
  let recoveryHandled = false;
  _sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY' && !recoveryHandled) { recoveryHandled = true; setTimeout(handleRecovery, 300); }
  });
  if (WAS_RECOVERY) {
    _sb.auth.getSession().then(({ data }) => {
      if (data.session && !recoveryHandled) { recoveryHandled = true; setTimeout(handleRecovery, 500); }
    });
  }

  // "Continue as …" when a session already exists (saves re-typing on phones).
  async function offerContinue() {
    const box = document.getElementById('hjContinue');
    if (!box) return;
    const { data: { session } } = await _sb.auth.getSession();
    if (!session || !session.user || !session.user.email) { box.innerHTML = ''; return; }
    box.innerHTML = `<button type="button" onclick="hjContinue()" style="width:100%;padding:12px;background:#eef5f0;color:var(--pine);border:1.5px solid rgba(74,124,95,.3);border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;font-family:var(--fb);margin-bottom:14px">Continue as ${E(session.user.email)} →</button>`;
  }
  window.hjContinue = async function () {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) return offerContinue();
    if (session.user.user_metadata && session.user.user_metadata.must_change_password) {
      const ok = await askNewPassword('Please choose your own password to continue.');
      if (!ok) return;
    }
    enterDashboard(session.user.email);
  };

  if (typeof setView === 'function') {
    const origSetView = setView;
    setView = function (v) { const r = origSetView.apply(this, arguments); if (v === 'host-login') offerContinue(); return r; };
    window.setView = setView;
  }

  // Applicants: check status with the email + WhatsApp number they applied with.
  window.hjCheckApplication = function () {
    modal(`<div style="font-family:var(--fd);font-size:21px;color:var(--pine);margin-bottom:6px">Check your application</div>
      <p style="font-size:13px;color:var(--stone);line-height:1.6;margin-bottom:14px">Use the email and WhatsApp number you applied with.</p>
      ${fld('Email', `<input class="fi" type="email" id="hjAsEmail" value="${E((document.getElementById('hostEmail')?.value || H.email || '').trim())}"/>`)}
      ${fld('WhatsApp number', '<input class="fi" id="hjAsPhone" maxlength="10" inputmode="numeric" placeholder="10-digit mobile"/>')}
      <div id="hjAsOut" style="margin-bottom:12px"></div>
      ${btn('Check status', 'hjRunAppCheck()', 'main', 'width:100%')}`);
  };
  window.hjRunAppCheck = async function () {
    const out = document.getElementById('hjAsOut');
    const email = (document.getElementById('hjAsEmail')?.value || '').trim(), phone = (document.getElementById('hjAsPhone')?.value || '').replace(/\D/g, '');
    out.innerHTML = '<div style="font-size:13px;color:var(--stone)">Checking…</div>';
    let d = {};
    try {
      const r = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'partner-status', email, phone }) });
      d = await r.json().catch(() => ({}));
      if (!r.ok) d.error = d.error || 'Could not check right now';
    } catch (e) { d = { error: 'No connection — please try again' }; }
    if (d.error) { out.innerHTML = `<div style="font-size:13px;color:#b3261e;background:#fdeaea;border-radius:8px;padding:10px">${E(d.error)}</div>`; return; }
    const box = (bg, fg, html) => `<div style="background:${bg};color:${fg};border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.6">${html}</div>`;
    const name = `<b>${E(d.propertyName)}</b>`;
    if (d.status === 'pending' && d.infoRequest) out.innerHTML = box('#fff8e6', '#6b5311', `${name} is being reviewed. <b>We need one more thing from you:</b><br>${E(d.infoRequest)}<br><span style="font-size:12px">Reply to our email or WhatsApp +91 93171 10366.</span>`);
    else if (d.status === 'pending') out.innerHTML = box('#eef5f0', '#1a3d2b', `${name} is being reviewed by the PahariPath team. We'll contact you on WhatsApp and email your host login once approved.`);
    else if (d.status === 'approved') out.innerHTML = box('#e6f4ec', '#1e6b3c', d.live ? `${name} is approved and live. Log in above to manage it.` : `${name} is approved! Your host login was emailed to you. Log in above and finish the Setup checklist to go live.`);
    else out.innerHTML = box('#fdeaea', '#9b2020', `${name} was not approved.${d.reason ? '<br><b>Reason:</b> ' + E(d.reason) : ''}<br><span style="font-size:12px">Questions: hello@paharipath.in</span>`);
  };

  // ════════════════════════════════════════════════════════════════════
  // 2. DATA FOR THE CURRENT STAY
  // ════════════════════════════════════════════════════════════════════
  // Tabs show the last loaded data straight away. If it is over a minute old it is
  // refreshed in the background and the open tab redraws quietly when the new data lands.
  let refreshing = null;
  function fetchData(id, fresh) {
    if (!fresh && refreshing && refreshing.id === id) return refreshing.p;
    const p = api('host-dashboard', { stayId: id }).then(d => {
      refreshing = null;
      if (d.error) return d;
      d._at = Date.now();
      if (!stay() || stay().id === id) { H.data = d; H.dataFor = id; }
      return d;
    });
    refreshing = { id, p };
    return p;
  }
  async function loadData(force) {
    const s = stay();
    if (!s || !s.id) return null;
    const have = H.data && H.dataFor === s.id;
    if (have && !force) {
      if (Date.now() - H.data._at > 60000) {
        const tab = currentTab();
        fetchData(s.id).then(d => { if (!d.error && currentTab() === tab && stay() && stay().id === s.id) redraw(tab); });
      }
      return H.data;
    }
    const d = await fetchData(s.id, force);
    if (d.error) { toast(d.error); return null; }
    return d;
  }
  function currentTab() {
    const b = document.querySelector('.htab.act');
    const m = b && (b.getAttribute('onclick') || '').match(/hTab\('(\w+)'/);
    return m ? m[1] : '';
  }
  function redraw(tab) {
    const s = stay();
    if (!document.getElementById('view-host')?.classList.contains('active') || !s) return;
    if (tab === 'overview' && !s.setup_pending) renderOverview();
    else if (tab === 'guests') renderGuests();
    else if (tab === 'earnings') renderEarnings();
  }
  function replaceStay(updated) {
    if (!updated) return;
    const i = H.stays.findIndex(x => x.id === updated.id);
    if (i >= 0) H.stays[i] = updated; else H.stays.push(updated);
    _hostStays = H.stays;
    if (stay() && stay().id === updated.id) _hostStay = updated;
    const p = (typeof STAYS !== 'undefined') ? STAYS.findIndex(x => x.id === updated.id) : -1;
    if (p >= 0) Object.assign(STAYS[p], { status: updated.status, photos: updated.photos, house_rules: updated.house_rules, checkin_time: updated.checkin_time, checkout_time: updated.checkout_time, rooms: updated.rooms, max_guests: updated.max_guests });
  }
  async function refreshStays() {
    const d = await api('host-stays');
    if (!d.error) { H.stays = d.stays || []; _hostStays = H.stays; const s = stay(); if (s) _hostStay = H.stays.find(x => x.id === s.id) || _hostStay; }
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. TABS
  // ════════════════════════════════════════════════════════════════════
  const content = () => document.getElementById('hostContent');
  function markTab(name) {
    document.querySelectorAll('.htab').forEach(b => b.classList.toggle('act', (b.getAttribute('onclick') || '').includes(`'${name}'`)));
  }

  const origHTab = hTab;
  hTab = function (name, btnEl) {
    const o = content();
    const s = stay();
    if (name === 'overview' || name === 'listing' || name === 'guests' || name === 'earnings') {
      markTab(name);
      const adm = document.getElementById('adMain'); if (adm) adm.innerHTML = '';
      if (!s || !s.id) { o.innerHTML = noListing(); return; }
      o.innerHTML = '<div style="text-align:center;padding:40px;color:var(--stone)">Loading…</div>';
      ({ overview: s.setup_pending ? renderSetup : renderOverview, listing: renderListing, guests: renderGuests, earnings: renderEarnings })[name]();
      return;
    }
    const r = origHTab.call(this, name, btnEl);
    markTab(name);
    if (name === 'calendar' && s && s.id) calendarExtras();
    return r;
  };
  window.hTab = hTab;

  function noListing() {
    return title('🏡 Welcome') + card(`<div style="text-align:center;padding:16px 4px">
      <div style="font-size:40px;margin-bottom:10px">🏡</div>
      <div style="font-size:16px;font-weight:600;color:var(--pine);margin-bottom:8px">No listing on this login yet</div>
      <p style="font-size:13px;color:var(--stone);line-height:1.6;margin-bottom:18px">If you applied, your listing appears here once PahariPath approves it. You can check where your application stands.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">${btn('Check application status', 'hjCheckApplication()', 'plain')}${btn('List a property', 'showPartnerForm()')}</div></div>`);
  }

  // ── 3a. SETUP (shown as Overview until the stay is live) ─────────────
  function renderSetup() {
    const s = stay();
    const list = s.checklist || [];
    const done = list.filter(x => x.done).length;
    const pct = Math.round(100 * done / Math.max(list.length, 1));
    const ready = done === list.length;
    const go = {
      description: `hTab('listing');setTimeout(()=>document.getElementById('hjDesc')?.focus(),300)`,
      times: `hTab('listing');setTimeout(()=>document.getElementById('hjIn')?.focus(),300)`,
      rules: `hTab('listing');setTimeout(()=>document.getElementById('hjRules')?.focus(),300)`,
      amenities: `hTab('listing');setTimeout(()=>document.getElementById('hjAmen')?.scrollIntoView({behavior:'smooth'}),300)`,
      photos: `hTab('listing');setTimeout(()=>document.getElementById('hjPhotos')?.scrollIntoView({behavior:'smooth'}),300)`,
      whatsapp: `hTab('listing');setTimeout(()=>document.getElementById('hjPhone')?.focus(),300)`,
      calendar: `hTab('calendar')`,
      agreement: `hjShowAgreement()`,
    };
    const row = x => `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f1f3f1">
      <div style="width:26px;height:26px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;${x.done ? 'background:#1e6b3c;color:#fff' : 'background:#f1f3f1;color:var(--stone)'}">${x.done ? '✓' : ''}</div>
      <div style="flex:1;font-size:13.5px;color:${x.done ? 'var(--stone)' : 'var(--ink)'};${x.done ? 'text-decoration:line-through' : ''}">${E(x.label)}${x.who === 'pahari' && !x.done ? '<div style="font-size:11.5px;color:#a8710a;text-decoration:none">PahariPath does this — usually within a day</div>' : ''}</div>
      ${!x.done && go[x.key] ? btn(x.key === 'agreement' ? 'Read & accept' : 'Do it', go[x.key], 'plain', 'padding:7px 12px;min-height:34px;font-size:12.5px') : ''}</div>`;
    content().innerHTML = title('🚀 Set up ' + E(s.name), 'You\'re approved! Finish these steps and tap <b>Go live</b> — travellers can then find your stay and send requests. Your listing stays hidden until then.') +
      card(`<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px"><div style="font-weight:700;color:var(--pine)">${done} of ${list.length} done</div><div style="font-size:12px;color:var(--stone)">${pct}%</div></div>
        <div style="height:8px;background:#eef1ee;border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--pine);border-radius:6px"></div></div>
        <div style="margin-top:6px">${list.map(row).join('')}</div>
        <div style="margin-top:18px">${ready ? btn('🟢 Go live', 'hjGoLive()', 'main', 'width:100%;padding:14px;font-size:15px') : `<button type="button" disabled style="width:100%;padding:14px;border-radius:10px;border:none;background:#e5e8e5;color:#8a948c;font-weight:600;font-size:14px;font-family:var(--fb)">Go live — finish the steps above first</button>`}</div>`) +
      card(`${label('What happens after you go live')}
        ${[['📨', 'A traveller sends a booking request — we email you straight away.'], ['💬', 'Chat with them on PahariPath, then accept or decline within 24 hours.'], ['💵', 'Right now guests pay you directly or on arrival. No PahariPath fee for hosts until ' + FREE_UNTIL + '.'], ['⭐', 'After checkout, rate your guest — good guests earn PAHADI points.']].map(([i, t]) => `<div style="display:flex;gap:12px;padding:8px 0;font-size:13px;color:var(--ink)"><div style="font-size:18px">${i}</div><div>${t}</div></div>`).join('')}`, 'background:#f6f9f7');
  }

  window.hjGoLive = async function () {
    const s = stay();
    if (!confirm('Make ' + s.name + ' live on PahariPath now?')) return;
    const d = await api('host-setup', { stayId: s.id, step: 'go-live' });
    if (d.error) { toast(d.error); await refreshStays(); return hTab('overview'); }
    replaceStay(d.stay);
    if (typeof loadStays === 'function') { await loadStays(); if (typeof renderStays === 'function') renderStays(); }
    modal(`<div style="text-align:center"><div style="font-size:46px">🎉</div><div style="font-family:var(--fd);font-size:22px;color:var(--pine);margin:6px 0">You're live!</div>
      <p style="font-size:13px;color:var(--stone);line-height:1.6;margin-bottom:16px">${E(s.name)} is now on PahariPath. We'll email you as soon as a traveller asks to book.</p>${btn('Open my dashboard', "hjCloseModal();hTab('overview')", 'main', 'width:100%')}</div>`);
  };

  window.hjShowAgreement = function () {
    const s = stay();
    const pts = [
      ['Fees', `No PahariPath fee for hosts until <b>${FREE_UNTIL}</b>. From <b>${FEE_START}</b> a commission is charged on each completed booking. Founding hosts (the first 20 homestays) pay about 2% less than the standard rate. We will email you the exact rate at least 30 days before it starts. Guests pay a small booking fee once online payment is live.`],
      ['Requests', 'Reply to every booking request within 24 hours — accept, decline, or chat first. Keep your calendar up to date so guests only ask for dates you can host.'],
      ['Keep bookings on PahariPath', 'Guests who find you on PahariPath book and chat through PahariPath. Please don\'t ask them to book or pay outside it.'],
      ['Price', 'Your nightly price is agreed with PahariPath and changed through us, so our prices stay fair and low for travellers.'],
      ['Honour confirmed stays', 'Once you accept, the stay is confirmed. If you truly must cancel, tell the guest and PahariPath at once so we can help them find another stay.'],
      ['Payments', 'While online payment is off, guests pay you directly or on arrival. Once it is on, PahariPath pays you to your account on file after check-in.'],
      ['Rules & safety', 'Keep your HP Tourism homestay registration valid and follow local rules. Treat guests with respect and help them in an emergency.'],
      ['Listing quality', 'Photos and descriptions must be real and of your own property. PahariPath may pause a listing after serious guest complaints. Either side can end the listing at any time.'],
    ];
    modal(`<div style="font-family:var(--fd);font-size:21px;color:var(--pine);margin-bottom:4px">PahariPath host agreement</div>
      <div style="font-size:12px;color:var(--stone);margin-bottom:14px">For ${E(s.name)}</div>
      ${pts.map(([h, t]) => `<div style="padding:9px 0;border-bottom:1px solid #f1f3f1"><div style="font-size:13px;font-weight:700;color:var(--ink);margin-bottom:2px">${h}</div><div style="font-size:12.5px;color:#4a564d;line-height:1.6">${t}</div></div>`).join('')}
      <p style="font-size:12px;color:var(--stone);margin:12px 0">Full terms: <a href="/terms-of-service.html" target="_blank" rel="noopener" style="color:var(--pine)">Terms of Service</a></p>
      <label style="display:flex;gap:10px;align-items:flex-start;font-size:13px;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="hjAgree" style="width:17px;height:17px;margin-top:2px"/> I have read and accept the host agreement.</label>
      ${btn('Accept', 'hjAcceptAgreement()', 'main', 'width:100%')}`, { width: 520 });
  };
  window.hjAcceptAgreement = async function () {
    if (!document.getElementById('hjAgree')?.checked) return toast('Please tick the box first');
    const d = await api('host-setup', { stayId: stay().id, step: 'agree', accept: true });
    if (d.error) return toast(d.error);
    replaceStay(d.stay); closeModal(); toast('Agreement accepted ✓'); hTab('overview');
  };

  // ── 3b. OVERVIEW (live stays) ────────────────────────────────────────
  async function renderOverview() {
    const s = stay();
    const d = await loadData();
    if (!d) { content().innerHTML = card('Could not load your dashboard. Pull down to refresh, or log in again.'); return; }
    const today = d.today || istToday(), in7 = addDays(today, 7), month = today.slice(0, 7);
    const B = d.bookings || [];
    const active = B.filter(b => b.status === 'confirmed' || b.status === 'completed');
    const req = B.filter(b => b.status === 'requested');
    const arriving = active.filter(b => b.checkin_date >= today && b.checkin_date <= in7).sort((a, b) => a.checkin_date.localeCompare(b.checkin_date));
    const staying = active.filter(b => b.checkin_date < today && b.checkout_date > today);
    const leaving = active.filter(b => b.checkout_date === today);
    const upcoming = active.filter(b => b.checkin_date >= today);
    const thisMonth = active.filter(b => (b.checkin_date || '').slice(0, 7) === month);
    const answered = B.filter(b => ['confirmed', 'completed', 'declined'].includes(b.status)).length, missed = B.filter(b => b.status === 'expired').length;
    const replyRate = answered + missed ? Math.round(100 * answered / (answered + missed)) + '%' : '—';
    const R = d.reviews || [];
    const avg = R.length ? (R.reduce((a, r) => a + (parseInt(r.rating) || 0), 0) / R.length).toFixed(1) : null;
    const ratedRefs = new Set((d.rated || []).map(x => x.ref));
    const toRate = active.filter(b => b.checkout_date <= today && !ratedRefs.has(b.id));

    const stat = (n, l, on) => `<button type="button" ${on ? `onclick="${on}"` : 'disabled'} style="text-align:left;background:#fff;border:1px solid rgba(74,124,95,.12);border-radius:14px;padding:14px;cursor:${on ? 'pointer' : 'default'};font-family:var(--fb)"><div style="font-size:24px;font-weight:700;color:var(--pine)">${n}</div><div style="font-size:11.5px;color:var(--stone);margin-top:2px">${l}</div></button>`;
    const person = (b, tag) => `<div style="display:flex;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #f1f3f1;flex-wrap:wrap">
      <div style="flex:1;min-width:170px"><div style="font-size:14px;font-weight:700;color:var(--ink)">${E(b.guest)} <span style="font-size:11px;font-weight:600;color:#a8710a;margin-left:4px">${tag}</span></div>
      <div style="font-size:12px;color:var(--stone)">${fmtD(b.checkin_date)} → ${fmtD(b.checkout_date)} · 👥 ${E(b.guests || 1)} · 🌙 ${E(b.nights || '—')}${b.guest_phone ? ` · <a href="tel:${E(b.guest_phone)}" style="color:var(--pine)">📱 ${E(b.guest_phone)}</a>` : ''}</div></div>
      <div style="display:flex;gap:6px">${tag.startsWith('Arriving') ? btn('Send arrival info', `hjArrivalInfo('${E(b.id)}')`, 'plain', 'padding:7px 11px;min-height:34px;font-size:12px') : ''}${btn('💬 Chat', `ppOpenChat('${E(b.id)}',{host:true})`, 'plain', 'padding:7px 11px;min-height:34px;font-size:12px')}</div></div>`;
    const dayTag = b => b.checkin_date === today ? 'Arriving today' : b.checkin_date === addDays(today, 1) ? 'Arriving tomorrow' : 'Arriving ' + fmtD(b.checkin_date);

    const todos = [];
    if (req.length) todos.push([`📨 ${req.length} booking request${req.length > 1 ? 's' : ''} waiting — reply within 24 hours`, "hTab('bookings')"]);
    if (toRate.length) todos.push([`⭐ Rate ${toRate.length} guest${toRate.length > 1 ? 's' : ''} who stayed with you`, "hTab('guests')"]);
    if ((s.pending_photos || []).length) todos.push([`📷 ${s.pending_photos.length} photo${s.pending_photos.length > 1 ? 's' : ''} waiting for PahariPath approval`, "hTab('listing')"]);
    (s.checklist || []).filter(x => !x.done && x.who === 'host' && x.key !== 'agreement' && x.key !== 'calendar').forEach(x => todos.push(['✏️ ' + x.label, "hTab('listing')"]));
    if (s.status === 'full') todos.push(['🔴 Your stay is marked Fully booked — reopen it when you have rooms', "hTab('listing')"]);

    const statusLine = { active: '🟢 Live — taking requests', full: '🔴 Marked fully booked', paused: '⏸ Paused by PahariPath — contact us', hidden: '⚪ Hidden by PahariPath — contact us' }[s.status || 'active'] || '';
    content().innerHTML = title('📊 Overview') +
      `<div style="background:linear-gradient(135deg,#1a3d2b,#2d5a40);border-radius:18px;padding:20px 22px;color:#fff;margin-bottom:16px">
        <div style="font-family:var(--fd);font-size:21px;font-weight:600">${E(s.emoji || '🏡')} ${E(s.name)}</div>
        <div style="font-size:12.5px;opacity:.75;margin-top:3px">📍 ${E(s.loc)} · ${E(s.price || inr(s.pn) + '/night')}</div>
        <div style="font-size:12.5px;margin-top:10px;background:rgba(255,255,255,.12);display:inline-block;padding:4px 10px;border-radius:20px">${statusLine}</div></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:16px">
        ${stat(req.length, 'Requests waiting', "hTab('bookings')")}${stat(upcoming.length, 'Upcoming stays', "hTab('bookings')")}${stat(thisMonth.length, 'Stays this month', "hTab('earnings')")}${stat(avg ? '⭐ ' + avg : 'New', avg ? R.length + ' review' + (R.length > 1 ? 's' : '') : 'No reviews yet', "hTab('guests')")}${stat(replyRate, 'Requests answered', '')}
      </div>` +
      (todos.length ? card(label('To do') + todos.map(([t, on]) => `<button type="button" onclick="${on}" style="display:block;width:100%;text-align:left;background:#fffaf0;border:1px solid #f0dfb8;border-radius:10px;padding:11px 13px;margin-bottom:8px;font-size:13px;color:#6b5311;cursor:pointer;font-family:var(--fb)">${E(t)} →</button>`).join('')) : '') +
      card(label('Today & next 7 days') +
        ((arriving.length + staying.length + leaving.length) ?
          leaving.map(b => person(b, 'Leaving today')).join('') + staying.map(b => person(b, 'Staying now')).join('') + arriving.map(b => person(b, dayTag(b))).join('')
          : '<div style="font-size:13px;color:var(--stone);padding:6px 0">No guests in the next 7 days. Keep your calendar open and your photos fresh.</div>')) +
      card(label('Good hosting on PahariPath') + [
        ['⏱️', 'Reply to requests within 24 hours', 'Hosts who answer fast get more bookings. Unanswered requests expire.'],
        ['📅', 'Keep your calendar right', 'Block days you are away so guests only ask for free dates.'],
        ['📍', 'Send arrival info the day before', 'Directions, parking and a phone number make check-in easy.'],
        ['⭐', 'Rate guests after checkout', 'It rewards responsible travellers with PAHADI points.'],
        ['🚦', 'Share crowd updates', 'Tell travellers how busy your area really is.'],
      ].map(([i, t, n]) => `<div style="display:flex;gap:12px;padding:9px 0;border-bottom:1px solid #f5f5f3"><div style="font-size:19px">${i}</div><div><div style="font-size:13px;font-weight:600">${t}</div><div style="font-size:12px;color:var(--stone);margin-top:2px">${n}</div></div></div>`).join(''));
    if (typeof ppSetHostBadge === 'function') ppSetHostBadge(req.length);
  }

  // Opens the chat with an arrival message ready to edit and send.
  window.hjArrivalInfo = function (ref) {
    const s = stay(), b = ((H.data && H.data.bookings) || []).find(x => x.id === ref);
    if (!b) return;
    const lines = [
      `Namaste ${String(b.guest || '').split(' ')[0]}! Looking forward to hosting you at ${s.name} on ${fmtD(b.checkin_date)}.`,
      s.checkin_time ? `Check-in is from ${s.checkin_time}${s.checkout_time ? ' and check-out by ' + s.checkout_time : ''}.` : '',
      s.map_url ? `Location pin: ${s.map_url}` : (s.address ? `Address: ${s.address}` : ''),
      'Tell me roughly what time you will arrive, and if you need help with directions, parking or food.',
    ].filter(Boolean).join('\n');
    ppOpenChat(ref, { host: true });
    let tries = 0;
    const fill = () => { const ta = document.getElementById('ppChatInput'); if (ta) { ta.value = lines; ta.dispatchEvent(new Event('input')); ta.focus(); } else if (tries++ < 20) setTimeout(fill, 150); };
    setTimeout(fill, 200);
  };

  // ── 3c. MY LISTING ───────────────────────────────────────────────────
  function renderListing() {
    const s = stay();
    const amen = new Set(s.amenities || []);
    const options = H.amenities.length ? H.amenities : ['WiFi', 'Parking', 'Hot Water', 'Room Heater', 'Power Backup', 'Attached Bathroom', 'Home-cooked Meals', 'Kitchen Access', 'Mountain View', 'Garden / Sit-out', 'Bonfire', 'Workspace', 'Pet Friendly', 'Local Guide on Request'];
    const st = s.status || 'active';
    const canToggle = !s.setup_pending && (st === 'active' || st === 'full');
    const toggle = canToggle ? card(label('Availability') + `<p style="font-size:12.5px;color:var(--stone);margin:0 0 12px">Full for a while? Mark it fully booked and guests won't be able to request it. For single days, use the Calendar.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${['active', 'full'].map(v => `<button type="button" onclick="hjSetOpen('${v}')" style="flex:1;min-width:140px;padding:11px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--fb);border:1.5px solid ${st === v ? (v === 'active' ? '#1e6b3c' : '#c0392b') : 'rgba(74,124,95,.2)'};background:${st === v ? (v === 'active' ? '#e6f4ec' : '#fdeaea') : '#fff'};color:${st === v ? (v === 'active' ? '#1e6b3c' : '#c0392b') : 'var(--stone)'}">${v === 'active' ? '✅ Open for requests' : '🔴 Fully booked'}</button>`).join('')}</div>`)
      : s.setup_pending ? card('<div style="font-size:13px;color:#6b5311">⚪ Your listing is hidden until you finish setup and tap <b>Go live</b> on the Overview tab.</div>', 'background:#fffaf0')
        : card('<div style="font-size:13px;color:#9b2020">⏸ PahariPath has paused this listing. Write to hello@paharipath.in to reopen it.</div>', 'background:#fdf3f2');
    const ro = [['Property name', s.name], ['Location', s.loc], ['Type', s.type || 'Homestay'], ['Price per night', s.price || inr(s.pn)], ['HP registration', s.registration_no || '—']];
    const live = s.photos || [], pend = s.pending_photos || [];
    const ph = (u, i) => `<div style="position:relative;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#eee"><img src="${E(u)}" alt="Photo ${i + 1}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"/>${i === 0 ? '<span style="position:absolute;top:6px;left:6px;background:var(--pine);color:#fff;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px">Cover</span>' : ''}
      <div style="position:absolute;bottom:6px;right:6px;display:flex;gap:4px">${i > 0 ? `<button type="button" onclick="hjPhoto('cover',${i})" style="background:rgba(255,255,255,.92);border:none;border-radius:7px;font-size:11px;font-weight:600;padding:4px 7px;cursor:pointer">Make cover</button>` : ''}<button type="button" aria-label="Remove photo" onclick="hjPhoto('remove',${i})" style="background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:7px;font-size:11px;padding:4px 7px;cursor:pointer">Remove</button></div></div>`;
    const pp = (u, i) => `<div style="position:relative;aspect-ratio:4/3;border-radius:10px;overflow:hidden;background:#eee;opacity:.8"><img src="${E(u)}" alt="Waiting photo ${i + 1}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"/><span style="position:absolute;top:6px;left:6px;background:#a8710a;color:#fff;font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:10px">Waiting for review</span><button type="button" onclick="hjPhoto('withdraw',${i})" style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:7px;font-size:11px;padding:4px 7px;cursor:pointer">Withdraw</button></div>`;
    const descLen = String(s.description || '').length;

    content().innerHTML = title('🏡 My Listing', 'This is what travellers see. Save your changes at the bottom — they show on the site straight away. New photos are checked by PahariPath first.') +
      toggle +
      card(label('About your stay') +
        fld('Describe your stay *', `<textarea class="fi" id="hjDesc" rows="6" maxlength="1500" oninput="document.getElementById('hjDescN').textContent=this.value.length" placeholder="The view from the rooms, the village, what food you cook, what guests can do nearby, how to reach…">${E(s.description || '')}</textarea>`, `<span id="hjDescN">${descLen}</span> / 1500 · at least 80 characters. Write it the way you'd tell a friend.`) +
        `<div class="pp-row" style="display:flex;gap:10px">${fld('Rooms', `<input class="fi" type="number" id="hjRooms" min="1" max="6" value="${E(s.rooms || '')}"/>`)}${fld('Max guests', `<input class="fi" type="number" id="hjGuests" min="1" max="24" value="${E(s.max_guests || '')}"/>`)}</div>
        <div style="display:flex;gap:10px">${fld('Check-in from *', `<input class="fi" type="time" id="hjIn" value="${E(s.checkin_time || '12:00')}"/>`)}${fld('Check-out by *', `<input class="fi" type="time" id="hjOut" value="${E(s.checkout_time || '10:00')}"/>`)}</div>` +
        fld('House rules *', `<textarea class="fi" id="hjRules" rows="3" maxlength="1000" placeholder="e.g. No loud music after 10pm · No smoking inside · Pets on request">${E(s.house_rules || '')}</textarea>`) +
        `<div id="hjAmen" class="fg"><label>What your stay offers *</label><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-top:6px">${options.map(a => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:500;text-transform:none;letter-spacing:0;color:var(--ink);margin:0;cursor:pointer;background:#f6f9f7;border-radius:8px;padding:8px 10px"><input type="checkbox" class="hjAmenity" value="${E(a)}" ${amen.has(a) ? 'checked' : ''}/> ${E(a)}</label>`).join('')}</div></div>` +
        fld('Your WhatsApp number (private) *', `<input class="fi" id="hjPhone" maxlength="10" inputmode="numeric" value="${E(s.host_phone || '')}" placeholder="10-digit mobile"/>`, 'PahariPath uses this to reach you about bookings. Guests never see it.') +
        btn('Save changes', 'hjSaveListing()', 'main', 'width:100%;padding:13px;font-size:14px')) +
      `<div id="hjPhotos">` + card(label(`Photos (${live.length} live${pend.length ? ', ' + pend.length + ' waiting' : ''})`) +
        `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:14px">${live.map(ph).join('')}${pend.map(pp).join('')}</div>
        <label style="display:block;border:1.5px dashed rgba(74,124,95,.35);border-radius:12px;padding:16px;text-align:center;cursor:pointer;color:var(--pine);font-size:13px;font-weight:600">📷 Add photos<input type="file" accept="image/*" multiple style="display:none" onchange="hjUploadPhotos(this)"/></label>
        <div id="hjUpMsg" style="font-size:12px;color:var(--stone);margin-top:8px">Bright, real photos of rooms, the view, food and the outside. Up to 15 in total. Big photos are shrunk automatically.</div>`) + `</div>` +
      card(label('Set by PahariPath') + `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px">${ro.map(([k, v]) => `<div><div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--stone);margin-bottom:3px">${k}</div><div style="font-size:13.5px;color:var(--ink)">${E(v)}</div></div>`).join('')}</div>
        <p style="font-size:12px;color:var(--stone);margin:12px 0 0">To change these, write to <a href="mailto:hello@paharipath.in?subject=${encodeURIComponent('Listing change: ' + s.name)}" style="color:var(--pine)">hello@paharipath.in</a> or WhatsApp +91 93171 10366.</p>`);
  }

  window.hjSaveListing = async function () {
    const s = stay();
    const v = id => (document.getElementById(id)?.value || '').trim();
    const changes = {};
    const desc = v('hjDesc'), rules = v('hjRules');
    if (desc !== (s.description || '').trim() && desc) changes.description = desc;
    if (rules !== (s.house_rules || '').trim() && rules) changes.house_rules = rules;
    if (v('hjIn') !== (s.checkin_time || '') || v('hjOut') !== (s.checkout_time || '')) { changes.checkin_time = v('hjIn'); changes.checkout_time = v('hjOut'); }
    if (v('hjRooms') && String(v('hjRooms')) !== String(s.rooms || '')) changes.rooms = parseInt(v('hjRooms'));
    if (v('hjGuests') && String(v('hjGuests')) !== String(s.max_guests || '')) changes.max_guests = parseInt(v('hjGuests'));
    const amen = [...document.querySelectorAll('.hjAmenity:checked')].map(x => x.value);
    if (amen.slice().sort().join('|') !== (s.amenities || []).slice().sort().join('|')) changes.amenities = amen;
    const ph = v('hjPhone').replace(/\D/g, '');
    if (ph && ph !== (s.host_phone || '')) changes.host_phone = ph;
    if (!Object.keys(changes).length) return toast(desc ? 'No changes to save' : 'Please describe your stay first');
    const d = await api('host-listing', { stayId: s.id, changes });
    if (d.error) return toast(d.error);
    replaceStay(d.stay);
    toast('Saved ✓');
    if (d.stay.setup_pending) hTab('overview'); else renderListing();
  };

  window.hjSetOpen = async function (v) {
    const err = await hostStayApi({ status: v });
    if (err) return toast('Error: ' + err);
    const s = stay(); s.status = v; replaceStay(s);
    if (typeof renderStays === 'function') renderStays();
    toast(v === 'full' ? '🔴 Marked fully booked' : '✅ Open for requests again');
    renderListing();
  };
  // Keep the old helpers (used elsewhere in app.js) pointing at the new flow.
  window.hostSetAvailability = hjSetOpen; hostSetAvailability = hjSetOpen;

  window.hjPhoto = async function (op, i) {
    const s = stay();
    const photo = (op === 'withdraw' ? s.pending_photos : s.photos)[i];
    if (!photo) return;
    if (op === 'remove' && !confirm('Remove this photo from your listing?')) return;
    const d = await api('host-photos', { stayId: s.id, op, photo });
    if (d.error) return toast(d.error);
    replaceStay(d.stay);
    toast({ remove: 'Photo removed', cover: 'Cover photo changed ✓', withdraw: 'Photo withdrawn' }[op]);
    renderListing();
    setTimeout(() => document.getElementById('hjPhotos')?.scrollIntoView({ block: 'start' }), 50);
  };

  window.hjUploadPhotos = async function (input) {
    const s = stay();
    const files = Array.from(input.files || []).filter(f => /^image\//.test(f.type));
    input.value = '';
    if (!files.length) return;
    const room = Math.min(10 - (s.pending_photos || []).length, 15 - (s.photos || []).length - (s.pending_photos || []).length);
    if (room <= 0) return toast('You already have the maximum number of photos');
    const msg = document.getElementById('hjUpMsg');
    const refs = [];
    const rand = () => { const a = new Uint8Array(6); crypto.getRandomValues(a); return Array.from(a, x => x.toString(16).padStart(2, '0')).join(''); };
    for (let i = 0; i < Math.min(files.length, room); i++) {
      if (files[i].size > 15 * 1024 * 1024) { toast(files[i].name + ' is too large (max 15 MB)'); continue; }
      if (msg) msg.textContent = `Uploading photo ${i + 1} of ${Math.min(files.length, room)}…`;
      const blob = typeof ppCompress === 'function' ? await ppCompress(files[i]) : files[i];
      const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
      const name = `host-${s.id}-${rand()}.${ext}`;
      const { error } = await _sb.storage.from('stay-photos').upload(name, blob, { upsert: false, contentType: blob.type || 'image/jpeg' });
      if (!error) refs.push('stay-photos/' + name);
    }
    if (!refs.length) { if (msg) msg.textContent = 'Upload failed. Check your connection and try again.'; return; }
    const d = await api('host-photos', { stayId: s.id, op: 'submit', photos: refs });
    if (d.error) { if (msg) msg.textContent = d.error; return toast(d.error); }
    replaceStay(d.stay);
    toast(`📷 ${refs.length} photo${refs.length > 1 ? 's' : ''} sent — PahariPath will review ${refs.length > 1 ? 'them' : 'it'} soon`);
    renderListing();
    setTimeout(() => document.getElementById('hjPhotos')?.scrollIntoView({ block: 'start' }), 50);
  };

  // ── 3d. GUESTS & REVIEWS ─────────────────────────────────────────────
  const BEHAVIOURS = ['Kept the stay clean', 'Followed eco pledges', 'Respectful to locals', 'On time for check-in/out', 'No single-use plastic', 'Supported local vendors', 'Easy to communicate with'];
  async function renderGuests() {
    const d = await loadData();
    if (!d) { content().innerHTML = card('Could not load guests. Please try again.'); return; }
    const today = d.today || istToday();
    const rated = {}; (d.rated || []).forEach(x => { rated[x.ref] = x.rating; });
    const past = (d.bookings || []).filter(b => (b.status === 'completed' || b.status === 'confirmed') && b.checkout_date && b.checkout_date <= today);
    const todo = past.filter(b => !rated[b.id]), done = past.filter(b => rated[b.id]);
    const R = d.reviews || [];
    const avg = R.length ? (R.reduce((a, r) => a + (parseInt(r.rating) || 0), 0) / R.length).toFixed(1) : null;
    const rateCard = b => card(`<div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px"><div><div style="font-size:15px;font-weight:700">${E(b.guest)}</div><div style="font-size:12px;color:var(--stone)">${fmtD(b.checkin_date)} → ${fmtD(b.checkout_date)} · 👥 ${E(b.guests || 1)} · Ref ${E(b.id)}</div></div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${[['excellent', '🌟 Excellent guest', '+50 pts & badge'], ['good', '🙂 Good guest', '+20 pts'], ['poor', '😕 Had problems', 'no points']].map(([v, t, n]) => `<label style="flex:1;min-width:120px;border:1.5px solid rgba(74,124,95,.2);border-radius:10px;padding:9px 10px;cursor:pointer;font-size:13px"><input type="radio" name="hjR_${E(b.id)}" value="${v}" ${v === 'good' ? 'checked' : ''}/> ${t}<div style="font-size:11px;color:var(--stone);margin-left:20px">${n}</div></label>`).join('')}</div>
      <details style="margin-bottom:10px"><summary style="font-size:12.5px;color:var(--pine);cursor:pointer">What went well? (optional)</summary><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px;margin-top:8px">${BEHAVIOURS.map(x => `<label style="font-size:12.5px;display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" class="hjB_${E(b.id)}" value="${E(x)}"/> ${E(x)}</label>`).join('')}</div>
      <textarea class="fi" id="hjC_${E(b.id)}" rows="2" maxlength="1000" placeholder="A note for PahariPath (not shown to the guest)" style="margin-top:8px"></textarea></details>
      ${btn('Submit rating', `hjRateGuest('${E(b.id)}')`, 'main')}`);
    content().innerHTML = title('👥 Guests & Reviews', 'Rate each guest after they leave — good guests earn PAHADI points and a badge, which keeps responsible travellers coming back.') +
      (todo.length ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--stone);margin:0 0 8px">To rate (${todo.length})</div>` + todo.map(rateCard).join('')
        : card('<div style="font-size:13px;color:var(--stone)">✅ No guests waiting for a rating.</div>')) +
      (done.length ? `<details style="margin-bottom:16px"><summary style="cursor:pointer;font-size:12.5px;color:var(--stone)">Already rated (${done.length})</summary>${done.map(b => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid #f1f3f1">${E(b.guest)} · ${fmtD(b.checkin_date)} — <b>${E(rated[b.id])}</b></div>`).join('')}</details>` : '') +
      card(label(`What guests say${avg ? ` · ⭐ ${avg} from ${R.length}` : ''}`) + (R.length ? R.map(r => `<div style="padding:10px 0;border-bottom:1px solid #f1f3f1"><div style="color:#e6a83c;font-size:14px">${'★'.repeat(parseInt(r.rating) || 0)}<span style="color:#ddd">${'★'.repeat(5 - (parseInt(r.rating) || 0))}</span> <span style="color:var(--stone);font-size:12px">${E(r.guest_name || 'Guest')} · ${r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span></div>${r.comment ? `<div style="font-size:13px;color:#4a564d;margin-top:4px;line-height:1.55">“${E(r.comment)}”</div>` : ''}</div>`).join('')
        : '<div style="font-size:13px;color:var(--stone)">No reviews yet. Guests can review after checkout — a warm goodbye helps!</div>'));
  }
  window.hjRateGuest = async function (ref) {
    const rating = (document.querySelector(`input[name="hjR_${ref}"]:checked`) || {}).value;
    const behaviours = [...document.querySelectorAll('.hjB_' + ref + ':checked')].map(x => x.value);
    const comment = (document.getElementById('hjC_' + ref)?.value || '').trim();
    const d = await api('host-rate-guest', { bookingRef: ref, rating, behaviours, comment });
    if (d.error) return toast(d.error);
    toast(d.badge ? `🏅 Thank you! Badge + ${d.pts} points sent to your guest` : d.pts ? `✓ Thank you! ${d.pts} points sent to your guest` : '✓ Thank you — saved');
    await loadData(true); renderGuests();
  };

  // ── 3e. EARNINGS ─────────────────────────────────────────────────────
  async function renderEarnings() {
    const d = await loadData();
    if (!d) { content().innerHTML = card('Could not load earnings. Please try again.'); return; }
    const today = d.today || istToday(), month = today.slice(0, 7);
    const hostAmt = b => b.status === 'cancelled' ? 0 : (parseInt(b.base_amount) || rupees(b.amount));
    const B = (d.bookings || []).filter(b => ['confirmed', 'completed'].includes(b.status));
    const earned = B.filter(b => b.checkout_date && b.checkout_date <= today);
    const upcoming = B.filter(b => !(b.checkout_date && b.checkout_date <= today));
    const sum = l => l.reduce((a, b) => a + hostAmt(b), 0);
    const mon = B.filter(b => (b.checkin_date || '').slice(0, 7) === month);
    const how = b => {
      if (b.payment_status === 'paid') {
        if (b.payout_status === 'paid') return `<span style="color:#1e6b3c">✅ Paid to you${b.paid_out_at ? ' ' + new Date(b.paid_out_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}${b.payout_ref ? ' · ref ' + E(b.payout_ref) : ''}</span>`;
        return '<span style="color:#a8710a">⏳ Paid online — PahariPath pays you after check-in</span>';
      }
      return '<span style="color:var(--stone)">💵 Guest pays you at the stay</span>';
    };
    const stat = (n, l) => `<div class="h-stat" style="background:#fff;border:1px solid rgba(74,124,95,.12);border-radius:14px;padding:14px"><div style="font-size:22px;font-weight:700;color:var(--pine)">${n}</div><div style="font-size:11.5px;color:var(--stone);margin-top:2px">${l}</div></div>`;
    const row = b => `<div style="display:flex;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #f1f3f1;flex-wrap:wrap"><div style="min-width:170px;flex:1"><div style="font-size:13.5px;font-weight:600">${E(b.guest)} <span style="font-weight:400;color:var(--stone);font-size:12px">· ${fmtD(b.checkin_date)} → ${fmtD(b.checkout_date)}</span></div><div style="font-size:12px;margin-top:2px">${how(b)}</div></div><div style="font-weight:700;color:var(--pine)">${inr(hostAmt(b))}</div></div>`;
    content().innerHTML = title('💰 Earnings', 'The stay price of your confirmed bookings. GST or booking fees paid by guests are not included.') +
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px">${stat(inr(sum(mon)), 'Stays starting this month')}${stat(inr(sum(earned)), 'Earned (guests have left)')}${stat(inr(sum(upcoming)), 'Coming up')}</div>` +
      card(label('Fees') + `<div style="font-size:13px;line-height:1.7;color:var(--ink)">🤝 <b>No PahariPath fee for hosts until ${FREE_UNTIL}.</b> The full stay price is yours.<br>From ${FEE_START} a commission applies to completed bookings, at the rate in your host agreement — founding hosts pay about 2% less. We'll email you the exact rate at least 30 days before.</div>`, 'background:#f6f9f7') +
      card(label('Coming up') + (upcoming.length ? upcoming.sort((a, b) => a.checkin_date.localeCompare(b.checkin_date)).map(row).join('') : '<div style="font-size:13px;color:var(--stone)">No confirmed stays coming up.</div>')) +
      card(label('Earned') + (earned.length ? earned.map(row).join('') : '<div style="font-size:13px;color:var(--stone)">Nothing yet — your first guest is on the way!</div>')) +
      `<p style="font-size:12px;color:var(--stone)">To change your payout account (UPI or bank), write to <a href="mailto:hello@paharipath.in?subject=Payout%20account" style="color:var(--pine)">hello@paharipath.in</a> from your host email.</p>`;
  }

  // ── 3f. CALENDAR extras: block a date range, and mark the calendar checked during setup
  function calendarExtras() {
    const o = content(); const s = stay();
    if (!o || !s) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = card(label('Block several days') + `<div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div><div style="font-size:11px;color:var(--stone);margin-bottom:4px">From</div><input class="ai" type="date" id="hjBf" min="${istToday()}"/></div>
        <div><div style="font-size:11px;color:var(--stone);margin-bottom:4px">To (last day)</div><input class="ai" type="date" id="hjBt" min="${istToday()}"/></div>
        <div style="flex:1;min-width:140px"><div style="font-size:11px;color:var(--stone);margin-bottom:4px">Reason (optional)</div><input class="ai" id="hjBr" placeholder="e.g. family wedding" style="width:100%"/></div>
        ${btn('Block days', 'hjBlockRange()')}</div>`) +
      (s.setup_pending ? card(`<div style="font-size:13px;color:var(--ink);margin-bottom:10px">${(s.checklist || []).find(x => x.key === 'calendar' && x.done) ? '✅ You confirmed your calendar.' : 'Blocked every day you can\'t host? Then confirm below — it\'s one of your setup steps.'}</div>${btn('✓ My calendar is up to date', 'hjCalendarDone()', 'main', 'width:100%')}`, 'background:#f6f9f7') : '');
    o.insertBefore(wrap, o.children[4] || null);
  }
  window.hjBlockRange = async function () {
    const s = stay();
    const f = document.getElementById('hjBf')?.value, t = document.getElementById('hjBt')?.value, r = (document.getElementById('hjBr')?.value || '').trim();
    if (!f || !t) return toast('Pick both dates');
    if (t < f) return toast('The last day must be after the first');
    const days = []; for (let d = f; d <= t && days.length < 120; d = addDays(d, 1)) days.push(d);
    if (days.length >= 120) return toast('Please block at most 120 days at a time');
    const { error } = await _sb.from('host_blocked_dates').upsert(days.map(d => ({ stay_id: s.id, blocked_date: d, reason: r })), { onConflict: 'stay_id,blocked_date', ignoreDuplicates: true });
    if (error) {
      // Fallback for databases without that unique index: insert one by one.
      let ok = 0; for (const d of days) { const x = await _sb.from('host_blocked_dates').insert({ stay_id: s.id, blocked_date: d, reason: r }); if (!x.error) ok++; }
      toast(ok ? `Blocked ${ok} day${ok > 1 ? 's' : ''} ✓` : 'Could not block those dates');
    } else toast(`Blocked ${days.length} day${days.length > 1 ? 's' : ''} ✓`);
    hTab('calendar');
  };
  window.hjCalendarDone = async function () {
    const d = await api('host-setup', { stayId: stay().id, step: 'calendar' });
    if (d.error) return toast(d.error);
    replaceStay(d.stay); toast('Calendar confirmed ✓'); hTab('overview');
  };

  // Switching stays: reset the cache, then show the right first screen.
  const origSwitch = hostSwitchStay;
  hostSwitchStay = function (id) { H.data = null; H.dataFor = null; return origSwitch.call(this, id); };
  window.hostSwitchStay = hostSwitchStay;

  // ════════════════════════════════════════════════════════════════════
  // 4. GUEST-FACING: description + amenities on the stay page
  // ════════════════════════════════════════════════════════════════════
  const infoCache = {};
  if (typeof openStayDetail === 'function') {
    const origOpen = openStayDetail;
    openStayDetail = function (id) {
      const r = origOpen.apply(this, arguments);
      (async () => {
        let info = infoCache[id];
        if (!info) { info = await ppApi({ action: 'stay-info', stayId: id }); if (!info.error) infoCache[id] = info; }
        if (!info || info.error || (!info.description && !(info.amenities || []).length)) return;
        const rev = document.getElementById('sdReviews');
        if (!rev || document.getElementById('sdAbout')) return;
        const box = document.createElement('div');
        box.id = 'sdAbout';
        box.style.cssText = 'margin-top:20px;padding-top:16px;border-top:1px solid #eee';
        box.innerHTML = (info.description ? `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--stone);margin-bottom:8px">About this stay</div><div style="font-size:13.5px;line-height:1.7;color:var(--ink);white-space:pre-line">${E(info.description)}</div>` : '') +
          ((info.amenities || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">${info.amenities.map(a => `<span style="background:#f0f6f2;color:#2d5a40;font-size:11.5px;padding:4px 10px;border-radius:20px">${E(a)}</span>`).join('')}</div>` : '');
        rev.parentNode.insertBefore(box, rev);
      })();
      return r;
    };
    window.openStayDetail = openStayDetail;
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. ADMIN: approve with destination, ask for info, reject with email,
  //    Host Onboarding tab
  // ════════════════════════════════════════════════════════════════════
  const APPS = {};
  if (typeof ppHostAppExtra === 'function') {
    const origExtra = ppHostAppExtra;
    ppHostAppExtra = function (a) {
      APPS[a.id] = a;
      let html = origExtra.apply(this, arguments);
      if (a.info_request) html += `<div style="font-size:12px;background:#fff8e6;border-radius:8px;padding:8px 10px;margin:6px 0;color:#6b5311">❓ Asked ${a.info_requested_at ? new Date(a.info_requested_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''}: ${E(a.info_request)}</div>`;
      if (a.status === 'pending') html += `<button type="button" class="ab" style="font-size:11px;padding:5px 12px;margin:4px 0;background:#fff8e6;color:#6b5311;border:1px solid #f0dca0" onclick="hjAskInfo(${parseInt(a.id)})">❓ Ask for more info</button>`;
      return html;
    };
    window.ppHostAppExtra = ppHostAppExtra;
  }
  const reloadApps = () => adTab('hostapps', document.querySelector('.adm-ni[onclick*="hostapps"]'));

  function guessPlace(a) {
    const text = String((a && (a.location + ' ' + (a.address || ''))) || '').toLowerCase();
    const list = (typeof ALL !== 'undefined' ? ALL : []);
    return (list.find(p => p.name && text.includes(String(p.name).toLowerCase())) || {}).id || '';
  }
  function placeOptions(sel) {
    const list = (typeof ALL !== 'undefined' ? ALL : []).slice().sort((x, y) => String(x.name).localeCompare(String(y.name)));
    return '<option value="">— Pick the village / destination —</option>' + list.map(p => `<option value="${parseInt(p.id)}" ${String(p.id) === String(sel) ? 'selected' : ''}>${E(p.name)} — ${E(p.district || '')}</option>`).join('');
  }

  adminApproveHostApp = function (id) {
    const a = APPS[id] || {};
    modal(`<div style="font-family:var(--fd);font-size:20px;color:var(--pine);margin-bottom:6px">Approve ${E(a.property_name || 'application')}</div>
      <p style="font-size:12.5px;color:var(--stone);line-height:1.6;margin-bottom:12px">This creates the host login and emails it. The listing stays <b>hidden</b> until the host finishes setup and taps Go live.</p>
      ${a.location ? `<div style="font-size:12.5px;margin-bottom:10px">📍 Applied as: <b>${E(a.location)}</b></div>` : ''}
      ${fld('Destination on the map *', `<select class="fi" id="hjApPlace">${placeOptions(guessPlace(a))}</select>`, 'Links the host\'s Crowd Update and Itinerary tools.')}
      ${btn('✓ Approve & create login', `hjDoApprove(${parseInt(id)})`, 'main', 'width:100%')}`, { width: 460 });
  };
  window.adminApproveHostApp = adminApproveHostApp;
  window.hjDoApprove = async function (id) {
    const placeId = parseInt(document.getElementById('hjApPlace')?.value) || 0;
    if (!placeId) return toast('Pick the destination first');
    closeModal();
    const t = await _destAdminCall({ action: 'host-app-approve', applicationId: id, placeId });
    if (!t) return;
    t.warning ? alert('⚠️ ' + t.warning) : toast('✓ Approved — login emailed. Listing goes live after the host finishes setup.');
    reloadApps();
  };

  adminRejectHostApp = function (id) {
    const a = APPS[id] || {};
    modal(`<div style="font-family:var(--fd);font-size:20px;color:var(--pine);margin-bottom:10px">Reject ${E(a.property_name || 'application')}</div>
      ${fld('Reason', '<textarea class="fi" id="hjRjNote" rows="3" maxlength="1000" placeholder="e.g. We could not verify the HP homestay registration"></textarea>')}
      <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:14px;cursor:pointer"><input type="checkbox" id="hjRjMail" checked/> Email this reason to the applicant</label>
      ${btn('Reject application', `hjDoReject(${parseInt(id)})`, 'warn', 'width:100%')}`, { width: 460 });
  };
  window.adminRejectHostApp = adminRejectHostApp;
  window.hjDoReject = async function (id) {
    const notes = (document.getElementById('hjRjNote')?.value || '').trim();
    const notify = !!document.getElementById('hjRjMail')?.checked;
    if (notify && !notes) return toast('Write a reason, or untick the email box');
    closeModal();
    const t = await _destAdminCall({ action: 'host-app-reject', applicationId: id, notes, notify });
    if (!t) return;
    toast(notify ? (t.emailSent ? 'Rejected — applicant emailed' : 'Rejected — but the email failed to send') : 'Rejected');
    reloadApps();
  };

  window.hjAskInfo = function (id) {
    const a = APPS[id] || {};
    modal(`<div style="font-family:var(--fd);font-size:20px;color:var(--pine);margin-bottom:6px">Ask ${E(a.owner_name || 'the applicant')}</div>
      <p style="font-size:12.5px;color:var(--stone);margin-bottom:10px">They get this by email, and see it under "Check application status". The application stays pending.</p>
      ${fld('What do you need?', '<textarea class="fi" id="hjAiMsg" rows="4" maxlength="1000" placeholder="e.g. Please send a clearer photo of your HP homestay registration certificate."></textarea>')}
      ${btn('Send', `hjDoAskInfo(${parseInt(id)})`, 'main', 'width:100%')}`, { width: 460 });
  };
  window.hjDoAskInfo = async function (id) {
    const message = (document.getElementById('hjAiMsg')?.value || '').trim();
    if (message.length < 5) return toast('Write what you need');
    closeModal();
    const t = await _destAdminCall({ action: 'host-app-info', applicationId: id, message });
    if (!t) return;
    toast(t.emailSent ? 'Sent ✓' : 'Saved — but the email failed. Message them on WhatsApp.');
    reloadApps();
  };

  // Admin tab: Host Onboarding
  if (typeof adTab === 'function') {
    const origAd = adTab;
    adTab = function (name, el) {
      if (name !== 'onboarding') return origAd.apply(this, arguments);
      document.querySelectorAll('.adm-ni').forEach(x => x.classList.remove('act'));
      el && el.classList.add('act');
      const hc = document.getElementById('hostContent'); if (hc) hc.innerHTML = '';
      const o = document.getElementById('adMain');
      o.innerHTML = '<h2 style="font-size:20px;font-weight:600;color:var(--pine);margin-bottom:6px;font-family:var(--fd)">🧭 Host Onboarding</h2><p style="font-size:13px;color:var(--stone);margin-bottom:16px">Approved hosts still in setup, photos waiting for your approval, and stays not linked to a destination.</p><div id="hjOnb">Loading…</div>';
      loadOnboarding();
    };
    window.adTab = adTab;
  }
  const ONB = { rows: [] };
  async function loadOnboarding() {
    const box = document.getElementById('hjOnb');
    if (!box) return;
    const d = await _destAdminCall({ action: 'onboarding-list' });
    if (!d) { box.innerHTML = '<div style="color:#b3261e">Could not load. If this is the first time, run host-onboarding.sql in Supabase.</div>'; return; }
    const rows = d.stays || [];
    ONB.rows = rows;
    if (!rows.length) { box.innerHTML = '<div class="adm-panel" style="color:var(--stone)">✅ Nothing waiting — every host is set up and no photos need review.</div>'; return; }
    box.innerHTML = rows.map(s => {
      const done = s.checklist.filter(x => x.done).length;
      const wa = s.host_phone ? `https://wa.me/91${String(s.host_phone).replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent('Namaste! This is PahariPath. Your listing ' + s.name + ' is approved — log in at paharipath.in/host-login and finish the Setup tab to go live. Need help? Just reply here.')}` : '';
      return `<div class="adm-panel" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><div style="font-size:15px;font-weight:700">${E(s.name)} <span style="font-weight:400;color:var(--stone);font-size:12px">— ${E(s.loc)}</span></div><div style="font-size:12px;color:var(--stone)">${E(s.host_email || '')} · status: ${E(s.status)}${s.setup_pending ? ` · setup ${done}/${s.checklist.length}` : ''}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${wa ? `<a class="ab" href="${wa}" target="_blank" rel="noopener" style="font-size:11px;padding:5px 10px;text-decoration:none;background:#1e7a45;color:#fff">WhatsApp host</a>` : ''}${s.setup_pending ? `<button class="ab ab-p" style="font-size:11px;padding:5px 10px" onclick="hjForceLive(${s.id})">Make live now</button>` : ''}</div></div>
        ${s.setup_pending ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin:10px 0">${s.checklist.map(x => `<span style="font-size:11px;padding:3px 8px;border-radius:10px;${x.done ? 'background:#e6f4ec;color:#1e6b3c' : 'background:#fdf1de;color:#8a5a06'}">${x.done ? '✓' : '○'} ${E(x.key)}</span>`).join('')}</div>` : ''}
        ${!(parseInt(s.placeid) > 0) ? `<div style="display:flex;gap:8px;align-items:center;margin:10px 0;flex-wrap:wrap"><select class="ai" id="hjPl_${s.id}" style="max-width:320px">${placeOptions('')}</select><button class="ab ab-p" style="font-size:11px;padding:6px 12px" onclick="hjLinkPlace(${s.id})">Link destination</button></div>` : ''}
        ${s.pending_photos.length ? `<div style="font-size:12px;font-weight:700;color:var(--stone);margin:10px 0 6px">Photos to review (${s.pending_photos.length})</div><div style="display:flex;gap:10px;flex-wrap:wrap">${s.pending_photos.map((u, i) => `<div style="width:150px"><a href="${E(u)}" target="_blank" rel="noopener"><img src="${E(u)}" alt="Pending photo" style="width:150px;height:110px;object-fit:cover;border-radius:8px;display:block"/></a><div style="display:flex;gap:4px;margin-top:4px"><button class="ab ab-p" style="flex:1;font-size:11px;padding:4px" onclick="hjReviewPhoto(${parseInt(s.id)},${i},'approve')">✓ Approve</button><button class="ab ab-d" style="flex:1;font-size:11px;padding:4px" onclick="hjReviewPhoto(${parseInt(s.id)},${i},'reject')">✕</button></div></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  }
  window.hjReviewPhoto = async function (stayId, i, decision) {
    const row = (ONB.rows || []).find(x => x.id === stayId);
    const photo = row && row.pending_photos[i];
    if (!photo) return loadOnboarding();
    const t = await _destAdminCall({ action: 'photo-review', stayId, photo, decision });
    if (t) { toast(decision === 'approve' ? 'Photo is live ✓' : 'Photo rejected'); loadOnboarding(); }
  };
  window.hjLinkPlace = async function (stayId) {
    const placeid = parseInt(document.getElementById('hjPl_' + stayId)?.value) || 0;
    if (!placeid) return toast('Pick a destination');
    const t = await _destAdminCall({ action: 'stay-update', id: stayId, changes: { placeid } });
    if (t) { toast('Destination linked ✓'); loadOnboarding(); }
  };
  window.hjForceLive = async function (stayId) {
    if (!confirm('Make this stay live now, without the host finishing setup?')) return;
    const t = await _destAdminCall({ action: 'onboarding-force-live', stayId });
    if (t) { toast('Stay is live ✓'); loadOnboarding(); }
  };
})();
