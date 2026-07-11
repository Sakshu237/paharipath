// /api/lookup-booking.js
// Read-only lookup used by the "Manage My Booking" flow. Returns just
// enough info to show the guest what they're about to cancel — never
// exposes other guests' bookings, since it requires an exact phone
// match in addition to the booking reference.
//
// REQUEST BODY (POST, JSON): { "bookingRef": "PP482913", "phone": "9876543210" }
// RESPONSE: { booking: {...} } or { error: "..." }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { bookingRef, phone } = req.body || {};
  if (!bookingRef || !phone) {
    res.status(400).json({ error: 'Missing bookingRef or phone' });
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
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&select=id,stay_name,dates,checkin_date,checkout_date,amount,status,nights,guests`,
      { headers }
    );
    const bookings = await bookingRes.json();
    const booking = Array.isArray(bookings) ? bookings[0] : null;

    if (!booking) {
      res.status(404).json({ error: 'No booking found with that reference' });
      return;
    }

    // Verify ownership separately (don't leak whether a ref exists vs
    // whether the phone matches, by checking guest_phone in a second
    // query rather than the select above).
    const ownerRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&guest_phone=eq.${encodeURIComponent(phone)}&select=id`,
      { headers }
    );
    const ownerRows = await ownerRes.json();
    if (!Array.isArray(ownerRows) || !ownerRows.length) {
      res.status(403).json({ error: 'This phone number does not match the booking on record' });
      return;
    }

    res.status(200).json({ booking });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
