// /api/award-points.js
// The ONLY place points get written to traveller_scores now.
// Runs server-side using the Supabase SERVICE ROLE key (never
// exposed to the browser), so it can bypass RLS safely — but only
// after verifying a real, confirmed booking exists for that
// reference. This closes the hole where anyone could fake points
// by writing to traveller_scores directly from the client.
//
// Uses plain fetch() against Supabase's REST API — same pattern as
// your existing api/sitemap.js — so no new npm dependency or
// package.json is needed.
//
// SETUP (one-time):
// In Vercel: Project Settings → Environment Variables → add
//   SUPABASE_SERVICE_ROLE_KEY = (from Supabase → Settings → API →
//   "service_role" key — NOT the anon key, and never put this one
//   in any client-side code)
//
// REQUEST BODY (POST, JSON):
//   { "bookingRef": "PP482913" }
//
// RESPONSE:
//   { "points": 1340, "awarded": 90, "reasons": [...] }
//   or { "error": "message" }

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';

function tsKey(phone){
  if(!phone) return 'anon';
  let h = 5381;
  for(let i=0;i<phone.length;i++) h = ((h<<5)+h) ^ phone.charCodeAt(i);
  return 'u'+(h>>>0).toString(36);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { bookingRef } = req.body || {};
  if (!bookingRef) {
    res.status(400).json({ error: 'Missing bookingRef' });
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
    // 1. Verify a real, confirmed booking exists for this reference.
    const bookingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}&status=eq.confirmed&select=*`,
      { headers }
    );
    const bookings = await bookingRes.json();
    const booking = Array.isArray(bookings) ? bookings[0] : null;

    if (!booking) {
      res.status(404).json({ error: 'No confirmed booking found for this reference' });
      return;
    }

    // 2. Idempotency — refuse to award points twice for the same booking.
    if (booking.points_awarded) {
      res.status(200).json({ points: null, awarded: 0, reasons: ['Points already awarded for this booking'] });
      return;
    }

    // 3. Calculate points using the same rules as the site's public logic.
    const nights = booking.nights || 1;
    let pts = 0;
    const reasons = [];
    pts += 100; reasons.push('+100 for completing a booking');
    pts += nights * 20; reasons.push(`+${nights*20} for ${nights} night${nights!==1?'s':''}`);
    if (booking.eco) { pts += 50; reasons.push('+50 carbon offset'); }
    const pledgeCount = booking.pledges_accepted || 0;
    if (pledgeCount > 0) { pts += pledgeCount*10; reasons.push(`+${pledgeCount*10} eco pledges`); }
    if (booking.offbeat) { pts += 50; reasons.push('+50 offbeat/village stay'); }

    // 4. Load the traveller's current score row, if any.
    const phone = booking.guest_phone;
    const key = tsKey(phone);
    const scoreRes = await fetch(
      `${SUPABASE_URL}/rest/v1/traveller_scores?user_key=eq.${key}&select=*`,
      { headers }
    );
    const scoreRows = await scoreRes.json();
    const current = (Array.isArray(scoreRows) && scoreRows[0]) || { points:0, stays:0, nights:0, eco:0, offbeat:0, pledges:0, history:[] };

    const updated = {
      user_key: key,
      guest_name: booking.guest || current.guest_name,
      phone_hint: phone,
      points: (current.points||0) + pts,
      stays: (current.stays||0) + 1,
      nights: (current.nights||0) + nights,
      eco: (current.eco||0) + (booking.eco ? 1 : 0),
      offbeat: (current.offbeat||0) + (booking.offbeat ? 1 : 0),
      pledges: (current.pledges||0) + pledgeCount,
      history: [...(current.history||[]), {
        ref: bookingRef, stay: booking.stay_name, pts,
        date: new Date().toLocaleDateString('en-IN'), reasons
      }],
    };

    // 5. Upsert the score (insert or update, keyed on user_key).
    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/traveller_scores?on_conflict=user_key`,
      {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(updated),
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      res.status(500).json({ error: 'Failed to save points: ' + errText });
      return;
    }

    // 6. Mark this booking as claimed so it can never award points again.
    await fetch(
      `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingRef)}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ points_awarded: true }),
      }
    );

    res.status(200).json({ points: updated.points, awarded: pts, reasons });
  } catch (err) {
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
