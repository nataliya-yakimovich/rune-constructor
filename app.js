(() => {
  'use strict';

  // ---------- Настройки ----------

  const STORAGE_KEY = 'rune-constructor:v1';
  // 100 шагов: снимок состояния — это небольшой JSON (~100 байт на руну),
  // так что даже при 50 рунах история занимает ~0.5 МБ из ~5 МБ localStorage.
  const HISTORY_LIMIT = 100;
  const BASE = 1000; // длинная сторона листа во внутренних единицах
  const RATIOS = ['3:4', '2:3', '9:16', '1:1', '4:3', '3:2', '16:9'];
  const DEFAULT_BG = '#ffffff';
  const DEFAULT_RATIO = '3:4';
  const DEFAULT_COLOR = '#000000';
  const DEFAULT_STROKE = 1.7;
  const BG_SWATCHES = ['#ffffff', '#f4ecd8', '#e6dfd1', '#c9d6df', '#2b2b2b', '#000000'];
  const RUNE_SWATCHES = ['#000000', '#8b1e1e', '#b8860b', '#1f4e79', '#2e6b3a', '#ffffff'];
  const MIN_SIZE = 0.04;
  const MAX_SIZE = 1.5;
  const MIN_STROKE = 0.3;
  const MAX_STROKE = 5;
  const EXPORT_LONG_SIDE = 2400; // px
  const HEX = /^#[0-9a-f]{6}$/i;

  const $ = (sel) => document.querySelector(sel);
  const els = {
    stage: $('#stage'),
    stageWrap: $('#stage-wrap'),
    bg: $('#stage-bg'),
    layer: $('#rune-layer'),
    overlay: $('#overlay'),
    menu: $('#menu'),
    menuBtn: $('#menu-btn'),
    menuClose: $('#menu-close'),
    backdrop: $('#backdrop'),
    undo: $('#undo-btn'),
    redo: $('#redo-btn'),
    exportBtn: $('#export-btn'),
    clearBtn: $('#clear-btn'),
    bgSwatches: $('#bg-swatches'),
    bgColor: $('#bg-color'),
    ratios: $('#ratios'),
    runeList: $('#rune-list'),
    toolbar: $('#toolbar'),
    tbColor: $('#tb-color'),
    tbSwatches: $('#tb-swatches'),
    tbWidth: $('#tb-width'),
    tbSize: $('#tb-size'),
    tbDup: $('#tb-dup'),
    tbDelete: $('#tb-delete'),
  };

  // ---------- Состояние ----------

  /** @type {{bg: string, ratio: string, runes: Array<{id: string, rune: string, x: number, y: number, s: number, w: number, color: string}>}} */
  let state = defaultState();
  let past = [];    // JSON-снимки для «Отменить»
  let future = [];  // JSON-снимки для «Вернуть»
  let selectedId = null;
  let drag = null;
  let pending = null; // снимок до начала «живого» изменения (слайдер, пипетка)
  let lastColor = DEFAULT_COLOR;

  const library = new Map(); // id -> {id, name, vb, inner, stroke}
  const isCoarse = matchMedia('(pointer: coarse)').matches;

  function defaultState() {
    return { bg: DEFAULT_BG, ratio: DEFAULT_RATIO, runes: [] };
  }

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function num(v, fallback, min, max) {
    return typeof v === 'number' && isFinite(v) ? clamp(v, min, max) : fallback;
  }

  function sanitizeState(s) {
    if (!s || typeof s !== 'object') return null;
    const out = {
      bg: HEX.test(s.bg) ? s.bg : DEFAULT_BG,
      ratio: RATIOS.includes(s.ratio) ? s.ratio : DEFAULT_RATIO,
      runes: [],
    };
    if (Array.isArray(s.runes)) {
      for (const r of s.runes) {
        if (!r || typeof r.id !== 'string' || typeof r.rune !== 'string') continue;
        out.runes.push({
          id: r.id.replace(/[^\w-]/g, ''),
          rune: r.rune,
          x: num(r.x, 0.5, 0, 1),
          y: num(r.y, 0.5, 0, 1),
          s: num(r.s, 0.3, MIN_SIZE, MAX_SIZE),
          w: num(r.w, DEFAULT_STROKE, MIN_STROKE, MAX_STROKE),
          color: HEX.test(r.color) ? r.color : DEFAULT_COLOR,
        });
      }
    }
    return out;
  }

  function snapshot() {
    return JSON.stringify(state);
  }

  function uid() {
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- Хранилище ----------

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!data) return;
      state = sanitizeState(data.state) || defaultState();
      const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
      past = strings(data.past).slice(-HISTORY_LIMIT);
      future = strings(data.future).slice(-HISTORY_LIMIT);
    } catch (e) {
      console.warn('Не удалось прочитать сохранение', e);
    }
  }

  function save() {
    const write = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, past, future }));
    try {
      write();
    } catch (e) {
      // Переполнение хранилища: жертвуем самой старой историей
      while (past.length) {
        past.splice(0, Math.ceil(past.length / 4));
        try { write(); return; } catch (_) { /* пробуем дальше */ }
      }
      future = [];
      try { write(); } catch (_) { console.warn('Не удалось сохранить', e); }
    }
  }

  // ---------- История ----------

  function finishChange(before) {
    if (before === snapshot()) return;
    past.push(before);
    if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
    future = [];
    save();
  }

  function commit(mutate) {
    liveEnd();
    const before = snapshot();
    mutate();
    finishChange(before);
    render();
  }

  // «Живое» изменение: перерисовываем сразу, а в историю пишем один шаг по окончании
  function live(mutate) {
    if (pending === null) pending = snapshot();
    mutate();
    render();
  }

  function liveEnd() {
    if (pending === null) return;
    const before = pending;
    pending = null;
    finishChange(before);
    updateUI();
  }

  function restore(json) {
    state = sanitizeState(JSON.parse(json)) || defaultState();
    if (!findRune(selectedId)) selectedId = null;
  }

  function undo() {
    liveEnd();
    if (!past.length) return;
    future.push(snapshot());
    restore(past.pop());
    save();
    render();
  }

  function redo() {
    liveEnd();
    if (!future.length) return;
    past.push(snapshot());
    restore(future.pop());
    save();
    render();
  }

  // ---------- Геометрия ----------

  function stageSize(ratio = state.ratio) {
    const [a, b] = ratio.split(':').map(Number);
    return a >= b ? { W: BASE, H: (BASE * b) / a } : { W: (BASE * a) / b, H: BASE };
  }

  function findRune(id) {
    return id ? state.runes.find((r) => r.id === id) : undefined;
  }

  // Позиция руны хранится в долях листа (x, y — центр), размер — доля от короткой стороны,
  // поэтому при смене соотношения сторон руны остаются на своих местах.
  function geom(r) {
    const { W, H } = stageSize();
    const vb = library.get(r.rune).vb;
    const h = r.s * Math.min(W, H);
    const w = (h * vb[2]) / vb[3];
    const cx = r.x * W;
    const cy = r.y * H;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, vb };
  }

  function unitsPerPx() {
    const rect = els.stage.getBoundingClientRect();
    return rect.width ? stageSize().W / rect.width : 1;
  }

  function toStage(e) {
    const pt = els.stage.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(els.stage.getScreenCTM().inverse());
  }

  const f = (n) => Math.round(n * 100) / 100;

  function runeMarkup(r) {
    const g = geom(r);
    return (
      `<svg x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" viewBox="${g.vb.join(' ')}" ` +
      `overflow="visible" fill="none" color="${r.color}" stroke="${r.color}" stroke-width="${r.w}" ` +
      `stroke-linecap="round" stroke-linejoin="round">${library.get(r.rune).inner}</svg>`
    );
  }

  // ---------- Отрисовка ----------

  function render() {
    const { W, H } = stageSize();
    els.stage.setAttribute('viewBox', `0 0 ${W} ${H}`);
    els.bg.setAttribute('width', W);
    els.bg.setAttribute('height', H);
    els.bg.setAttribute('fill', state.bg);

    els.layer.innerHTML = state.runes
      .filter((r) => library.has(r.rune))
      .map((r) => {
        const g = geom(r);
        return (
          `<g class="rune" data-id="${r.id}">` +
          `<rect x="${f(g.x)}" y="${f(g.y)}" width="${f(g.w)}" height="${f(g.h)}" fill="none" pointer-events="all"/>` +
          runeMarkup(r) +
          '</g>'
        );
      })
      .join('');

    fitStage();
    renderOverlay();
    updateUI();
  }

  function renderOverlay() {
    const r = findRune(selectedId);
    if (!r || !library.has(r.rune)) {
      els.overlay.innerHTML = '';
      return;
    }
    const g = geom(r);
    const k = unitsPerPx();
    const pad = 6 * k;
    const hr = (isCoarse ? 13 : 8) * k;
    els.overlay.innerHTML =
      `<rect class="sel-box" x="${g.x - pad}" y="${g.y - pad}" width="${g.w + pad * 2}" height="${g.h + pad * 2}" ` +
      `stroke-width="${1.5 * k}" stroke-dasharray="${6 * k} ${4 * k}"/>` +
      `<circle class="sel-handle" data-handle="1" cx="${g.x + g.w + pad}" cy="${g.y + g.h + pad}" r="${hr}" stroke-width="${2 * k}"/>`;
  }

  function fitStage() {
    const { W, H } = stageSize();
    const pad = 16;
    const aw = els.stageWrap.clientWidth - pad * 2;
    const ah = els.stageWrap.clientHeight - pad * 2;
    const scale = Math.max(0, Math.min(aw / W, ah / H));
    els.stage.style.width = W * scale + 'px';
    els.stage.style.height = H * scale + 'px';
  }

  function updateUI() {
    els.undo.disabled = !past.length;
    els.redo.disabled = !future.length;

    els.bgColor.value = state.bg;
    markActive(els.bgSwatches, state.bg);
    for (const b of els.ratios.children) b.classList.toggle('is-active', b.dataset.ratio === state.ratio);

    const r = findRune(selectedId);
    els.toolbar.classList.toggle('is-disabled', !r);
    if (r) {
      els.tbColor.value = r.color;
      els.tbWidth.value = r.w;
      els.tbSize.value = r.s;
      markActive(els.tbSwatches, r.color);
    } else {
      markActive(els.tbSwatches, null);
    }
  }

  function markActive(container, color) {
    for (const b of container.children) {
      b.classList.toggle('is-active', !!color && b.dataset.color.toLowerCase() === color.toLowerCase());
    }
  }

  function select(id) {
    selectedId = id;
    const r = findRune(id);
    if (r) lastColor = r.color;
    renderOverlay();
    updateUI();
  }

  // ---------- Руны: загрузка ----------

  function parseRune(item, text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (svg.nodeName !== 'svg' || doc.querySelector('parsererror')) throw new Error('bad svg');
    svg.querySelectorAll('script, foreignObject').forEach((n) => n.remove());
    const vb = (svg.getAttribute('viewBox') || `0 0 ${svg.getAttribute('width') || 24} ${svg.getAttribute('height') || 24}`)
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (vb.length !== 4 || vb.some((n) => !isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) throw new Error('bad viewBox');
    const inner = new XMLSerializer().serializeToString(svg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
    return {
      id: String(item.id),
      name: String(item.name || item.id),
      vb,
      inner,
      stroke: num(parseFloat(svg.getAttribute('stroke-width')), DEFAULT_STROKE, MIN_STROKE, MAX_STROKE),
    };
  }

  async function loadRunes() {
    try {
      const res = await fetch('runes/runes.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      const list = await res.json();
      const loaded = await Promise.all(
        list.map(async (item) => {
          try {
            const r = await fetch('runes/' + item.file, { cache: 'no-cache' });
            if (!r.ok) throw new Error(r.status);
            return parseRune(item, await r.text());
          } catch (e) {
            console.warn('Руна не загрузилась:', item.file, e);
            return null;
          }
        })
      );
      for (const r of loaded) if (r) library.set(r.id, r);
      buildRuneList();
      render();
    } catch (e) {
      console.error(e);
      els.runeList.innerHTML =
        '<li class="msg">Не удалось загрузить список рун. Если вы открыли файл напрямую с диска — запустите локальный веб-сервер (см. README).</li>';
    }
  }

  function buildRuneList() {
    els.runeList.innerHTML = '';
    if (!library.size) {
      els.runeList.innerHTML = '<li class="msg">Руны пока не добавлены.</li>';
      return;
    }
    for (const rune of library.values()) {
      const li = document.createElement('li');
      li.className = 'rune-item';

      const thumb = document.createElement('div');
      thumb.className = 'rune-thumb';
      thumb.innerHTML =
        `<svg viewBox="${rune.vb.join(' ')}" fill="none" stroke="currentColor" stroke-width="${rune.stroke}" ` +
        `stroke-linecap="round" stroke-linejoin="round" overflow="visible">${rune.inner}</svg>`;

      const name = document.createElement('span');
      name.className = 'rune-name';
      name.textContent = rune.name;

      const add = document.createElement('button');
      add.className = 'btn';
      add.textContent = 'Добавить';
      add.addEventListener('click', () => addRune(rune.id));

      li.append(thumb, name, add);
      els.runeList.append(li);
    }
  }

  // ---------- Действия ----------

  function addRune(runeId) {
    const rune = library.get(runeId);
    if (!rune) return;
    const off = ((state.runes.length % 5) - 2) * 0.04; // чтобы новые руны не ложились точно друг на друга
    const r = { id: uid(), rune: runeId, x: 0.5 + off, y: 0.5 + off, s: 0.3, w: rune.stroke, color: lastColor };
    commit(() => state.runes.push(r));
    select(r.id);
    if (matchMedia('(max-width: 720px)').matches) closeMenu();
  }

  function deleteSelected() {
    if (!findRune(selectedId)) return;
    const id = selectedId;
    selectedId = null;
    commit(() => (state.runes = state.runes.filter((r) => r.id !== id)));
  }

  function duplicateSelected() {
    const src = findRune(selectedId);
    if (!src) return;
    const copy = { ...src, id: uid(), x: clamp(src.x + 0.04, 0, 1), y: clamp(src.y + 0.04, 0, 1) };
    commit(() => state.runes.push(copy));
    select(copy.id);
  }

  function clearSheet() {
    if (!confirm('Очистить лист? Все руны будут удалены, фон станет белым.\nДействие можно отменить кнопкой «Отменить».')) return;
    selectedId = null;
    commit(() => {
      state.runes = [];
      state.bg = DEFAULT_BG;
    });
    closeMenu();
  }

  async function exportPNG() {
    liveEnd();
    const { W, H } = stageSize();
    const scale = EXPORT_LONG_SIDE / Math.max(W, H);
    const cw = Math.round(W * scale);
    const ch = Math.round(H * scale);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}" viewBox="0 0 ${W} ${H}">` +
      `<rect width="${W}" height="${H}" fill="${state.bg}"/>` +
      state.runes.filter((r) => library.has(r.rune)).map(runeMarkup).join('') +
      '</svg>';

    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    try {
      await img.decode();
    } catch (e) {
      alert('Не удалось подготовить изображение.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
    canvas.toBlob((blob) => {
      if (!blob) return alert('Не удалось сохранить PNG.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      a.download = `runes-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
      a.href = url;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  // ---------- Меню ----------

  function openMenu() {
    document.body.classList.add('menu-open');
    els.menu.setAttribute('aria-hidden', 'false');
    els.menuBtn.setAttribute('aria-expanded', 'true');
  }

  function closeMenu() {
    document.body.classList.remove('menu-open');
    els.menu.setAttribute('aria-hidden', 'true');
    els.menuBtn.setAttribute('aria-expanded', 'false');
  }

  function makeSwatches(container, colors, onPick) {
    for (const c of colors) {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c;
      b.dataset.color = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => onPick(c));
      container.append(b);
    }
  }

  function buildRatios() {
    for (const ratio of RATIOS) {
      const [a, b] = ratio.split(':').map(Number);
      const k = 22 / Math.max(a, b);
      const btn = document.createElement('button');
      btn.className = 'ratio';
      btn.dataset.ratio = ratio;
      btn.innerHTML = `<i style="width:${a * k}px;height:${b * k}px"></i><span>${a}×${b}</span>`;
      btn.addEventListener('click', () => commit(() => (state.ratio = ratio)));
      els.ratios.append(btn);
    }
  }

  // ---------- Перетаскивание и масштаб ----------

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    liveEnd();
    const p = toStage(e);
    const selected = findRune(selectedId);
    const runeEl = e.target.closest('.rune');

    if (e.target.closest('[data-handle]') && selected) {
      const g = geom(selected);
      drag = {
        mode: 'resize',
        id: selected.id,
        before: snapshot(),
        cx: g.cx,
        cy: g.cy,
        startDist: Math.max(1, Math.hypot(p.x - g.cx, p.y - g.cy)),
        startS: selected.s,
      };
    } else if (runeEl) {
      const id = runeEl.dataset.id;
      select(id);
      const g = geom(findRune(id));
      drag = { mode: 'move', id, before: snapshot(), dx: p.x - g.cx, dy: p.y - g.cy };
    } else {
      select(null);
      return;
    }
    els.stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    const r = findRune(drag.id);
    if (!r) return;
    const p = toStage(e);
    if (drag.mode === 'move') {
      const { W, H } = stageSize();
      r.x = clamp((p.x - drag.dx) / W, 0, 1);
      r.y = clamp((p.y - drag.dy) / H, 0, 1);
    } else {
      const dist = Math.hypot(p.x - drag.cx, p.y - drag.cy);
      r.s = clamp((drag.startS * dist) / drag.startDist, MIN_SIZE, MAX_SIZE);
    }
    render();
  }

  function onPointerUp() {
    if (!drag) return;
    finishChange(drag.before);
    drag = null;
    updateUI();
  }

  // ---------- Привязка событий ----------

  function bind() {
    els.menuBtn.addEventListener('click', () =>
      document.body.classList.contains('menu-open') ? closeMenu() : openMenu()
    );
    els.menuClose.addEventListener('click', closeMenu);
    els.backdrop.addEventListener('click', closeMenu);
    els.undo.addEventListener('click', undo);
    els.redo.addEventListener('click', redo);
    els.exportBtn.addEventListener('click', exportPNG);
    els.clearBtn.addEventListener('click', clearSheet);

    makeSwatches(els.bgSwatches, BG_SWATCHES, (c) => commit(() => (state.bg = c)));
    els.bgColor.addEventListener('input', () => live(() => (state.bg = els.bgColor.value)));
    els.bgColor.addEventListener('change', liveEnd);

    const editSelected = (fn) => {
      const r = findRune(selectedId);
      if (r) live(() => fn(r));
    };
    makeSwatches(els.tbSwatches, RUNE_SWATCHES, (c) => {
      const r = findRune(selectedId);
      if (!r) return;
      lastColor = c;
      commit(() => (r.color = c));
    });
    els.tbColor.addEventListener('input', () =>
      editSelected((r) => (r.color = lastColor = els.tbColor.value))
    );
    els.tbWidth.addEventListener('input', () =>
      editSelected((r) => (r.w = clamp(parseFloat(els.tbWidth.value), MIN_STROKE, MAX_STROKE)))
    );
    els.tbSize.addEventListener('input', () =>
      editSelected((r) => (r.s = clamp(parseFloat(els.tbSize.value), MIN_SIZE, MAX_SIZE)))
    );
    for (const input of [els.tbColor, els.tbWidth, els.tbSize]) input.addEventListener('change', liveEnd);
    els.tbDup.addEventListener('click', duplicateSelected);
    els.tbDelete.addEventListener('click', deleteSelected);

    els.stage.addEventListener('pointerdown', onPointerDown);
    els.stage.addEventListener('pointermove', onPointerMove);
    els.stage.addEventListener('pointerup', onPointerUp);
    els.stage.addEventListener('pointercancel', onPointerUp);
    // Клик по пустому месту вокруг листа снимает выделение
    els.stageWrap.addEventListener('pointerdown', (e) => {
      if (e.target === els.stageWrap) select(null);
    });

    document.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && (key === 'z' || key === 'я')) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && (key === 'y' || key === 'н')) {
        e.preventDefault();
        redo();
        return;
      }
      if (e.target.closest('input, textarea')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        document.body.classList.contains('menu-open') ? closeMenu() : select(null);
      }
    });

    new ResizeObserver(() => {
      fitStage();
      renderOverlay();
    }).observe(els.stageWrap);

    // Сохраняем на всякий случай при уходе со страницы (например, если пипетка не прислала change)
    window.addEventListener('pagehide', () => {
      liveEnd();
      save();
    });
  }

  // ---------- Старт ----------

  load();
  buildRatios();
  bind();
  render();
  loadRunes();
})();
