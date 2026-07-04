// /api/blog-index.js
// Renders the /blog listing page — all published posts, newest first.

const SUPABASE_URL = 'https://fcrkfemeirmfhhxhomgw.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcmtmZW1laXJtZmhoeGhvbWd3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4MDE0NjksImV4cCI6MjA5NzM3NzQ2OX0.6OH8shrt0js3E-uh_GHxm2NFASygzTmKeMaNYobclM4';

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
  let posts = [];
  try {
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?status=eq.published&select=title,slug,excerpt,cover_image,published_at&order=published_at.desc`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`
      }
    });
    posts = await r.json();
    if (!Array.isArray(posts)) posts = [];
  } catch (e) {
    posts = [];
  }

  const cards = posts.map(p => {
    const dateDisplay = p.published_at ? new Date(p.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `<a class="card" href="/blog/${escapeHtml(p.slug)}">
      ${p.cover_image ? `<div class="card-img" style="background-image:url('${escapeHtml(p.cover_image)}')"></div>` : `<div class="card-img card-img-empty">🏔️</div>`}
      <div class="card-body">
        <div class="card-date">${dateDisplay}</div>
        <div class="card-title">${escapeHtml(p.title)}</div>
        ${p.excerpt ? `<div class="card-excerpt">${escapeHtml(p.excerpt)}</div>` : ''}
      </div>
    </a>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Blog — PahariPath | Himachal Travel Guides & Stories</title>
<meta name="description" content="Guides, stories, and offbeat travel tips for exploring Himachal Pradesh responsibly — from PahariPath."/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="https://paharipath.in/blog"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="PahariPath"/>
<meta property="og:title" content="PahariPath Blog"/>
<meta property="og:description" content="Guides, stories, and offbeat travel tips for exploring Himachal Pradesh responsibly."/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<style>
  :root{--pine:#1a3d2b;--sage:#4a7c5f;--mist:#e8ede9;--stone:#6b7c6e;--ink:#1c2420;--cream:#faf9f6;--fd:'Cormorant Garamond',Georgia,serif;--fb:'DM Sans',sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--fb);background:var(--cream);color:var(--ink)}
  nav{padding:16px 24px;border-bottom:1px solid rgba(74,124,95,.12);display:flex;align-items:center;gap:10px}
  nav a{font-family:Georgia,serif;font-size:20px;font-weight:700;color:var(--pine);text-decoration:none}
  .wrap{max-width:1000px;margin:0 auto;padding:48px 24px 80px}
  h1{font-family:var(--fd);font-size:clamp(34px,6vw,54px);color:var(--pine);font-weight:600;margin-bottom:8px}
  .sub{font-size:15px;color:var(--stone);margin-bottom:40px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
  .card{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid rgba(74,124,95,.1);border-radius:16px;overflow:hidden;transition:transform .2s}
  .card:hover{transform:translateY(-3px)}
  .card-img{height:180px;background-size:cover;background-position:center;background-color:var(--mist)}
  .card-img-empty{display:flex;align-items:center;justify-content:center;font-size:40px}
  .card-body{padding:18px}
  .card-date{font-size:11px;color:var(--stone);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
  .card-title{font-family:var(--fd);font-size:20px;font-weight:600;color:var(--pine);margin-bottom:6px}
  .card-excerpt{font-size:13px;color:var(--stone);line-height:1.6}
  .empty{text-align:center;padding:60px 20px;color:var(--stone)}
  footer{text-align:center;padding:30px;color:var(--stone);font-size:12px}
</style>
</head>
<body>
<nav><a href="https://paharipath.in/">Pahari<span style="font-weight:400;color:var(--sage)">Path</span></a></nav>
<div class="wrap">
  <h1>The PahariPath Journal</h1>
  <p class="sub">Guides, stories, and offbeat travel tips from Himachal Pradesh.</p>
  ${posts.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No posts published yet — check back soon.</div>`}
</div>
<footer>© 2026 PahariPath · Himachal Pradesh · Responsible Travel</footer>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
  res.status(200).end(html);
};
