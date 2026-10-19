/* Ядро: события, хранилище, настройки, геометрия, DOM-помощники, иконки. */
(function () {
  'use strict';
  const KG = (window.KG = window.KG || {});
  KG.VERSION = '1.0.1';
  KG.params = new URLSearchParams(location.search);
  KG.debug = KG.params.get('debug') === '1';

  /* ---------- журнал ---------- */
  KG.logs = [];
  KG.log = function (level, msg, extra) {
    let line = msg;
    if (extra !== undefined) {
      try { line += ' ' + (extra instanceof Error ? extra.message : JSON.stringify(extra)); } catch (e) { line += ' [obj]'; }
    }
    KG.logs.push({ t: Date.now(), level: level, msg: String(line) });
    if (KG.logs.length > 300) KG.logs.shift();
    if (KG.debug) {
      try { (console[level] || console.log).call(console, '[KG]', line); } catch (e) { /* ignore */ }
    }
    KG.emit('log');
  };

  /* ---------- события ---------- */
  const handlers = {};
  KG.on = function (ev, fn) {
    (handlers[ev] = handlers[ev] || []).push(fn);
    return function () { handlers[ev] = (handlers[ev] || []).filter(function (f) { return f !== fn; }); };
  };
  KG.emit = function (ev, data) {
    (handlers[ev] || []).slice().forEach(function (fn) {
      try { fn(data); } catch (e) { if (ev !== 'log') KG.log('error', 'обработчик ' + ev + ': ' + (e && e.message)); }
    });
  };

  /* ---------- localStorage ---------- */
  KG.store = {
    get: function (k, def) {
      try { const v = localStorage.getItem('kg.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) { try { localStorage.setItem('kg.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('kg.' + k); } catch (e) { /* ignore */ } }
  };

  /* ---------- настройки ---------- */
  const DEFAULTS = {
    mode: 'road', mult: 1, auto: true, autoOnline: false, online: true,
    speed: 1, volume: 1, voice: '', fontScale: 1, theme: 'auto', compass: false
  };
  KG.settings = Object.assign({}, DEFAULTS, KG.store.get('settings', {}));
  KG.setSetting = function (k, v) {
    KG.settings[k] = v;
    KG.store.set('settings', KG.settings);
    if (k === 'theme' || k === 'fontScale') KG.applyLook();
    KG.emit('settings', k);
  };
  KG.applyLook = function () {
    const r = document.documentElement;
    r.style.setProperty('--fscale', String(KG.settings.fontScale));
    if (KG.settings.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', KG.settings.theme);
  };

  /* ---------- геометрия ---------- */
  const R = 6371000, D2R = Math.PI / 180;
  KG.geo = {
    dist: function (a, b) {
      const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
      const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    },
    bearing: function (a, b) {
      const y = Math.sin((b.lon - a.lon) * D2R) * Math.cos(b.lat * D2R);
      const x = Math.cos(a.lat * D2R) * Math.sin(b.lat * D2R) - Math.sin(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.cos((b.lon - a.lon) * D2R);
      return (Math.atan2(y, x) / D2R + 360) % 360;
    },
    /* a − b, нормировано в (−180, 180] */
    diff: function (a, b) {
      let d = ((a - b) % 360 + 540) % 360 - 180;
      return d === -180 ? 180 : d;
    },
    dest: function (p, brg, m) {
      const d = m / R, b = brg * D2R, la = p.lat * D2R, lo = p.lon * D2R;
      const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
      const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
      return { lat: la2 / D2R, lon: ((lo2 / D2R + 540) % 360) - 180 };
    }
  };

  /* ---------- форматирование ---------- */
  KG.plural = function (n, forms) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  };
  KG.fmtDist = function (m) {
    if (m == null || !isFinite(m)) return '';
    if (m < 950) {
      const v = m < 100 ? Math.max(0, Math.round(m / 5) * 5) : Math.round(m / 10) * 10;
      return v + ' м';
    }
    const km = m / 1000;
    return (km < 10 ? km.toFixed(1).replace('.', ',') : String(Math.round(km))) + ' км';
  };
  KG.distWords = function (m) {
    if (m < 950) {
      const n = m < 200 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50;
      return n + ' ' + KG.plural(n, ['метр', 'метра', 'метров']);
    }
    const km = m / 1000;
    const x = km < 10 ? Math.round(km * 2) / 2 : Math.round(km);
    if (Number.isInteger(x)) return x + ' ' + KG.plural(x, ['километр', 'километра', 'километров']);
    return String(x).replace('.', ',') + ' километра';
  };
  KG.compassWord = function (deg) {
    return ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
  };
  KG.norm = function (s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); };
  KG.fmtBytes = function (b) {
    if (b < 1048576) return Math.max(1, Math.round(b / 1024)) + ' КБ';
    return (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' МБ';
  };
  KG.fmtTime = function (s) {
    if (!isFinite(s)) return '0:00';
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  KG.abs = function (path) { return new URL(path, document.baseURI).href; };

  /* ---------- сеть ---------- */
  KG.fetchJson = async function (url, ms, opts) {
    const ctl = new AbortController();
    const t = setTimeout(function () { ctl.abort(); }, ms || 8000);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  };

  /* ---------- DOM ---------- */
  KG.$ = function (sel, root) { return (root || document).querySelector(sel); };
  KG.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  KG.el = function (tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k === 'dataset') Object.assign(e.dataset, v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (let i = 2; i < arguments.length; i++) KG.append(e, arguments[i]);
    return e;
  };
  KG.append = function (parent, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { KG.append(parent, k); }); return; }
    parent.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
  };
  KG.clear = function (e) { while (e.firstChild) e.removeChild(e.firstChild); return e; };

  const ICONS = {
    nearby: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.6"/>',
    map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4z"/><path d="M9 4v14M15 6v14"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.8" cy="6" r="1"/><circle cx="3.8" cy="12" r="1"/><circle cx="3.8" cy="18" r="1"/>',
    more: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
    pause: '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    back15: '<path d="M4 4v5h5"/><path d="M4.6 14a8 8 0 1 0 1.2-6.6L4 9"/><text x="12" y="16.2" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">15</text>',
    fwd15: '<path d="M20 4v5h-5"/><path d="M19.4 14a8 8 0 1 1-1.2-6.6L20 9"/><text x="12" y="16.2" font-size="7.5" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">15</text>',
    prev: '<path d="M6 5v14M19 5l-9 7 9 7z" fill="currentColor"/>',
    next: '<path d="M18 5v14M5 5l9 7-9 7z" fill="currentColor"/>',
    nav: '<path d="M12 2.5 20 21l-8-4-8 4z" fill="currentColor"/>',
    arrow: '<path d="M12 3 5.5 12h4.2v9h4.6v-9h4.2z" fill="currentColor"/>',
    audio: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10.5 11v6M13.5 11v6"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15"/>',
    wiki: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.6 3.6 5.4 3.6 8.5s-1 5.9-3.6 8.5M12 3.5C9.4 6.1 8.4 8.9 8.4 12s1 5.9 3.6 8.5"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    share: '<path d="M12 15V3.5M8 7l4-4 4 4M6 11H5.5A1.5 1.5 0 0 0 4 12.5v7A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.2"/>',
    crosshair: '<circle cx="12" cy="12" r="5.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    cat: '<path d="M3 19l6-10 4 6 2.5-3.5L21 19z" fill="currentColor" stroke="none"/>',
    save: '<path d="M6 4h12v16l-6-4-6 4z"/>'
  };
  KG.icon = function (name, cls) {
    const s = document.createElement('span');
    s.className = 'ic' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return s;
  };

  /* ---------- уведомления ---------- */
  let toastTimer = null;
  KG.toast = function (msg, ms) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 3500);
  };

  /* ---------- сегмент-переключатель ---------- */
  KG.segmented = function (options, value, onchange) {
    const wrap = KG.el('div', { class: 'seg', role: 'group' });
    options.forEach(function (o) {
      const b = KG.el('button', { type: 'button', class: o.value === value ? 'on' : '', text: o.label,
        onclick: function () {
          KG.$$('button', wrap).forEach(function (x) { x.classList.remove('on'); });
          b.classList.add('on');
          onchange(o.value);
        } });
      wrap.appendChild(b);
    });
    return wrap;
  };
  KG.switchEl = function (checked, onchange, label) {
    const inp = KG.el('input', { type: 'checkbox', role: 'switch' });
    inp.checked = !!checked;
    inp.addEventListener('change', function () { onchange(inp.checked); });
    return KG.el('label', { class: 'sw', 'aria-label': label || '' }, inp, KG.el('span', { class: 'sw-track' }));
  };

  window.addEventListener('error', function (e) { KG.log('error', 'window.onerror: ' + e.message); });
  window.addEventListener('unhandledrejection', function (e) { KG.log('error', 'promise: ' + (e.reason && e.reason.message || e.reason)); });
})();
