// ==========================================================================
// Streamvance Service Worker: Background Longevity & Audio Cache Engine
// PWA 지원 및 모바일 브라우저 백그라운드 프로세스 우선순위 보장
// ==========================================================================

const CACHE_NAME = 'streamvance-cache-v6';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/style.css',
  '/js/data.js',
  '/js/audioPlayer.js',
  '/js/ui.js',
  '/js/app.js',
  '/js/searchService.js',
  '/js/auth.js',
  '/js/lyricsService.js',
  '/js/colorExtractor.js',
  '/js/pipManager.js',
  '/js/takeoutService.js',
  '/js/offlineStorage.js',
  '/public/favicon.svg',
  '/public/icons.svg'
];

// 1. 서비스 워커 설치: 정적 에셋 프리캐싱
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[ServiceWorker] Pre-cache partial fail:', err);
      });
    })
  );
});

// 2. 서비스 워커 활성화: 이전 버전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. 네트워크 요청 핸들러: API/오디오 스트림은 바이패스, 정적 자원은 캐시 우선
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 실시간 스트리밍, 오디오 프록시, 검색 등 API 요청은 캐시하지 않고 직접 네트워크로 전송
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 캐시 히트 시에도 백그라운드에서 최신 버전 갱신 (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {});
        return cachedResponse;
      }
      return fetch(event.request);
    }).catch(() => {
      // 오프라인 상태일 때 기본 페이지 폴백
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});
