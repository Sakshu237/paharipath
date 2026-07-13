// /api/_lib/email.js
// Shared Zoho SMTP sender. Needs EMAIL_USER + EMAIL_PASS env vars
// (a Zoho app-specific password, not your login password).
const nodemailer = require('nodemailer');

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) return null;
  _transporter = nodemailer.createTransport({
    host: 'smtp.zoho.in',
    port: 465,
    secure: true,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
  return _transporter;
}

// Never throws — a failed email should never break the calling action.
async function sendEmail({ to, subject, html }) {
  const transporter = getTransporter();
  if (!transporter || !to) return false;
  try {
    await transporter.sendMail({ from: '"PahariPath" <' + process.env.EMAIL_USER + '>', to, subject, html });
    return true;
  } catch (err) {
    console.warn('Email send failed:', err.message);
    return false;
  }
}

module.exports = { sendEmail };
