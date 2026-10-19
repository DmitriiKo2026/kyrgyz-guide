/* Общие элементы интерфейса: строки списков, стрелки, мини-плеер, шторка. */
(function () {
  'use strict';
  const KG = window.KG;
  const el = KG.el;
  const U = (KG.ui = {});
  KG.views = {};

  U.arrow = function (rel) {
    const a = el('span', { class: 'arrow' }, KG.icon('arrow'));
    U.setArrow(a, rel);
    return a;
  };
  U.setArrow = function (a, rel) {
    if (rel === null || rel === undefined) { a.style.visibility = 'hidden'; return; }
    a.style.visibility = 'visible';
    a.style.transform = 'rotate(' + Math.round(rel) + 'deg)';
  };

  U.flags = function (p, done) {
    const f = [];
    if (p.audio) f.push(el('span', { class: 'flag', title: 'Есть аудио (mp3)' }, KG.icon('audio')));
    if (KG.data.hasHistoric(p)) f.push(el('span', { class: 'flag', title: 'Есть исторические фото' }, KG.icon('clock')));
    if (done) f.push(el('span', { class: 'flag done' }, KG.icon('check'), 'озвучено'));
    return f;
  };

  U.row = function (p, o) {
    o = o || {};
    const sub = [KG.data.catLabel(p.category), p.era].filter(Boolean).join(' · ');
    const d = el('span', { class: 'row-d' });
    const arr = U.arrow(null);
    const flags = el('span', { class: 'row-flags' });
    const a = el('a', { class: 'row', href: '#/poi/' + encodeURIComponent(p.id), dataset: { id: p.id } },
      el('span', { class: 'row-ic p' + p.priority }, KG.icon('cat')),
      el('span', { class: 'row-main' }, el('b', { class: 'row-t', text: KG.data.name(p) }),
        el('span', { class: 'row-s', text: sub }), flags),
      el('span', { class: 'row-end' }, d, arr));
    a._d = d; a._arr = arr; a._flags = flags; a._p = p;
    U.updateRow(a, o);
    return a;
  };
  U.updateRow = function (a, o) {
    const p = a._p;
    a._d.textContent = o.dist != null ? KG.fmtDist(o.dist) : '';
    U.setArrow(a._arr, o.rel);
    a._arr.style.display = o.dist != null ? '' : 'none';
    const done = KG.guide.isDone(p.id);
    const key = (done ? '1' : '0') + (o.ahead ? '1' : '0');
    if (a._fk !== key) {
      a._fk = key;
      KG.clear(a._flags);
      KG.append(a._flags, U.flags(p, done));
      if (o.ahead) a._flags.appendChild(el('span', { class: 'flag ahead' }, 'впереди'));
    }
  };

  /* ---------- шторка (карточка, симуляция, о приложении) ---------- */
  U.sheet = function () { return KG.$('#sheet'); };
  U.openSheet = function (title, body, opts) {
    opts = opts || {};
    const s = U.sheet();
    KG.clear(s);
    const back = el('button', { class: 'sheet-back', type: 'button', 'aria-label': 'Назад', onclick: U.closeSheet }, KG.icon('back'), el('span', { text: 'Назад' }));
    const head = el('div', { class: 'sheet-head' }, back, el('div', { class: 'sheet-title', text: title || '' }), opts.action || el('span'));
    const scroll = el('div', { class: 'sheet-body' }, body);
    s.appendChild(head); s.appendChild(scroll);
    s.hidden = false;
    document.body.classList.add('sheet-open');
    scroll.scrollTop = 0;
    U.sheetOpen = true;
    KG.emit('sheet', true);
  };
  U.closeSheet = function (fromRoute) {
    if (!U.sheetOpen) return;
    const s = U.sheet();
    s.hidden = true; KG.clear(s);
    document.body.classList.remove('sheet-open');
    U.sheetOpen = false;
    if (U.onClose) { const f = U.onClose; U.onClose = null; f(); }
    KG.emit('sheet', false);
    if (fromRoute !== true && /^#\/(poi|online|sim|about)/.test(location.hash)) {
      if (history.length > 1) history.back(); else location.hash = '#/nearby';
    }
  };

  /* ---------- мини-плеер ---------- */
  let nowEl = null;
  U.initNow = function () {
    nowEl = KG.$('#nowbar');
    const render = function () {
      const P = KG.player, t = P.track;
      const show = P.state !== 'idle' && t && !(U.sheetOpen && U.cardKey === t.key);
      nowEl.hidden = !show;
      document.body.classList.toggle('has-now', show);
      if (!show) return;
      KG.clear(nowEl);
      const playing = P.state === 'playing' || P.state === 'loading';
      nowEl.appendChild(el('a', { class: 'now-main', href: t.onlineId ? '#/online/' + t.onlineId : '#/poi/' + encodeURIComponent(t.poiId || t.key) },
        el('b', { text: t.title }),
        el('span', { class: 'muted', text: P.kind === 'tts' ? 'читает голос iPhone' : 'аудиогид' + (P.state === 'loading' ? ' · загрузка…' : '') })));
      nowEl.appendChild(el('button', { class: 'now-btn big', type: 'button', 'aria-label': playing ? 'Пауза' : 'Играть', onclick: function () { P.toggle(); } },
        KG.icon(playing ? 'pause' : 'play'), el('span', { text: playing ? 'Пауза' : 'Играть' })));
      nowEl.appendChild(el('button', { class: 'now-btn stop', type: 'button', 'aria-label': 'Остановить', onclick: function () { P.stop(); } }, KG.icon('stop')));
    };
    ['player', 'track', 'sheet'].forEach(function (e) { KG.on(e, render); });
    render();
  };

  /* ---------- общие подписи ---------- */
  U.regionChip = function (r) { return el('span', { class: 'pill', text: KG.data.regionTitle(r) }); };
  U.section = function (title, kids, cls) {
    return el('section', { class: 'card' + (cls ? ' ' + cls : '') }, title ? el('h2', { text: title }) : null, kids);
  };
  U.empty = function (text, action) {
    return el('div', { class: 'empty' }, el('p', { text: text }), action || null);
  };
})();
