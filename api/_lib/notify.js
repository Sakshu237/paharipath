// /api/_lib/notify.js
// Booking emails for the guest, the host and the admin. Every function
// here is best-effort: it never throws, so a failed email can never break
// a booking, a payment or a cancellation.
//
// Needs EMAIL_USER + EMAIL_PASS (see _lib/email.js) and, for admin copies,
// ADMIN_EMAIL in Vercel env vars.

const { sendEmail } = require('./email');

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (k, v) => `<tr><td style="padding:6px 0;color:#666">${esc(k)}</td><td style="padding:6px 0;font-weight:600">${esc(v)}</td></tr>`;
const wrap = (title, intro, rows, foot) => `
  <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h2 style="color:#2d5a3d;margin:0 0 8px">${esc(title)}</h2>
    <p style="margin:0 0 12px">${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">${rows.join('')}</table>
    ${foot || ''}
    <p style="font-size:12px;color:#888;margin-top:18px">PahariPath · hello@paharipath.in</p>
  </div>`;

const payLine = b => b.payment_status === 'paid' ? `Paid online (${b.amount || '—'})` : `Pay at the stay (${b.amount || '—'})`;

// Looks up the stay's host email / name / phone with the service-role headers.
async function stayInfo(stayId, headers, SUPABASE_URL) {
  if (!stayId) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/stays?id=eq.${parseInt(stayId)}&select=name,host_email,contact,address,checkin_time,checkout_time,house_rules`, { headers });
    const rows = r.ok ? await r.json() : [];
    return rows[0] || null;
  } catch (e) { return null; }
}

async function guestConfirmed(b, stay) {
  if (!b.guest_email) return;
  const rows = [
    row('Stay', b.stay_name), row('Dates', b.dates || '—'), row('Nights', b.nights || '—'), row('Guests', b.guests || 1),
    row('Payment', payLine(b)), row('Reference', b.id),
    ...(stay && stay.address ? [row('Address', stay.address)] : []),
    ...(stay && stay.checkin_time ? [row('Check-in', stay.checkin_time)] : []),
    ...(stay && stay.checkout_time ? [row('Check-out', stay.checkout_time)] : []),
  ];
  const foot = `${b.invoice_no ? `<p style="font-size:13px">Tax invoice no. <b>${esc(b.invoice_no)}</b> — GST ₹${esc(b.gst_amount || 0)} included.</p>` : ''}
    ${stay && stay.house_rules ? `<p style="font-size:13px;color:#444"><b>House rules:</b> ${esc(stay.house_rules)}</p>` : ''}
    <p style="font-size:13px;color:#666">Need to manage or cancel? Use "Manage / Cancel Booking" on paharipath.in with this reference and your phone number.</p>`;
  await sendEmail({ to: b.guest_email, subject: `Booking confirmed — ${String(b.stay_name).slice(0, 80)} (Ref: ${b.id})`, html: wrap('Your stay is confirmed 🏔️', `Hi ${esc(b.guest || 'traveller')}, here's your booking summary:`, rows, foot) });
}

async function hostNewBooking(b, stay) {
  if (!stay || !stay.host_email) return;
  const rows = [
    row('Guest', b.guest), row('Guest phone', b.guest_phone), row('Dates', b.dates || '—'),
    row('Nights', b.nights || '—'), row('Guests', b.guests || 1), row('Payment', payLine(b)), row('Reference', b.id),
  ];
  const foot = `<p style="font-size:13px">Please WhatsApp the guest to welcome them and share directions. Your calendar on PahariPath already shows these dates as booked.</p>`;
  await sendEmail({ to: stay.host_email, subject: `New booking: ${b.guest} · ${b.dates || ''} (Ref: ${b.id})`, html: wrap('You have a new booking 🎉', `A guest has booked <b>${esc(stay.name || b.stay_name)}</b>.`, rows, foot) });
}

async function hostCancelled(b, stay, refund) {
  if (!stay || !stay.host_email) return;
  const rows = [row('Guest', b.guest), row('Dates', b.dates || '—'), row('Reference', b.id), ...(refund != null ? [row('Refund to guest', `₹${refund}`)] : [])];
  await sendEmail({ to: stay.host_email, subject: `Booking cancelled: ${b.guest} · ${b.dates || ''} (Ref: ${b.id})`, html: wrap('A booking was cancelled', `This booking at <b>${esc(stay.name || b.stay_name)}</b> has been cancelled. These dates are open again.`, rows) });
}

async function admin(subject, title, b, extra) {
  const to = process.env.ADMIN_EMAIL;
  if (!to) return;
  const rows = [row('Stay', b.stay_name), row('Guest', `${b.guest} · ${b.guest_phone}`), row('Dates', b.dates || '—'), row('Payment', payLine(b)), row('Reference', b.id), ...(extra || [])];
  await sendEmail({ to, subject, html: wrap(title, '', rows) });
}

// Called once a booking is truly confirmed (pay-at-stay create, or verified payment).
async function bookingConfirmed(b, headers, SUPABASE_URL) {
  try {
    const stay = await stayInfo(b.stay_id, headers, SUPABASE_URL);
    await Promise.all([guestConfirmed(b, stay), hostNewBooking(b, stay), admin(`New booking ${b.id} — ${b.stay_name}`, 'New booking', b)]);
  } catch (e) { console.warn('bookingConfirmed notify failed', e.message); }
}

async function bookingCancelled(b, refund, headers, SUPABASE_URL) {
  try {
    const stay = await stayInfo(b.stay_id, headers, SUPABASE_URL);
    await Promise.all([hostCancelled(b, stay, refund), admin(`Cancelled ${b.id} — ${b.stay_name}`, 'Booking cancelled', b, refund != null ? [row('Refund', `₹${refund}`)] : [])]);
  } catch (e) { console.warn('bookingCancelled notify failed', e.message); }
}

module.exports = { bookingConfirmed, bookingCancelled, esc };
