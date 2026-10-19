/* Логика гида: расстояния, кандидаты на объявление, история, Wake Lock. */
(function () {
  'use strict';
  const KG = window.KG;
  const G = (KG.guide = { list: [], cands: [], pos: null, suppressUntil: 0, wake: null, lastAreaAt: 0 });

  /* «Площадные» места (озёра, долины, хребты: радиус от 5 км) в зоне действия лежат часами пути. Чтобы они не заглушали
     обычные места, их рассказ ставится в очередь после всех остальных кандидатов и не чаще одного раза в AREA_GAP. */
  const AREA_RADIUS = 5000, AREA_GAP = 6 * 60 * 1000;
  G.isArea = function (p) { return p.radius_m >= AREA_RADIUS; };

  let hist = KG.store.get('history', {});
  const simHist = {};
  const store = function () { return KG.gps.sim ? simHist : hist; };

  G.isDone = function (id) { return !!store()[id]; };
  G.markDone = function (id) {
    store()[id] = Date.now();
    if (!KG.gps.sim) KG.store.set('history', hist);
    KG.emit('history', id);
  };
  G.unmark = function (id) {
    delete store()[id];
    if (!KG.gps.sim) KG.store.set('history', hist);
    KG.emit('history', id);
  };
  G.doneCount = function () { return Object.keys(hist).length; };
  G.resetHistory = function () {
    hist = {};
    Object.keys(simHist).forEach(function (k) { delete simHist[k]; });
    KG.store.set('history', hist);
    KG.emit('history');
  };

  G.trackFor = function (p, intro) {
    const cover = KG.data.coverPhoto(p);
    return {
      key: p.id, poiId: p.id, title: KG.data.name(p), subtitle: KG.data.regionTitle(p.region),
      cover: cover ? KG.abs(cover.file) : null,
      audio: p.audio || null, text: KG.data.name(p) + '. ' + p.story, intro: intro || null
    };
  };
  G.trackForOnline = function (it) {
    return { key: 'w' + it.pageid, onlineId: it.pageid, title: it.title, subtitle: 'Википедия', cover: it.thumb || null,
      audio: null, text: it.title + '. ' + (it.extract || ''), intro: null };
  };

  G.markIfPoi = function (track) { if (track && track.poiId) G.markDone(track.poiId); };

  G.compute = function (fix) {
    G.pos = fix;
    const heading = KG.gps.heading();
    G.list = KG.data.pois.map(function (p) {
      const dist = KG.geo.dist(fix, p), brg = KG.geo.bearing(fix, p);
      return {
        poi: p, dist: dist, brg: brg,
        rel: heading !== null && heading !== undefined ? KG.geo.diff(brg, heading) : brg,
        relCourse: fix.course !== null && fix.course !== undefined ? KG.geo.diff(brg, fix.course) : null
      };
    }).sort(function (a, b) { return a.dist - b.dist; });
    G.cands = candidates(fix);
    KG.emit('nearby', G.list);
  };

  function candidates(fix) {
    const mult = KG.settings.mult, road = KG.settings.mode === 'road';
    const out = [];
    G.list.forEach(function (it) {
      const p = it.poi;
      if (G.isDone(p.id)) return;
      if (it.dist <= p.radius_m * mult) { out.push(Object.assign({ reason: 'here' }, it)); return; }
      if (road && p.road_m > 0 && it.dist <= p.road_m * mult && fix.moving && it.relCourse !== null && Math.abs(it.relCourse) <= 60) {
        out.push(Object.assign({ reason: 'ahead' }, it));
      }
    });
    out.sort(function (a, b) { return (G.isArea(a.poi) - G.isArea(b.poi)) || (a.poi.priority - b.poi.priority) || (a.dist - b.dist); });
    return out;
  }

  /* Первый кандидат, которого сейчас можно объявить (площадные места — не чаще раза в AREA_GAP). */
  function pickCandidate() {
    const areaBusy = Date.now() - G.lastAreaAt < AREA_GAP;
    return G.cands.find(function (c) { return !(areaBusy && G.isArea(c.poi)); }) || null;
  }

  function sideWord(rel) { return Math.abs(rel) <= 20 ? 'Впереди' : rel > 0 ? 'Справа' : 'Слева'; }

  G.announce = function (item) {
    const p = item.poi;
    let intro = null;
    if (item.reason === 'ahead') intro = sideWord(item.relCourse) + ' через ' + KG.distWords(item.dist) + ' — ' + KG.data.name(p) + '.';
    G.markDone(p.id);
    if (G.isArea(p)) G.lastAreaAt = Date.now();
    KG.player.play(G.trackFor(p, intro));
    KG.toast((item.reason === 'ahead' ? sideWord(item.relCourse) + ' через ' + KG.fmtDist(item.dist) + ': ' : 'Рядом: ') + KG.data.name(p), 4500);
    KG.emit('announce', item);
  };

  function autoEval() {
    if (!KG.settings.auto || !KG.player.unlocked || !G.pos) return;
    if (KG.player.state !== 'idle' || Date.now() < G.suppressUntil) return;
    const next = pickCandidate();
    if (next) { G.announce(next); return; }
    if (G.cands.length) return;
    if (KG.settings.autoOnline && KG.online) {
      const it = KG.online.nextAutoCandidate(G.pos);
      if (it) {
        KG.online.markDone(it);
        KG.player.play(G.trackForOnline(it));
        KG.toast('Найдено в Википедии: ' + it.title, 4500);
        KG.emit('announce', { online: it });
      }
    }
  }

  G.playNearest = function () {
    if (!G.pos || !G.list.length) { KG.toast('Положение пока не определено. Откройте «Каталог» и выберите место.', 4500); return false; }
    const it = G.list[0];
    G.markDone(it.poi.id);
    KG.player.play(G.trackFor(it.poi, null));
    return true;
  };

  KG.on('fix', function (fix) {
    if (!KG.data.loaded) return;
    G.compute(fix);
    autoEval();
  });
  KG.on('data', function () { if (G.pos) G.compute(G.pos); });
  KG.on('player-end', function () { setTimeout(autoEval, 1500); });
  KG.on('player-stop', function () { G.suppressUntil = Date.now() + 30000; });
  KG.on('settings', function (k) { if (G.pos && (k === 'mult' || k === 'mode')) { G.compute(G.pos); } });
  KG.on('unlocked', autoEval);

  /* ---------- экран не гаснет в режиме «В дороге» ---------- */
  let waking = false;
  async function updateWake() {
    const st = KG.gps.state;
    const want = KG.settings.mode === 'road' && (st === 'ok' || st === 'sim') && !document.hidden;
    if (want && !G.wake && !waking && navigator.wakeLock) {
      waking = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        G.wake = lock;
        lock.addEventListener('release', function () { if (G.wake === lock) G.wake = null; KG.emit('wake'); });
        KG.emit('wake');
        setTimeout(updateWake, 0);
      } catch (e) { KG.log('warn', 'wakeLock: ' + (e && e.name)); }
      waking = false;
    } else if (!want && G.wake) {
      try { G.wake.release(); } catch (e) { /* ignore */ }
      G.wake = null;
      KG.emit('wake');
    }
  }
  KG.on('gps-state', updateWake);
  KG.on('settings', function (k) { if (k === 'mode') updateWake(); });
  document.addEventListener('visibilitychange', updateWake);
  G.wakeSupported = function () { return !!navigator.wakeLock; };
})();
