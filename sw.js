// Service worker: l'app funziona anche senza internet (utile in fiera)
const VERSION = 'v11';
const SHELL = `shell-${VERSION}`;
const VENDOR = 'vendor-v1';
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'parse.js', 'db.js', 'i18n.js', 'access.js', 'lock.js', 'profili.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'vendor/qrcode.js', 'vendor/fonts/manrope-latin-400-normal.woff2', 'vendor/fonts/manrope-latin-500-normal.woff2', 'vendor/fonts/manrope-latin-600-normal.woff2', 'vendor/fonts/manrope-latin-700-normal.woff2', 'vendor/fonts/manrope-latin-800-normal.woff2'];
const VENDOR_FILES = [
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-lstm.wasm.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/lang/ita.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL);
      await shell.addAll(SHELL_FILES);
      const vendor = await caches.open(VENDOR);
      for (const f of VENDOR_FILES) {
        if (!(await vendor.match(f))) await vendor.add(f).catch(() => {});
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== SHELL && k !== VENDOR) await caches.delete(k);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/tesseract/')) {
    // librerie pesanti: dalla cache, scaricate una volta sola
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then(
        (r) => r || fetch(e.request).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(VENDOR).then((c) => c.put(e.request, copy)); }
          return res;
        })
      )
    );
    return;
  }
  // app: risposta subito dalla cache, aggiornamento in sottofondo
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => cached || caches.match('index.html'));
      return cached || net;
    })
  );
});
