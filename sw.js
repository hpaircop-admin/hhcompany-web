// ════════════════════════════════════════════════════════
// HHCOMPANY PWA 서비스워커 (최소 구성)
// - 설치(홈 화면 추가) 요건 충족을 위한 최소한의 캐시만 둡니다.
// - Supabase API 호출(xoupacfmkhuuvxebgfqi.supabase.co)은 항상 최신 데이터가
//   필요하므로 캐시하지 않고 그대로 네트워크로 흘려보냅니다.
// - 페이지 이동(navigation)은 네트워크 우선, 오프라인일 때만 캐시된 쉘로 대체합니다.
// ════════════════════════════════════════════════════════

const CACHE_NAME = 'hhcompany-shell-v1';
const SHELL_FILES = [
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 다른 도메인(Supabase API 등)은 캐시 로직에 관여하지 않음
  if (url.origin !== self.location.origin) return;

  // 페이지 이동: 네트워크 우선, 실패 시 캐시된 쉘로 대체
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('products.html'))
    );
    return;
  }

  // 정적 자산: 캐시 우선, 없으면 네트워크 후 캐시에 저장
  if (SHELL_FILES.some((f) => req.url.endsWith(f))) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return res;
      }))
    );
  }
});
