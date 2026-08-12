/**
 * 司马八字 · Service Worker sw.js
 * 策略：网络优先（Network First）
 * 网络失败时才回退到缓存，确保每次部署后用户拿到最新代码
 */

const CACHE_NAME = 'smb-v6';

// 只缓存这些不常变的 CDN 资源作为离线兜底
const CDN_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', e => {
  // 立即激活，不等旧 SW 退出
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  // 清除所有旧版缓存
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // GLB、API 请求：完全不经过 SW
  if (url.includes('.glb') || url.includes('/generate') || url.includes('/status') || url.includes('/auth/')) {
    return;
  }

  const isCDN = CDN_HOSTS.some(h => url.includes(h));

  if (isCDN) {
    // CDN 资源：网络优先，失败走缓存（Three.js 等大库）
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // 本地资源（JS/HTML/CSS）：网络优先，失败走缓存
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
