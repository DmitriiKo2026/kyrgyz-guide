/* Геопозиция: реальный GPS, симуляция, курс и компас. */
(function () {
  'use strict';
  const KG = window.KG;
  const G = (KG.gps = {
    state: 'off',      // off | wait | ok | denied | unavailable | unsupported
    last: null,        // последний фикс
    watchId: null,
    sim: null,
    compassHeading: null,
    compassOn: false
  });
  let anchor = null, course = null, courseTs = 0, errText = '';

  function setState(s, text) {
    errText = text || '';
    if (G.state !== s) { G.state = s; KG.emit('gps-state', s); } else if (text) KG.emit('gps-state', s);
  }
  G.errorText = function () { return errText; };

  function process(fix) {
    const prev = G.last;
    let speed = isFinite(fix.speed) && fix.speed !== null ? fix.speed : null;
    if (speed === null && prev) {
      const dt = (fix.ts - prev.ts) / 1000;
      speed = dt > 0.5 ? KG.geo.dist(prev, fix) / dt : 0;
    }
    speed = speed || 0;
    if (isFinite(fix.heading) && fix.heading !== null && speed > 1) {
      course = fix.heading; courseTs = fix.ts; anchor = { lat: fix.lat, lon: fix.lon };
    } else {
      if (!anchor) anchor = { lat: fix.lat, lon: fix.lon };
      else if (KG.geo.dist(anchor, fix) >= Math.max(15, Math.min(40, (fix.acc || 0) * 0.6))) {
        course = KG.geo.bearing(anchor, fix); courseTs = fix.ts; anchor = { lat: fix.lat, lon: fix.lon };
      }
    }
    fix.speed = speed;
    fix.moving = speed > 1;
    fix.course = course !== null && fix.ts - courseTs < 120000 ? course : null;
    G.last = fix;
    setState(fix.sim ? 'sim' : 'ok');
    KG.emit('fix', fix);
  }

  /* Эффективное направление «вперёд» для стрелок: по движению, иначе по компасу. */
  G.heading = function () {
    const f = G.last;
    if (!f) return null;
    if (f.moving && f.course !== null) return f.course;
    if (G.compassOn && G.compassHeading !== null && KG.settings.compass) return G.compassHeading;
    return f.course;
  };

  G.start = function () {
    if (G.sim) return;
    if (!('geolocation' in navigator)) { setState('unsupported', 'Геопозиция не поддерживается этим браузером.'); return; }
    if (G.watchId !== null) return;
    if (!G.last) setState('wait');
    G.watchId = navigator.geolocation.watchPosition(function (pos) {
      const c = pos.coords;
      process({ lat: c.latitude, lon: c.longitude, acc: c.accuracy, ts: pos.timestamp || Date.now(), speed: c.speed, heading: c.heading, sim: false });
    }, function (err) {
      if (err.code === 1) setState('denied', 'Доступ к геопозиции запрещён. Разрешите его: Настройки iPhone → Конфиденциальность → Службы геолокации → Safari (или «Кыргызстан»).');
      else if (err.code === 2) setState('unavailable', 'Не удаётся определить положение. Выйдите на открытое место.');
      else if (G.state !== 'ok') setState('wait', 'GPS отвечает долго…');
      KG.log('warn', 'geolocation error ' + err.code + ' ' + err.message);
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  };

  G.stop = function () {
    if (G.watchId !== null) { navigator.geolocation.clearWatch(G.watchId); G.watchId = null; }
    if (!G.sim) setState('off');
  };

  G.restart = function () { G.stop(); G.start(); };

  /* ---------- симуляция ---------- */
  G.simStart = function (o) {
    const wasReal = G.watchId !== null || G.state === 'ok' || G.state === 'wait';
    if (G.watchId !== null) { navigator.geolocation.clearWatch(G.watchId); G.watchId = null; }
    if (G.sim) clearInterval(G.sim.timer);
    anchor = null; course = null; G.last = null;
    G.sim = {
      lat: o.lat, lon: o.lon, speedKmh: o.speedKmh || 0, heading: o.heading || 0, warp: o.warp || 1,
      path: o.path || null, pi: 0, resume: G.sim ? G.sim.resume : wasReal, timer: null
    };
    if (G.sim.path && G.sim.path.length) { G.sim.lat = G.sim.path[0].lat; G.sim.lon = G.sim.path[0].lon; G.sim.pi = 1; }
    KG.log('info', 'симуляция: ' + G.sim.lat.toFixed(5) + ',' + G.sim.lon.toFixed(5));
    emitSim(true);
    G.sim.timer = setInterval(tick, 1000);
    KG.emit('sim-state', true);
  };

  function emitSim(first) {
    const s = G.sim;
    if (!s) return;
    process({ lat: s.lat, lon: s.lon, acc: 5, ts: Date.now(), speed: s.speedKmh / 3.6, heading: s.speedKmh > 0 ? s.heading : null, sim: true });
    if (first) KG.emit('sim-state', true);
  }

  function tick() {
    const s = G.sim;
    if (!s) return;
    let step = (s.speedKmh / 3.6) * s.warp;
    if (s.path && s.pi < s.path.length) {
      while (step > 0 && s.pi < s.path.length) {
        const target = s.path[s.pi];
        const d = KG.geo.dist(s, target);
        s.heading = KG.geo.bearing(s, target);
        if (d <= step) { s.lat = target.lat; s.lon = target.lon; step -= d; s.pi++; } else {
          const n = KG.geo.dest(s, s.heading, step); s.lat = n.lat; s.lon = n.lon; step = 0;
        }
      }
      if (s.pi >= s.path.length) { s.speedKmh = 0; KG.toast('Путь симуляции завершён'); KG.emit('sim-state', true); }
    } else if (step > 0) {
      const n = KG.geo.dest(s, s.heading, step);
      s.lat = n.lat; s.lon = n.lon;
    }
    emitSim();
  }

  G.simUpdate = function (patch) {
    if (!G.sim) return;
    Object.assign(G.sim, patch);
    if (patch.lat !== undefined || patch.lon !== undefined) { anchor = null; }
    emitSim();
  };

  G.simStop = function () {
    if (!G.sim) return;
    clearInterval(G.sim.timer);
    const resume = G.sim.resume;
    G.sim = null; G.last = null; anchor = null; course = null;
    setState('off');
    KG.emit('sim-state', false);
    if (resume || KG.store.get('onboarded', false)) G.start();
  };

  /* ---------- компас (необязательно) ---------- */
  function onOrient(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h === null) return;
    G.compassHeading = h;
    KG.emit('heading', h);
  }
  G.compassStart = async function () {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', onOrient, true);
      window.addEventListener('deviceorientationabsolute', onOrient, true);
      G.compassOn = true;
      return true;
    } catch (e) { KG.log('warn', 'compass: ' + e.message); return false; }
  };
  G.compassStop = function () {
    window.removeEventListener('deviceorientation', onOrient, true);
    window.removeEventListener('deviceorientationabsolute', onOrient, true);
    G.compassOn = false; G.compassHeading = null;
  };
})();
