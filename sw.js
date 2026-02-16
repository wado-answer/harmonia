// Harmonia Service Worker - PWA & オフライン対応
const CACHE_VERSION = 'harmonia-v1';
const CACHE_ASSETS = [
    './',
    './index.html',
    './app.js',
    './styles.css',
    './manifest.json',
    './state-manager.js',
    './db-manager.js',
    './audio-engine.js',
    './ui-manager.js',
    './id3-reader.js'
];

// インストール時にキャッシュ
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker...');
    
    event.waitUntil(
        caches.open(CACHE_VERSION)
            .then((cache) => {
                console.log('[SW] Caching app shell');
                return cache.addAll(CACHE_ASSETS);
            })
            .catch((error) => {
                console.error('[SW] Cache failed:', error);
            })
    );
    
    self.skipWaiting();
});

// アクティベーション時に古いキャッシュを削除
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_VERSION) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    
    self.clients.claim();
});

// フェッチ時のキャッシュ戦略
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);
    
    // オーディオファイル（Blob URL）は処理しない
    if (url.protocol === 'blob:') {
        return;
    }
    
    // API リクエストは処理しない
    if (url.pathname.startsWith('/api/')) {
        return;
    }
    
    // キャッシュ戦略: Cache First, Network Fallback
    event.respondWith(
        caches.match(request)
            .then((cachedResponse) => {
                if (cachedResponse) {
                    // キャッシュがあればそれを返す
                    return cachedResponse;
                }
                
                // キャッシュになければネットワークから取得
                return fetch(request)
                    .then((networkResponse) => {
                        // 成功したレスポンスをキャッシュ
                        if (networkResponse && networkResponse.status === 200) {
                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_VERSION)
                                .then((cache) => {
                                    cache.put(request, responseToCache);
                                });
                        }
                        return networkResponse;
                    })
                    .catch((error) => {
                        console.error('[SW] Fetch failed:', error);
                        
                        // オフライン時のフォールバック
                        if (request.destination === 'document') {
                            return caches.match('./index.html');
                        }
                    });
            })
    );
});

// メッセージハンドラー（キャッシュクリアなど）
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.delete(CACHE_VERSION).then(() => {
            console.log('[SW] Cache cleared');
        });
    }
});
