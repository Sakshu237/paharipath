/* ════════════════════════════════════════════════════════════════════
   PahariPath — Admin Control Centre  (admin-control.js)
   ────────────────────────────────────────────────────────────────────
   The first tab of the admin panel. Everything here goes through the
   server (/api/dest-admin, admin-only actions), so it works on EVERY
   stay and booking regardless of database row rules:
     • What needs attention today (booking requests, check-ins, host apps)
     • All bookings — confirm / cancel / no-show, WhatsApp the guest
     • All stays — show / pause / mark full / hide, verify, edit price,
       host email and contact
   Load after app.js:  <script src="/admin-control.js"></script>
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { stays: [], bookings: [], dash: null, bFilter: 'requested', sFilter: 'all', editing: null, busy: false };

  async function api(action, payload) {
    const { data: { session } } = await _sb.auth.getSession();
    if (!session) throw new Error('Your admin session has expired — please sign in again');
    const r = await fetch('/api/dest-admin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, access_token: session.access_token }, payload || {})),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || ('Request failed (' + r.status + ')'));
    return j;
  }

  // ── helpers ──
  const waLink = (phone, text) => {
    const p = String(phone || '').replace(/\D/g, '');
    if (!p) return '';
    const num = p.length === 10 ? '91' + p : p;
    return `https://wa.me/${num}${text ? '?text=' + encodeURIComponent(text) : ''}`;
  };
  const fmtDate = d => { if (!d) return '—'; const x = new Date(d); return isNaN(x) ? esc(d) : x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); };
  const STATUS_STYLE = {
    requested: ['#fbf1dc', '#8a5a06', 'Request'], confirmed: ['#e5f2e9', '#1e6b3e', 'Confirmed'],
    pending_payment: ['#eef1ee', '#4f5e53', 'Awaiting payment'], completed: ['#e8eef7', '#2b4f7e', 'Completed'],
    cancelled: ['#fde8e5', '#a3261f', 'Cancelled'], no_show: ['#fde8e5', '#a3261f', 'No-show'], expired: ['#eef1ee', '#4f5e53', 'Expired'],
  };
  const pill = st => { const s = STATUS_STYLE[st] || ['#eef1ee', '#4f5e53', st || '—']; return `<span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:10px;background:${s[0]};color:${s[1]};white-space:nowrap">${esc(s[2])}</span>`; };
  const STAY_STATUS = [['active', 'Live'], ['paused', 'Paused'], ['full', 'Full'], ['hidden', 'Hidden']];
  const btn = (label, onclick, kind) => {
    const k = { main: 'background:var(--pine);color:#fff;border:none', warn: 'background:#fff;color:#a3261f;border:1px solid #f0c4be', plain: 'background:#fff;color:var(--ink);border:1px solid #dde3de', wa: 'background:#1e7a45;color:#fff;border:none' }[kind || 'plain'];
    return `<button type="button" onclick="${onclick}" style="${k};font-family:var(--fb);font-size:12.5px;font-weight:600;padding:8px 12px;border-radius:8px;cursor:pointer;min-height:36px">${label}</button>`;
  };
  const card = (title, inner, sub) => `<div class="adm-panel" style="margin-bottom:16px"><h3 style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap">${title}${sub ? `<span style="font-size:12px;font-weight:400;color:var(--stone)">${sub}</span>` : ''}</h3>${inner}</div>`;

  // ── render ──
  function render() {
    const el = document.getElementById('adMain');
    if (!el || !el.dataset.ppAdmin) return;
    const d = S.dash || {};
    const stat = (n, l, onclick) => `<button type="button" ${onclick ? `onclick="${onclick}"` : 'disabled'} style="text-align:left;background:#fff;border:1px solid rgba(74,124,95,.15);border-radius:12px;padding:14px;cursor:${onclick ? 'pointer' : 'default'};font-family:var(--fb)"><div style="font-size:26px;font-weight:700;color:var(--pine)">${n}</div><div style="font-size:12px;color:var(--stone)">${l}</div></button>`;

    // 1. needs attention
    const reqs = (d.requested || []);
    const reqHtml = reqs.length ? reqs.map(b => `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0ee">
        <div style="min-width:200px"><div style="font-weight:600">${esc(b.guest || 'Guest')} → ${esc(b.stay_name || '')}</div>
          <div style="font-size:12px;color:var(--stone)">${esc(b.dates || fmtDate(b.checkin_date))} · Ref ${esc(b.id)} · asked ${fmtDate(b.created_at)}</div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${btn('Confirm', `ppAdmin.setBooking('${esc(b.id)}','confirmed')`, 'main')}
          ${btn('Decline', `ppAdmin.setBooking('${esc(b.id)}','cancelled')`, 'warn')}
          ${b.guest_phone ? `<a href="${esc(waLink(b.guest_phone, 'Hi ' + (b.guest || '') + ', this is PahariPath about your stay request at ' + (b.stay_name || '') + ' (' + (b.dates || '') + ').'))}" target="_blank" rel="noopener" style="text-decoration:none;background:#1e7a45;color:#fff;font-size:12.5px;font-weight:600;padding:9px 12px;border-radius:8px;min-height:36px;display:inline-flex;align-items:center">WhatsApp guest</a>` : ''}
        </div>
      </div>`).join('') : '<div style="font-size:13px;color:var(--stone);padding:6px 0">No booking requests waiting. 🎉</div>';
    const upHtml = (d.upcoming || []).slice(0, 6).map(b => `<div style="font-size:13px;padding:6px 0;border-bottom:1px solid #f4f4f2"><b>${fmtDate(b.checkin_date)}</b> · ${esc(b.guest || '')} at ${esc(b.stay_name || '')} ${b.guest_phone ? `· <a href="${esc(waLink(b.guest_phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>`).join('') || '<div style="font-size:13px;color:var(--stone)">No confirmed check-ins coming up.</div>';

    // 2. bookings list
    const bf = S.bFilter;
    const shownB = S.bookings.filter(b => bf === 'all' || b.status === bf || (bf === 'cancelled' && b.status === 'no_show'));
    const fChip = (k, l) => `<button type="button" onclick="ppAdmin.filterBookings('${k}')" style="font-family:var(--fb);font-size:12px;font-weight:600;padding:6px 11px;border-radius:14px;cursor:pointer;border:1.5px solid ${bf === k ? 'var(--pine)' : '#dde3de'};background:${bf === k ? 'var(--pine)' : '#fff'};color:${bf === k ? '#fff' : 'var(--ink)'}">${l} (${k === 'all' ? S.bookings.length : S.bookings.filter(b => b.status === k || (k === 'cancelled' && b.status === 'no_show')).length})</button>`;
    const bRows = shownB.slice(0, 100).map(b => `
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;padding:10px 0;border-bottom:1px solid #f0f0ee">
        <div style="min-width:0">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13.5px">${esc(b.guest || 'Guest')}</b>${pill(b.status)}<span style="font-size:11.5px;color:var(--stone)">Ref ${esc(b.id)}</span></div>
          <div style="font-size:12.5px;color:var(--stone);margin-top:2px">${esc(b.stay_name || '')} · ${esc(b.dates || (fmtDate(b.checkin_date) + ' – ' + fmtDate(b.checkout_date)))} · ${esc(b.amount || '')} · ${esc(b.payment_status === 'paid' ? 'paid online' : b.payment_status === 'pay_at_stay' ? 'pay at stay' : (b.payment_status || ''))}</div>
          ${b.guest_phone ? `<div style="font-size:12.5px;margin-top:2px">📞 ${esc(b.guest_phone)} · <a href="${esc(waLink(b.guest_phone))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
        </div>
        <div>${b.status === 'completed' ? '' : `<label style="font-size:11px;color:var(--stone);display:block">Change status
          <select onchange="ppAdmin.setBooking('${esc(b.id)}',this.value)" style="display:block;font-family:var(--fb);font-size:12.5px;padding:6px;border-radius:8px;border:1px solid #dde3de;margin-top:2px">
            <option value="">—</option>${['requested', 'confirmed', 'cancelled', 'no_show'].filter(x => x !== b.status).map(x => `<option value="${x}">${(STATUS_STYLE[x] || [, , x])[2]}</option>`).join('')}
          </select></label>`}</div>
      </div>`).join('') || '<div style="font-size:13px;color:var(--stone);padding:8px 0">No bookings in this list.</div>';

    // 3. stays list
    const sf = S.sFilter;
    const shownS = S.stays.filter(s => sf === 'all' || (s.status || 'active') === sf);
    const sChip = (k, l) => `<button type="button" onclick="ppAdmin.filterStays('${k}')" style="font-family:var(--fb);font-size:12px;font-weight:600;padding:6px 11px;border-radius:14px;cursor:pointer;border:1.5px solid ${sf === k ? 'var(--pine)' : '#dde3de'};background:${sf === k ? 'var(--pine)' : '#fff'};color:${sf === k ? '#fff' : 'var(--ink)'}">${l} (${k === 'all' ? S.stays.length : S.stays.filter(s => (s.status || 'active') === k).length})</button>`;
    const sRows = shownS.map(s => {
      const st = s.status || 'active';
      const editing = S.editing === s.id;
      return `
      <div style="padding:12px 0;border-bottom:1px solid #f0f0ee;${st === 'hidden' ? 'opacity:.6' : ''}">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center">
          <div style="min-width:0"><b>${esc(s.name)}</b> <span style="font-size:12px;color:var(--stone)">#${esc(s.id)} · ${esc(s.loc || '')} · ${esc(s.price || '')}</span>
            ${s.verified ? '<span style="font-size:11px;font-weight:700;color:#1e6b3e;margin-left:4px">✓ Verified</span>' : '<span style="font-size:11px;color:#a3261f;margin-left:4px">Not verified</span>'}
            <div style="font-size:12px;color:var(--stone)">Host: ${s.host_email ? esc(s.host_email) : '<span style="color:#a3261f">no host account</span>'}${s.contact ? ' · ' + esc(s.contact) : ''}</div></div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center" role="group" aria-label="Status for ${esc(s.name)}">
            ${STAY_STATUS.map(([k, l]) => `<button type="button" aria-pressed="${st === k}" onclick="ppAdmin.setStay(${s.id},{status:'${k}'})" style="font-family:var(--fb);font-size:12px;font-weight:600;padding:6px 10px;border-radius:8px;cursor:pointer;border:1.5px solid ${st === k ? (k === 'hidden' ? '#a3261f' : 'var(--pine)') : '#dde3de'};background:${st === k ? (k === 'hidden' ? '#a3261f' : 'var(--pine)') : '#fff'};color:${st === k ? '#fff' : 'var(--ink)'}">${l}</button>`).join('')}
            ${btn(s.verified ? 'Unverify' : 'Verify', `ppAdmin.setStay(${s.id},{verified:${!s.verified}})`)}
            ${btn(editing ? 'Close' : 'Edit', `ppAdmin.edit(${editing ? 'null' : s.id})`)}
          </div>
        </div>
        ${editing ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-top:10px;background:#f6f8f6;padding:10px;border-radius:10px">
          <label style="font-size:11.5px;color:var(--stone)">Name<input id="ppe-name" class="ai" value="${esc(s.name)}" style="width:100%"></label>
          <label style="font-size:11.5px;color:var(--stone)">Location<input id="ppe-loc" class="ai" value="${esc(s.loc || '')}" style="width:100%"></label>
          <label style="font-size:11.5px;color:var(--stone)">Price per night (₹)<input id="ppe-pn" class="ai" type="number" min="0" value="${esc(s.pn || '')}" style="width:100%"></label>
          <label style="font-size:11.5px;color:var(--stone)">Max guests<input id="ppe-mg" class="ai" type="number" min="1" value="${esc(s.max_guests || '')}" style="width:100%"></label>
          <label style="font-size:11.5px;color:var(--stone)">Host login email<input id="ppe-host" class="ai" type="email" value="${esc(s.host_email || '')}" style="width:100%"></label>
          <label style="font-size:11.5px;color:var(--stone)">Contact phone<input id="ppe-contact" class="ai" value="${esc(s.contact || '')}" style="width:100%"></label>
          <div style="display:flex;align-items:flex-end">${btn('Save changes', `ppAdmin.saveEdit(${s.id})`, 'main')}</div>
        </div>` : ''}
      </div>`;
    }).join('') || '<div style="font-size:13px;color:var(--stone);padding:8px 0">No stays in this list.</div>';

    el.innerHTML = `
      <h2 style="font-size:20px;font-weight:600;color:var(--pine);margin-bottom:6px;font-family:var(--fd)">Control Centre</h2>
      <p style="font-size:13px;color:var(--stone);margin-bottom:16px">Everything that needs you, in one place. Changes here go live immediately.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:16px">
        ${stat(reqs.length, 'Booking requests waiting', "ppAdmin.filterBookings('requested')")}
        ${stat((d.upcoming || []).length, 'Confirmed check-ins ahead', "ppAdmin.filterBookings('confirmed')")}
        ${stat(d.bookingsThisWeek || 0, 'Bookings in the last 7 days', "ppAdmin.filterBookings('all')")}
        ${stat(d.pendingHostApplications || 0, 'Host applications to review', "ppAdmin.openTab('hostapps')")}
        ${stat(d.staysLive || 0, 'Stays live', "ppAdmin.filterStays('active')")}
        ${stat(d.staysHidden || 0, 'Stays hidden', "ppAdmin.filterStays('hidden')")}
      </div>
      ${card('⏳ Booking requests', reqHtml, 'Confirm after checking with the host')}
      ${card('🧳 Coming up', upHtml)}
      ${card('📋 All bookings', `<div id="ppAdmB" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${fChip('requested', 'Requests')}${fChip('confirmed', 'Confirmed')}${fChip('completed', 'Completed')}${fChip('cancelled', 'Cancelled')}${fChip('all', 'All')}</div>${bRows}`, 'Cancelling here does not refund online payments — refund in Razorpay first')}
      ${card('🏡 All stays', `<div id="ppAdmS" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${sChip('all', 'All')}${sChip('active', 'Live')}${sChip('paused', 'Paused')}${sChip('full', 'Full')}${sChip('hidden', 'Hidden')}</div>${sRows}`, 'Hidden = not shown and cannot be booked')}
    `;
  }

  async function load(el) {
    el.dataset.ppAdmin = '1';
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--stone)">Loading Control Centre…</div>';
    try {
      const [dash, stays, bookings] = await Promise.all([api('dashboard'), api('stays-list'), api('bookings-list', { limit: 500 })]);
      S.dash = dash; S.stays = stays.stays || []; S.bookings = bookings.bookings || [];
      if (!(S.dash.requested || []).length && S.bFilter === 'requested') S.bFilter = 'all';
      render();
    } catch (e) {
      const envHint = /ADMIN_EMAIL/.test(e.message) ? '<p style="font-size:13px;margin-top:8px">Fix: in Vercel → Settings → Environment Variables, set <b>ADMIN_EMAIL</b> to this login email, then redeploy.</p>' : '';
      el.innerHTML = `<div class="adm-panel"><h3>Control Centre couldn't load</h3><p style="font-size:13px;color:#a3261f">${esc(e.message)}</p>${envHint}${btn('Try again', 'ppAdmin.reload()', 'main')}</div>`;
    }
  }

  async function refreshDash() { try { S.dash = await api('dashboard'); } catch (e) { /* keep old */ } }
  async function refreshPublicStays() { try { if (typeof loadStays === 'function') { await loadStays(); typeof renderStays === 'function' && renderStays(); } } catch (e) { /* ignore */ } }
  const note = m => (typeof toast === 'function' ? toast(m) : alert(m));

  window.ppAdmin = {
    render: el => load(el),
    reload: () => { const el = document.getElementById('adMain'); el && load(el); },
    filterBookings(k) { S.bFilter = k; render(); const t = document.getElementById('ppAdmB'); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    filterStays(k) { S.sFilter = k; render(); const t = document.getElementById('ppAdmS'); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    edit(id) { S.editing = id; render(); },
    openTab(key) { const n = [...document.querySelectorAll('.adm-ni')].find(x => (x.getAttribute('onclick') || '').includes(`'${key}'`)); n && n.click(); },
    async setBooking(id, status) {
      if (!status || S.busy) return;
      const label = (STATUS_STYLE[status] || [, , status])[2];
      if (status === 'cancelled' && !confirm(`Cancel booking ${id}? The guest is not notified automatically — message them on WhatsApp.`)) { render(); return; }
      S.busy = true;
      try {
        const r = await api('booking-update', { id, status });
        const i = S.bookings.findIndex(b => b.id === id);
        if (i >= 0) S.bookings[i] = Object.assign({}, S.bookings[i], r.booking);
        await refreshDash(); note(`✓ Booking ${id} → ${label}`);
      } catch (e) { note('Error: ' + e.message); }
      S.busy = false; render();
    },
    async setStay(id, changes) {
      if (S.busy) return;
      if (changes.status === 'hidden') { const s = S.stays.find(x => x.id === id); if (!confirm(`Hide "${s ? s.name : id}"? It disappears from the site and can't be booked. You can show it again any time.`)) return; }
      S.busy = true;
      try {
        const r = await api('stay-update', { id, changes });
        const i = S.stays.findIndex(s => s.id === id);
        if (i >= 0) S.stays[i] = Object.assign({}, S.stays[i], r.stay);
        await refreshDash(); await refreshPublicStays(); note('✓ Saved');
      } catch (e) { note('Error: ' + e.message); }
      S.busy = false; render();
    },
    async saveEdit(id) {
      const v = k => (document.getElementById('ppe-' + k) || {}).value;
      const changes = { name: v('name'), loc: v('loc'), host_email: v('host'), contact: v('contact') };
      if (v('pn') !== '') changes.pn = v('pn');
      if (v('mg') !== '') changes.max_guests = v('mg');
      S.editing = null;
      await window.ppAdmin.setStay(id, changes);
    },
    _state: S,
  };
})();
