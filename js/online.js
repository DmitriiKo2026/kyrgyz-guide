/* Онлайн-расширение: места из Википедии рядом, фото Commons, кэш в IndexedDB. */
(function () {
  'use strict';
  const KG = window.KG;
  const WIKI = 'https://ru.wikipedia.org/w/api.php';
  const COMMONS = 'https://commons.wikimedia.org/w/api.php';
  const MAX_CACHE = 200;

  const O = (KG.online = {
    finds: [],            // с расстояниями от текущей позиции (без дублей локальных мест)
    status: 'idle',       // idle | loading | ok | offline | error | off
    lastQuery: null, busy: false, memory: {}
  });

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) return reject(new Error('нет IndexedDB'));
      const rq = indexedDB.open('kg-online', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('finds', { keyPath: 'id' }); };
      rq.onsuccess = function () { resolve(rq.result); };
      rq.onerror = function () { reject(rq.error); };
    });
    dbp.catch(function () { dbp = null; });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        const t = d.transaction('finds', mode), s = t.objectStore('finds');
        const r = fn(s);
        t.oncomplete = function () { resolve(r && r.result !== undefined ? r.result : undefined); };
        t.onerror = t.onabort = function () { reject(t.error); };
      });
    });
  }
  const idbAll = function () { return tx('readonly', function (s) { return s.getAll(); }).catch(function () { return []; }); };
  const idbPut = function (rec) { return tx('readwrite', function (s) { return s.put(rec); }).catch(function (e) { KG.log('warn', 'idb put: ' + (e && e.message)); }); };
  const idbGet = function (id) { return tx('readonly', function (s) { return s.get(id); }).catch(function () { return null; }); };
  const idbDel = function (id) { return tx('readwrite', function (s) { return s.delete(id); }).catch(function () { /* ignore */ }); };

  async function prune() {
    const all = await idbAll();
    const loose = all.filter(function (r) { return !r.saved; }).sort(function (a, b) { return a.ts - b.ts; });
    for (let i = 0; i < loose.length - MAX_CACHE; i++) await idbDel(loose[i].id);
  }

  /* ---------- вспомогательное ---------- */
  function isDuplicate(rec) {
    if (KG.data.wikiTitles.has(KG.norm(rec.title))) return true;
    return KG.data.pois.some(function (p) { return Math.abs(p.lat - rec.lat) < 0.003 && Math.abs(p.lon - rec.lon) < 0.004 && KG.geo.dist(p, rec) < 150; });
  }
  function stripHtml(s) { const d = document.createElement('div'); d.innerHTML = s || ''; return (d.textContent || '').trim(); }
  O.articleUrl = function (rec) { return 'https://ru.wikipedia.org/?curid=' + rec.pageid; };

  O.compute = function (fix) {
    const heading = KG.gps.heading();
    O.finds = Object.keys(O.memory).map(function (k) { return O.memory[k]; })
      .filter(function (r) { return !isDuplicate(r); })
      .map(function (r) {
        const dist = KG.geo.dist(fix, r), brg = KG.geo.bearing(fix, r);
        return { rec: r, id: r.id, pageid: r.pageid, title: r.title, extract: r.extract, thumb: r.thumb, lat: r.lat, lon: r.lon,
          dist: dist, brg: brg, rel: heading != null ? KG.geo.diff(brg, heading) : brg, saved: !!r.saved, cached: !!r.fromCache };
      })
      .filter(function (it) { return it.dist <= 12000; })
      .sort(function (a, b) { return a.dist - b.dist; })
      .slice(0, 15);
    KG.emit('finds', O.finds);
  };

  /* ---------- запросы ---------- */
  async function query(fix) {
    if (O.busy) return;
    O.busy = true; O.status = 'loading'; KG.emit('finds-status');
    try {
      const radius = KG.settings.mode === 'road' ? 10000 : 5000;
      const gs = await KG.fetchJson(WIKI + '?action=query&list=geosearch&gscoord=' + fix.lat.toFixed(5) + '%7C' + fix.lon.toFixed(5) +
        '&gsradius=' + radius + '&gslimit=20&format=json&origin=*', 8000);
      const hits = (gs.query && gs.query.geosearch) || [];
      O.lastQuery = { lat: fix.lat, lon: fix.lon, ts: Date.now() };
      const need = hits.filter(function (h) { const m = O.memory['w' + h.pageid]; return !m || !m.extract || Date.now() - m.ts > 7 * 864e5 || m.fromCache; });
      const details = {};
      if (need.length) {
        const ids = need.map(function (h) { return h.pageid; }).join('%7C');
        const d = await KG.fetchJson(WIKI + '?action=query&prop=extracts%7Cpageimages%7Ccoordinates&pageids=' + ids +
          '&exintro=1&explaintext=1&exsentences=6&exlimit=20&piprop=thumbnail&pithumbsize=800&pilimit=20&format=json&origin=*', 8000);
        const pages = (d.query && d.query.pages) || {};
        Object.keys(pages).forEach(function (k) { details[pages[k].pageid] = pages[k]; });
      }
      for (const h of hits) {
        const old = O.memory['w' + h.pageid] || {};
        const dt = details[h.pageid];
        const rec = {
          id: 'w' + h.pageid, pageid: h.pageid, title: h.title, lat: h.lat, lon: h.lon,
          extract: (dt && dt.extract) || old.extract || '', thumb: (dt && dt.thumbnail && dt.thumbnail.source) || old.thumb || '',
          ts: Date.now(), saved: !!old.saved, fromCache: false
        };
        if (old.saved) rec.thumbBlob = old.thumbBlob;
        O.memory[rec.id] = rec;
        idbPut(Object.assign({}, rec));
      }
      O.status = 'ok';
      prune();
    } catch (e) {
      O.status = navigator.onLine ? 'error' : 'offline';
      O.backoffUntil = Date.now() + 45000;
      KG.log('warn', 'wiki: ' + (e && e.message));
    } finally {
      O.busy = false;
      KG.emit('finds-status');
      if (KG.gps.last) O.compute(KG.gps.last);
    }
  }

  O.maybeQuery = function (fix) {
    if (!KG.settings.online) { O.status = 'off'; return; }
    if (!navigator.onLine) { O.status = 'offline'; KG.emit('finds-status'); return; }
    const q = O.lastQuery, now = Date.now();
    if (now < (O.backoffUntil || 0)) return;
    if (q) {
      const moved = KG.geo.dist(q, fix), age = now - q.ts;
      if (!(age >= 60000 || (moved > 300 && age >= 10000))) return;
    }
    query(fix);
  };

  O.refreshNow = function () { O.lastQuery = null; O.backoffUntil = 0; if (KG.gps.last) O.maybeQuery(KG.gps.last); };

  async function loadCache() {
    const all = await idbAll();
    all.forEach(function (r) { if (!O.memory[r.id]) { r.fromCache = true; O.memory[r.id] = r; } });
    if (KG.gps.last) O.compute(KG.gps.last);
  }

  KG.on('fix', function (fix) { O.compute(fix); O.maybeQuery(fix); });
  KG.on('settings', function (k) { if (k === 'online') { O.lastQuery = null; if (!KG.settings.online) O.status = 'off'; if (KG.gps.last) O.maybeQuery(KG.gps.last); KG.emit('finds-status'); } });
  window.addEventListener('online', function () { O.lastQuery = null; O.backoffUntil = 0; if (KG.gps.last) O.maybeQuery(KG.gps.last); KG.emit('finds-status'); });
  window.addEventListener('offline', function () { O.status = 'offline'; KG.emit('finds-status'); });
  O.init = function () { loadCache(); };

  /* ---------- «услышано» для автоозвучки ---------- */
  const heard = KG.store.get('heardOnline', {});
  O.markDone = function (it) { heard[it.id] = Date.now(); KG.store.set('heardOnline', heard); KG.emit('history', it.id); };
  O.isDone = function (id) { return !!heard[id]; };
  O.nextAutoCandidate = function (fix) {
    const lim = 200 * KG.settings.mult;
    return O.finds.find(function (it) { return it.dist <= lim && !heard[it.id] && it.extract && it.extract.length > 60; }) || null;
  };

  /* ---------- карточка ---------- */
  O.get = async function (pageid) {
    const id = 'w' + pageid;
    if (O.memory[id]) return O.memory[id];
    const r = await idbGet(id);
    if (r) { r.fromCache = true; O.memory[id] = r; }
    return r || null;
  };

  O.save = async function (rec) {
    rec.saved = true;
    if (rec.thumb && !rec.thumbBlob && navigator.onLine) {
      try {
        const r = await fetch(rec.thumb, { mode: 'cors' });
        if (r.ok) rec.thumbBlob = await r.blob();
      } catch (e) { KG.log('warn', 'thumb save: ' + e.message); }
    }
    O.memory[rec.id] = rec;
    await idbPut(Object.assign({}, rec));
    KG.emit('finds-status');
  };
  O.unsave = async function (rec) {
    rec.saved = false; delete rec.thumbBlob;
    await idbPut(Object.assign({}, rec));
    KG.emit('finds-status');
  };
  O.savedList = async function () { return (await idbAll()).filter(function (r) { return r.saved; }); };

  /* Фото рядом с местом: Commons geosearch (до 300 м) + автор и лицензия из extmetadata. */
  O.commonsPhotos = async function (rec) {
    const g = await KG.fetchJson(COMMONS + '?action=query&list=geosearch&gscoord=' + rec.lat.toFixed(5) + '%7C' + rec.lon.toFixed(5) +
      '&gsradius=300&gsnamespace=6&gslimit=8&format=json&origin=*', 8000);
    const titles = ((g.query && g.query.geosearch) || []).map(function (x) { return x.title; });
    if (!titles.length) return [];
    const d = await KG.fetchJson(COMMONS + '?action=query&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=800&format=json&origin=*&titles=' +
      encodeURIComponent(titles.join('|')), 8000);
    const out = [];
    const pages = (d.query && d.query.pages) || {};
    Object.keys(pages).forEach(function (k) {
      const ii = pages[k].imageinfo && pages[k].imageinfo[0];
      if (!ii || !ii.thumburl || !/^image\/(jpeg|png)/.test(ii.mime || '')) return;
      const em = ii.extmetadata || {};
      const lic = (em.LicenseShortName && em.LicenseShortName.value) || '';
      if (!/^(CC0|Public domain|PD|CC BY(-SA)?\b)/i.test(lic)) return;
      out.push({ url: ii.thumburl, title: stripHtml(em.ObjectName && em.ObjectName.value) || pages[k].title.replace(/^Файл:|^File:/, ''),
        author: stripHtml(em.Artist && em.Artist.value) || 'автор не указан', license: lic, source_url: ii.descriptionurl });
    });
    return out.slice(0, 6);
  };
})();
