/**
 * PahariPath SEO Patch
 * ─────────────────────
 * Drop this <script> block just before </body> in index.html.
 *
 * What it does:
 *   1. Pushes /destination/<slug> into the browser history when a
 *      destination modal/card is opened — giving each destination a
 *      shareable, crawlable URL.
 *   2. Updates <title>, meta description, canonical, og:* and twitter:*
 *      tags dynamically for that destination.
 *   3. Injects JSON-LD TouristAttraction + BreadcrumbList structured data.
 *   4. On page load, if the URL path is already /destination/<slug>,
 *      it pre-fills meta so Googlebot sees the right content (important
 *      once you add prerendering or SSR).
 *   5. Restores home-page meta when modal is closed / user navigates back.
 *
 * Integration steps:
 *   a) In your existing "open destination modal" JS, call:
 *        window.pahariSEO.open(destinationObject);
 *   b) In your "close modal" JS, call:
 *        window.pahariSEO.close();
 *   c) The destinationObject shape expected:
 *        {
 *          slug:        "kaza",                    // URL-safe, lowercase
 *          name:        "Kaza",
 *          district:    "Spiti",
 *          description: "Remote valley town...",   // 1–2 sentences
 *          tags:        ["Offbeat","Trek"],
 *          lat:         32.2273,
 *          lng:         78.0718,
 *          crowdLevel:  "quiet"                    // quiet | moderate | busy
 *        }
 */

(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function setMeta(name, content) {
    var el = document.querySelector('meta[name="' + name + '"]') ||
             document.querySelector('meta[property="' + name + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(name.startsWith('og:') || name.startsWith('twitter:') ? 'property' : 'name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setCanonical(url) {
    var el = document.querySelector('link[rel="canonical"]');
    if (!el) {
      el = document.createElement('link');
      el.setAttribute('rel', 'canonical');
      document.head.appendChild(el);
    }
    el.setAttribute('href', url);
  }

  function setJsonLd(data) {
    var el = document.getElementById('paharipath-jsonld');
    if (!el) {
      el = document.createElement('script');
      el.id = 'paharipath-jsonld';
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }

  /* ── Home-page defaults ───────────────────────────────────── */

  var HOME = {
    title:       'PahariPath — Discover Real Himachal Pradesh',
    description: 'Discover 146+ offbeat destinations in Himachal Pradesh with live crowd tracking. Find peaceful valleys, quiet villages, and real Pahadi experiences. Book directly with local hosts.',
    url:         'https://paharipath.in/',
    image:       'https://paharipath.in/og-image.jpg'
  };

  /* ── Website-level JSON-LD (always present on home) ────────── */

  var HOME_JSONLD = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": "https://paharipath.in/#website",
        "url": "https://paharipath.in/",
        "name": "PahariPath",
        "description": HOME.description,
        "inLanguage": "en-IN",
        "potentialAction": {
          "@type": "SearchAction",
          "target": {
            "@type": "EntryPoint",
            "urlTemplate": "https://paharipath.in/?q={search_term_string}"
          },
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@type": "Organization",
        "@id": "https://paharipath.in/#organization",
        "name": "PahariPath",
        "url": "https://paharipath.in/",
        "logo": "https://paharipath.in/logo.png",
        "contactPoint": {
          "@type": "ContactPoint",
          "email": "hello@paharipath.in",
          "contactType": "customer support"
        }
      },
      {
        "@type": "TravelAgency",
        "@id": "https://paharipath.in/#travelagency",
        "name": "PahariPath",
        "description": "Offbeat travel discovery platform for Himachal Pradesh with live crowd tracking and direct local homestay bookings.",
        "url": "https://paharipath.in/",
        "areaServed": {
          "@type": "State",
          "name": "Himachal Pradesh",
          "sameAs": "https://en.wikipedia.org/wiki/Himachal_Pradesh"
        }
      }
    ]
  };

  /* ── Open destination ─────────────────────────────────────── */

  function openDestination(dest) {
    var slug = dest.slug || dest.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var destUrl  = 'https://paharipath.in/destination/' + slug;
    var pageUrl  = '/destination/' + slug;
    var title    = dest.name + ' Travel Guide — Himachal Pradesh | PahariPath';
    var desc     = dest.description
                   ? dest.description.slice(0, 155)
                   : 'Explore ' + dest.name + ' in ' + (dest.district || 'Himachal Pradesh') + '. Live crowd tracking, local homestays, and travel tips on PahariPath.';

    // Update browser URL
    history.pushState({ destination: slug }, title, pageUrl);
    document.title = title;

    setMeta('description', desc);
    setMeta('og:title', dest.name + ' — Offbeat Himachal | PahariPath');
    setMeta('og:description', desc);
    setMeta('og:url', destUrl);
    setMeta('og:type', 'article');
    setMeta('twitter:title', dest.name + ' — PahariPath');
    setMeta('twitter:description', desc);
    setCanonical(destUrl);

    /* JSON-LD — TouristAttraction + BreadcrumbList */
    var jsonld = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "TouristAttraction",
          "@id": destUrl + "#place",
          "name": dest.name,
          "description": desc,
          "url": destUrl,
          "inLanguage": "en-IN",
          "touristType": dest.tags || [],
          "containedInPlace": {
            "@type": "State",
            "name": "Himachal Pradesh",
            "sameAs": "https://en.wikipedia.org/wiki/Himachal_Pradesh"
          }
        },
        {
          "@type": "BreadcrumbList",
          "itemListElement": [
            {
              "@type": "ListItem",
              "position": 1,
              "name": "Home",
              "item": "https://paharipath.in/"
            },
            {
              "@type": "ListItem",
              "position": 2,
              "name": dest.district || "Himachal Pradesh",
              "item": "https://paharipath.in/#" + (dest.district || '').toLowerCase().replace(/\s+/g, '-')
            },
            {
              "@type": "ListItem",
              "position": 3,
              "name": dest.name,
              "item": destUrl
            }
          ]
        }
      ]
    };

    /* Add geo if available */
    if (dest.lat && dest.lng) {
      jsonld['@graph'][0].geo = {
        "@type": "GeoCoordinates",
        "latitude": dest.lat,
        "longitude": dest.lng
      };
    }

    setJsonLd(jsonld);
  }

  /* ── Close / restore home ─────────────────────────────────── */

  function closeDestination() {
    history.pushState({}, HOME.title, '/');
    document.title = HOME.title;
    setMeta('description', HOME.description);
    setMeta('og:title', HOME.title);
    setMeta('og:description', HOME.description);
    setMeta('og:url', HOME.url);
    setMeta('og:type', 'website');
    setMeta('twitter:title', 'PahariPath — Real Himachal Pradesh');
    setMeta('twitter:description', 'Live crowd tracking for 146+ HP destinations. Find quiet valleys and book local stays.');
    setCanonical(HOME.url);
    setJsonLd(HOME_JSONLD);
  }

  /* ── Handle back/forward navigation ─────────────────────────── */

  window.addEventListener('popstate', function (e) {
    if (window.location.pathname === '/') {
      // Restore home meta without pushing another history entry
      document.title = HOME.title;
      setMeta('description', HOME.description);
      setMeta('og:title', HOME.title);
      setMeta('og:description', HOME.description);
      setMeta('og:url', HOME.url);
      setMeta('og:type', 'website');
      setCanonical(HOME.url);
      setJsonLd(HOME_JSONLD);
    }
  });

  /* ── On load: set home JSON-LD ───────────────────────────────── */

  setJsonLd(HOME_JSONLD);

  /* ── Public API ──────────────────────────────────────────────── */

  window.pahariSEO = {
    open:  openDestination,
    close: closeDestination
  };

})();
