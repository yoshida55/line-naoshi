// ホーム画面のアプリとして動かすための仕組み（スマホで開いたときだけ使う）
// しまってある画面をすぐ出し、裏で新しい版を取ってきて入れ替える（次に開いたときに新しくなる）

const CACHE = 'naoshi-v1';
const FILES = ['./', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Gemini や LINE など、よそへの通信はそのまま通す
  if (url.origin !== location.origin || e.request.method !== 'GET') return;

  // 画面を開くとき、共有された文が URL に付いてくる。サーバーへは送らず、URL の後ろを外して取る
  const key = e.request.mode === 'navigate' ? './' : url.pathname;

  const fresh = fetch(key).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((cache) => cache.put(key, copy));
    }
    return res;
  });

  e.respondWith(
    caches.match(key, { ignoreSearch: true }).then((cached) => cached || fresh)
  );
  e.waitUntil(fresh.catch(() => {}));
});
