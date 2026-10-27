// /api/support.js
// Customer care / support ticket system.
// Public: 'submit' — anyone can raise a ticket, no login required.
// Admin only: 'list', 'update' — reviewing and resolving tickets.
//
// REQUEST BODY (POST, JSON): { action, ...fields, access_token }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

// 'submit' is public and unauthenticated by design (a support request
// shouldn't require a login), so it's rate-limited and length-capped the
// same way /api/sos.js and /api/bookings.js create-booking are — shared
// rate_limit_log table, distinct key prefix so buckets never collide.
const { sendEmail } = require('./_lib/email');
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const MAX_NAME_LEN = 100;
const MAX_CONTACT_LEN = 100;
const MAX_CATEGORY_LEN = 40;
const MAX_MESSAGE_LEN = 1000;
const MAX_REF_LEN = 40;


const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PROPERTY_TYPES = ['Homestay', 'Eco Cottage', 'Eco Camp', 'Heritage Stay', 'Village Stay', 'Lodge'];
// Uploaded files are referenced as "bucket/filename" — nothing else is accepted.
function parseStorageRef(v, allowedBuckets) {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^([a-z-]+)\/([A-Za-z0-9._-]{1,160})$/);
  if (!m || !allowedBuckets.includes(m[1])) return null;
  return { bucket: m[1], path: m[2] };
}

function clip(val, max) {
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

async function countRecentAttempts(key, headers) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rate_limit_log?rl_key=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(since)}&select=id`,
    { headers }
  );
  const rows = await res.json();
  return Array.isArray(rows) ? rows.length : 0;
}
async function logAttempt(key, headers) {
  await fetch(`${SUPABASE_URL}/rest/v1/rate_limit_log`, { method: 'POST', headers, body: JSON.stringify({ rl_key: key }) });
}

async function verifyAdmin(access_token, adminEmail) {
  if (!adminEmail) return { errorReason: 'ADMIN_EMAIL is not set on the server (Vercel env vars)' };
  if (!access_token) return { errorReason: 'No login session was sent with this request — please log out and back in' };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${access_token}` },
  });
  if (!userRes.ok) return { errorReason: 'Your login session has expired — please log out and back in' };
  const user = await userRes.json();
  if (!user.email) return { errorReason: 'Could not read the account email from this session' };
  if (user.email.toLowerCase() !== adminEmail.toLowerCase()) {
    return { errorReason: `Logged in as ${user.email}, which does not match the ADMIN_EMAIL set on the server` };
  }
  return { user };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!serviceKey) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }
  const svcHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const { action } = req.body || {};

  try {
    // ═══════════════════════════════════════════════
    // action: 'submit' — anyone raises a support ticket, no login needed
    // fields: name, contact, category, message, bookingRef (optional)
    // ═══════════════════════════════════════════════
    if (action === 'submit') {
      const b = req.body;
      const name = clip(b.name, MAX_NAME_LEN);
      const contact = clip(b.contact, MAX_CONTACT_LEN);
      const message = clip(b.message, MAX_MESSAGE_LEN);
      if (!name || !contact || !message) {
        res.status(400).json({ error: 'Name, contact, and message are required' });
        return;
      }

      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const ipKey = `support-ip:${ip}`;
      const contactKey = `support-contact:${contact}`;
      const counts = await Promise.all([
        countRecentAttempts(ipKey, svcHeaders),
        countRecentAttempts(contactKey, svcHeaders),
      ]);
      if (counts[0] >= MAX_ATTEMPTS || counts[1] >= MAX_ATTEMPTS) {
        res.status(429).json({ error: 'Too many support requests recently — please wait a bit before trying again.' });
        return;
      }
      await Promise.all([logAttempt(ipKey, svcHeaders), logAttempt(contactKey, svcHeaders)]);

      const payload = {
        name, contact, category: clip(b.category, MAX_CATEGORY_LEN) || 'general',
        message, booking_ref: clip(b.bookingRef, MAX_REF_LEN), status: 'open',
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      });
      if (!insRes.ok) { res.status(400).json({ error: 'Submit failed: ' + await insRes.text() }); return; }
      res.status(200).json({ success: true, message: "We've got your message — we'll get back to you soon." });
      return;
    }


    // ═══════════════════════════════════════════════
    // action: 'partner-apply' — a property owner submits a listing request
    // (public, rate-limited). Saved as a pending partner_applications row
    // for admin verification; the admin is emailed and the applicant gets
    // a confirmation. Files are uploaded by the browser first and sent here
    // as "bucket/filename" references, which are validated below.
    // ═══════════════════════════════════════════════
    if (action === 'partner-apply') {
      const b = req.body;
      const propertyName = clip(b.propertyName, 120);
      const location = clip(b.location, 150);
      const ownerName = clip(b.ownerName, 100);
      const phone = clip(b.phone, 10);
      const email = (clip(b.email, 150) || '').toLowerCase();
      const description = clip(b.description, 1000) || '';
      const price = parseInt(b.price);
      const propertyType = PROPERTY_TYPES.includes(b.propertyType) ? b.propertyType : 'Homestay';
      const eco = b.eco === true;
      // Listing details guests need, and the HP Home Stay registration (mandatory under the HP Home Stay Rules 2025).
      const rooms = parseInt(b.rooms);
      const maxGuests = parseInt(b.maxGuests);
      const address = clip(b.address, 300);
      const mapUrl = clip(b.mapUrl, 300);
      const checkinTime = clip(b.checkinTime, 20);
      const checkoutTime = clip(b.checkoutTime, 20);
      const houseRules = clip(b.houseRules, 1000) || '';
      const registrationNo = clip(b.registrationNo, 60);
      const gstin = (clip(b.gstin, 15) || '').toUpperCase();
      // Payout details — stored in a server-only table, never shown on the site.
      const upi = (clip(b.upi, 60) || '').toLowerCase();
      const accHolder = clip(b.accountHolder, 100);
      const accNo = (clip(b.accountNumber, 20) || '').replace(/\s/g, '');
      const ifsc = (clip(b.ifsc, 11) || '').toUpperCase();

      if (!propertyName || !location || !ownerName || !phone || !email) { res.status(400).json({ error: 'Please fill all required fields' }); return; }
      if (!/^[6-9]\d{9}$/.test(phone)) { res.status(400).json({ error: 'Enter a valid 10-digit WhatsApp number' }); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { res.status(400).json({ error: 'Enter a valid email address' }); return; }
      if (!(price >= 100 && price <= 100000)) { res.status(400).json({ error: 'Enter a valid price per night (₹100 to ₹1,00,000)' }); return; }
      if (!(rooms >= 1 && rooms <= 6)) { res.status(400).json({ error: 'Enter the number of rooms (1 to 6 for a homestay)' }); return; }
      if (!(maxGuests >= 1 && maxGuests <= 24)) { res.status(400).json({ error: 'Enter the maximum number of guests (1 to 24)' }); return; }
      if (!address || address.length < 10) { res.status(400).json({ error: 'Enter the full address of the property' }); return; }
      if (mapUrl && !/^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|www\.google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\//i.test(mapUrl)) { res.status(400).json({ error: 'Map link must be a Google Maps link' }); return; }
      if (!registrationNo) { res.status(400).json({ error: 'Enter your HP Tourism homestay registration number' }); return; }
      if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) { res.status(400).json({ error: 'GSTIN should be 15 characters' }); return; }
      const hasBank = accNo || ifsc || accHolder;
      if (!upi && !hasBank) { res.status(400).json({ error: 'Add a UPI ID or bank account so we can pay you' }); return; }
      if (upi && !/^[a-z0-9._-]{2,}@[a-z]{2,}$/.test(upi)) { res.status(400).json({ error: 'Enter a valid UPI ID, e.g. name@okaxis' }); return; }
      if (hasBank && !(/^\d{9,18}$/.test(accNo) && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc) && accHolder)) { res.status(400).json({ error: 'Check the bank account number, IFSC code and account holder name' }); return; }

      const photoRefs = (Array.isArray(b.photos) ? b.photos : []).slice(0, 5)
        .map(p => parseStorageRef(p, ['stay-photos', 'host-verification'])).filter(Boolean);
      if (photoRefs.length < 2) { res.status(400).json({ error: 'Please add at least 2 photos of your property' }); return; }
      const idRef = parseStorageRef(b.idDoc, ['host-verification']);
      if (!idRef) { res.status(400).json({ error: 'Please add an ID or ownership proof' }); return; }
      const regRef = parseStorageRef(b.registrationDoc, ['host-verification']);
      if (!regRef) { res.status(400).json({ error: 'Please add your homestay registration certificate' }); return; }

      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
      const ipKey = `partner-ip:${ip}`;
      const emailKey = `partner-email:${email}`;
      const counts = await Promise.all([countRecentAttempts(ipKey, svcHeaders), countRecentAttempts(emailKey, svcHeaders)]);
      if (counts[0] >= MAX_ATTEMPTS || counts[1] >= MAX_ATTEMPTS) {
        res.status(429).json({ error: 'Too many attempts recently — please wait a few minutes and try again.' });
        return;
      }
      await Promise.all([logAttempt(ipKey, svcHeaders), logAttempt(emailKey, svcHeaders)]);

      const dupRes = await fetch(`${SUPABASE_URL}/rest/v1/partner_applications?email=eq.${encodeURIComponent(email)}&status=eq.pending&select=id&limit=1`, { headers: svcHeaders });
      const dup = dupRes.ok ? await dupRes.json() : [];
      if (Array.isArray(dup) && dup.length) {
        res.status(409).json({ error: 'We already have a pending application for this email. Our team will contact you on WhatsApp soon.' });
        return;
      }

      const row = {
        property_name: propertyName, location, owner_name: ownerName, phone, email,
        price_per_night: price, property_type: propertyType, description, eco_friendly: eco, status: 'pending',
        property_photos: photoRefs.map(r => `${SUPABASE_URL}/storage/v1/object/public/${r.bucket}/${r.path}`),
        id_document_url: `${idRef.bucket}/${idRef.path}`,
        rooms, max_guests: maxGuests, address, map_url: mapUrl || null, checkin_time: checkinTime || null, checkout_time: checkoutTime || null,
        house_rules: houseRules, registration_no: registrationNo, registration_doc: `${regRef.bucket}/${regRef.path}`, gstin: gstin || null,
      };
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/partner_applications`, {
        method: 'POST', headers: { ...svcHeaders, Prefer: 'return=representation' }, body: JSON.stringify(row),
      });
      if (!insRes.ok) { console.error('partner app insert failed', await insRes.text()); res.status(500).json({ error: 'Could not save your application right now. Please try again.' }); return; }
      const [savedApp] = await insRes.json().catch(() => [null]);
      // Payout details in their own server-only table (no browser access at all).
      if (savedApp && savedApp.id) {
        const pr = await fetch(`${SUPABASE_URL}/rest/v1/host_payout_details`, {
          method: 'POST', headers: { ...svcHeaders, Prefer: 'return=minimal' },
          body: JSON.stringify({ application_id: savedApp.id, host_email: email, upi_id: upi || null, account_holder: accHolder || null, account_number: accNo || null, ifsc: ifsc || null }),
        });
        if (!pr.ok) console.error('payout details insert failed', await pr.text());
      }

      // Best-effort emails — sendEmail never throws, and a failed email must not fail the application.
      if (adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `New host application: ${propertyName}`,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
            <h3 style="color:#2d5a3d">New host application</h3>
            <p><b>${esc(propertyName)}</b> — ${esc(location)}<br/>${esc(propertyType)} · ₹${price}/night · ${rooms} rooms · up to ${maxGuests} guests<br/>HP registration: ${esc(registrationNo)}<br/>
            ${esc(ownerName)} · ${esc(phone)} · ${esc(email)}</p>
            <p>Review it in the admin panel → Host Applications, then approve or reject.</p></div>`,
        });
      }
      await sendEmail({
        to: email,
        subject: 'We received your PahariPath listing request',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#2d5a3d">Thanks, ${esc(ownerName)}!</h2>
          <p>We received your request to list <b>${esc(propertyName)}</b> on PahariPath. Our team will verify your details and contact you on WhatsApp within 48 hours. Once approved, your listing goes live and your host login is emailed to you.</p></div>`,
      });

      res.status(200).json({ success: true });
      return;
    }

    // Everything past this point is admin-only.
    const authResult = await verifyAdmin(req.body.access_token, adminEmail);
    if (!authResult.user) { res.status(403).json({ error: authResult.errorReason || 'Only the admin account can do that' }); return; }
    const user = authResult.user;

    // ═══════════════════════════════════════════════
    // action: 'list' — admin fetches tickets (optionally filtered by status)
    // fields: status (optional: 'open'|'in_progress'|'resolved')
    // ═══════════════════════════════════════════════
    if (action === 'list') {
      const status = req.body.status;
      const url = status
        ? `${SUPABASE_URL}/rest/v1/support_tickets?status=eq.${encodeURIComponent(status)}&order=created_at.desc`
        : `${SUPABASE_URL}/rest/v1/support_tickets?order=created_at.desc&limit=200`;
      const listRes = await fetch(url, { headers: svcHeaders });
      if (!listRes.ok) { res.status(400).json({ error: 'Fetch failed: ' + await listRes.text() }); return; }
      const tickets = await listRes.json();
      res.status(200).json({ success: true, tickets });
      return;
    }

    // ═══════════════════════════════════════════════
    // action: 'update' — admin changes status / adds notes
    // fields: ticketId, status (optional), adminNotes (optional)
    // ═══════════════════════════════════════════════
    if (action === 'update') {
      const ticketId = parseInt(req.body.ticketId);
      if (!ticketId) { res.status(400).json({ error: 'Missing ticketId' }); return; }
      const ALLOWED_STATUSES = ['open', 'in_progress', 'resolved'];
      const fields = { updated_at: new Date().toISOString() };
      if (req.body.status) {
        if (!ALLOWED_STATUSES.includes(req.body.status)) {
          res.status(400).json({ error: 'Invalid status value' });
          return;
        }
        fields.status = req.body.status;
      }
      if (req.body.adminNotes !== undefined) fields.admin_notes = clip(req.body.adminNotes, MAX_MESSAGE_LEN);
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/support_tickets?id=eq.${ticketId}`, {
        method: 'PATCH', headers: svcHeaders, body: JSON.stringify(fields),
      });
      if (!upd.ok) { res.status(400).json({ error: 'Update failed: ' + await upd.text() }); return; }
      res.status(200).json({ success: true });
      return;
    }

    res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
