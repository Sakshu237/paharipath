// /api/my-bookings.js
// Returns every booking associated with a phone number — used by the
// traveller's self-service profile dashboard to show their real
// booking history. Kept server-side (rather than a public anon SELECT
// policy on `bookings`) so the site never has to expose all guests'
// bookings to anonymous reads; a client can only ever see bookings
// tied to the exact phone number they provide.
//
// REQUEST BODY (POST, JSON): { "phone": "9876543210" }
// RESPONSE: { bookings: [...] } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { phone } = req.body || {};
  if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
    res.status(400).json({ error: 'Invalid phone number' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'Server not configured — missing SUPABASE_SERVICE_ROLE_KEY' });
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    const bookingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?guest_phone=eq.${encodeURIComponent(phone)}&select=id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests,eco&order=created_at.desc`,
      { headers }
    );
    const bookings = await bookingsRes.json();
    res.status(200).json({ bookings: Array.isArray(bookings) ? bookings : [] });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
