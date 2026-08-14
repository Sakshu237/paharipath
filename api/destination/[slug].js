// /api/destination/[slug].js
// Renders a real, indexable HTML page for a single destination — this is
// what Google actually sees and ranks. Regular visitors get a "read the
// full guide in the app" handoff that deep-links straight to that place's
// detail view inside the main PahariPath single-page app.
//
// Content comes from two layers, merged: the static places.json bundle
// (base data, redeployed with the app) plus any live `destination_overrides`
// row from Supabase for this place_id (admin-edited name/desc/etc — the
// same table the client-side SPA reads via loadDestinationEdits). Without
// this merge, admin edits and the long-form SEO descriptions written into
// destination_overrides would only ever show inside the app and never on
// the actual page search engines crawl.

const places = require('../../places.json');

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

// destination_overrides column -> places.json field mapping. Mirrors the
// mapping in app.js's loadDestinationEdits so the SPA and the SEO page
// never disagree about which override field maps to which display field.
const OVERRIDE_FIELD_MAP = {
  name: 'name',
  district: 'district',
  description: 'desc',
  emoji: 'emoji',
  vibes: 'vibes',
  best_time: 'bestTime',
  altitude: 'altitude',
  famous_for: 'famousFor',
  zone: 'zone',
};

async function fetchOverride(placeId) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/destination_overrides?place_id=eq.${placeId}&select=*&limit=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let r;
    try {
      r = await fetch(url, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const rows = await r.json();
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) {
    return null; // fall back to static places.json data — never block the page on this
  }
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = async (req, res) => {
  const { slug } = req.query;
  const staticPlace = places.find(p => p.slug === slug);

  if (!staticPlace) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html><head><title>Not found — PahariPath</title>
      <meta name="robots" content="noindex"/></head>
      <body style="font-family:sans-serif;text-align:center;padding:80px 20px;color:#1a3d2b">
      <h1>Destination not found</h1>
      <p><a href="https://paharipath.in/" style="color:#1a3d2b">← Back to PahariPath</a></p>
      </body></html>`);
    return;
  }

  // Merge in any live admin edits from destination_overrides — same fields,
  // same precedence as the client-side loadDestinationEdits.
  const place = { ...staticPlace };
  const override = await fetchOverride(staticPlace.id);
  if (override) {
    for (const [col, field] of Object.entries(OVERRIDE_FIELD_MAP)) {
      if (override[col] !== undefined && override[col] !== null && override[col] !== '') {
        place[field] = override[col];
      }
    }
  }

  const title = `${place.name}, ${place.district} — Crowd Levels, Best Time & Guide | PahariPath`;
  const bodyText = place.longDesc || place.desc;
  const metaSnippet = bodyText && bodyText.length > 160
    ? bodyText.slice(0, 155).replace(/\s+\S*$/, '') + '…'
    : `${bodyText} Altitude: ${place.altitude || 'N/A'}. Best time to visit: ${place.bestTime || 'year-round'}. Live crowd tracking and local homestays on PahariPath.`;
  const description = metaSnippet;
  const url = `https://paharipath.in/destination/${place.slug}`;
  const ogImage = 'https://paharipath.in/og-image.jpg';
  const tags = (place.vibes || []).map(v => escapeHtml(v));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}"/>
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="PahariPath"/>
<meta property="og:title" content="${escapeHtml(place.name)} — ${escapeHtml(place.district)}, Himachal Pradesh"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:image" content="${ogImage}"/>
<meta property="og:url" content="${url}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(place.name)} — PahariPath"/>
<meta name="twitter:description" content="${escapeHtml(description)}"/>
<meta name="geo.placename" content="${escapeHtml(place.name)}, Himachal Pradesh, India"/>
<meta name="geo.region" content="IN-HP"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "TouristAttraction",
  "name": place.name,
  "description": bodyText,
  "url": url,
  "address": {
    "@type": "PostalAddress",
    "addressRegion": "Himachal Pradesh",
    "addressLocality": place.district,
    "addressCountry": "IN"
  },
  "isAccessibleForFree": true,
  "publicAccess": true
}, null, 2)}
</script>
<style>
  :root{--pine:#1a3d2b;--moss:#2d5a40;--sage:#4a7c5f;--mist:#e8ede9;--clay:#c4704a;--stone:#6b7c6e;--ink:#1c2420;--cream:#faf9f6;--fd:'Cormorant Garamond',Georgia,serif;--fb:'DM Sans',sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--fb);background:var(--cream);color:var(--ink);line-height:1.7}
  nav{padding:16px 24px;border-bottom:1px solid rgba(74,124,95,.12);display:flex;align-items:center;gap:10px}
  nav a{font-family:Georgia,serif;font-size:20px;font-weight:700;color:var(--pine);text-decoration:none}
  .wrap{max-width:720px;margin:0 auto;padding:40px 24px 80px}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:10px}
  h1{font-family:var(--fd);font-size:clamp(32px,6vw,52px);color:var(--pine);font-weight:600;margin-bottom:8px;line-height:1.1}
  .sub{font-size:15px;color:var(--stone);margin-bottom:28px}
  .facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:28px}
  .fact{background:#fff;border:1px solid rgba(74,124,95,.12);border-radius:12px;padding:14px 16px}
  .fact-l{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--stone);margin-bottom:4px}
  .fact-v{font-size:14px;font-weight:600;color:var(--ink)}
  p.desc{font-size:17px;color:var(--ink);margin-bottom:24px}
  .tags{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:36px}
  .tag{font-size:12px;padding:5px 12px;border-radius:20px;background:var(--mist);color:var(--sage);font-weight:500}
  .cta{background:var(--pine);border-radius:16px;padding:28px;text-align:center;color:#fff}
  .cta h2{font-family:var(--fd);font-size:24px;margin-bottom:8px}
  .cta p{font-size:14px;opacity:.8;margin-bottom:18px}
  .cta a{display:inline-block;background:#fff;color:var(--pine);padding:13px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px}
  footer{text-align:center;padding:30px;color:var(--stone);font-size:12px}
</style>
</head>
<body>
<nav><a href="https://paharipath.in/">Pahari<span style="font-weight:400;color:var(--sage)">Path</span></a></nav>
<div class="wrap">
  <div class="eyebrow">${escapeHtml(place.district)} District · Himachal Pradesh</div>
  <h1>${escapeHtml(place.name)} ${place.emoji || ''}</h1>
  <p class="sub">${place.famousFor ? escapeHtml(place.famousFor) : ''}</p>

  <div class="facts">
    ${place.altitude ? `<div class="fact"><div class="fact-l">Altitude</div><div class="fact-v">${escapeHtml(place.altitude)} ASL</div></div>` : ''}
    ${place.bestTime ? `<div class="fact"><div class="fact-l">Best Time to Visit</div><div class="fact-v">${escapeHtml(place.bestTime)}</div></div>` : ''}
    <div class="fact"><div class="fact-l">District</div><div class="fact-v">${escapeHtml(place.district)}</div></div>
  </div>

  <p class="desc">${escapeHtml(bodyText)}</p>

  <div class="tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>

  <div class="cta">
    <h2>See live crowd levels &amp; book a stay</h2>
    <p>Check real-time crowd data, weekly forecasts, and local homestays for ${escapeHtml(place.name)} in the full PahariPath app.</p>
    <a href="https://paharipath.in/?openPlace=${place.id}">Open in PahariPath →</a>
  </div>
</div>
<footer>© 2026 PahariPath · Himachal Pradesh · Responsible Travel</footer>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).end(html);
};
