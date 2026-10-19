/* Данные: pois.json, packs.json, пакеты регионов (Cache Storage). */
(function () {
  'use strict';
  const KG = window.KG;

  const CATS = {
    history: 'История', architecture: 'Архитектура', nature: 'Природа', religion: 'Религия',
    museum: 'Музей', archaeology: 'Археология', culture: 'Культура', soviet: 'Советское наследие',
    monument: 'Памятник', pass: 'Перевал', city: 'Город', food: 'Еда'
  };
  const REGION_FALLBACK = { bishkek: 'Бишкек и север', issykkul: 'Иссык-Куль', naryn: 'Нарын и центр', south: 'Юг страны' };

  const D = (KG.data = { pois: [], byId: {}, version: '', packs: null, packsVersion: '', error: null, loaded: false, wikiTitles: new Set() });

  D.catLabel = function (c) { return CATS[c] || c; };
  D.categories = function () { return Object.keys(CATS); };
  D.regionTitle = function (r) {
    const p = D.packs && D.packs.regions && D.packs.regions[r];
    return (p && p.title) || REGION_FALLBACK[r] || r;
  };
  D.regionIds = function () {
    const order = ['bishkek', 'issykkul', 'naryn', 'south'];
    const set = new Set(D.pois.map(function (p) { return p.region; }));
    const out = order.filter(function (r) { return set.has(r); });
    set.forEach(function (r) { if (out.indexOf(r) < 0) out.push(r); });
    return out;
  };
  D.name = function (p) { return (p.name && p.name.ru) || p.id; };
  D.hasHistoric = function (p) { return (p.photos || []).some(function (x) { return x.kind === 'historic'; }); };
  D.hasNow = function (p) { return (p.photos || []).some(function (x) { return x.kind !== 'historic'; }); };
  D.coverPhoto = function (p) {
    const ph = p.photos || [];
    return ph.find(function (x) { return x.kind !== 'historic'; }) || ph[0] || null;
  };

  function ingest(doc) {
    const list = Array.isArray(doc) ? doc : (doc && doc.pois) || [];
    D.pois = list.filter(function (p) { return p && p.id && isFinite(p.lat) && isFinite(p.lon); });
    D.byId = {};
    D.wikiTitles = new Set();
    D.pois.forEach(function (p) {
      D.byId[p.id] = p;
      if (p.wiki && p.wiki.ru) D.wikiTitles.add(KG.norm(p.wiki.ru.replace(/_/g, ' ')));
    });
    D.version = (doc && doc.version) || '';
  }

  D.load = async function () {
    try {
      const doc = await KG.fetchJson('data/pois.json', 15000);
      ingest(doc);
      D.error = null;
    } catch (e) {
      D.error = e;
      KG.log('error', 'pois.json: ' + e.message);
    }
    try {
      D.packs = await KG.fetchJson('data/packs.json', 15000);
      D.packsVersion = D.packs.version || '';
    } catch (e) {
      D.packs = null;
      KG.log('warn', 'packs.json: ' + e.message);
    }
    D.loaded = true;
    KG.emit('data');
    return !D.error;
  };

  /* Принудительная проверка свежих данных с сервера (мимо кэша SW). */
  D.refresh = async function () {
    const q = '?chk=' + Date.now();
    const doc = await KG.fetchJson('data/pois.json' + q, 15000, { cache: 'no-store' });
    let packs = null;
    try { packs = await KG.fetchJson('data/packs.json' + q, 15000, { cache: 'no-store' }); } catch (e) { /* ignore */ }
    const changed = (doc.version || '') !== D.version || (packs && packs.version) !== D.packsVersion;
    const before = D.pois.length;
    if (changed) {
      ingest(doc);
      D.packs = packs || D.packs;
      D.packsVersion = (D.packs && D.packs.version) || '';
      KG.emit('data');
    }
    return { changed: changed, before: before, after: D.pois.length };
  };

  /* ---------- пакеты регионов ---------- */
  const PK = (KG.packs = {});
  const cname = function (r) { return 'kg-pack-' + r; };
  const pathOf = function (rel) { return new URL(rel, document.baseURI).pathname; };
  const have = function () { return 'caches' in window; };

  PK.info = function (region) { return D.packs && D.packs.regions && D.packs.regions[region]; };
  PK.regions = function () { return D.packs && D.packs.regions ? Object.keys(D.packs.regions) : []; };

  PK.cachedPaths = async function (region) {
    if (!have() || !(await caches.has(cname(region)))) return new Set();
    const c = await caches.open(cname(region));
    const keys = await c.keys();
    return new Set(keys.map(function (k) { return new URL(k.url).pathname; }));
  };

  PK.status = async function (region) {
    const info = PK.info(region);
    if (!info) return { state: 'none', have: 0, total: 0 };
    const set = await PK.cachedPaths(region);
    const stored = KG.store.get('pack.' + region, null);
    let n = 0, bytes = 0, stale = 0;
    info.files.forEach(function (f) {
      if (set.has(pathOf(f.path))) {
        n++; bytes += f.size;
        if (stored && stored.files && stored.files[f.path] !== f.h) stale++;
      }
    });
    const total = info.files.length;
    let state = 'none';
    if (n > 0) state = n < total ? 'partial' : (stale > 0 ? 'outdated' : 'full');
    if (total === 0) state = 'full';
    return { state: state, have: n, total: total, bytes: bytes, version: stored && stored.version };
  };

  PK.download = async function (region, onProgress, ctl) {
    const info = PK.info(region);
    if (!info) throw new Error('Нет сведений о пакете');
    if (!have()) throw new Error('Браузер не поддерживает офлайн-хранилище');
    const cache = await caches.open(cname(region));
    const stored = KG.store.get('pack.' + region, { files: {} });
    const have0 = await PK.cachedPaths(region);
    const queue = info.files.filter(function (f) { return !(have0.has(pathOf(f.path)) && stored.files && stored.files[f.path] === f.h); });
    const total = info.files.reduce(function (s, f) { return s + f.size; }, 0);
    let done = total - queue.reduce(function (s, f) { return s + f.size; }, 0);
    let failed = 0, idx = 0;
    const okFiles = Object.assign({}, stored.files);
    ctl = ctl || {};
    onProgress && onProgress(done / (total || 1), failed);

    async function worker() {
      while (idx < queue.length && !ctl.cancel) {
        const f = queue[idx++];
        let ok = false;
        for (let attempt = 0; attempt < 3 && !ok && !ctl.cancel; attempt++) {
          try {
            const r = await fetch(f.path + '?dl=' + f.h, { cache: 'no-store' });
            if (!r.ok || r.status !== 200) throw new Error('HTTP ' + r.status);
            await cache.put(new Request(new URL(f.path, document.baseURI).href), r);
            ok = true;
          } catch (e) {
            await new Promise(function (res) { setTimeout(res, 700 * (attempt + 1)); });
          }
        }
        if (ok) okFiles[f.path] = f.h; else { failed++; KG.log('warn', 'не скачан ' + f.path); }
        done += f.size;
        onProgress && onProgress(Math.min(1, done / (total || 1)), failed);
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    const want = new Set(info.files.map(function (f) { return pathOf(f.path); }));
    const keys = await cache.keys();
    for (const k of keys) { if (!want.has(new URL(k.url).pathname)) await cache.delete(k); }
    KG.store.set('pack.' + region, { version: failed ? 'partial' : info.version, files: okFiles, date: Date.now(), bytes: total });
    if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch (e) { /* ignore */ } }
    KG.emit('packs', region);
    return { failed: failed, cancelled: !!ctl.cancel };
  };

  PK.remove = async function (region) {
    if (have()) await caches.delete(cname(region));
    KG.store.del('pack.' + region);
    KG.emit('packs', region);
  };
})();
