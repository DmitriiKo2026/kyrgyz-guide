/* Экран «Каталог». */
(function () {
  'use strict';
  const KG = window.KG, el = KG.el, U = KG.ui;
  const V = (KG.views.catalog = {});
  const st = { q: '', region: '', cat: '', audio: false, hist: false, done: false };
  let root, chipsEl, listEl, countEl, input, catSel, active = false, deb = 0;

  V.init = function (r) {
    root = r;
    input = el('input', { type: 'search', class: 'search', placeholder: 'Поиск по названию', 'aria-label': 'Поиск по названию', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'search',
      oninput: function () { clearTimeout(deb); deb = setTimeout(function () { st.q = input.value; render(); }, 120); } });
    chipsEl = el('div', { class: 'chips' });
    catSel = el('select', { class: 'select', 'aria-label': 'Категория', onchange: function () { st.cat = catSel.value; render(); } });
    countEl = el('div', { class: 'muted small count' });
    listEl = el('div', { class: 'list' });
    root.appendChild(el('div', { class: 'cat-head' }, el('div', { class: 'search-wrap' }, KG.icon('search'), input), chipsEl,
      el('div', { class: 'filters' }, catSel, toggle('audio', 'Только с озвучкой'), toggle('hist', 'С историческими фото'), toggle('done', 'Не слышал(а)')),
      countEl));
    root.appendChild(listEl);
    KG.on('data', function () { buildFilters(); if (active) render(); });
    KG.on('history', function () { if (active && st.done) render(); });
    KG.on('nearby', function () { if (active && !V.pending) { V.pending = true; setTimeout(function () { V.pending = false; if (active) updateDist(); }, 2500); } });
    buildFilters();
  };

  function toggle(key, label) {
    const b = el('button', { class: 'chip' + (st[key] ? ' on' : ''), type: 'button', text: label, 'aria-pressed': String(!!st[key]),
      onclick: function () { st[key] = !st[key]; b.classList.toggle('on', st[key]); b.setAttribute('aria-pressed', String(st[key])); render(); } });
    return b;
  }

  function buildFilters() {
    KG.clear(chipsEl);
    const mk = function (id, label) {
      return el('button', { class: 'chip' + (st.region === id ? ' on' : ''), type: 'button', text: label, dataset: { r: id },
        onclick: function () { st.region = id; KG.$$('.chip', chipsEl).forEach(function (c) { c.classList.toggle('on', c.dataset.r === id); }); render(); } });
    };
    chipsEl.appendChild(mk('', 'Все'));
    KG.data.regionIds().forEach(function (r) { chipsEl.appendChild(mk(r, KG.data.regionTitle(r))); });
    KG.clear(catSel);
    catSel.appendChild(el('option', { value: '', text: 'Все категории' }));
    const present = new Set(KG.data.pois.map(function (p) { return p.category; }));
    KG.data.categories().filter(function (c) { return present.has(c); }).forEach(function (c) { catSel.appendChild(el('option', { value: c, text: KG.data.catLabel(c) })); });
    catSel.value = st.cat;
  }

  /* Поиск: ё=е, без пробелов/дефисов («сон куль» = «Сон-Куль»), частые разночтения написания («Сулейман-Тоо» = «Сулайман-Тоо»). */
  const ALIAS = [['ысык', 'иссык'], ['сулейман', 'сулайман'], ['сулаймон', 'сулайман']];
  function alias(t) { ALIAS.forEach(function (a) { t = t.split(a[0]).join(a[1]); }); return t; }
  function sq(s) { return alias(KG.norm(s).replace(/[^a-zа-я0-9]+/g, '')); }
  const nameWords = function (p) { return alias(KG.norm((p.name.ru || '') + ' ' + (p.name.ky || ''))).split(/[^a-zа-я0-9]+/).filter(Boolean); };

  /* 0 — слово в названии начинается с запроса, 1 — запрос внутри названия, 2 — только в описании, -1 — не совпало */
  function textScore(p, q) {
    if (!q) return 0;
    const qs = sq(q);
    if (!qs) return 0;
    const qw = alias(KG.norm(q)).split(/[^a-zа-я0-9]+/).filter(Boolean);
    const words = nameWords(p);
    if (qw.length && qw.every(function (w) { return words.some(function (x) { return x.indexOf(w) === 0; }); })) return 0;
    if (sq((p.name.ru || '') + ' ' + (p.name.ky || '')).indexOf(qs) >= 0) return 1;
    const hay = [p.summary, p.era, KG.data.catLabel(p.category)].join(' ');
    return KG.norm(hay).indexOf(KG.norm(q)) >= 0 || sq(hay).indexOf(qs) >= 0 ? 2 : -1;
  }

  function matches(p) {
    if (st.region && p.region !== st.region) return false;
    if (st.cat && p.category !== st.cat) return false;
    if (st.audio && !p.audio) return false;
    if (st.hist && !KG.data.hasHistoric(p)) return false;
    if (st.done && KG.guide.isDone(p.id)) return false;
    if (st.q.trim() && textScore(p, st.q.trim()) < 0) return false;
    return true;
  }

  function distOf(p) { const f = KG.guide.pos; return f && KG.gps.state !== 'off' ? KG.geo.dist(f, p) : null; }

  function render() {
    KG.clear(listEl);
    const items = KG.data.pois.filter(matches);
    countEl.textContent = items.length ? 'Найдено мест: ' + items.length : '';
    if (!items.length) { listEl.appendChild(U.empty(KG.data.pois.length ? 'Ничего не найдено. Попробуйте изменить поиск или фильтры.' : 'Список мест пока пуст.')); return; }
    const q = st.q.trim();
    const byPrio = function (a, b) { return (a.priority - b.priority) || KG.data.name(a).localeCompare(KG.data.name(b), 'ru'); };
    if (q) {
      const sc = {};
      items.forEach(function (p) { sc[p.id] = textScore(p, q); });
      items.sort(function (a, b) { return (sc[a.id] - sc[b.id]) || byPrio(a, b); }).forEach(function (p) { listEl.appendChild(U.row(p, { dist: distOf(p), rel: null })); });
      return;
    }
    KG.data.regionIds().forEach(function (r) {
      const part = items.filter(function (p) { return p.region === r; }).sort(byPrio);
      if (!part.length) return;
      listEl.appendChild(el('h3', { class: 'group', text: KG.data.regionTitle(r) + ' · ' + part.length }));
      part.forEach(function (p) { listEl.appendChild(U.row(p, { dist: distOf(p), rel: null })); });
    });
  }

  function updateDist() {
    KG.$$('.row', listEl).forEach(function (a) { if (a._p) U.updateRow(a, { dist: distOf(a._p), rel: null }); });
  }

  V.show = function () { active = true; render(); };
  V.hide = function () { active = false; };
})();
