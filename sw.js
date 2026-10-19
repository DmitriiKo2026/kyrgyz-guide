/*
 * Service worker «Кыргызстан — аудиогид».
 *
 * Три слоя кэша:
 *  1. kg-core-<VERSION>   — ядро (HTML/CSS/JS/иконки/Leaflet) и данные (pois.json, packs.json, контур страны).
 *     Код отдаётся строго из кэша своей версии (все файлы гарантированно одной версии, запуск мгновенный офлайн);
 *     новая версия скачивается целиком при установке нового SW, затем в приложении появляется кнопка «Обновить».
 *     Данные (data/*.json) — «кэш сначала, затем обновление в фоне» (stale-while-revalidate).
 *  2. kg-pack-<region>    — фото (img/<region>/…) и аудио (audio/<id>.mp3). Пакет скачивается кнопкой в «Ещё»
 *     (страница сама кладёт файлы в кэш), плюс всё, что пользователь уже просмотрел/прослушал, кэшируется на лету.
 *     Эти кэши НЕ удаляются при обновлении версии.
 *  3. Сеть — остальное (в т.ч. тайлы карты OSM, Википедия): SW не вмешивается в кросс-доменные запросы.
 *
 * Аудио и Range: iOS Safari запрашивает mp3 кусками (Range: bytes=…) и требует ответ 206. Поэтому файл целиком берётся из кэша
 * (или один раз скачивается и кладётся в кэш), а ответ на Range-запрос собирается здесь вручную.
 *
 * !!! При каждой публикации изменённых файлов приложения увеличьте VERSION — иначе пользователи не получат обновление.
 *     Фото/аудио/данные при изменении VERSION менять не требуют (но если менялся код — требуют).
 */
var VERSION = 'v1.0.1';
var CORE = 'kg-core-' + VERSION;
var PACK_PREFIX = 'kg-pack-';

/* Без этих файлов приложение не работает: установка SW падает, если какой-то не скачался. */
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/core.js',
  'js/data.js',
  'js/gps.js',
  'js/player.js',
  'js/guide.js',
  'js/online.js',
  'js/ui.js',
  'js/map.js',
  'js/v-nearby.js',
  'js/v-catalog.js',
  'js/v-card.js',
  'js/v-more.js',
  'js/main.js',
  'js/vendor/leaflet/leaflet.js',
  'js/vendor/leaflet/leaflet.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-64.png'
];
/* Данные: если их ещё нет на сервере, установка не должна падать. */
var DATA_ASSETS = ['data/pois.json', 'data/packs.json', 'data/kg-outline.json'];

var SCOPE_PATH = new URL(self.registration.scope).pathname;
var inflight = {};

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CORE).then(function (cache) {
    var reload = function (u) { return new Request(u, { cache: 'reload' }); };
    return cache.addAll(ASSETS.map(reload)).then(function () {
      return Promise.all(DATA_ASSETS.map(function (u) {
        return fetch(reload(u)).then(function (r) { if (r.ok) return cache.put(u, r); }).catch(function () { /* данных может ещё не быть */ });
      }));
    });
  }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('kg-core-') === 0 && k !== CORE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var d = event.data || {};
  if (d.type === 'skipWaiting') self.skipWaiting();
  if (d.type === 'getVersion' && event.source) event.source.postMessage({ type: 'version', version: VERSION });
});

function relOf(url) {
  var p = url.pathname;
  return p.indexOf(SCOPE_PATH) === 0 ? decodeURIComponent(p.slice(SCOPE_PATH.length)) : decodeURIComponent(p);
}
function cleanUrl(url) { return url.origin + url.pathname; }
function mimeOf(rel) {
  if (/\.mp3$/i.test(rel)) return 'audio/mpeg';
  if (/\.jpe?g$/i.test(rel)) return 'image/jpeg';
  if (/\.png$/i.test(rel)) return 'image/png';
  if (/\.webp$/i.test(rel)) return 'image/webp';
  return 'application/octet-stream';
}
function regionOf(rel) {
  var m = /^img\/([^/]+)\//.exec(rel);
  if (m) return m[1];
  m = /^audio\/([^/.]+?)(?:-|\.)/.exec(rel);
  return m ? m[1] : 'misc';
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var rel = relOf(url);

  /* Запросы страницы, которым нужна свежая версия с сервера (скачивание пакета, «проверить обновление») */
  if (url.searchParams.has('dl')) { event.respondWith(fetch(cleanUrl(url), { cache: 'no-store' })); return; }
  if (url.searchParams.has('chk')) { event.respondWith(freshData(url, rel)); return; }

  if (req.mode === 'navigate') { event.respondWith(navigate(req)); return; }
  if (rel.indexOf('img/') === 0 || rel.indexOf('audio/') === 0) { event.respondWith(media(req, url, rel)); return; }
  if (rel === 'data/pois.json' || rel === 'data/packs.json') { event.respondWith(swr(event, req, url)); return; }
  event.respondWith(coreFirst(req, url));
});

function navigate(req) {
  return caches.open(CORE).then(function (cache) {
    return cache.match('index.html').then(function (r) {
      return r || fetch(req).catch(function () { return new Response('<meta charset="utf-8"><body style="font:18px sans-serif;padding:24px">Нет сети, а приложение ещё не сохранено. Откройте его один раз с интернетом.', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } }); });
    });
  });
}

function coreFirst(req, url) {
  return caches.open(CORE).then(function (cache) {
    return cache.match(cleanUrl(url)).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (r) {
        if (r.ok && r.status === 200) cache.put(cleanUrl(url), r.clone());
        return r;
      }).catch(function () { return new Response('', { status: 504, statusText: 'offline' }); });
    });
  });
}

function swr(event, req, url) {
  return caches.open(CORE).then(function (cache) {
    return cache.match(cleanUrl(url)).then(function (hit) {
      var net = fetch(new Request(cleanUrl(url), { cache: 'no-cache' })).then(function (r) {
        if (r.ok && r.status === 200) cache.put(cleanUrl(url), r.clone());
        return r;
      }).catch(function () { return null; });
      event.waitUntil(net);
      if (hit) return hit;
      return net.then(function (r) { return r || new Response('', { status: 504, statusText: 'offline' }); });
    });
  });
}

function freshData(url, rel) {
  return fetch(cleanUrl(url), { cache: 'no-store' }).then(function (r) {
    if (r.ok && r.status === 200 && DATA_ASSETS.indexOf(rel) >= 0) {
      var copy = r.clone();
      caches.open(CORE).then(function (c) { c.put(cleanUrl(url), copy); });
    }
    return r;
  });
}

/* ---------- фото и аудио ---------- */
function fetchFull(url, rel) {
  if (inflight[url]) return inflight[url];
  var p = fetch(url).then(function (r) {
    if (!r.ok || r.status !== 200) return null;
    return r.arrayBuffer().then(function (buf) {
      var type = r.headers.get('content-type') || mimeOf(rel);
      var copy = new Response(buf.slice(0), { status: 200, headers: { 'content-type': type, 'content-length': String(buf.byteLength) } });
      return caches.open(PACK_PREFIX + regionOf(rel)).then(function (c) { return c.put(url, copy); })
        .catch(function () { /* кэш переполнен — не страшно */ })
        .then(function () { return { buf: buf, type: type }; });
    });
  }).catch(function () { return null; }).then(function (res) { delete inflight[url]; return res; });
  inflight[url] = p;
  return p;
}

function rangeResponse(buf, type, range) {
  var size = buf.byteLength;
  var m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
  if (!m || (m[1] === '' && m[2] === '')) return new Response(buf, { status: 200, headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  var start, end;
  if (m[1] === '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
  }
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } });
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: 'Partial Content',
    headers: { 'content-type': type, 'content-range': 'bytes ' + start + '-' + end + '/' + size, 'content-length': String(end - start + 1), 'accept-ranges': 'bytes' }
  });
}

function media(req, url, rel) {
  var key = cleanUrl(url);
  var range = req.headers.get('range');
  return caches.match(key).then(function (hit) {
    if (hit) {
      if (!range) return hit;
      return hit.arrayBuffer().then(function (buf) { return rangeResponse(buf, hit.headers.get('content-type') || mimeOf(rel), range); });
    }
    return fetchFull(key, rel).then(function (res) {
      if (!res) return new Response('', { status: 504, statusText: 'offline' });
      if (range) return rangeResponse(res.buf, res.type, range);
      return new Response(res.buf, { status: 200, headers: { 'content-type': res.type, 'content-length': String(res.buf.byteLength), 'accept-ranges': 'bytes' } });
    });
  });
}
