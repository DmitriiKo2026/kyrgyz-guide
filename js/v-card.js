/* Карточка места и карточка онлайн-находки. */
(function () {
  'use strict';
  const KG = window.KG, el = KG.el, U = KG.ui;
  const C = (KG.card = {});
  let offs = [];

  function sub(evt, fn) { offs.push(KG.on(evt, fn)); }
  function cleanup() { offs.forEach(function (f) { f(); }); offs = []; U.cardKey = null; closeLightbox(); }

  const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  /* ---------- фото ---------- */
  function placeholder(text, cls) {
    return el('div', { class: 'ph-empty ' + (cls || '') }, KG.icon('cat'), el('span', { text: text || 'Фото нет' }));
  }
  function badge(ph) {
    const hist = ph.kind === 'historic';
    return el('span', { class: 'badge ' + (hist ? 'hist' : 'now'), text: hist ? 'Тогда · ' + (ph.year || '') : 'Сейчас' + (ph.year ? ' · ' + ph.year : '') });
  }
  function imgEl(ph, eager) {
    const img = el('img', { src: ph.file || ph.url, alt: ph.caption || '', loading: eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', function () { img.replaceWith(placeholder('Фото не загрузилось. Нет сети? Скачайте пакет региона.', 'err')); });
    return img;
  }

  let lb = null;
  function openLightbox(ph) {
    closeLightbox();
    lb = el('div', { class: 'lightbox', role: 'dialog', onclick: closeLightbox },
      el('img', { src: ph.file || ph.url, alt: ph.caption || '' }),
      el('div', { class: 'lb-cap', text: [ph.caption, ph.year ? '(' + ph.year + ')' : '', ph.author ? '— ' + ph.author : '', ph.license].filter(Boolean).join(' ') }),
      el('button', { class: 'lb-x', type: 'button', 'aria-label': 'Закрыть' }, KG.icon('close')));
    document.body.appendChild(lb);
  }
  function closeLightbox() { if (lb) { lb.remove(); lb = null; } }

  function gallery(photos) {
    const wrap = el('div', { class: 'gal' });
    if (!photos.length) { wrap.appendChild(placeholder('Для этого места пока нет фото')); return wrap; }
    const track = el('div', { class: 'gal-track', tabindex: '0' });
    photos.forEach(function (ph, i) {
      const fig = el('figure', { class: 'gal-slide' }, imgEl(ph, i === 0), badge(ph));
      fig.addEventListener('click', function () { openLightbox(ph); });
      track.appendChild(fig);
    });
    const caption = el('div', { class: 'gal-cap' });
    const dots = el('div', { class: 'dots' });
    photos.forEach(function () { dots.appendChild(el('i')); });
    const cmp = comparer(photos);
    const hi = photos.findIndex(function (x) { return x.kind === 'historic'; }), ni = photos.findIndex(function (x) { return x.kind !== 'historic'; });
    let segBtns = null;
    const setIdx = function (i) {
      KG.$$('i', dots).forEach(function (d, k) { d.classList.toggle('on', k === i); });
      const ph = photos[i];
      caption.textContent = (ph.caption || '') + (ph.year ? ' (' + ph.year + ')' : '');
      if (segBtns) { segBtns.then.classList.toggle('on', ph.kind === 'historic' && !cmp.active()); segBtns.now.classList.toggle('on', ph.kind !== 'historic' && !cmp.active()); }
    };
    const go = function (i) { track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' }); };
    let tick = 0;
    track.addEventListener('scroll', function () {
      clearTimeout(tick);
      tick = setTimeout(function () { setIdx(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))); }, 60);
    }, { passive: true });
    wrap.appendChild(el('div', { class: 'gal-stage' }, track, cmp.node));
    if (photos.length > 1) wrap.appendChild(dots);
    if (hi >= 0 && ni >= 0) {
      segBtns = {
        then: el('button', { type: 'button', text: 'Тогда', onclick: function () { cmp.set(false); go(hi); setIdx(hi); } }),
        now: el('button', { type: 'button', text: 'Сейчас', onclick: function () { cmp.set(false); go(ni); setIdx(ni); } }),
        cmp: el('button', { type: 'button', text: 'Сравнить', onclick: function () { cmp.set(!cmp.active()); segBtns.cmp.classList.toggle('on', cmp.active()); setIdx(Math.round(track.scrollLeft / Math.max(1, track.clientWidth))); } })
      };
      wrap.appendChild(el('div', { class: 'seg tn', role: 'group', 'aria-label': 'Тогда и сейчас' }, segBtns.then, segBtns.now, segBtns.cmp));
    }
    wrap.appendChild(caption);
    wrap._cmp = cmp; wrap._track = track;
    setIdx(0);
    cmp.onToggle = function (on) { track.style.visibility = on ? 'hidden' : 'visible'; if (segBtns) segBtns.cmp.classList.toggle('on', on); };
    return wrap;
  }

  /* слайдер «Тогда / Сейчас» */
  function comparer(photos) {
    const h = photos.find(function (x) { return x.kind === 'historic'; }), n = photos.find(function (x) { return x.kind !== 'historic'; });
    const o = { node: el('div', { class: 'cmp', hidden: true }), on: false, onToggle: null };
    if (!h || !n) return Object.assign(o, { active: function () { return false; }, set: function () { /* нет пары */ } });
    const top = el('div', { class: 'cmp-top' }, imgEl(h, false));
    const handle = el('div', { class: 'cmp-handle' }, el('span'));
    const range = el('input', { type: 'range', min: '0', max: '100', value: '50', class: 'cmp-range', 'aria-label': 'Сравнение: тогда и сейчас' });
    const apply = function () { top.style.clipPath = 'inset(0 ' + (100 - range.value) + '% 0 0)'; handle.style.left = range.value + '%'; };
    range.addEventListener('input', apply);
    o.node.appendChild(imgEl(n, false));
    o.node.appendChild(top);
    o.node.appendChild(handle);
    o.node.appendChild(el('span', { class: 'badge hist l', text: 'Тогда · ' + (h.year || '') }));
    o.node.appendChild(el('span', { class: 'badge now r', text: 'Сейчас' + (n.year ? ' · ' + n.year : '') }));
    o.node.appendChild(range);
    apply();
    o.active = function () { return o.on; };
    o.set = function (v) { o.on = v; o.node.hidden = !v; if (o.onToggle) o.onToggle(v); };
    return o;
  }

  /* ---------- плеер ---------- */
  function playerBox(track, hasAudio) {
    const box = el('section', { class: 'card player' });
    let seeking = false, bar, cur, tot, label, mounted = false;
    const P = KG.player;
    const mine = function () { return P.track && P.track.key === track.key && P.state !== 'idle'; };

    function renderIdle() {
      KG.clear(box); mounted = false;
      const modeTxt = hasAudio ? 'Аудиогид, около ' + Math.max(1, Math.round(track.text.split(/\s+/).length / 140)) + ' мин' :
        (P.ttsAvailable() ? 'Прочитает голос iPhone' : 'Русский голос iPhone не найден — доступен только текст');
      box.appendChild(el('button', { class: 'btn primary xl wide', type: 'button', onclick: function () { P.unlock(); P.play(track); KG.guide.markIfPoi && KG.guide.markIfPoi(track); } },
        KG.icon('play'), el('span', { text: 'Слушать рассказ' })));
      box.appendChild(el('div', { class: 'muted small center', text: modeTxt }));
      if (!hasAudio) box.appendChild(el('div', { class: 'muted small center', text: 'Голос iPhone замолкает при блокировке экрана; mp3 играет и с заблокированным.' }));
    }

    function renderActive() {
      KG.clear(box); mounted = true;
      const playing = P.state === 'playing' || P.state === 'loading';
      const tts = P.kind === 'tts';
      const prev = el('button', { class: 'pbtn', type: 'button', 'aria-label': tts ? 'Предыдущее предложение' : 'Назад на 15 секунд', onclick: function () { P.seek(-15); } }, KG.icon(tts ? 'prev' : 'back15'));
      const next = el('button', { class: 'pbtn', type: 'button', 'aria-label': tts ? 'Следующее предложение' : 'Вперёд на 15 секунд', onclick: function () { P.seek(15); } }, KG.icon(tts ? 'next' : 'fwd15'));
      const main = el('button', { class: 'pbtn main', type: 'button', 'aria-label': playing ? 'Пауза' : 'Играть', onclick: function () { P.toggle(); } }, KG.icon(playing ? 'pause' : 'play'));
      box.appendChild(el('div', { class: 'pctl' }, prev, main, next));
      bar = el('input', { type: 'range', min: '0', max: '1000', value: String(Math.round(P.progress() * 1000)), class: 'pbar', 'aria-label': 'Позиция' });
      bar.addEventListener('input', function () { seeking = true; updTimes(+bar.value / 1000); });
      bar.addEventListener('change', function () { seeking = false; P.seekTo(+bar.value / 1000); });
      cur = el('span', { text: '0:00' }); tot = el('span', { text: '' });
      box.appendChild(bar);
      box.appendChild(el('div', { class: 'ptimes' }, cur, tot));
      const rates = [0.8, 1, 1.25, 1.5];
      box.appendChild(el('div', { class: 'prate' }, el('span', { class: 'muted small', text: 'Скорость' }),
        el('div', { class: 'seg sm' }, rates.map(function (r) {
          return el('button', { type: 'button', class: Math.abs(KG.settings.speed - r) < 0.01 ? 'on' : '', text: String(r).replace('.', ',') + '×', onclick: function (e) {
            KG.setSetting('speed', r); KG.$$('button', e.currentTarget.parentNode).forEach(function (b) { b.classList.remove('on'); }); e.currentTarget.classList.add('on'); } });
        })),
        el('button', { class: 'btn ghost sm', type: 'button', onclick: function () { P.stop(); } }, KG.icon('stop'), 'Стоп')));
      label = el('div', { class: 'muted small center' });
      box.appendChild(label);
      if (tts) box.appendChild(el('div', { class: 'muted small center', text: 'Читает голос iPhone — при блокировке экрана замолкает. Для работы с заблокированным экраном скачайте пакет региона (там есть mp3).' }));
      updTimes(P.progress());
    }

    function updTimes(frac) {
      if (!cur) return;
      if (P.kind === 'tts') { cur.textContent = 'Предложение ' + (Math.min(P.dur, Math.floor(frac * P.dur) + 1)); tot.textContent = 'из ' + P.dur; } else {
        cur.textContent = KG.fmtTime(frac * (P.dur || 0)); tot.textContent = P.dur ? KG.fmtTime(P.dur) : '';
      }
      if (label) label.textContent = P.state === 'loading' ? 'Загрузка…' : '';
    }

    const upd = function () {
      if (!mine()) { renderIdle(); return; }
      renderActive();
    };
    sub('player', function () { upd(); });
    sub('track', upd);
    sub('player-time', function () { if (mounted && !seeking && bar) { bar.value = String(Math.round(P.progress() * 1000)); updTimes(P.progress()); } });
    upd();
    return box;
  }

  /* ---------- навигация ---------- */
  function navLinks(lat, lon, name) {
    const q = encodeURIComponent(name);
    const primary = isApple ? 'maps://?ll=' + lat + ',' + lon + '&q=' + q
      : isAndroid ? 'geo:' + lat + ',' + lon + '?q=' + lat + ',' + lon + '(' + q + ')'
        : 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=16/' + lat + '/' + lon;
    return el('div', { class: 'navs' },
      el('a', { class: 'btn primary xl wide', href: primary }, KG.icon('nav'), el('span', { text: 'Открыть в навигаторе' })),
      el('div', { class: 'navs-more' },
        el('a', { class: 'btn ghost sm', href: 'https://maps.apple.com/?ll=' + lat + ',' + lon + '&q=' + q, target: '_blank', rel: 'noopener', text: 'Apple Maps' }),
        el('a', { class: 'btn ghost sm', href: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '#map=16/' + lat + '/' + lon, target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }),
        el('a', { class: 'btn ghost sm', href: 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon, target: '_blank', rel: 'noopener', text: 'Google Карты' })));
  }

  function link(url, text) { return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: text || url }); }
  function hostOf(u) { try { const x = new URL(u); return x.hostname.replace(/^www\./, '') + decodeURIComponent(x.pathname).slice(0, 40); } catch (e) { return u; } }
  function paras(text) { return String(text || '').split(/\n+/).filter(Boolean).map(function (t) { return el('p', { text: t }); }); }

  /* ---------- карточка места ---------- */
  C.poi = function (id) {
    cleanup();
    const p = KG.data.byId[id];
    if (!p) { U.openSheet('Место не найдено', U.empty('Такого места нет в базе. Возможно, данные обновились.', el('a', { class: 'btn primary', href: '#/catalog', text: 'В каталог' }))); return; }
    U.cardKey = p.id;
    U.onClose = cleanup;
    const name = KG.data.name(p);
    const g = gallery(p.photos || []);
    const dist = el('span', { class: 'pill dist' });
    const updDist = function () { const f = KG.guide.pos; dist.hidden = !f; if (f) dist.textContent = KG.fmtDist(KG.geo.dist(f, p)) + ' от вас'; };
    updDist();
    sub('fix', updDist);
    const done = el('span', { class: 'pill ok', hidden: !KG.guide.isDone(p.id) }, KG.icon('check'), 'озвучено');
    sub('history', function () { done.hidden = !KG.guide.isDone(p.id); });
    const track = KG.guide.trackFor(p, null);
    const body = el('div', { class: 'card-page' },
      g,
      el('div', { class: 'card-head' },
        el('h1', { text: name }),
        p.name && p.name.ky ? el('div', { class: 'muted ky', text: p.name.ky }) : null,
        el('div', { class: 'pills' }, U.regionChip(p.region), el('span', { class: 'pill', text: KG.data.catLabel(p.category) }), p.era ? el('span', { class: 'pill', text: p.era }) : null, dist, done)),
      playerBox(track, !!p.audio),
      p.summary ? el('p', { class: 'lead', text: p.summary }) : null,
      el('section', { class: 'story' }, paras(p.story)),
      p.facts && p.facts.length ? U.section('Интересные факты', el('ul', { class: 'facts' }, p.facts.map(function (f) { return el('li', { text: f }); }))) : null,
      p.tip ? el('section', { class: 'card tip' }, el('h2', { text: 'Совет туристу' }), el('p', { text: p.tip })) : null,
      navLinks(p.lat, p.lon, name),
      credits(p),
      el('div', { class: 'card-foot' }, el('button', { class: 'btn ghost', type: 'button', onclick: function () { KG.guide.isDone(p.id) ? KG.guide.unmark(p.id) : KG.guide.markDone(p.id); } },
        el('span', { text: KG.guide.isDone(p.id) ? 'Снять отметку «озвучено»' : 'Отметить «озвучено»' }))));
    sub('history', function () { const b = KG.$('.card-foot button span', body); if (b) b.textContent = KG.guide.isDone(p.id) ? 'Снять отметку «озвучено»' : 'Отметить «озвучено»'; });
    U.openSheet(name, body);
  };

  function credits(p) {
    const items = [];
    (p.photos || []).forEach(function (ph) {
      items.push(el('li', {}, (ph.caption ? ph.caption + ' — ' : '') + 'фото: ' + (ph.author || 'автор не указан') + ', ' + (ph.license || '') + ' ',
        ph.source_url ? link(ph.source_url, 'источник') : null));
    });
    const src = (p.sources || []).map(function (s) { return el('li', {}, link(s, hostOf(s))); });
    if (!items.length && !src.length) return null;
    const d = el('details', { class: 'card credits' }, el('summary', { text: 'Источники и лицензии фото' }),
      src.length ? el('h3', { text: 'Источники текста' }) : null, src.length ? el('ul', {}, src) : null,
      items.length ? el('h3', { text: 'Фотографии' }) : null, items.length ? el('ul', {}, items) : null,
      el('p', { class: 'muted small', text: 'Тексты пересказаны своими словами по открытым источникам. Фото — Wikimedia Commons, с указанием авторов и лицензий.' }));
    return d;
  }

  /* ---------- карточка онлайн-находки ---------- */
  C.online = async function (pageid) {
    cleanup();
    const rec = await KG.online.get(pageid);
    if (!rec) { U.openSheet('Не найдено', U.empty('Эта находка недоступна. Возможно, она была удалена из кэша.', el('a', { class: 'btn primary', href: '#/nearby', text: 'Назад' }))); return; }
    U.cardKey = 'w' + rec.pageid;
    U.onClose = cleanup;
    let thumbSrc = rec.thumb;
    if (rec.thumbBlob) { try { thumbSrc = URL.createObjectURL(rec.thumbBlob); } catch (e) { /* ignore */ } }
    const track = KG.guide.trackForOnline(rec);
    const saveBtn = el('button', { class: 'btn ghost wide', type: 'button' });
    const paintSave = function () { KG.clear(saveBtn); saveBtn.appendChild(KG.icon('save')); saveBtn.appendChild(el('span', { text: rec.saved ? 'Сохранено для офлайна — убрать' : 'Сохранить для офлайна' })); };
    paintSave();
    saveBtn.addEventListener('click', async function () {
      if (rec.saved) await KG.online.unsave(rec); else await KG.online.save(rec);
      paintSave(); KG.toast(rec.saved ? 'Сохранено: текст и миниатюра останутся без сети' : 'Убрано из сохранённых');
    });
    const dist = el('span', { class: 'pill dist' });
    const updDist = function () { const f = KG.guide.pos; dist.hidden = !f; if (f) dist.textContent = KG.fmtDist(KG.geo.dist(f, rec)) + ' от вас'; };
    updDist(); sub('fix', updDist);
    const photosBox = el('section', { class: 'card', hidden: true }, el('h2', { text: 'Фото рядом (Wikimedia Commons)' }));
    const body = el('div', { class: 'card-page' },
      thumbSrc ? el('div', { class: 'gal' }, el('div', { class: 'gal-stage' }, el('figure', { class: 'gal-slide one' }, imgEl({ url: thumbSrc, caption: rec.title }, true))),
        el('div', { class: 'gal-cap', text: 'Миниатюра статьи Википедии (лицензия — на странице файла в статье).' })) : null,
      el('div', { class: 'card-head' }, el('h1', { text: rec.title }),
        el('div', { class: 'pills' }, el('span', { class: 'pill' }, KG.icon('wiki'), 'Википедия'), dist, rec.fromCache ? el('span', { class: 'pill', text: 'из кэша' }) : null)),
      playerBox(track, false),
      el('section', { class: 'story' }, rec.extract ? paras(rec.extract) : el('p', { class: 'muted', text: 'Краткого текста у статьи нет — откройте её в Википедии.' })),
      saveBtn,
      el('section', { class: 'card' }, el('p', {}, link(KG.online.articleUrl(rec), 'Читать статью в Википедии'), ' ', KG.icon('ext')),
        el('p', { class: 'muted small', text: 'Текст: Википедия, свободная энциклопедия, лицензия CC BY-SA 4.0. Показан без изменений (краткое вступление).' })),
      navLinks(rec.lat, rec.lon, rec.title),
      photosBox);
    U.openSheet(rec.title, body);
    if (navigator.onLine) {
      try {
        const ph = await KG.online.commonsPhotos(rec);
        if (ph.length && U.cardKey === 'w' + rec.pageid) {
          photosBox.hidden = false;
          ph.forEach(function (x) {
            const fig = el('figure', { class: 'cf' }, imgEl({ url: x.url, caption: x.title }, false),
              el('figcaption', {}, x.title + ' — ' + x.author + ', ' + x.license + ' ', link(x.source_url, 'источник')));
            fig.firstChild.addEventListener('click', function () { openLightbox({ url: x.url, caption: x.title, author: x.author, license: x.license }); });
            photosBox.appendChild(fig);
          });
        }
      } catch (e) { KG.log('warn', 'commons: ' + e.message); }
    }
  };

  C.cleanup = cleanup;
})();
