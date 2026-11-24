// ホーム画面のアプリとして動かすための仕組み（スマホで開いたときだけ使う）
// いつもネットから新しい版を取る。つながらないときだけ、しまってある画面を出す
// ver.5 までは「しまってある画面をすぐ出し、裏で取り替える」形だった。新しい版が出るまで2回開く必要があり、
// さらに公開先が「10分は同じ物を使ってよい」（max-age=600）と返すため、送ってもスマホは前の版のままだった（2026-11-25）

const CACHE = 'naoshi-v2';
const FILES = ['./', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' … ブラウザがしまった古い物を使わず、サーバーから取り直す
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  // 前の版でしまった物（naoshi-v1）を消す
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

  e.respondWith(
    // cache: 'no-cache' … 毎回サーバーに「変わった？」と聞く（変わっていなければ短い返事で済む）
    fetch(key, { cache: 'no-cache' })
      .then((res) => {
        if (!res.ok) return res;
        // 「毎回確かめて」の札に付けかえて返す。公開先の札（10分は使い回してよい）のままだと、
        // 開き直してもブラウザが手元の古い app.js を使い回し、新しい版が出なかった（2026-11-25 PCで再現）
        const headers = new Headers(res.headers);
        headers.set('Cache-Control', 'no-cache');
        const fresh = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
        const copy = fresh.clone();
        caches.open(CACHE).then((cache) => cache.put(key, copy));
        return fresh;
      })
      // 電波が無いときだけ、しまってある物を出す
      .catch(() => caches.match(key, { ignoreSearch: true }).then((cached) => cached || Response.error()))
  );
});
