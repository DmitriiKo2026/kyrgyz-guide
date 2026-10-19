/* Экран «Ещё»: настройки, пакеты регионов; шторки «Симуляция GPS», «О приложении»; первый запуск. */
(function () {
  'use strict';
  const KG = window.KG, el = KG.el, U = KG.ui;
  const V = (KG.views.more = {});
  let root, packsEl, active = false, updInfo;
  const jobs = {};

  /* ---------- вспомогательное ---------- */
  function row(label, ctl, hint) {
    return el('div', { class: 'srow' }, el('div', { class: 'srow-l' }, el('b', { text: label }), hint ? el('span', { class: 'muted small', text: hint }) : null), ctl);
  }
  function range(min, max, step, value, oninput, fmt) {
    const out = el('output', { class: 'rng-out', text: fmt(value) });
    const inp = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), class: 'rng' });
    inp.addEventListener('input', function () { out.textContent = fmt(+inp.value); });
    inp.addEventListener('change', function () { oninput(+inp.value); });
    return el('div', { class: 'rng-wrap' }, inp, out);
  }

  V.init = function (r) {
    root = r;
    KG.on('packs', function () { if (active) renderPacks(); });
    KG.on('data', function () { if (active) { build(); } });
    KG.on('voices', function () { if (active) build(); });
    KG.on('sw', function () { if (active) build(); });
  };
  V.show = function () { active = true; build(); };
  V.hide = function () { active = false; };

  function build() {
    const top = root.scrollTop;
    KG.clear(root);
    root.appendChild(el('h1', { class: 'h-page', text: 'Ещё' }));
    if (KG.swState && KG.swState.waiting) {
      root.appendChild(el('section', { class: 'card accent-card' }, el('b', { text: 'Доступна новая версия приложения' }),
        el('button', { class: 'btn primary wide', type: 'button', text: 'Обновить сейчас', onclick: function () { KG.applyUpdate(); } })));
    }

    /* — пакеты — */
    packsEl = el('section', { class: 'card packs' });
    root.appendChild(packsEl);
    renderPacks();

    /* — режим и объявления — */
    const S = KG.settings;
    root.appendChild(U.section('Гид', [
      row('Режим по умолчанию', KG.segmented([{ value: 'road', label: 'В дороге' }, { value: 'walk', label: 'Пешком' }], S.mode, function (v) { KG.setSetting('mode', v); }),
        'В дороге гид предупреждает заранее и называет сторону, пешком — только вблизи.'),
      row('Автообъявление', KG.switchEl(S.auto, function (v) { KG.setSetting('auto', v); KG.player.unlock(); }, 'Автообъявление')),
      row('Радиус объявлений', range(0.5, 2, 0.25, S.mult, function (v) { KG.setSetting('mult', v); }, function (v) { return '×' + String(v).replace('.', ','); }),
        'Множитель к радиусу каждого места.'),
      row('Искать места в Википедии', KG.switchEl(S.online, function (v) { KG.setSetting('online', v); }, 'Поиск в Википедии'),
        'Нужен интернет; в Википедию уходят только координаты.'),
      row('Озвучивать находки онлайн', KG.switchEl(S.autoOnline, function (v) { KG.setSetting('autoOnline', v); }, 'Автоозвучка находок'),
        'Голосом iPhone, когда вы рядом.'),
      row('Компас в режиме «Пешком»', KG.switchEl(S.compass, async function (v) {
        if (v) { const ok = await KG.gps.compassStart(); if (!ok) { KG.toast('Компас недоступен или доступ не выдан'); v = false; build(); } } else KG.gps.compassStop();
        KG.setSetting('compass', v);
      }, 'Компас'), 'Стрелки поворачиваются вместе с телефоном, когда вы стоите.')
    ]));

    /* — звук и вид — */
    const voices = KG.player.voices();
    const sel = el('select', { class: 'select', 'aria-label': 'Голос' },
      el('option', { value: '', text: voices.length ? 'Автовыбор лучшего русского голоса' : 'Русские голоса не найдены' }),
      voices.map(function (v) { return el('option', { value: v.voiceURI, text: v.name + ' (' + v.lang + ')' }); }));
    sel.value = S.voice || '';
    sel.addEventListener('change', function () { KG.setSetting('voice', sel.value); });
    const testBtn = el('button', { class: 'btn ghost sm', type: 'button', text: 'Проверить голос', onclick: function () {
      KG.player.unlock();
      KG.player.play({ key: 'test', title: 'Проверка голоса', subtitle: '', cover: null, audio: null, text: 'Добро пожаловать в Кыргызстан. Это проверка голоса гида.' });
    } });
    root.appendChild(U.section('Звук и вид', [
      row('Скорость озвучки', range(0.8, 1.5, 0.05, S.speed, function (v) { KG.setSetting('speed', v); }, function (v) { return v.toFixed(2).replace('.', ',') + '×'; })),
      row('Громкость голоса iPhone', range(0.2, 1, 0.1, S.volume, function (v) { KG.setSetting('volume', v); }, function (v) { return Math.round(v * 100) + '%'; }),
        'Громкость mp3 регулируется кнопками телефона.'),
      row('Голос iPhone', el('div', { class: 'voice-ctl' }, sel, testBtn),
        voices.length ? 'Лучше выбрать «улучшенный» голос: Настройки → Универсальный доступ → Устный контент → Голоса → Русский.' : 'Добавьте русский голос: Настройки → Универсальный доступ → Устный контент → Голоса.'),
      row('Размер текста', KG.segmented([{ value: 1, label: 'Обычный' }, { value: 1.15, label: 'Крупный' }, { value: 1.3, label: 'Очень' }], S.fontScale, function (v) { KG.setSetting('fontScale', +v); })),
      row('Тема', KG.segmented([{ value: 'auto', label: 'Авто' }, { value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }], S.theme, function (v) { KG.setSetting('theme', v); }))
    ]));

    /* — данные — */
    updInfo = el('div', { class: 'muted small', text: 'Версия приложения ' + KG.VERSION + (KG.data.version ? ' · данные ' + KG.data.version : '') + ' · мест: ' + KG.data.pois.length });
    const updBtn = el('button', { class: 'btn primary wide', type: 'button' }, KG.icon('refresh'), el('span', { text: 'Проверить обновление' }));
    updBtn.addEventListener('click', async function () {
      updBtn.disabled = true; updInfo.textContent = 'Проверяем…';
      try { await KG.checkUpdate(updInfo); } catch (e) { updInfo.textContent = 'Не удалось проверить: ' + (navigator.onLine ? e.message : 'нет сети'); }
      updBtn.disabled = false;
    });
    root.appendChild(U.section('Обновление и история', [
      updBtn, updInfo,
      row('Озвучено мест', el('button', { class: 'btn ghost sm', type: 'button', text: 'Сбросить историю', onclick: function () {
        if (confirm('Сбросить историю? Гид снова сможет рассказать обо всех местах.')) { KG.guide.resetHistory(); KG.toast('История сброшена'); build(); } } }),
        String(KG.guide.doneCount()) + ' из ' + KG.data.pois.length)
    ]));

    root.appendChild(U.section('', [
      el('a', { class: 'btn ghost wide', href: '#/sim', text: 'Симуляция GPS (для проверки без поездки)' }),
      el('a', { class: 'btn ghost wide', href: '#/about', text: 'О приложении, лицензии и источники' }),
      el('button', { class: 'btn ghost wide', type: 'button', text: 'Показать приветствие ещё раз', onclick: function () { KG.onboarding(); } })
    ], 'links'));
    root.scrollTop = top;
  }

  /* ---------- пакеты ---------- */
  /* Рисуем во фрагмент и подставляем разом: несколько одновременных перерисовок (событие «packs» приходит дважды после
     загрузки) раньше дописывали блоки друг другу и список регионов дублировался. */
  let packsSeq = 0;
  async function renderPacks() {
    if (!packsEl) return;
    const my = ++packsSeq, host = packsEl, frag = document.createDocumentFragment();
    const done = function () { if (my === packsSeq && host === packsEl) { KG.clear(host); host.appendChild(frag); } };
    frag.appendChild(el('h2', { text: 'Пакеты регионов для офлайна' }));
    frag.appendChild(el('p', { class: 'muted small', text: 'Фото и аудио региона сохраняются в память телефона. Скачивайте по Wi-Fi. Без пакета тексты работают всегда, а фото и mp3 подгружаются из сети.' }));
    const regions = KG.packs.regions();
    if (!regions.length) { frag.appendChild(el('p', { class: 'muted', text: 'Список пакетов недоступен (нет данных).' })); done(); return; }
    let allFull = true;
    for (const r of regions) {
      const info = KG.packs.info(r);
      const stt = await KG.packs.status(r);
      if (stt.state !== 'full') allFull = false;
      const job = jobs[r];
      const bar = el('div', { class: 'progress', hidden: !job }, el('i', { style: { width: job ? Math.round(job.p * 100) + '%' : '0%' } }));
      const stText = job ? 'Загрузка… ' + Math.round(job.p * 100) + '%' + (job.failed ? ' · ошибок: ' + job.failed : '')
        : stt.state === 'full' ? 'Скачан, версия ' + info.version : stt.state === 'outdated' ? 'Доступно обновление'
          : stt.state === 'partial' ? 'Частично: ' + stt.have + ' из ' + stt.total + ' файлов' : 'Не скачан';
      const btns = el('div', { class: 'pk-btns' });
      if (job) {
        btns.appendChild(el('button', { class: 'btn ghost sm', type: 'button', text: 'Отмена', onclick: function () { job.ctl.cancel = true; } }));
      } else {
        const label = stt.state === 'full' ? null : stt.state === 'outdated' ? 'Обновить' : stt.state === 'partial' ? 'Докачать' : 'Скачать для офлайна (' + info.size_mb.toString().replace('.', ',') + ' МБ)';
        if (label) btns.appendChild(el('button', { class: 'btn primary', type: 'button', onclick: function () { startDownload(r); } }, KG.icon('download'), el('span', { text: label })));
        if (stt.state !== 'none') btns.appendChild(el('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Удалить пакет', onclick: async function () {
          if (confirm('Удалить скачанные фото и аудио региона «' + info.title + '»?')) { await KG.packs.remove(r); } } }, KG.icon('trash'), 'Удалить'));
      }
      frag.appendChild(el('div', { class: 'pk' },
        el('div', { class: 'pk-h' }, el('b', { text: info.title }), el('span', { class: 'muted small', text: info.poi_count + ' ' + KG.plural(info.poi_count, ['место', 'места', 'мест']) + ' · ' + info.size_mb.toString().replace('.', ',') + ' МБ' })),
        el('div', { class: 'muted small', text: stText }), bar, btns));
    }
    if (regions.length > 1 && !allFull) {
      const all = regions.reduce(function (s, r) { return s + KG.packs.info(r).bytes; }, 0);
      frag.appendChild(el('button', { class: 'btn accent wide', type: 'button', onclick: function () { regions.forEach(function (r) { if (!jobs[r]) startDownload(r); }); } },
        KG.icon('download'), el('span', { text: 'Скачать всё (' + (all / 1048576).toFixed(0) + ' МБ)' })));
    }
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        if (e.usage != null) frag.appendChild(el('p', { class: 'muted small', text: 'Занято в памяти приложения: ' + KG.fmtBytes(e.usage) + (e.quota ? ' из ~' + KG.fmtBytes(e.quota) : '') }));
      } catch (er) { /* ignore */ }
    }
    done();
  }

  async function startDownload(r) {
    if (jobs[r]) return;
    const ctl = { cancel: false };
    jobs[r] = { p: 0, failed: 0, ctl: ctl };
    if (active) renderPacks();
    try {
      const res = await KG.packs.download(r, function (p, failed) {
        jobs[r].p = p; jobs[r].failed = failed;
        const bars = packsEl && KG.$$('.pk', packsEl);
        if (active && bars) { updateProgressDom(r); }
      }, ctl);
      KG.toast(res.cancelled ? 'Загрузка отменена' : res.failed ? 'Скачано не всё: ошибок ' + res.failed + '. Нажмите «Докачать».' : 'Пакет «' + KG.data.regionTitle(r) + '» скачан', 5000);
    } catch (e) { KG.toast('Не удалось скачать: ' + e.message, 5000); }
    delete jobs[r];
    KG.emit('packs', r);
    if (KG.onPackDone) KG.onPackDone(r);
  }

  function updateProgressDom(r) {
    const idx = KG.packs.regions().indexOf(r);
    const pk = KG.$$('.pk', packsEl)[idx];
    if (!pk) return;
    const j = jobs[r];
    const bar = KG.$('.progress', pk);
    if (bar) { bar.hidden = false; bar.firstChild.style.width = Math.round(j.p * 100) + '%'; }
    const t = pk.children[1];
    if (t) t.textContent = 'Загрузка… ' + Math.round(j.p * 100) + '%' + (j.failed ? ' · ошибок: ' + j.failed : '');
  }
  V.startDownload = startDownload;
  V.jobs = jobs;

  /* ---------- симуляция GPS ---------- */
  const ROUTES = {
    'Бишкек → Бурана': '42.8765,74.6040\n42.8400,74.7500\n42.8000,74.9500\n42.7700,75.1500\n42.7433,75.2500',
    'Чолпон-Ата → Каракол': '42.6500,77.0600\n42.6000,77.4000\n42.5500,77.8000\n42.5000,78.2000\n42.4916,78.3902',
    'Бишкек → Чолпон-Ата (по прямой)': '42.8765,74.6040\n42.8000,75.5000\n42.7200,76.4000\n42.6538,77.0592'
  };

  {
    V.sim = function () {
      const G = KG.gps;
      const off = [];
      const lat = el('input', { class: 'inp', inputmode: 'decimal', value: G.sim ? G.sim.lat.toFixed(5) : (G.last ? G.last.lat.toFixed(5) : '42.87648'), 'aria-label': 'Широта' });
      const lon = el('input', { class: 'inp', inputmode: 'decimal', value: G.sim ? G.sim.lon.toFixed(5) : (G.last ? G.last.lon.toFixed(5) : '74.60398'), 'aria-label': 'Долгота' });
      const speed = el('input', { type: 'range', min: '0', max: '120', step: '5', value: String(G.sim ? G.sim.speedKmh : 0), class: 'rng' });
      const heading = el('input', { type: 'range', min: '0', max: '359', step: '5', value: String(G.sim ? G.sim.heading : 90), class: 'rng' });
      const warp = el('select', { class: 'select' }, [1, 5, 20].map(function (w) { return el('option', { value: String(w), text: 'время ×' + w }); }));
      const sOut = el('output', {}), hOut = el('output', {});
      const paintOut = function () { sOut.textContent = speed.value + ' км/ч'; hOut.textContent = heading.value + '° ' + KG.compassWord(+heading.value); };
      speed.addEventListener('input', paintOut); heading.addEventListener('input', paintOut); paintOut();
      const read = function () { const a = parseFloat(String(lat.value).replace(',', '.')), b = parseFloat(String(lon.value).replace(',', '.')); if (!isFinite(a) || !isFinite(b)) { KG.toast('Введите числа: широта и долгота'); return null; } return { lat: a, lon: b }; };
      const apply = function () {
        const p = read(); if (!p) return;
        const o = { lat: p.lat, lon: p.lon, speedKmh: +speed.value, heading: +heading.value, warp: +warp.value };
        if (G.sim) { G.simUpdate(o); } else G.simStart(o);
        KG.player.unlock();
        KG.toast('Симуляция: ' + p.lat.toFixed(4) + ', ' + p.lon.toFixed(4));
      };
      speed.addEventListener('change', function () { if (G.sim) G.simUpdate({ speedKmh: +speed.value }); });
      heading.addEventListener('change', function () { if (G.sim) G.simUpdate({ heading: +heading.value }); });
      warp.addEventListener('change', function () { if (G.sim) G.simUpdate({ warp: +warp.value }); });

      const pois = KG.data.pois.slice().sort(function (a, b) { return KG.data.name(a).localeCompare(KG.data.name(b), 'ru'); });
      const place = el('select', { class: 'select', 'aria-label': 'Перейти к месту' }, el('option', { value: '', text: 'Выбрать место…' }),
        pois.map(function (p) { return el('option', { value: p.id, text: KG.data.name(p) }); }));
      place.addEventListener('change', function () {
        const p = KG.data.byId[place.value]; if (!p) return;
        const q = KG.geo.dest(p, (+heading.value + 180) % 360, Math.max(p.road_m ? Math.min(p.road_m * 0.8, 2500) : 0, 0));
        lat.value = q.lat.toFixed(5); lon.value = q.lon.toFixed(5);
      });

      const pathTa = el('textarea', { class: 'inp ta', rows: '5', placeholder: 'Каждая строка: широта,долгота', 'aria-label': 'Точки пути' });
      const presets = el('select', { class: 'select', 'aria-label': 'Готовый путь' }, el('option', { value: '', text: 'Готовые пути…' }), Object.keys(ROUTES).map(function (k) { return el('option', { value: k, text: k }); }));
      presets.addEventListener('change', function () { if (ROUTES[presets.value]) pathTa.value = ROUTES[presets.value]; });
      const runPath = function () {
        const pts = pathTa.value.split(/\n/).map(function (s) { const m = s.match(/(-?\d+[.,]?\d*)\s*[,; ]\s*(-?\d+[.,]?\d*)/); return m ? { lat: parseFloat(m[1].replace(',', '.')), lon: parseFloat(m[2].replace(',', '.')) } : null; }).filter(Boolean);
        if (pts.length < 2) { KG.toast('Нужно минимум две точки'); return; }
        const sp = +speed.value || 60;
        speed.value = String(sp); paintOut();
        G.simStart({ lat: pts[0].lat, lon: pts[0].lon, speedKmh: sp, heading: 0, warp: +warp.value, path: pts });
        KG.player.unlock();
        KG.toast('Идём по пути: ' + pts.length + ' точек');
      };

      const live = el('div', { class: 'sim-live muted small' });
      const paintLive = function () {
        const f = G.last;
        live.textContent = G.sim && f ? 'Позиция: ' + f.lat.toFixed(5) + ', ' + f.lon.toFixed(5) + ' · ' + Math.round(f.speed * 3.6) + ' км/ч · курс ' + (f.course != null ? Math.round(f.course) + '°' : '—') +
          ' · кандидатов на объявление: ' + KG.guide.cands.length + (KG.guide.list[0] ? ' · ближайшее: ' + KG.data.name(KG.guide.list[0].poi) + ' (' + KG.fmtDist(KG.guide.list[0].dist) + ')' : '')
          : 'Симуляция выключена — работает настоящий GPS.';
      };
      paintLive();
      off.push(KG.on('fix', paintLive), KG.on('sim-state', paintLive));
      U.onClose = function () { off.forEach(function (f) { f(); }); };

      const body = el('div', { class: 'card-page' },
        U.section('Симуляция GPS', [
          el('p', { class: 'muted', text: 'Позволяет проверить гида без поездки. Пока симуляция включена, настоящий GPS не используется, а история объявлений ведётся отдельно и не сохраняется.' }),
          live,
          el('div', { class: 'two' }, el('label', {}, 'Широта', lat), el('label', {}, 'Долгота', lon)),
          place,
          el('label', { class: 'rngl' }, 'Скорость', speed, sOut),
          el('label', { class: 'rngl' }, 'Курс', heading, hOut),
          warp,
          el('button', { class: 'btn primary xl wide', type: 'button', onclick: apply }, KG.icon('play'), el('span', { text: G.sim ? 'Применить' : 'Начать симуляцию' })),
          el('div', { class: 'two' },
            el('button', { class: 'btn ghost', type: 'button', text: 'Остановиться', onclick: function () { speed.value = '0'; paintOut(); if (G.sim) G.simUpdate({ speedKmh: 0, path: null }); } }),
            el('button', { class: 'btn ghost', type: 'button', text: 'Выключить симуляцию', onclick: function () { G.simStop(); KG.toast('Снова настоящий GPS'); } }))
        ]),
        U.section('Путь по точкам', [
          presets, pathTa,
          el('button', { class: 'btn primary wide', type: 'button', onclick: runPath }, KG.icon('play'), el('span', { text: 'Пройти путь на заданной скорости' }))
        ]),
        el('p', { class: 'muted small', text: 'Подсказка: ссылка вида …/?sim=42.8765,74.6040 сразу включает симуляцию, а ?debug=1 показывает журнал.' }));
      U.openSheet('Симуляция GPS', body);
    };
  }

  /* ---------- о приложении ---------- */
  V.about = function () {
    const photos = [];
    KG.data.pois.forEach(function (p) { (p.photos || []).forEach(function (ph) { photos.push({ p: p, ph: ph }); }); });
    const list = el('details', { class: 'card credits' }, el('summary', { text: 'Все фотографии, авторы и лицензии (' + photos.length + ')' }),
      el('ul', {}, photos.map(function (x) {
        return el('li', {}, KG.data.name(x.p) + ': ' + (x.ph.author || '') + ', ' + (x.ph.license || '') + ' ', x.ph.source_url ? el('a', { href: x.ph.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'источник' }) : null);
      })));
    const body = el('div', { class: 'card-page about' },
      U.section('Кыргызстан — аудиогид', [
        el('p', { text: 'Офлайн-гид по Кыргызстану: рассказывает о местах, мимо которых вы едете или идёте, показывает исторические и современные фото. Версия ' + KG.VERSION + '.' }),
        el('p', { class: 'muted small', text: 'Данные: ' + KG.data.pois.length + ' мест, версия ' + (KG.data.version || '—') + '.' })
      ]),
      U.section('Конфиденциальность', [
        el('p', { text: 'Ваше положение нигде не хранится и никуда не отправляется. Единственное исключение: когда включён поиск в Википедии и есть интернет, приложение запрашивает у Википедии и Wikimedia Commons статьи и фото рядом с вами — в запросе передаются координаты (округлённые до 5 знаков). Историю прослушанного и настройки приложение хранит только на вашем телефоне. Карта (плитки OpenStreetMap) загружается с серверов OpenStreetMap, когда вы открываете её онлайн.' })
      ]),
      U.section('Ограничения iPhone', [
        el('ul', { class: 'facts' },
          el('li', { text: 'Приложение должно быть открыто: при блокировке экрана iPhone прекращает отдавать GPS. В режиме «В дороге» экран не гаснет сам.' }),
          el('li', { text: 'Голос iPhone (озвучка без mp3) замолкает при блокировке экрана; mp3 продолжает играть и с заблокированным экраном.' }),
          el('li', { text: 'Safari может удалить данные неустановленного сайта. Добавьте приложение на экран «Домой» — так данные хранятся надёжнее.' }))
      ]),
      U.section('Источники и лицензии', [
        el('ul', { class: 'facts' },
          el('li', {}, 'Тексты — пересказ открытых источников (Википедия, ЮНЕСКО, музейные сайты); подробности — в карточке каждого места.'),
          el('li', {}, 'Фото — Wikimedia Commons: CC0, Public domain, CC BY, CC BY-SA; автор и лицензия указаны у каждого фото.'),
          el('li', {}, 'Онлайн-находки — ', el('a', { href: 'https://ru.wikipedia.org', target: '_blank', rel: 'noopener', text: 'Русская Википедия' }), ', тексты под лицензией CC BY-SA 4.0.'),
          el('li', {}, 'Карта — © участники ', el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }), ' (ODbL).'),
          el('li', {}, 'Библиотека карт ', el('a', { href: 'https://leafletjs.com', target: '_blank', rel: 'noopener', text: 'Leaflet 1.9.4' }), ' (лицензия BSD-2-Clause).'),
          el('li', {}, 'Контур страны — Natural Earth (общественное достояние).'),
          el('li', {}, 'Озвучка mp3 синтезирована нейросетевым голосом (Microsoft Edge TTS).'))
      ]),
      list);
    U.openSheet('О приложении', body);
  };

  /* ---------- первый запуск ---------- */
  KG.onboarding = function () {
    const host = KG.$('#onboard');
    host.hidden = false;
    document.body.classList.add('onb-open');
    let step = 0;
    const standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    const regionBoxes = {};
    const steps = [
      function () {
        return [el('div', { class: 'onb-art' }, el('img', { src: 'icons/icon-192.png', alt: '' })),
          el('h1', { text: 'Кыргызстан — аудиогид' }),
          el('p', { text: 'Рассказывает о местах, мимо которых вы едете или идёте: история, природа, легенды. Показывает старые и современные фото. Работает без интернета.' }),
          el('p', { class: 'muted', text: 'Дальше — три коротких шага, чтобы всё заработало в дороге.' })];
      },
      function () {
        return [el('h1', { text: 'Добавьте на экран «Домой»' }),
          standalone ? el('p', { class: 'ok-note' }, KG.icon('check'), ' Готово: приложение уже установлено.')
            : el('ol', { class: 'steps' },
              el('li', {}, 'В Safari нажмите «Поделиться» ', KG.icon('share', 'inl'), '. Если кнопки не видно (в iOS 26 она часто спрятана), нажмите «⋯» справа внизу, затем «Поделиться».'),
              el('li', { text: 'Прокрутите список и выберите «На экран “Домой”».' }),
              el('li', { text: 'Оставьте включённым «Открывать как веб-приложение», нажмите «Добавить» и дальше открывайте гид с иконки.' })),
          standalone ? null : el('p', { class: 'warn-note', text: 'Важно: Safari и иконка на экране «Домой» хранят данные отдельно. Сначала добавьте гид на экран «Домой», затем откройте его с иконки и уже там скачайте пакеты — иначе скачанное в Safari иконке не достанется.' }),
          el('p', { class: 'muted', text: 'Так iPhone не удалит скачанные фото и аудио и приложение запускается как обычное, на весь экран.' })];
      },
      function () {
        const st = el('p', { class: 'muted', id: 'onb-gps', text: '' });
        return [el('h1', { text: 'Геопозиция' }),
          el('p', { text: 'Гид узнаёт, где вы, и сам начинает рассказ. Разрешите доступ к геопозиции, когда iPhone спросит: лучше «При использовании приложения» и «Точная геопозиция».' }),
          el('button', { class: 'btn primary xl wide', type: 'button', onclick: function () {
            KG.player.unlock(); KG.gps.start(); st.textContent = 'Запрос отправлен. Подтвердите его в окне iPhone.';
            const off = KG.on('gps-state', function (s) { st.textContent = s === 'ok' ? 'Геопозиция работает.' : s === 'denied' ? 'Доступ запрещён. Можно разрешить позже: Настройки iPhone → Конфиденциальность → Службы геолокации.' : st.textContent; if (s === 'ok') off(); });
          } }, KG.icon('nearby'), el('span', { text: 'Разрешить геопозицию' })),
          st,
          el('p', { class: 'muted', text: 'Держите приложение открытым: на заблокированном экране iPhone останавливает GPS. В режиме «В дороге» экран не гаснет сам. Включите звук телефона.' })];
      },
      function () {
        const list = el('div', { class: 'onb-packs' });
        const regions = KG.packs.regions();
        regions.forEach(function (r) {
          const info = KG.packs.info(r);
          const cb = el('input', { type: 'checkbox', checked: true });
          regionBoxes[r] = cb;
          list.appendChild(el('label', { class: 'onb-pk' }, cb, el('span', {}, el('b', { text: info.title }), el('span', { class: 'muted small', text: ' ' + info.size_mb.toString().replace('.', ',') + ' МБ · ' + info.poi_count + ' ' + KG.plural(info.poi_count, ['место', 'места', 'мест']) }))));
        });
        return [el('h1', { text: 'Пакеты для офлайна' }),
          el('p', { text: 'Фото и аудио нужно скачать заранее, пока есть Wi-Fi: в горах интернета не будет. Тексты уже в приложении.' }),
          standalone ? null : el('p', { class: 'warn-note', text: 'Сейчас вы в Safari, а не в установленном приложении. Скачанное здесь не увидит иконка на экране «Домой» — лучше пропустите этот шаг, добавьте гид на экран «Домой» и скачайте пакеты, открыв его с иконки.' }),
          regions.length ? list : el('p', { class: 'muted', text: 'Список пакетов пока недоступен.' }),
          regions.length ? el('button', { class: 'btn accent xl wide', type: 'button', onclick: function () {
            regions.forEach(function (r) { if (regionBoxes[r].checked) V.startDownload(r); });
            finish(); KG.toast('Загрузка идёт — смотрите «Ещё»', 5000); location.hash = '#/more';
          } }, KG.icon('download'), el('span', { text: 'Скачать выбранное' })) : null,
          el('p', { class: 'muted small', text: 'Можно пропустить и скачать позже: Ещё → Пакеты регионов.' })];
      }
    ];
    function finish() {
      KG.store.set('onboarded', true);
      host.hidden = true; KG.clear(host);
      document.body.classList.remove('onb-open');
      KG.gps.start();
    }
    function paint() {
      KG.clear(host);
      const dots = el('div', { class: 'dots' }, steps.map(function (_, i) { return el('i', { class: i === step ? 'on' : '' }); }));
      host.appendChild(el('div', { class: 'onb' }, el('div', { class: 'onb-body' }, steps[step]()), dots,
        el('div', { class: 'onb-nav' },
          step > 0 ? el('button', { class: 'btn ghost', type: 'button', text: 'Назад', onclick: function () { step--; paint(); } }) : el('span'),
          step < steps.length - 1 ? el('button', { class: 'btn primary', type: 'button', text: 'Далее', onclick: function () { step++; paint(); } })
            : el('button', { class: 'btn primary', type: 'button', text: 'Начать', onclick: finish }))));
    }
    paint();
  };
})();
