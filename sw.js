/* ============================================
 * Service Worker - PWA 离线缓存
 * 采用 Cache-First 策略缓存静态资源
 * ============================================ */

const CACHE_NAME = 'repayment-bills-v3';
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './favicon.svg',
    './css/style.css',
    './js/app.js',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS).catch(() => {
                // 部分 CDN 资源可能失败，不影响主流程
                return Promise.resolve();
            });
        }).then(() => self.skipWaiting())
    );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// 拦截请求：缓存优先，网络回退
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // 只缓存 GET 请求
    if (req.method !== 'GET') return;

    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) return cached;

            // 网络请求，并尝试缓存
            return fetch(req).then((response) => {
                // 只缓存同源成功响应
                if (response && response.status === 200) {
                    const url = new URL(req.url);
                    if (url.origin === location.origin) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
                    }
                }
                return response;
            }).catch(() => {
                // 离线时，导航请求回退到首页
                if (req.mode === 'navigate') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
