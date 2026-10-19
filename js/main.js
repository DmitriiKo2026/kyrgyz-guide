/* Запуск: service worker, маршруты, вкладки, индикаторы, отладочная панель. */
(function () {
  'use strict';
  const KG = window.KG, el = KG.el, U = KG.ui;
  const TABS = ['nearby', 'map', 'catalog', 'more'];
  let curTab = 'nearby', applying = false;
  KG.swState = { reg: null, waiting: false, version: '' };

  /* ---------- service worker ---------- */
  function markWaiting() {
    KG.swState.waiting = true;
    const bar = KG.$('#updbar');
    if (bar) { bar.hidden = false; }
    KG.emit('sw');
  }
  KG.applyUpdate = function () {
    const reg = KG.swState.reg;
    applying = true;
    if (reg && reg.waiting) reg.waiting.postMessage({ type: 'skipWaiting' }); else location.reload();
  };
  function registerSW() {
    if (!('serviceWorker' in navigator)) { KG.log('warn', 'service worker не поддерживается'); return; }
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (applying) location.reload(); });
    navigator.serviceWorker.addEventListener('message', function (e) { if (e.data && e.data.type === 'version') KG.swState.version = e.data.version; });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
      KG.swState.reg = reg;
      if (reg.waiting && navigator.serviceWorker.controller) markWaiting();
      reg.addEventListener('updatefound', function () {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) markWaiting(); });
      });
      navigator.serviceWorker.ready.then(function (r) { if (r.active) r.active.postMessage({ type: 'getVersion' }); });
      KG.log('info', 'service worker зарегистрирован');
    }).catch(function (e) { KG.log('warn', 'service worker: ' + e.message); });
  }

  KG.checkUpdate = async function (info) {
    if (!navigator.onLine) throw new Error('нет сети');
    const msg = [];
    const reg = KG.swState.reg;
    if (reg) {
      try {
        await reg.update();
        const nw = reg.installing;
        if (nw) await new Promise(function (res) {
          const t = setTimeout(res, 25000);
          nw.addEventListener('statechange', function () { if (nw.state === 'installed' || nw.state === 'redundant') { clearTimeout(t); res(); } });
        });
      } catch (e) { KG.log('warn', 'reg.update: ' + e.message); }
    }
    const r = await KG.data.refresh();
    msg.push(r.changed ? 'Данные обновлены (мест: ' + r.after + ')' : 'Данные актуальны (мест: ' + r.after + ')');
    if (KG.swState.waiting || (reg && reg.waiting)) { markWaiting(); msg.push('Есть новая версия приложения — нажмите «Обновить сейчас»'); } else msg.push('Версия приложения актуальна');
    if (info) info.textContent = msg.join('. ') + '.';
    return msg;
  };

  /* ---------- вкладки и маршруты ---------- */
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = 'nearby';
    TABS.forEach(function (t) {
      const sec = KG.$('#v-' + t), on = t === name;
      sec.classList.toggle('active', on);
      const v = KG.views[t === 'map' ? 'map' : t];
      if (v && !on && t === curTab) { v.hide && v.hide(); }
    });
    curTab = name;
    KG.$$('#tabbar .tab').forEach(function (b) {
      const on = b.dataset.tab === name;
      b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    });
    const v = name === 'map' ? KG.mapView : KG.views[name];
    if (v && v.show) v.show();
    document.body.dataset.tab = name;
  }

  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/');
    const name = parts[0] || 'nearby';
    let arg = '';
    try { arg = decodeURIComponent(parts.slice(1).join('/')); } catch (e) { arg = parts.slice(1).join('/'); }
    if (name === 'poi') KG.card.poi(arg);
    else if (name === 'online') KG.card.online(arg);
    else if (name === 'sim') KG.views.more.sim();
    else if (name === 'about') KG.views.more.about();
    else { U.closeSheet(true); showTab(name); }
  }

  /* ---------- индикаторы ---------- */
  function paintConn() {
    const on = navigator.onLine;
    const c = KG.$('#conn');
    c.className = 'conn ' + (on ? 'on' : 'off');
    KG.$('.conn-t', c).textContent = on ? 'Онлайн' : 'Офлайн';
  }
  function paintGps() {
    const s = KG.gps.state, c = KG.$('#gpschip');
    c.className = 'gpschip ' + (s === 'ok' || s === 'sim' ? 'ok' : s === 'wait' ? 'wait' : 'off');
    KG.$('.conn-t', c).textContent = s === 'sim' ? 'Симуляция' : s === 'ok' ? 'GPS' : s === 'wait' ? 'GPS…' : 'GPS выкл';
  }

  /* ---------- отладка ---------- */
  function debugPanel() {
    const panel = KG.$('#dbg');
    panel.hidden = false;
    const head = el('div', { class: 'dbg-h' });
    const log = el('pre', { class: 'dbg-log' });
    const toggle = el('button', { type: 'button', text: 'свернуть', onclick: function () { panel.classList.toggle('min'); toggle.textContent = panel.classList.contains('min') ? 'развернуть' : 'свернуть'; } });
    panel.appendChild(el('div', { class: 'dbg-bar' }, el('b', { text: 'debug' }), toggle));
    panel.appendChild(head); panel.appendChild(log);
    let t = 0;
    const paint = function () {
      t = 0;
      const f = KG.gps.last, P = KG.player;
      head.textContent = 'gps=' + KG.gps.state + (f ? ' ' + f.lat.toFixed(5) + ',' + f.lon.toFixed(5) + ' v=' + (f.speed * 3.6).toFixed(0) + ' c=' + (f.course != null ? f.course.toFixed(0) : '-') : '') +
        ' | player=' + P.state + '/' + (P.kind || '-') + ' | cands=' + KG.guide.cands.length + ' | online=' + navigator.onLine + ' sw=' + (navigator.serviceWorker && navigator.serviceWorker.controller ? 'on' : 'off') + ' wake=' + (KG.guide.wake ? 1 : 0);
      log.textContent = KG.logs.slice(-40).map(function (l) { return new Date(l.t).toTimeString().slice(0, 8) + ' ' + l.level[0] + ' ' + l.msg; }).join('\n');
    };
    const sched = function () { if (!t) t = setTimeout(paint, 400); };
    ['log', 'fix', 'player', 'gps-state'].forEach(function (e) { KG.on(e, sched); });
    paint();
  }

  /* ---------- запуск ---------- */
  async function boot() {
    KG.applyLook();
    registerSW();
    await KG.data.load();
    KG.$('#boot').remove();
    KG.$('#app').hidden = false;

    KG.views.nearby.init(KG.$('#v-nearby'));
    KG.mapView.init(KG.$('#v-map')); KG.views.map = KG.mapView;
    KG.views.catalog.init(KG.$('#v-catalog'));
    KG.views.more.init(KG.$('#v-more'));
    U.initNow();
    KG.online.init();

    KG.$$('#tabbar .tab').forEach(function (b) { b.addEventListener('click', function () { U.closeSheet(true); location.replace('#/' + b.dataset.tab); if (b.dataset.tab === curTab && !U.sheetOpen) showTab(curTab); }); });
    KG.$('#updbtn').addEventListener('click', function () { KG.applyUpdate(); });
    KG.$('#conn').addEventListener('click', function () { KG.toast(navigator.onLine ? 'Есть интернет: карта и находки Википедии доступны.' : 'Нет сети: работают тексты и скачанные пакеты. Карта и находки недоступны.', 4500); });
    window.addEventListener('online', paintConn); window.addEventListener('offline', paintConn);
    KG.on('gps-state', paintGps); paintConn(); paintGps();
    window.addEventListener('hashchange', function () { try { route(); } catch (e) { KG.log('error', 'route: ' + e.message); } });

    const mode = KG.params.get('mode');
    if (mode === 'walk' || mode === 'road') KG.settings.mode = mode;
    if (KG.params.get('theme')) KG.settings.theme = KG.params.get('theme');
    KG.applyLook();

    if (KG.settings.compass) KG.gps.compassStart().then(function (ok) { if (!ok) KG.settings.compass = false; });

    try { route(); } catch (e) { KG.log('error', 'route: ' + e.message); showTab('nearby'); }

    if (KG.data.error && !KG.data.pois.length) {
      KG.toast('Данные не загрузились. При первом запуске нужен интернет.', 7000);
    }

    const sim = KG.params.get('sim');
    if (sim) {
      const a = sim.split(',').map(parseFloat);
      if (a.length >= 2 && isFinite(a[0]) && isFinite(a[1])) {
        const sp = parseFloat(KG.params.get('speed')), hd = parseFloat(KG.params.get('heading'));
        KG.store.set('onboarded', true);
        KG.gps.simStart({ lat: a[0], lon: a[1], speedKmh: isFinite(sp) ? sp : 0, heading: isFinite(hd) ? hd : 0, warp: parseFloat(KG.params.get('warp')) || 1 });
      }
    } else if (KG.store.get('onboarded', false)) KG.gps.start();
    else KG.onboarding();

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && !KG.gps.sim && KG.store.get('onboarded', false)) {
        const f = KG.gps.last;
        if (!f || Date.now() - f.ts > 30000) KG.gps.restart();
      }
    });

    if (KG.debug) debugPanel();
    KG.log('info', 'готово: мест ' + KG.data.pois.length);
  }

  document.addEventListener('DOMContentLoaded', function () {
    boot().catch(function (e) {
      KG.log('error', 'boot: ' + (e && e.stack || e));
      let b = KG.$('#boot');
      if (!b) { b = el('div', { id: 'boot', class: 'boot' }); document.body.appendChild(b); }
      {
        KG.clear(b);
        b.appendChild(el('div', { class: 'boot-err' }, el('h1', { text: 'Не удалось запустить приложение' }), el('p', { text: String(e && e.message || e) }),
          el('button', { class: 'btn primary', type: 'button', text: 'Перезагрузить', onclick: function () { location.reload(); } }),
          el('button', { class: 'btn ghost', type: 'button', text: 'Сбросить кэш и перезагрузить', onclick: async function () {
            try { const ks = await caches.keys(); await Promise.all(ks.filter(function (k) { return k.indexOf('kg-core-') === 0; }).map(function (k) { return caches.delete(k); })); const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(function (r) { return r.unregister(); })); } catch (er) { /* ignore */ }
            location.reload();
          } })));
      }
    });
  });
})();
