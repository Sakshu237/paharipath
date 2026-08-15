// /api/sitemap.js
// Generates sitemap.xml dynamically: homepage + all 146 destinations +
// blog index + every published blog post. Add a new blog post in the
// admin panel and it appears here automatically on next crawl — no
// manual sitemap editing, ever.
//
// lastmod dates are real, not "whenever this function last ran": each
// destination uses its destination_overrides.updated_at when an admin
// has edited it, falling back to a fixed content-seed date otherwise.
// Sitemap generation is cached for an hour (see Cache-Control below), so
// stamping "today" on every request was telling crawlers everything
// changes hourly — which burns crawl budget on pages that haven't moved.
const places = require('../places.json');
const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

// Fallback lastmod for content that has never been touched via the admin
// panel (no destination_overrides row / no published_at). Update this if
// you do another bulk content pass on places.json itself.
const CONTENT_SEED_DATE = '2026-07-01';
// Legal pages carry their own real "last revised" date — update this
// constant whenever the actual ToS/Privacy text changes, not on every crawl.
const LEGAL_LAST_REVISED = '2026-06-24';

module.exports = async (req, res) => {
  let posts = [];
  let overrides = [];
  try {
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?status=eq.published&select=slug,published_at`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let r;
    try {
      r = await fetch(url, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    posts = await r.json();
    if (!Array.isArray(posts)) posts = [];
  } catch (e) {
    posts = [];
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/destination_overrides?select=place_id,updated_at`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    let r;
    try {
      r = await fetch(url, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    overrides = await r.json();
    if (!Array.isArray(overrides)) overrides = [];
  } catch (e) {
    overrides = [];
  }

  const overrideDateByPlaceId = new Map(
    overrides
      .filter(o => o.updated_at)
      .map(o => [o.place_id, new Date(o.updated_at).toISOString().split('T')[0]])
  );

  // Homepage and the blog index are aggregator pages — their "real" change
  // date is whichever underlying content (a post or a destination edit)
  // changed most recently, not the moment the sitemap happened to render.
  const allKnownDates = [
    ...posts.map(p => p.published_at).filter(Boolean),
    ...overrides.map(o => o.updated_at).filter(Boolean),
  ].map(d => new Date(d).getTime()).filter(t => !isNaN(t));
  const mostRecentActivity = allKnownDates.length
    ? new Date(Math.max(...allKnownDates)).toISOString().split('T')[0]
    : CONTENT_SEED_DATE;

  const urls = [
    // Homepage deliberately has no lastmod — it's the evergreen entry
    // point, and Google was showing this date directly in the search
    // snippet (before the description), which looked odd for a homepage.
    // Destination and blog pages keep real lastmod dates below, since
    // freshness signals are genuinely useful for that content.
    { loc: 'https://paharipath.in/', priority: '1.0', freq: 'weekly' },
    { loc: 'https://paharipath.in/blog', priority: '0.7', freq: 'weekly', lastmod: mostRecentActivity },
    { loc: 'https://paharipath.in/privacy-policy.html', priority: '0.3', freq: 'yearly', lastmod: LEGAL_LAST_REVISED },
    { loc: 'https://paharipath.in/terms-of-service.html', priority: '0.3', freq: 'yearly', lastmod: LEGAL_LAST_REVISED },
    ...places.map(p => ({
      loc: `https://paharipath.in/destination/${p.slug}`,
      priority: '0.8',
      freq: 'monthly',
      lastmod: overrideDateByPlaceId.get(p.id) || CONTENT_SEED_DATE
    })),
    ...posts.map(p => ({
      loc: `https://paharipath.in/blog/${p.slug}`,
      priority: '0.6',
      freq: 'monthly',
      lastmod: p.published_at ? new Date(p.published_at).toISOString().split('T')[0] : CONTENT_SEED_DATE
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).end(xml);
};
