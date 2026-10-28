// /api/_lib/admin.js
// One place that decides who is an admin.
//
// Vercel env vars:
//   ADMIN_EMAIL         — the admin login email. Several are allowed, comma-separated:
//                         "admin@paharipath.in" or "admin@paharipath.in,rushlessroaming@gmail.com"
//   ADMIN_NOTIFY_EMAIL  — optional: where booking / support alerts are emailed.
//                         If not set, alerts go to the first ADMIN_EMAIL.

function adminEmails() {
  return String(process.env.ADMIN_EMAIL || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

function isAdminEmail(email) {
  const list = adminEmails();
  return !!email && list.includes(String(email).trim().toLowerCase());
}

function notifyEmail() {
  return (process.env.ADMIN_NOTIFY_EMAIL || '').trim() || adminEmails()[0] || '';
}

module.exports = { adminEmails, isAdminEmail, notifyEmail };
