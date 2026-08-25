/* ═══════════════════════════════════════════════════════════════════════
   TAWAL Li-Ion Battery Field Checklist — offline service worker
   PM 2026-08-05

   Why this exists
   ---------------
   The checklist is used at remote tower sites where coverage is patchy or
   absent. GitHub Pages serves it with `cache-control: max-age=600`, so ten
   minutes after loading, a reload would hit the network and fail — leaving a
   technician mid-inspection with a blank page and answers stranded in
   localStorage. This worker makes the app load from disk, at any signal level.

   Strategy: stale-while-revalidate
   --------------------------------
   Serve the cached copy immediately (instant load, works at zero signal), and
   refresh it from the network in the background. The refreshed copy is used on
   the NEXT load, never mid-session — a checklist must not change shape under
   the technician while it is being filled in.

   Staleness control
   -----------------
   A handover document served from a stale cache forever would be worse than a
   slow one. Three things prevent that:
     • CACHE is keyed to VERSION — bumping VERSION orphans every old entry.
     • activate deletes every cache that is not the current one.
     • skipWaiting + clients.claim mean a new worker takes over promptly, and
       the page shows a toast telling the technician to reopen.
   VERSION must match APP_VERSION in index.html; that string is displayed in the
   top bar so a technician can report exactly which build they are running.
   ═══════════════════════════════════════════════════════════════════════ */

const VERSION = '2026.08.25';
const CACHE = 'tawal-liion-' + VERSION;

/* Everything needed to run with no network at all. */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      // addAll is atomic — one 404 would reject the whole install and leave the
      // app uncached. Add individually so a single missing asset can't do that.
      .then(function (cache) {
        return Promise.all(CORE.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
            /* non-fatal: this asset simply won't be pre-cached */
          });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) {
            return k.indexOf('tawal-liion-') === 0 && k !== CACHE;
          }).map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;

  /* Only GET is cacheable. */
  if (req.method !== 'GET') return;

  /* Never intercept cross-origin requests — let the network handle them so an
     offline third-party asset can't be masked by a stale local copy. */
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith((async function () {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    const fromNetwork = fetch(req).then(function (res) {
      /* Only store complete same-origin responses. Opaque/partial responses
         would poison the cache with something we can't validate. */
      if (res && res.status === 200 && res.type === 'basic') {
        cache.put(req, res.clone());
      }
      return res;
    }).catch(function () { return null; });

    if (cached) {
      /* Serve instantly; keep the worker alive while it refreshes in background. */
      event.waitUntil(fromNetwork);
      return cached;
    }

    const res = await fromNetwork;
    if (res) return res;

    /* Offline and never cached. For a navigation, fall back to the app shell so
       the technician still gets the checklist rather than a browser error. */
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    return new Response('Offline and not cached.', {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  })());
});

/* Lets the page ask which build is actually serving it. */
self.addEventListener('message', function (event) {
  if (!event.data) return;
  if (event.data === 'GET_VERSION' || event.data.type === 'GET_VERSION') {
    if (event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
  }
  if (event.data === 'SKIP_WAITING' || event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
