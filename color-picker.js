// Собственный выбор цвета: на мобильных браузерах <input type="color"> сначала
// показывает короткую палитру, и до полного редактора нужно нажимать второй раз.
window.ColorPicker = (() => {
  'use strict';

  let root, sv, svThumb, hue, hueThumb, preview, hexInput;
  let hsv = { h: 0, s: 0, v: 0 };
  let current = null; // { anchor, onInput, onDone }

  const clamp01 = (n) => Math.min(1, Math.max(0, n));

  function hsvToHex({ h, s, v }) {
    const f = (n) => {
      const k = (n + h / 60) % 6;
      const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
      return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return '#' + f(5) + f(3) + f(1);
  }

  function hexToHsv(hex, fallbackHue = 0) {
    const n = parseInt(hex.slice(1), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = fallbackHue;
    if (d) {
      if (max === r) h = 60 * (((g - b) / d + 6) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function normalizeHex(text) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
    if (!m) return null;
    const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return '#' + x.toLowerCase();
  }

  function build() {
    root = document.createElement('div');
    root.className = 'cp';
    root.hidden = true;
    root.innerHTML =
      '<div class="cp-sv"><div class="cp-thumb cp-sv-thumb"></div></div>' +
      '<div class="cp-hue"><div class="cp-thumb cp-hue-thumb"></div></div>' +
      '<div class="cp-row">' +
      '<span class="cp-preview"></span>' +
      '<input class="cp-hex" maxlength="7" spellcheck="false" autocomplete="off" aria-label="Код цвета">' +
      '<button type="button" class="btn primary cp-done">Готово</button>' +
      '</div>';
    document.body.append(root);

    sv = root.querySelector('.cp-sv');
    svThumb = root.querySelector('.cp-sv-thumb');
    hue = root.querySelector('.cp-hue');
    hueThumb = root.querySelector('.cp-hue-thumb');
    preview = root.querySelector('.cp-preview');
    hexInput = root.querySelector('.cp-hex');

    track(sv, (x, y) => {
      hsv.s = x;
      hsv.v = 1 - y;
      update(true);
    });
    track(hue, (x) => {
      hsv.h = x * 360;
      update(true);
    });
    hexInput.addEventListener('input', () => {
      const hex = normalizeHex(hexInput.value);
      if (!hex) return;
      hsv = hexToHsv(hex, hsv.h);
      update(true, false);
    });
    hexInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close();
    });
    root.querySelector('.cp-done').addEventListener('click', close);

    // Нажатие мимо окна закрывает его (в фазе перехвата — раньше остальных обработчиков)
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (current && !root.contains(e.target) && !current.anchor.contains(e.target)) close();
      },
      true
    );
    document.addEventListener(
      'keydown',
      (e) => {
        if (current && e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      },
      true
    );
    window.addEventListener('resize', () => current && position());
  }

  function track(el, onMove) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) { /* без захвата тоже работает, пока палец над элементом */ }
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        onMove(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      move(e);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  function update(emit, syncHex = true) {
    const hex = hsvToHex(hsv);
    sv.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    svThumb.style.left = hsv.s * 100 + '%';
    svThumb.style.top = (1 - hsv.v) * 100 + '%';
    svThumb.style.backgroundColor = hex;
    hueThumb.style.left = (hsv.h / 360) * 100 + '%';
    hueThumb.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
    preview.style.backgroundColor = hex;
    if (syncHex) hexInput.value = hex;
    if (emit && current) current.onInput(hex);
  }

  function position() {
    const sheet = innerWidth < 600;
    root.classList.toggle('cp-sheet', sheet);
    if (sheet) {
      root.style.left = root.style.top = '';
      return;
    }
    const a = current.anchor.getBoundingClientRect();
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const left = Math.min(Math.max(8, a.left), innerWidth - w - 8);
    const below = a.bottom + 8;
    const top = below + h <= innerHeight - 8 ? below : Math.max(8, a.top - h - 8);
    root.style.left = left + 'px';
    root.style.top = top + 'px';
  }

  function open(anchor, hex, { onInput, onDone }) {
    if (!root) build();
    close();
    current = { anchor, onInput, onDone };
    hsv = hexToHsv(normalizeHex(hex) || '#000000');
    root.hidden = false;
    update(false);
    position();
  }

  function close() {
    if (!current) return;
    const c = current;
    current = null;
    root.hidden = true;
    if (c.onDone) c.onDone();
  }

  function toggle(anchor, hex, handlers) {
    if (current && current.anchor === anchor) close();
    else open(anchor, hex, handlers);
  }

  return { open, close, toggle };
})();
