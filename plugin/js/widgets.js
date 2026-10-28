/* RR FX — briques d'interface : composants façon Spectrum (comme Rotate), valeurs
   « hot text » et éditeurs de courbes façon Options d'effet de Premiere. */
(function (root) {
  'use strict';
  const Core = root.RRFXCore;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    kids.flat(Infinity).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return el;
  }

  // Premiere's blue "hot text": drag sideways to scrub, click to type.
  function hotText(o) {
    const fmt = v => {
      const d = o.step < 1 ? (String(o.step).split('.')[1] || '').length : 0;
      return Number(v).toFixed(d);
    };
    const val = h('span', { class: 'hot', tabindex: '0', title: 'Glisser pour régler · Maj = ×10 · clic pour saisir' }, fmt(o.value));
    const wrap = h('span', { class: 'hot-wrap' }, val, o.unit ? h('span', { class: 'unit' }, o.unit) : null);
    let value = o.value;
    const set = (v, final) => {
      v = Core.clamp(Math.round(v / o.step) * o.step, o.min, o.max);
      if (v === value && !final) return;
      value = v;
      val.textContent = fmt(v);
      o.onChange(v, !!final);
    };
    val.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, v0 = value;
      let moved = false;
      val.setPointerCapture(e.pointerId);
      const move = ev => {
        const dx = ev.clientX - x0;
        if (Math.abs(dx) > 2) moved = true;
        if (!moved) return;
        const mult = ev.shiftKey ? 10 : (ev.altKey ? 0.2 : 1);
        set(v0 + Math.round(dx / 2) * o.step * mult);
        document.body.classList.add('scrubbing');
      };
      const up = () => {
        val.removeEventListener('pointermove', move);
        val.removeEventListener('pointerup', up);
        document.body.classList.remove('scrubbing');
        if (moved) o.onChange(value, true);
        else edit();
      };
      val.addEventListener('pointermove', move);
      val.addEventListener('pointerup', up);
    });
    val.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { set(value + o.step * (e.shiftKey ? 10 : 1), true); e.preventDefault(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { set(value - o.step * (e.shiftKey ? 10 : 1), true); e.preventDefault(); }
      if (e.key === 'Enter') edit();
    });
    function edit() {
      const input = h('input', { class: 'hot-input', value: fmt(value) });
      val.replaceWith(input);
      input.focus();
      input.select();
      const done = commit => {
        if (!input.isConnected) return;
        input.replaceWith(val);
        const n = parseFloat(String(input.value).replace(',', '.'));
        if (commit && isFinite(n)) set(n, true);
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
    }
    wrap.setValue = v => { value = v; val.textContent = fmt(v); };
    return wrap;
  }

  // Rangée de sp-action-button dont un seul est sélectionné.
  function actionGroup(options, value, onChange, opts) {
    opts = opts || {};
    const el = h('div', { class: 'action-group' });
    options.forEach(op => {
      const b = h('button', { class: 'action' + (op.v === value ? ' selected' : '') + (op.cls ? ' ' + op.cls : ''), disabled: opts.disabled || op.disabled, title: op.title }, op.label);
      b.addEventListener('click', () => {
        el.querySelectorAll('.action').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        onChange(op.v);
      });
      el.appendChild(b);
    });
    return el;
  }

  // sp-picker
  function picker(options, value, onChange) {
    const s = h('select', null, options.map(op => h('option', { value: op.v, selected: op.v === value }, op.label)));
    s.addEventListener('change', () => onChange(s.value));
    const wrap = h('div', { class: 'picker' }, s);
    wrap.setValue = v => { s.value = v; };
    return wrap;
  }

  // sp-checkbox
  function checkbox(label, value, onChange) {
    const input = h('input', { type: 'checkbox', checked: !!value });
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'checkbox' }, input, h('span', { class: 'box' }), label ? h('span', null, label) : null);
  }

  // sp-radio-group
  let radioSeq = 0;
  function radioGroup(options, value, onChange, opts) {
    const name = 'r' + (++radioSeq);
    return h('div', { class: 'radio-group' + (opts && opts.inline ? ' inline' : '') }, options.map(op => {
      const input = h('input', { type: 'radio', name, value: op.v, checked: op.v === value });
      input.addEventListener('change', () => { if (input.checked) onChange(op.v); });
      return h('label', { class: 'radio', title: op.title }, input, h('span', { class: 'dot' }), h('span', null, op.label));
    }));
  }

  function row(label, control, opts) {
    opts = opts || {};
    return h('div', { class: 'row' + (opts.cls ? ' ' + opts.cls : ''), title: opts.title }, h('span', { class: 'row-label' }, label), h('div', { class: 'row-ctl' }, control));
  }

  // Section à titre en capitales (sp-detail), comme dans Rotate.
  function section(title, body, extra) {
    return h('div', { class: 'section' },
      title ? h('div', { class: 'section-title' }, h('span', { class: 'detail' }, title), extra || null) : null,
      body);
  }

  function fitCanvas(canvas, cssH) {
    const dpr = root.devicePixelRatio || 1;
    const w = Math.max(10, canvas.clientWidth || canvas.parentNode.clientWidth || 300);
    const hh = cssH || canvas.clientHeight || 120;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, h: hh };
  }

  // Les couleurs du thème sont définies sur <body> (theme-dark / theme-light). Lues une fois
  // (les dessins des courbes en demandent beaucoup à chaque image) ; css.reset() au changement de thème.
  const cssCache = new Map();
  function css(name) {
    let v = cssCache.get(name);
    if (v === undefined) {
      v = getComputedStyle(document.body).getPropertyValue(name).trim() || getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v) cssCache.set(name, v);
    }
    return v;
  }
  css.reset = () => cssCache.clear();

  // Une couleur CSS (#rgb, #rrggbb ou rgb()) avec une opacité donnée.
  function withAlpha(color, a) {
    let m = /^#([0-9a-f]{3})$/i.exec(color);
    if (m) color = '#' + m[1].split('').map(c => c + c).join('');
    m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
    if (m) return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
    m = /^rgba?\(([^,]+),([^,]+),([^,)]+)/i.exec(color);
    if (m) return 'rgba(' + m[1].trim() + ',' + m[2].trim() + ',' + m[3].trim() + ',' + a + ')';
    return 'rgba(128,128,128,' + a + ')';
  }

  // ---------------------------------------------------------------- curve editor
  // Left half: the PRE curve (rising into the cut). Right half: its POST mirror.
  // Both halves' handles can be dragged; they edit the same bezier.

  function CurveEditor(canvas, o) {
    const PAD = 12, Y0 = -0.15, Y1 = 1.15;
    let drag = null;
    const geo = () => {
      const w = canvas.clientWidth, hh = canvas.clientHeight, mid = w / 2;
      return { w, h: hh, mid, half: mid - PAD };
    };
    const yOf = (v, G) => PAD + (1 - (v - Y0) / (Y1 - Y0)) * (G.h - 2 * PAD);
    const vOf = (y, G) => Y0 + (1 - (y - PAD) / (G.h - 2 * PAD)) * (Y1 - Y0);
    const handles = G => {
      const c = o.get();
      return [
        { i: 0, side: 'pre', x: PAD + c[0] * G.half, y: yOf(c[1], G) },
        { i: 1, side: 'pre', x: PAD + c[2] * G.half, y: yOf(c[3], G) },
        { i: 0, side: 'post', x: G.mid + (1 - c[0]) * G.half, y: yOf(c[1], G) },
        { i: 1, side: 'post', x: G.mid + (1 - c[2]) * G.half, y: yOf(c[3], G) }
      ];
    };

    function draw() {
      const { g, w, h: hh } = fitCanvas(canvas, o.height || 128);
      const G = geo(), c = o.get(), f = Core.bezier(c[0], c[1], c[2], c[3]);
      const sides = o.sides(), N = Math.max(1, o.frames());
      g.clearRect(0, 0, w, hh);
      g.fillStyle = css('--bg-2'); g.fillRect(0, 0, w, hh);
      g.strokeStyle = css('--grid'); g.lineWidth = 1;
      for (let k = 0; k <= 4; k++) {
        const y = Math.round(yOf(k / 4, G)) + 0.5;
        g.beginPath(); g.moveTo(PAD, y); g.lineTo(w - PAD, y); g.stroke();
      }
      g.setLineDash([3, 3]);
      g.strokeStyle = css('--text-3');
      g.beginPath(); g.moveTo(G.mid + 0.5, 4); g.lineTo(G.mid + 0.5, hh - 4); g.stroke();
      g.setLineDash([]);
      g.fillStyle = css('--text-3'); g.font = '600 9px ' + css('--font');
      g.fillText('CUT', G.mid + 4, 12);

      [['pre', css('--pre')], ['post', css('--post')]].forEach(([side, col]) => {
        const on = sides.indexOf(side) >= 0;
        g.globalAlpha = on ? 1 : 0.22;
        const x0 = side === 'pre' ? PAD : G.mid;
        g.beginPath();
        for (let s = 0; s <= 80; s++) {
          const t = s / 80, v = side === 'pre' ? f(t) : f(1 - t);
          const x = x0 + t * G.half, y = yOf(v, G);
          s ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.lineTo(x0 + G.half, yOf(0, G)); g.lineTo(x0, yOf(0, G)); g.closePath();
        const grad = g.createLinearGradient(0, yOf(1, G), 0, yOf(0, G));
        grad.addColorStop(0, withAlpha(col, 0.33)); grad.addColorStop(1, withAlpha(col, 0));
        g.fillStyle = grad; g.fill();
        g.beginPath();
        for (let s = 0; s <= 80; s++) {
          const t = s / 80, v = side === 'pre' ? f(t) : f(1 - t);
          const x = x0 + t * G.half, y = yOf(v, G);
          s ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = col; g.lineWidth = 2; g.stroke();
        g.fillStyle = col;
        for (let i = 0; i < N; i++) {
          const t = N === 1 ? 1 : i / (N - 1), tt = side === 'pre' ? t : t, v = side === 'pre' ? f(tt) : f(1 - tt);
          g.beginPath(); g.arc(x0 + tt * G.half, yOf(v, G), 2, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
      });

      if (!o.locked || !o.locked()) {
        const hs = handles(G);
        g.lineWidth = 1;
        hs.forEach(p => {
          const anchor = p.side === 'pre'
            ? (p.i === 0 ? [PAD, yOf(0, G)] : [PAD + G.half, yOf(1, G)])
            : (p.i === 0 ? [G.mid + G.half, yOf(0, G)] : [G.mid, yOf(1, G)]);
          g.strokeStyle = css('--text-2');
          g.beginPath(); g.moveTo(anchor[0], anchor[1]); g.lineTo(p.x, p.y); g.stroke();
          g.fillStyle = css('--bg'); g.strokeStyle = css('--accent'); g.lineWidth = 1.6;
          g.beginPath(); g.arc(p.x, p.y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke();
          g.lineWidth = 1;
        });
      }
    }

    canvas.addEventListener('pointerdown', e => {
      if (o.locked && o.locked()) return;
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, G = geo();
      let best = null, bd = 14;
      handles(G).forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } });
      if (!best) return;
      drag = best;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, G = geo();
      if (!drag) {
        let near = false;
        if (!(o.locked && o.locked())) handles(G).forEach(p => { if (Math.hypot(p.x - x, p.y - y) < 14) near = true; });
        canvas.style.cursor = near ? 'grab' : 'default';
        return;
      }
      const c = o.get().slice();
      let t = drag.side === 'pre' ? (x - PAD) / G.half : 1 - (x - G.mid) / G.half;
      t = Core.clamp(t, 0, 1);
      const v = Core.clamp(vOf(y, G), -0.5, 1.5);
      c[drag.i * 2] = Math.round(t * 100) / 100;
      c[drag.i * 2 + 1] = Math.round(v * 100) / 100;
      o.set(c, false);
      draw();
    });
    const end = () => { if (drag) { drag = null; o.set(o.get(), true); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    return { draw };
  }

  // ---------------------------------------------------------------- ramp editor

  function RampEditor(canvas, o) {
    const PAD_L = 34, PAD_R = 10, PAD_T = 10, PAD_B = 18, VMIN = 10, VMAX = 1000;
    let drag = null, hover = null;
    const G = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });
    const xOf = (t, g) => PAD_L + t * (g.w - PAD_L - PAD_R);
    const tOf = (x, g) => (x - PAD_L) / (g.w - PAD_L - PAD_R);
    const yOf = (v, g) => PAD_T + (1 - (Math.log(v) - Math.log(VMIN)) / (Math.log(VMAX) - Math.log(VMIN))) * (g.h - PAD_T - PAD_B);
    const vOf = (y, g) => Math.exp(Math.log(VMIN) + (1 - (y - PAD_T) / (g.h - PAD_T - PAD_B)) * (Math.log(VMAX) - Math.log(VMIN)));

    function draw() {
      const { g, w, h: hh } = fitCanvas(canvas, o.height || 170);
      const geo = { w, h: hh }, pts = o.points(), f = Core.rampFunction(pts), N = o.frames();
      g.clearRect(0, 0, w, hh);
      g.fillStyle = css('--bg-2'); g.fillRect(0, 0, w, hh);
      g.font = '10px ' + css('--font');
      [25, 50, 100, 200, 400, 800].forEach(v => {
        const y = Math.round(yOf(v, geo)) + 0.5;
        g.strokeStyle = v === 100 ? css('--text-3') : css('--grid');
        g.beginPath(); g.moveTo(PAD_L, y); g.lineTo(w - PAD_R, y); g.stroke();
        g.fillStyle = css('--text-3');
        g.fillText(v + '%', 4, y + 3);
      });
      const pieces = Core.rampPieces(pts, N, o.segments());
      let acc = 0;
      pieces.forEach((p, k) => {
        const x0 = xOf(acc / N, geo), x1 = xOf((acc + p.frames) / N, geo);
        const y = yOf(Core.clamp(p.speed, VMIN, VMAX), geo), y100 = yOf(100, geo);
        g.fillStyle = p.speed >= 100 ? 'rgba(255,170,60,0.22)' : 'rgba(110,180,255,0.22)';
        g.fillRect(x0 + 0.5, Math.min(y, y100), Math.max(1, x1 - x0 - 1), Math.abs(y100 - y));
        g.strokeStyle = p.speed >= 100 ? 'rgba(255,170,60,0.85)' : 'rgba(110,180,255,0.85)';
        g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
        acc += p.frames;
      });
      g.beginPath();
      for (let s = 0; s <= 120; s++) {
        const t = s / 120, x = xOf(t, geo), y = yOf(Core.clamp(f(t), VMIN, VMAX), geo);
        s ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.strokeStyle = css('--accent'); g.lineWidth = 2; g.stroke(); g.lineWidth = 1;
      pts.forEach((p, i) => {
        const x = xOf(p.t, geo), y = yOf(Core.clamp(p.v, VMIN, VMAX), geo);
        g.fillStyle = (drag && drag.i === i) || hover === i ? css('--accent') : css('--bg');
        g.strokeStyle = css('--accent'); g.lineWidth = 1.6;
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); g.stroke();
        g.lineWidth = 1;
      });
      g.fillStyle = css('--text-3');
      g.fillText('0', PAD_L, hh - 5);
      const lab = N + ' i';
      g.fillText(lab, w - PAD_R - g.measureText(lab).width, hh - 5);
      const tip = drag != null ? drag.i : hover;
      if (tip != null && pts[tip]) {
        const p = pts[tip], x = xOf(p.t, geo), y = yOf(Core.clamp(p.v, VMIN, VMAX), geo);
        const txt = Math.round(p.t * N) + ' i · ' + Math.round(p.v) + ' %';
        const tw = g.measureText(txt).width + 10;
        const tx = Core.clamp(x - tw / 2, 2, w - tw - 2), ty = y > 30 ? y - 24 : y + 10;
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(tx, ty, tw, 16);
        g.fillStyle = '#fff'; g.fillText(txt, tx + 5, ty + 11);
      }
    }

    const hit = (x, y) => {
      const geo = G();
      let best = null, bd = 12;
      o.points().forEach((p, i) => { const d = Math.hypot(xOf(p.t, geo) - x, yOf(Core.clamp(p.v, VMIN, VMAX), geo) - y); if (d < bd) { bd = d; best = i; } });
      return best;
    };
    const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    canvas.addEventListener('pointerdown', e => {
      const [x, y] = local(e), i = hit(x, y);
      if (i === null) return;
      if (e.altKey && i > 0 && i < o.points().length - 1) {
        const pts = o.points().slice(); pts.splice(i, 1); o.set(pts, true); draw(); return;
      }
      drag = { i };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      const [x, y] = local(e), geo = G();
      if (!drag) { const i = hit(x, y); if (i !== hover) { hover = i; draw(); } canvas.style.cursor = i === null ? 'crosshair' : 'grab'; return; }
      const pts = o.points().map(p => Object.assign({}, p)), i = drag.i, last = pts.length - 1;
      if (i > 0 && i < last) pts[i].t = Core.clamp(tOf(x, geo), pts[i - 1].t + 0.02, pts[i + 1].t - 0.02);
      pts[i].v = Math.round(Core.clamp(vOf(y, geo), VMIN, VMAX));
      if (Math.abs(pts[i].v - 100) < 4) pts[i].v = 100;
      o.set(pts, false);
      draw();
    });
    const end = () => { if (drag) { drag = null; o.set(o.points(), true); draw(); } };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (hover !== null) { hover = null; draw(); } });
    canvas.addEventListener('dblclick', e => {
      const [x, y] = local(e), geo = G(), i = hit(x, y), pts = o.points().slice();
      if (i !== null) {
        if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); o.set(pts, true); draw(); }
        return;
      }
      const t = Core.clamp(tOf(x, geo), 0.02, 0.98);
      pts.push({ t: Math.round(t * 1000) / 1000, v: Math.round(Core.clamp(vOf(y, geo), VMIN, VMAX)) });
      pts.sort((a, b) => a.t - b.t);
      o.set(pts, true);
      draw();
    });
    return { draw };
  }

  // ---------------------------------------------------------------- player

  function Player(o) {
    let playing = true, frame = 0, last = 0, raf = 0;
    function tick(ts) {
      raf = requestAnimationFrame(tick);
      const n = o.length();
      if (!n) return;
      const fps = Math.min(30, o.fps());
      if (playing && ts - last >= 1000 / fps) {
        last = ts;
        frame = (frame + 1) % n;
        o.draw(frame);
      }
    }
    raf = requestAnimationFrame(tick);
    return {
      toggle() { playing = !playing; return playing; },
      get playing() { return playing; },
      seek(n) { frame = Core.clamp(n, 0, Math.max(0, o.length() - 1)); o.draw(frame); },
      redraw() { frame = Math.min(frame, Math.max(0, o.length() - 1)); o.draw(frame); },
      stop() { cancelAnimationFrame(raf); }
    };
  }

  root.RRFXUI = { withAlpha, h, hotText, actionGroup, picker, checkbox, radioGroup, row, section, fitCanvas, css, CurveEditor, RampEditor, Player };
})(typeof self !== 'undefined' ? self : this);
