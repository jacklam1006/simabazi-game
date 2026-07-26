/**
 * 司马八字 · Service Worker sw.js
 * 离线缓存静态资源，GLB文件不缓存（太大）
 */

const CACHE_NAME = 'smb-v4';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/js/i18n.js',
  '/js/audio.js',
  '/js/effects.js',
  '/js/config.js',
  '/js/auth.js',
  '/js/bazi-engine.js',
  '/js/user-state.js',
  '/js/island-loader.js',
  '/js/island-annotate.js',
  '/js/island-decorations.js',
  '/js/analysis.js',
  '/js/tasks.js',
  '/js/main-new.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[SW] 缓存失败，跳过:', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // GLB、API请求不走缓存
  if (url.includes('.glb') || url.includes('/generate') || url.includes('/status')) {
    return;
  }

  // CDN资源：网络优先，失败走缓存
  if (url.includes('cdn.jsdelivr') || url.includes('cdnjs.cloudflare')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // 本地静态资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => new Response('', { status: 503 })))
  );
});
