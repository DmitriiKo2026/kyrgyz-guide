/* Экран «Рядом». */
(function () {
  'use strict';
  const KG = window.KG, el = KG.el, U = KG.ui;
  const V = (KG.views.nearby = {});
  let root, statusEl, ctrlEl, listEl, onlineEl, moreBtn;
  let rows = new Map(), lastOrder = '', shown = 25, orows = new Map(), lastO = '', active = false, lastRender = 0, timer = 0;

  V.init = function (r) {
    root = r;
    statusEl = el('section', { class: 'card status' });
    ctrlEl = el('div', { class: 'ctrl' });
    listEl = el('div', { class: 'list' });
    moreBtn = el('button', { class: 'btn ghost wide', type: 'button', text: 'Показать ещё', hidden: true, onclick: function () { shown += 25; render(true); } });
    onlineEl = el('section', { class: 'card online' });
    root.appendChild(statusEl);
    root.appendChild(ctrlEl);
    root.appendChild(el('h2', { class: 'h-sec', id: 'near-h', text: 'Рядом с вами' }));
    root.appendChild(listEl);
    root.appendChild(moreBtn);
    root.appendChild(onlineEl);
    ['gps-state', 'settings', 'unlocked', 'wake', 'sim-state'].forEach(function (e) { KG.on(e, function () { if (active) { renderStatus(); renderCtrl(); } }); });
    KG.on('fix', function () { if (active) renderStatus(); });
    KG.on('nearby', function () { if (active) throttled(); });
    KG.on('history', function () { if (active) render(true); });
    KG.on('data', function () { if (active) render(true); });
    KG.on('finds', function () { if (active) renderOnline(); });
    KG.on('finds-status', function () { if (active) renderOnline(); });
    KG.on('player', function () { if (active) renderCtrl(); });
  };

  V.show = function () { active = true; renderStatus(); renderCtrl(); render(true); renderOnline(); };
  V.hide = function () { active = false; };

  function throttled() {
    const now = Date.now();
    if (now - lastRender > 1500) render(); else if (!timer) timer = setTimeout(function () { timer = 0; render(); }, 1500);
  }

  function gpsLine() {
    const s = KG.gps.state, f = KG.gps.last;
    if ((s === 'ok' || s === 'sim') && f) {
      let t = (s === 'sim' ? 'Симуляция' : 'GPS') + ' · точность ' + Math.round(f.acc || 0) + ' м';
      if (f.moving) t += ' · ' + Math.round(f.speed * 3.6) + ' км/ч' + (f.course != null ? ' · курс ' + Math.round(f.course) + '° ' + KG.compassWord(f.course) : '');
      else t += ' · на месте';
      return { cls: 'ok', text: t, sub: f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) };
    }
    if (s === 'wait') return { cls: 'wait', text: 'Определяем положение…', sub: KG.gps.errorText() || 'Выйдите на открытое место, это может занять до минуты.' };
    if (s === 'denied' || s === 'unavailable' || s === 'unsupported') return { cls: 'bad', text: 'Нет геопозиции', sub: KG.gps.errorText(), retry: true };
    return { cls: 'off', text: 'Геопозиция выключена', sub: 'Включите её, чтобы гид сам рассказывал о местах рядом.', retry: true };
  }

  function renderStatus() {
    const g = gpsLine();
    KG.clear(statusEl);
    statusEl.appendChild(el('div', { class: 'st-line' }, el('span', { class: 'dot ' + g.cls }), el('b', { text: g.text })));
    if (g.sub) statusEl.appendChild(el('div', { class: 'muted small', text: g.sub }));
    if (g.retry) statusEl.appendChild(el('button', { class: 'btn primary wide', type: 'button', text: KG.gps.state === 'off' ? 'Включить геопозицию' : 'Повторить', onclick: function () { KG.gps.restart(); } }));
    if (KG.settings.mode === 'road' && (KG.gps.state === 'ok' || KG.gps.state === 'sim')) {
      if (KG.guide.wake) statusEl.appendChild(el('div', { class: 'muted small', text: 'Экран не гаснет, пока приложение открыто.' }));
      else statusEl.appendChild(el('div', { class: 'muted small', text: 'Держите приложение открытым: при заблокированном экране iPhone останавливает GPS.' }));
    }
    const h = KG.gps.heading();
    const note = KG.gps.last ? (h != null ? 'Стрелки показывают направление относительно вашего движения: вверх — прямо по ходу.' : 'Курс пока неизвестен: стрелка вверх — на север.') : '';
    if (note) statusEl.appendChild(el('div', { class: 'muted small', text: note }));
  }

  function renderCtrl() {
    KG.clear(ctrlEl);
    ctrlEl.appendChild(KG.segmented([{ value: 'road', label: 'В дороге' }, { value: 'walk', label: 'Пешком' }], KG.settings.mode, function (v) { KG.setSetting('mode', v); }));
    const auto = el('label', { class: 'auto-row' }, el('span', {}, el('b', { text: 'Автообъявление' }), el('span', { class: 'muted small', text: KG.settings.auto ? ' гид сам расскажет о местах' : ' выключено' })),
      KG.switchEl(KG.settings.auto, function (v) { KG.setSetting('auto', v); KG.player.unlock(); }, 'Автообъявление'));
    ctrlEl.appendChild(auto);
    if (KG.settings.auto && !KG.player.unlocked) {
      ctrlEl.appendChild(el('button', { class: 'btn accent wide', type: 'button', text: 'Включить звук гида (одно касание)', onclick: function () { KG.player.unlock(); renderCtrl(); } }));
    }
    const playing = KG.player.state !== 'idle';
    ctrlEl.appendChild(el('button', { class: 'btn primary xl wide', type: 'button', onclick: function () { KG.player.unlock(); KG.guide.playNearest(); } },
      KG.icon('audio'), el('span', { text: 'Рассказать про ближайшее' })));
    if (playing) {
      const pl = KG.player.state === 'playing' || KG.player.state === 'loading';
      ctrlEl.appendChild(el('button', { class: 'btn accent xl wide', type: 'button', onclick: function () { KG.player.toggle(); } },
        KG.icon(pl ? 'pause' : 'play'), el('span', { text: pl ? 'Пауза' : 'Продолжить' })));
    }
  }

  function render(force) {
    lastRender = Date.now();
    const hasFix = !!KG.guide.pos && (KG.gps.state === 'ok' || KG.gps.state === 'sim');
    const h = KG.$('#near-h', root);
    let items;
    if (!KG.data.pois.length) {
      KG.clear(listEl); rows.clear(); lastOrder = '';
      listEl.appendChild(U.empty('Список мест пока пуст. Данные ещё не собраны или не загрузились.'));
      moreBtn.hidden = true; return;
    }
    if (hasFix) {
      h.textContent = 'Рядом с вами';
      const moving = KG.gps.last && KG.gps.last.moving;
      items = KG.guide.list.slice(0, shown).map(function (it) {
        return { p: it.poi, dist: it.dist, rel: it.rel, ahead: moving && KG.settings.mode === 'road' && it.relCourse !== null && Math.abs(it.relCourse) <= 60 && it.poi.road_m > 0 && it.dist <= it.poi.road_m * KG.settings.mult };
      });
      moreBtn.hidden = KG.guide.list.length <= shown;
    } else {
      h.textContent = 'Главные места (геопозиция пока не определена)';
      const main = KG.data.pois.filter(function (p) { return p.priority === 1; });
      items = main.slice(0, shown).map(function (p) { return { p: p, dist: null, rel: null }; });
      moreBtn.hidden = main.length <= shown;
    }
    const order = items.map(function (i) { return i.p.id; }).join('|');
    if (force || order !== lastOrder) {
      const nodes = items.map(function (i) {
        let r = rows.get(i.p.id);
        if (!r) { r = U.row(i.p, i); rows.set(i.p.id, r); }
        return r;
      });
      listEl.replaceChildren.apply(listEl, nodes);
      lastOrder = order;
    }
    items.forEach(function (i) { const r = rows.get(i.p.id); if (r) U.updateRow(r, i); });
  }

  /* ---------- онлайн-находки ---------- */
  function renderOnline() {
    const O = KG.online;
    KG.clear(onlineEl);
    onlineEl.appendChild(el('div', { class: 'online-h' }, KG.icon('wiki'), el('h2', { text: 'Найдено онлайн' }), el('span', { class: 'pill', text: 'Википедия' })));
    if (!KG.settings.online) { onlineEl.appendChild(el('p', { class: 'muted', text: 'Поиск в Википедии выключен (Ещё → Настройки).' })); return; }
    if (!KG.guide.pos) { onlineEl.appendChild(el('p', { class: 'muted', text: 'Появится, когда определится положение.' })); return; }
    const st = !navigator.onLine || O.status === 'offline' ? 'Нет сети — показаны сохранённые находки.' : O.status === 'loading' ? 'Ищем…' : O.status === 'error' ? 'Википедия не ответила, повторим позже.' : '';
    if (st) onlineEl.appendChild(el('p', { class: 'muted small', text: st }));
    if (!O.finds.length) {
      if (!st) onlineEl.appendChild(el('p', { class: 'muted', text: 'Поблизости нет статей, которых нет в гиде.' }));
      return;
    }
    O.finds.slice(0, 8).forEach(function (it) {
      const a = el('a', { class: 'row ol', href: '#/online/' + it.pageid },
        el('span', { class: 'row-ic ol' }, KG.icon('wiki')),
        el('span', { class: 'row-main' }, el('b', { class: 'row-t', text: it.title }),
          el('span', { class: 'row-s', text: (it.extract || '').slice(0, 90) + ((it.extract || '').length > 90 ? '…' : '') }),
          el('span', { class: 'row-flags' }, it.saved ? el('span', { class: 'flag done' }, KG.icon('save'), 'сохранено') : null, it.cached ? el('span', { class: 'flag' }, 'из кэша') : null)),
        el('span', { class: 'row-end' }, el('span', { class: 'row-d', text: KG.fmtDist(it.dist) }), U.arrow(it.rel)));
      onlineEl.appendChild(a);
    });
    onlineEl.appendChild(el('p', { class: 'muted small', text: 'Тексты Википедии, лицензия CC BY-SA. Голос iPhone читает их по кнопке в карточке.' }));
  }

  V.rerender = function () { if (active) { renderStatus(); renderCtrl(); render(true); renderOnline(); } };
})();
