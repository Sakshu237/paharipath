// /api/blog/[slug].js
// Renders a single published blog post as a real, indexable page.
// Fetches directly from Supabase (public anon key — same one used
// client-side; RLS on blog_posts should allow public SELECT where
// status='published').

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

// Minimal markdown-ish → HTML: paragraphs + line breaks only.
// Admin panel content is plain text with blank-line-separated paragraphs.
function renderBody(raw) {
  return String(raw || '')
    .split(/\n\s*\n/)
    .map(para => `<p>${escapeHtml(para.trim()).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

module.exports = async (req, res) => {
  const { slug } = req.query;

  let post = null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&status=eq.published&select=*&limit=1`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`
      }
    });
    const data = await r.json();
    post = Array.isArray(data) && data.length ? data[0] : null;
  } catch (e) {
    // fall through to 404 below
  }

  if (!post) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html><head><title>Not found — PahariPath</title>
      <meta name="robots" content="noindex"/></head>
      <body style="font-family:sans-serif;text-align:center;padding:80px 20px;color:#1a3d2b">
      <h1>Post not found</h1>
      <p><a href="https://paharipath.in/blog" style="color:#1a3d2b">← Back to Blog</a></p>
      </body></html>`);
    return;
  }

  const title = `${post.title} | PahariPath Blog`;
  const description = post.excerpt || String(post.content || '').slice(0, 155);
  const url = `https://paharipath.in/blog/${post.slug}`;
  const image = post.cover_image || 'https://paharipath.in/og-image.jpg';
  const publishedDate = post.published_at ? new Date(post.published_at).toISOString() : '';
  const dateDisplay = post.published_at ? new Date(post.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}"/>
<meta name="robots" content="index, follow"/>
<link rel="canonical" href="${url}"/>
<meta property="og:type" content="article"/>
<meta property="og:site_name" content="PahariPath"/>
<meta property="og:title" content="${escapeHtml(post.title)}"/>
<meta property="og:description" content="${escapeHtml(description)}"/>
<meta property="og:image" content="${escapeHtml(image)}"/>
<meta property="og:url" content="${url}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(post.title)}"/>
<meta name="twitter:description" content="${escapeHtml(description)}"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet"/>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": post.title,
  "description": description,
  "image": image,
  "datePublished": publishedDate,
  "author": { "@type": "Organization", "name": "PahariPath" },
  "publisher": { "@type": "Organization", "name": "PahariPath" },
  "mainEntityOfPage": url
}, null, 2)}
</script>
<style>
  :root{--pine:#1a3d2b;--moss:#2d5a40;--sage:#4a7c5f;--mist:#e8ede9;--clay:#c4704a;--stone:#6b7c6e;--ink:#1c2420;--cream:#faf9f6;--fd:'Cormorant Garamond',Georgia,serif;--fb:'DM Sans',sans-serif}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:var(--fb);background:var(--cream);color:var(--ink);line-height:1.8}
  nav{padding:16px 24px;border-bottom:1px solid rgba(74,124,95,.12);display:flex;align-items:center;gap:10px}
  nav a{font-family:Georgia,serif;font-size:20px;font-weight:700;color:var(--pine);text-decoration:none}
  .wrap{max-width:680px;margin:0 auto;padding:40px 24px 80px}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--sage);margin-bottom:12px}
  h1{font-family:var(--fd);font-size:clamp(30px,5.5vw,46px);color:var(--pine);font-weight:600;margin-bottom:10px;line-height:1.15}
  .meta{font-size:13px;color:var(--stone);margin-bottom:8px}
  .cover{width:100%;border-radius:14px;margin:24px 0;display:block}
  .body p{font-size:17px;color:var(--ink);margin-bottom:20px}
  .cta{background:var(--pine);border-radius:16px;padding:26px;text-align:center;color:#fff;margin-top:40px}
  .cta h2{font-family:var(--fd);font-size:22px;margin-bottom:8px}
  .cta a{display:inline-block;background:#fff;color:var(--pine);padding:12px 26px;border-radius:10px;font-weight:600;text-decoration:none;font-size:14px;margin-top:10px}
  footer{text-align:center;padding:30px;color:var(--stone);font-size:12px}
</style>
</head>
<body>
<nav><a href="https://paharipath.in/">Pahari<span style="font-weight:400;color:var(--sage)">Path</span></a></nav>
<div class="wrap">
  <div class="eyebrow">PahariPath Blog</div>
  <h1>${escapeHtml(post.title)}</h1>
  ${dateDisplay ? `<div class="meta">${dateDisplay}</div>` : ''}
  ${post.cover_image ? `<img class="cover" src="${escapeHtml(post.cover_image)}" alt="${escapeHtml(post.title)}"/>` : ''}
  <div class="body">${renderBody(post.content)}</div>
  <div class="cta">
    <h2>Ready to explore Himachal?</h2>
    <a href="https://paharipath.in/">Explore PahariPath →</a>
  </div>
</div>
<footer>© 2026 PahariPath · Himachal Pradesh · Responsible Travel</footer>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
  res.status(200).end(html);
};
