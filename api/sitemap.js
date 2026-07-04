// /api/sitemap.js
// Generates sitemap.xml dynamically: homepage + all 146 destinations +
// blog index + every published blog post. Add a new blog post in the
// admin panel and it appears here automatically on next crawl — no
// manual sitemap editing, ever.
const places = require('../places.json');
const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

module.exports = async (req, res) => {
  let posts = [];
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

  const today = new Date().toISOString().split('T')[0];
  const urls = [
    { loc: 'https://paharipath.in/', priority: '1.0', freq: 'weekly', lastmod: today },
    { loc: 'https://paharipath.in/blog', priority: '0.7', freq: 'weekly', lastmod: today },
    { loc: 'https://paharipath.in/privacy-policy.html', priority: '0.3', freq: 'yearly', lastmod: today },
    { loc: 'https://paharipath.in/terms-of-service.html', priority: '0.3', freq: 'yearly', lastmod: today },
    ...places.map(p => ({
      loc: `https://paharipath.in/destination/${p.slug}`,
      priority: '0.8',
      freq: 'monthly',
      lastmod: today
    })),
    ...posts.map(p => ({
      loc: `https://paharipath.in/blog/${p.slug}`,
      priority: '0.6',
      freq: 'monthly',
      lastmod: p.published_at ? new Date(p.published_at).toISOString().split('T')[0] : today
    }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.freq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).end(xml);
};
