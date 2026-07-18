// PahariPath Service Worker — Offline HP Map Tiles

const CACHE_NAME = 'paharipath-v2';
const TILE_CACHE = 'hp-tiles-v1';

// HP bounding box
const HP_BOUNDS = {
  minLat: 30.0,
  maxLat: 34.0,
  minLng: 75.5,
  maxLng: 79.5
};

// Static assets (DO NOT include "/" or "/index.html")
const APP_SHELL = [
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

// INSTALL
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(APP_SHELL.map(url => cache.add(url)))
    )
  );

  self.skipWaiting();
});

// ACTIVATE
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME && key !== TILE_CACHE) {
            return caches.delete(key);
          }
        })
      )
    )
  );

  self.clients.claim();
});

// FETCH
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ============================
  // MAP TILES — Cache First
  // ============================
  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('tiles.wmflabs.org')
  ) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;

          return fetch(event.request)
            .then(response => {
              if (response.ok) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // ============================
  // HTML PAGES — Network First
  // ============================
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();

            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, copy);
            });
          }

          return response;
        })
        .catch(() => caches.match(event.request))
    );

    return;
  }

  // ============================
  // STATIC ASSETS — Cache First
  // (matched by full URL, not pathname, so CDN assets actually hit this branch)
  // ============================
  if (APP_SHELL.includes(event.request.url)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;

        return fetch(event.request).then(response => {
          if (response.ok) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, response.clone());
            });
          }

          return response;
        });
      })
    );

    return;
  }

  // ============================
  // EVERYTHING ELSE
  // ============================
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// MESSAGE HANDLER
self.addEventListener('message', event => {
  if (event.data === 'PRECACHE_HP_TILES') {
    precacheHPTiles(event.source);
  }
});

// PRE-CACHE HP TILES
// NOTE: not called anywhere yet — do not wire this up until you've
// switched to a tile provider whose terms allow bulk caching
// (MapTiler / Stadia Maps). tile.openstreetmap.org's usage policy
// prohibits this kind of bulk programmatic download.
async function precacheHPTiles(client) {
  const cache = await caches.open(TILE_CACHE);
  const zoom = 9;

  function lngToTile(lng, z) {
    return Math.floor(((lng + 180) / 360) * Math.pow(2, z));
  }

  function latToTile(lat, z) {
    return Math.floor(
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) +
            1 / Math.cos((lat * Math.PI) / 180)
        ) /
          Math.PI) /
        2) *
        Math.pow(2, z)
    );
  }

  const minX = lngToTile(HP_BOUNDS.minLng, zoom);
  const maxX = lngToTile(HP_BOUNDS.maxLng, zoom);
  const minY = latToTile(HP_BOUNDS.maxLat, zoom);
  const maxY = latToTile(HP_BOUNDS.minLat, zoom);

  const tiles = [];

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      tiles.push(`https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`);
    }
  }

  let cachedCount = 0;

  for (let i = 0; i < tiles.length; i += 10) {
    const batch = tiles.slice(i, i + 10);

    const results = await Promise.allSettled(
      batch.map(tile =>
        fetch(tile)
          .then(response => {
            if (response.ok) {
              cache.put(tile, response.clone());
              return true;
            }

            return false;
          })
          .catch(() => false)
      )
    );

    cachedCount += results.filter(
      result => result.status === 'fulfilled' && result.value
    ).length;
  }

  console.log(
    `PahariPath: Cached ${cachedCount} HP map tiles for offline use`
  );

  if (client) {
    client.postMessage({
      type: 'HP_TILES_CACHED',
      count: cachedCount,
      total: tiles.length
    });
  }
}
