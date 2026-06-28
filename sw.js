// PahariPath Service Worker — Offline HP Map Tiles
const CACHE_NAME = 'paharipath-v1';
const TILE_CACHE = 'hp-tiles-v1';

// HP bounding box: lat 30.0–34.0, lng 75.5–79.5
// Zoom levels 7-12 cached for offline use
const HP_BOUNDS = {
  minLat: 30.0, maxLat: 34.0,
  minLng: 75.5, maxLng: 79.5
};

// App shell files to cache
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(APP_SHELL.filter(url => !url.startsWith('http') || url.includes('unpkg') || url.includes('jsdelivr')));
    }).catch(err => console.log('Cache install error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Cache OSM tile requests for HP region
  if (url.hostname.includes('tile.openstreetmap.org') || 
      url.hostname.includes('tiles.wmflabs.org')) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || new Response('', {status: 503}));
        })
      )
    );
    return;
  }

  // App shell — cache first
  if (event.request.mode === 'navigate' || APP_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        return cached || fetch(event.request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Everything else — network first, fall back to cache
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Message handler — trigger HP tile pre-cache
self.addEventListener('message', event => {
  if (event.data === 'PRECACHE_HP_TILES') {
    precacheHPTiles();
  }
});

async function precacheHPTiles() {
  const cache = await caches.open(TILE_CACHE);
  const zoom = 9; // Cache zoom 9 for overview
  
  function lngToTile(lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); }
  function latToTile(lat, z) {
    return Math.floor((1 - Math.log(Math.tan(lat * Math.PI/180) + 1/Math.cos(lat * Math.PI/180)) / Math.PI) / 2 * Math.pow(2, z));
  }

  const minX = lngToTile(HP_BOUNDS.minLng, zoom);
  const maxX = lngToTile(HP_BOUNDS.maxLng, zoom);
  const minY = latToTile(HP_BOUNDS.maxLat, zoom); // Y is inverted
  const maxY = latToTile(HP_BOUNDS.minLat, zoom);

  const tiles = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
    }
  }

  // Cache in batches of 10
  for (let i = 0; i < tiles.length; i += 10) {
    const batch = tiles.slice(i, i + 10);
    await Promise.allSettled(batch.map(url =>
      fetch(url).then(r => r.ok ? cache.put(url, r) : null).catch(() => null)
    ));
  }
  
  console.log(`PahariPath: Cached ${tiles.length} HP map tiles for offline use`);
}
