/* Экран «Карта»: Leaflet + тайлы OSM (онлайн) и «радар» на canvas (офлайн). */
(function () {
  'use strict';
  const KG = window.KG;
  const V = (KG.mapView = { root: null, mode: null, forced: null });

  let outline = null, outlineTried = false;
  let L_ready = null, lmap = null, lmarkers = null, lme = null, lacc = null, lfollow = false;
  const el = KG.el;
  let host, leafEl, canvas, ctx, bar, hint, pop, segWrap;
  let view = { lat: 41.4, lon: 74.6, z: 40 };  // z — пикселей на градус широты
  let radarFollow = false, dragging = null, pointers = {}, pinch = null, raf = 0, hitList = [];

  const PRIO_COLOR = { 1: '#c8281e', 2: '#e08a1e', 3: '#6b7a90' };

  V.init = function (root) {
    V.root = root;
    leafEl = el('div', { id: 'leaflet', class: 'leaflet-host' });
    canvas = el('canvas', { id: 'radar', class: 'radar', 'aria-label': 'Схема мест на контуре Кыргызстана' });
    pop = el('div', { class: 'map-pop', hidden: true });
    hint = el('div', { class: 'map-hint', hidden: true });
    segWrap = el('div', { class: 'map-seg' });
    const locate = el('button', { class: 'map-fab', type: 'button', 'aria-label': 'Моё положение', onclick: locateMe }, KG.icon('crosshair'));
    const fit = el('button', { class: 'map-fab fit', type: 'button', 'aria-label': 'Вся страна', onclick: fitCountry, text: 'Вся страна' });
    host = el('div', { class: 'map-host' }, leafEl, canvas, hint, pop, el('div', { class: 'map-fabs' }, fit, locate));
    bar = el('div', { class: 'map-bar' }, segWrap);
    root.appendChild(bar);
    root.appendChild(host);
    drawSeg();
    ctx = canvas.getContext('2d');
    bindRadar();
    window.addEventListener('resize', function () { if (V.active) { resizeCanvas(); schedule(); if (lmap) lmap.invalidateSize(); } });
    window.addEventListener('online', autoMode);
    window.addEventListener('offline', autoMode);
    KG.on('fix', function () { if (V.active) updateMe(); });
    KG.on('data', function () { if (lmarkers) buildMarkers(); schedule(); });
    KG.on('history', function () { if (lmarkers) buildMarkers(); });
  };

  function drawSeg() {
    KG.clear(segWrap);
    segWrap.appendChild(KG.segmented([{ value: 'map', label: 'Карта' }, { value: 'radar', label: 'Радар (офлайн)' }], V.mode || 'radar', function (v) { V.forced = v; setMode(v); }));
  }

  function autoMode() {
    if (!V.active) return;
    if (!V.forced) setMode(navigator.onLine ? 'map' : 'radar');
  }

  V.show = function () {
    V.active = true;
    if (!V.forced) V.mode = navigator.onLine ? 'map' : 'radar';
    setMode(V.mode, true);
  };
  V.hide = function () { V.active = false; };

  async function setMode(mode, initial) {
    V.mode = mode;
    drawSeg();
    leafEl.style.display = mode === 'map' ? 'block' : 'none';
    canvas.style.display = mode === 'radar' ? 'block' : 'none';
    hint.hidden = true; pop.hidden = true;
    if (mode === 'map') {
      try { await initLeaflet(); } catch (e) {
        KG.log('warn', 'leaflet: ' + e.message);
        hint.textContent = 'Карту загрузить не удалось — показан радар.'; hint.hidden = false;
        V.mode = 'radar'; drawSeg(); leafEl.style.display = 'none'; canvas.style.display = 'block';
        showRadar(initial);
        return;
      }
      lmap.invalidateSize();
      updateMe();
      if (!navigator.onLine) { hint.textContent = 'Нет сети: плитки карты не загрузятся. Откройте «Радар».'; hint.hidden = false; }
    } else showRadar(initial);
  }

  /* ---------- Leaflet ---------- */
  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (L_ready) return L_ready;
    L_ready = new Promise(function (resolve, reject) {
      const css = el('link', { rel: 'stylesheet', href: 'js/vendor/leaflet/leaflet.css' });
      document.head.appendChild(css);
      const s = el('script', { src: 'js/vendor/leaflet/leaflet.js' });
      s.onload = resolve;
      s.onerror = function () { L_ready = null; reject(new Error('leaflet.js не загрузился')); };
      document.head.appendChild(s);
    });
    return L_ready;
  }

  async function initLeaflet() {
    await loadLeaflet();
    if (lmap) return;
    lmap = L.map(leafEl, { zoomControl: false, attributionControl: true, worldCopyJump: false, tap: true }).setView([41.5, 74.7], 7);
    L.control.zoom({ position: 'topleft' }).addTo(lmap);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(lmap);
    let errs = 0;
    tiles.on('tileerror', function () { if (++errs === 6) { hint.textContent = 'Плитки карты не загружаются (нет сети?). Откройте «Радар».'; hint.hidden = false; } });
    tiles.on('tileload', function () { errs = 0; hint.hidden = true; });
    lmarkers = L.layerGroup().addTo(lmap);
    buildMarkers();
    lmap.on('dragstart', function () { lfollow = false; });
    const b = boundsOfPois();
    if (b) lmap.fitBounds(b, { padding: [30, 30], maxZoom: 9 });
    if (KG.gps.last) { lmap.setView([KG.gps.last.lat, KG.gps.last.lon], 11); }
  }

  function boundsOfPois() {
    const ps = KG.data.pois;
    if (!ps.length) return null;
    return L.latLngBounds(ps.map(function (p) { return [p.lat, p.lon]; }));
  }

  function buildMarkers() {
    if (!lmarkers) return;
    lmarkers.clearLayers();
    KG.data.pois.forEach(function (p) {
      const icon = L.divIcon({ className: 'pin-wrap', html: '<span class="pin p' + p.priority + (KG.guide.isDone(p.id) ? ' done' : '') + '"></span>', iconSize: [26, 26], iconAnchor: [13, 13] });
      const m = L.marker([p.lat, p.lon], { icon: icon, title: KG.data.name(p), keyboard: false });
      m.on('click', function () { popupFor(p); });
      lmarkers.addLayer(m);
    });
  }

  function updateMe() {
    const f = KG.gps.last;
    if (lmap && f) {
      if (!lme) {
        lme = L.marker([f.lat, f.lon], { icon: L.divIcon({ className: 'me-wrap', html: '<span class="me"><i></i></span>', iconSize: [28, 28], iconAnchor: [14, 14] }), interactive: false, zIndexOffset: 1000 }).addTo(lmap);
        lacc = L.circle([f.lat, f.lon], { radius: f.acc || 20, weight: 1, color: '#2a6fdb', fillOpacity: 0.1, interactive: false }).addTo(lmap);
      }
      lme.setLatLng([f.lat, f.lon]);
      lacc.setLatLng([f.lat, f.lon]); lacc.setRadius(Math.max(5, f.acc || 20));
      const h = KG.gps.heading();
      const node = lme.getElement();
      if (node) { const i = node.querySelector('i'); if (i) { i.style.transform = 'rotate(' + (h || 0) + 'deg)'; i.style.display = h == null ? 'none' : 'block'; } }
      if (lfollow) lmap.panTo([f.lat, f.lon], { animate: true });
    }
    if (V.mode === 'radar') { if (radarFollow && f) { view.lat = f.lat; view.lon = f.lon; } schedule(); }
  }

  function popupFor(p) {
    const d = KG.gps.last ? KG.fmtDist(KG.geo.dist(KG.gps.last, p)) : '';
    KG.clear(pop);
    pop.appendChild(el('div', { class: 'map-pop-t' }, el('b', { text: KG.data.name(p) }), el('span', { class: 'muted', text: [KG.data.catLabel(p.category), d].filter(Boolean).join(' · ') })));
    pop.appendChild(el('button', { class: 'btn primary', type: 'button', text: 'Открыть', onclick: function () { location.hash = '#/poi/' + p.id; } }));
    pop.appendChild(el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Закрыть', onclick: function () { pop.hidden = true; } }, KG.icon('close')));
    pop.hidden = false;
  }

  function locateMe() {
    const f = KG.gps.last;
    if (!f) { KG.toast('Положение ещё не определено'); return; }
    if (V.mode === 'map' && lmap) { lfollow = true; lmap.setView([f.lat, f.lon], Math.max(lmap.getZoom(), 12)); } else {
      radarFollow = true; view.lat = f.lat; view.lon = f.lon; view.z = Math.max(view.z, 160); schedule();
    }
  }
  function fitCountry() {
    lfollow = false; radarFollow = false;
    if (V.mode === 'map' && lmap) lmap.fitBounds([[39.1, 69.2], [43.3, 80.3]], { padding: [10, 10] });
    else { fitRadar(); schedule(); }
  }

  /* ---------- радар ---------- */
  async function loadOutline() {
    if (outline || outlineTried) return outline;
    outlineTried = true;
    try { outline = await KG.fetchJson('data/kg-outline.json', 10000); } catch (e) { KG.log('warn', 'outline: ' + e.message); }
    return outline;
  }

  function resizeCanvas() {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas._w = r.width; canvas._h = r.height; canvas._dpr = dpr;
  }

  function fitRadar() {
    const w = canvas._w || 300, h = canvas._h || 400;
    const dLat = 4.4, dLon = 11.6 * Math.cos(41.3 * Math.PI / 180);
    view.z = Math.min(w / dLon, h / dLat) * 0.92;
    view.lat = 41.25; view.lon = 74.75;
  }

  async function showRadar(initial) {
    resizeCanvas();
    await loadOutline();
    resizeCanvas();
    if (initial || !view.init) {
      fitRadar(); view.init = true;
      if (KG.gps.last && !V.forcedViewDone) { /* показываем всю страну; «Я» центрирует */ }
    }
    schedule();
  }

  const COS = Math.cos(41.3 * Math.PI / 180);
  function toScreen(lat, lon) {
    return [canvas._w / 2 + (lon - view.lon) * COS * view.z, canvas._h / 2 - (lat - view.lat) * view.z];
  }

  function schedule() { if (V.mode !== 'radar' || raf) return; raf = requestAnimationFrame(function () { raf = 0; drawRadar(); }); }

  function css(name, def) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || def; }

  function drawRadar() {
    if (!ctx || !canvas._w) return;
    const dpr = canvas._dpr, w = canvas._w, h = canvas._h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--map-bg', '#e9eef5'); ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1; ctx.strokeStyle = css('--map-grid', 'rgba(0,0,0,.08)'); ctx.fillStyle = css('--muted', '#667');
    ctx.font = '11px system-ui, sans-serif';
    const step = view.z > 300 ? 0.25 : view.z > 120 ? 0.5 : 1;
    const a = [view.lat + h / 2 / view.z, view.lon - w / 2 / (view.z * COS)], b = [view.lat - h / 2 / view.z, view.lon + w / 2 / (view.z * COS)];
    for (let lon = Math.ceil(a[1] / step) * step; lon <= b[1]; lon += step) {
      const x = toScreen(0, lon)[0]; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      if (Math.abs(lon % 1) < 1e-6) ctx.fillText(lon + '°', x + 3, h - 4);
    }
    for (let lat = Math.ceil(b[0] / step) * step; lat <= a[0]; lat += step) {
      const y = toScreen(lat, 0)[1]; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (Math.abs(lat % 1) < 1e-6) ctx.fillText(lat + '°', 4, y - 3);
    }
    if (outline) {
      ctx.lineJoin = 'round';
      outline.country.forEach(function (ring) {
        ctx.beginPath();
        ring.forEach(function (pt, i) { const s = toScreen(pt[1], pt[0]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
        ctx.closePath();
        ctx.fillStyle = css('--map-land', '#f8f4ea'); ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = css('--map-border', '#1d4380'); ctx.stroke();
      });
      ctx.fillStyle = css('--map-water', '#a9c9ee');
      (outline.lakes || []).forEach(function (lk) {
        ctx.beginPath();
        lk.ring.forEach(function (pt, i) { const s = toScreen(pt[1], pt[0]); i ? ctx.lineTo(s[0], s[1]) : ctx.moveTo(s[0], s[1]); });
        ctx.closePath(); ctx.fill();
      });
    }
    /* места */
    hitList = [];
    const showLabels = view.z > 130;
    ctx.textBaseline = 'middle';
    KG.data.pois.slice().sort(function (p, q) { return q.priority - p.priority; }).forEach(function (p) {
      const s = toScreen(p.lat, p.lon);
      if (s[0] < -20 || s[1] < -20 || s[0] > w + 20 || s[1] > h + 20) return;
      const r = p.priority === 1 ? 7 : p.priority === 2 ? 5.5 : 4.5;
      ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 6.2832);
      ctx.fillStyle = PRIO_COLOR[p.priority] || '#666'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = KG.guide.isDone(p.id) ? '#2e7d4f' : '#fff'; ctx.stroke();
      hitList.push({ p: p, x: s[0], y: s[1] });
      if (showLabels && (p.priority === 1 || view.z > 260)) {
        ctx.font = (p.priority === 1 ? '600 ' : '') + '12px system-ui, sans-serif';
        const t = KG.data.name(p);
        ctx.lineWidth = 3; ctx.strokeStyle = css('--map-land', '#fff'); ctx.strokeText(t, s[0] + r + 4, s[1]);
        ctx.fillStyle = css('--ink', '#111'); ctx.fillText(t, s[0] + r + 4, s[1]);
      }
    });
    /* я */
    const f = KG.gps.last;
    if (f) {
      const s = toScreen(f.lat, f.lon);
      const ar = Math.max(8, (f.acc || 20) / 111000 * view.z);
      ctx.beginPath(); ctx.arc(s[0], s[1], ar, 0, 6.2832); ctx.fillStyle = 'rgba(42,111,219,.15)'; ctx.fill();
      const hd = KG.gps.heading();
      if (hd != null) {
        ctx.save(); ctx.translate(s[0], s[1]); ctx.rotate(hd * Math.PI / 180);
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(8, -6); ctx.lineTo(-8, -6); ctx.closePath(); ctx.fillStyle = '#2a6fdb'; ctx.fill(); ctx.restore();
      }
      ctx.beginPath(); ctx.arc(s[0], s[1], 7, 0, 6.2832); ctx.fillStyle = '#2a6fdb'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    /* масштабная линейка */
    const km = [1, 2, 5, 10, 20, 50, 100, 200].find(function (k) { return k / 111 * view.z * COS > 60; }) || 200;
    const len = km / 111 * view.z * COS;
    ctx.strokeStyle = css('--ink', '#111'); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(12, h - 22); ctx.lineTo(12 + len, h - 22); ctx.stroke();
    ctx.fillStyle = css('--ink', '#111'); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(km + ' км', 12, h - 28);
    if (!outline) { ctx.fillText('Контур страны не загружен', 12, 24); }
  }

  function bindRadar() {
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: Date.now() };
      if (Object.keys(pointers).length === 2) { const ps = Object.values(pointers); pinch = { d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y), z: view.z }; }
    });
    canvas.addEventListener('pointermove', function (e) {
      const p = pointers[e.pointerId];
      if (!p) return;
      if (pinch && Object.keys(pointers).length >= 2) {
        p.x = e.clientX; p.y = e.clientY;
        const ps = Object.values(pointers);
        const d = Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y);
        view.z = Math.max(20, Math.min(1200, pinch.z * d / pinch.d)); radarFollow = false; schedule();
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      view.lon -= dx / (view.z * COS); view.lat += dy / view.z; radarFollow = false; schedule();
    });
    const up = function (e) {
      const p = pointers[e.pointerId];
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) pinch = null;
      if (p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < 8 && Date.now() - p.t < 500) tapAt(e);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', function (e) { delete pointers[e.pointerId]; pinch = null; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      view.z = Math.max(20, Math.min(1200, view.z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); schedule();
    }, { passive: false });
    canvas.addEventListener('dblclick', function () { view.z = Math.min(1200, view.z * 1.6); schedule(); });
  }

  function tapAt(e) {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 28;
    hitList.forEach(function (h) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } });
    if (best) popupFor(best.p); else pop.hidden = true;
  }

  V.refresh = function () { schedule(); };
  KG.on('settings', function () { schedule(); });
})();
