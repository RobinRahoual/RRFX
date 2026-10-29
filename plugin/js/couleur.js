/* RR FX : onglet Couleur : la colorimétrie comme dans Lightroom (module Développement).
   Histogramme, avant/après, looks, Réglages de base, Courbe des tonalités, Mélangeur de
   couleurs, Étalonnage des couleurs, Calibrage. Le look part dans Premiere en LUT .cube sur
   un calque de réglage Lumetri, ou s'exporte en .cube et en DCTL (DaVinci Resolve). */
(function (root) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  (root.RRFXFeatures = root.RRFXFeatures || []).push(function (app) {
    const D = root.RRFXDevelop, A = root.RRFXAssets, { Store, Pv } = app;
    const { h, actionGroup, row, fitCanvas, css } = app.UI;

    const PW = 480, PH = 270; // taille de calcul de l'aperçu
    const DEFAULTS = { open: { log: true, fix: false, looks: true, basic: true, curve: false, mixer: false, grading: false, calib: false, out: true }, view: 'split', split: 0.5, shot: 'A', curveCh: 'param', mixMode: 'h', wheel: 'shadows', name: _T('Mon look'), target: 'clip' };
    const st = () => {
      const s = app.settings();
      if (!s.color || typeof s.color !== 'object') s.color = {};
      const c = s.color;
      Object.keys(DEFAULTS).forEach(k => { if (!(k in c)) c[k] = typeof DEFAULTS[k] === 'object' ? Object.assign({}, DEFAULTS[k]) : DEFAULTS[k]; });
      c.params = D.normalize(c.params);
      return c;
    };
    const P = () => st().params;

    // ---------------------------------------------------------------- aperçu

    const V = { view: null, canvas: null, histo: null, src: null, after: null, timer: 0, hq: 0, lutKey: '' };

    function sourceCanvas() {
      const shots = Pv.shots(), img = shots[st().shot === 'B' ? 'B' : 'A'];
      const c = document.createElement('canvas');
      c.width = PW; c.height = PH;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, PW, PH);
      // Images en LOG : la conversion Rec.709 de la caméra passe avant le look (comme dans Premiere).
      const conv = app.conversion && app.conversion.previewLut();
      if (conv) { const d = g.getImageData(0, 0, PW, PH); A.applyLut(d.data, conv); g.putImageData(d, 0, 0); }
      return { canvas: c, data: g.getImageData(0, 0, PW, PH) };
    }

    // Recalcule l'image « après » (LUT réduite pendant un glissement, fine à la fin).
    function update(final) {
      if (!V.canvas || !V.canvas.isConnected) return;
      if (!V.src) V.src = sourceCanvas();
      const lut = D.buildLut(P(), final ? 33 : 17);
      const out = new ImageData(new Uint8ClampedArray(V.src.data.data), PW, PH);
      A.applyLut(out.data, lut);
      if (!V.after) { V.after = document.createElement('canvas'); V.after.width = PW; V.after.height = PH; }
      V.after.getContext('2d').putImageData(out, 0, 0);
      drawPreview();
      drawHisto(D.histogram(out.data, 128));
      if (V.curveDraw && st().open.curve) V.curveDraw();
    }
    function schedule(final) {
      if (final) { cancelAnimationFrame(V.timer); V.timer = 0; update(true); app.persist(); return; }
      if (V.timer) return;
      V.timer = requestAnimationFrame(() => { V.timer = 0; update(false); clearTimeout(V.hq); V.hq = setTimeout(() => update(true), 250); });
    }

    function drawPreview() {
      const c = V.canvas, g = c.getContext('2d'), s = st(), W = c.width, H = c.height;
      if (!V.after || !V.src) return;
      g.imageSmoothingQuality = 'high';
      if (s.view === 'before') g.drawImage(V.src.canvas, 0, 0, W, H);
      else g.drawImage(V.after, 0, 0, W, H);
      if (s.view === 'split') {
        // Tailles proportionnelles à l'image (le canevas est en haute définition).
        const x = Math.round(s.split * W), k = W / 480;
        g.drawImage(V.src.canvas, 0, 0, s.split * PW, PH, 0, 0, x, H);
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.fillRect(x - k, 0, 2 * k, H);
        g.beginPath(); g.arc(x, H / 2, 13 * k, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#222'; g.font = '600 ' + Math.round(14 * k) + 'px ' + css('--font'); g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('⇆', x, H / 2 + k);
        g.font = '600 ' + Math.round(12 * k) + 'px ' + css('--font');
        const tag = (text, cx) => { const w = g.measureText(text).width + 12 * k; g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(cx - w / 2, 8 * k, w, 20 * k); g.fillStyle = '#fff'; g.fillText(text, cx, 18 * k); };
        tag(_T('Avant'), 8 * k + 26 * k);
        tag(_T('Après'), W - 34 * k);
      }
    }

    function drawHisto(hg) {
      if (!V.histo || !V.histo.isConnected) return;
      const { g, w, h: hh } = fitCanvas(V.histo, 64);
      g.clearRect(0, 0, w, hh);
      g.fillStyle = css('--bg-2'); g.fillRect(0, 0, w, hh);
      g.globalCompositeOperation = css('--bg-2').indexOf('#f') === 0 ? 'multiply' : 'lighter';
      [['r', 'rgba(230,60,60,0.75)'], ['g', 'rgba(60,200,80,0.75)'], ['b', 'rgba(70,120,255,0.8)']].forEach(([k, col]) => {
        const v = hg[k], n = v.length;
        g.fillStyle = col;
        g.beginPath(); g.moveTo(0, hh);
        for (let i = 0; i < n; i++) g.lineTo(i / (n - 1) * w, hh - v[i] * (hh - 4));
        g.lineTo(w, hh); g.closePath(); g.fill();
      });
      g.globalCompositeOperation = 'source-over';
    }

    // ---------------------------------------------------------------- curseurs façon Lightroom

    const sign = (v, d) => (v > 0 ? '+' : '') + Number(v).toFixed(d).replace('.', ',');

    /* Curseur : libellé, piste dégradée, valeur. Double-clic sur le libellé ou le curseur = valeur par défaut. */
    function slider(label, o) {
      const d = o.decimals || 0;
      const val = h('span', { class: 'lr-val', title: _T('Cliquer pour saisir') }, sign(o.get(), d));
      const thumb = h('span', { class: 'lr-thumb' });
      const track = h('div', { class: 'lr-track', style: { background: o.grad || 'linear-gradient(90deg, #3a3a3a, #9a9a9a)' } }, thumb);
      const lab = h('span', { class: 'lr-label', title: _T('Double-clic : valeur par défaut') }, label);
      const el = h('div', { class: 'lr-row' }, lab, track, val);
      const pos = v => ((v - o.min) / (o.max - o.min) * 100) + '%';
      const show = v => { thumb.style.left = pos(v); val.textContent = sign(v, d); };
      const set = (v, fin) => {
        v = Math.min(o.max, Math.max(o.min, Math.round(v / o.step) * o.step));
        v = Math.round(v * 1000) / 1000;
        if (v === o.get() && !fin) return;
        o.set(v);
        show(v);
        schedule(!!fin);
      };
      track.addEventListener('pointerdown', e => {
        e.preventDefault();
        const r = track.getBoundingClientRect(), v0 = o.get(), x0 = e.clientX;
        // Clic sur la piste : la valeur y saute ; puis glissement (Maj = fin).
        let base = Math.abs(e.clientX - (r.left + (v0 - o.min) / (o.max - o.min) * r.width)) < 8 ? v0 : o.min + (e.clientX - r.left) / r.width * (o.max - o.min);
        set(base);
        base = o.get();
        track.setPointerCapture(e.pointerId);
        const move = m => set(base + (m.clientX - x0) / r.width * (o.max - o.min) * (m.shiftKey ? 0.2 : 1));
        const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); set(o.get(), true); };
        track.addEventListener('pointermove', move);
        track.addEventListener('pointerup', up);
      });
      const reset = () => set(o.def || 0, true);
      lab.addEventListener('dblclick', reset);
      thumb.addEventListener('dblclick', reset);
      val.addEventListener('click', () => {
        const input = h('input', { class: 'hot-input lr-input', value: String(o.get()).replace('.', ',') });
        val.replaceWith(input);
        input.focus(); input.select();
        const done = ok => { if (!input.isConnected) return; input.replaceWith(val); const n = parseFloat(input.value.replace(',', '.')); if (ok && isFinite(n)) set(n, true); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
        input.addEventListener('blur', () => done(true));
      });
      show(o.get());
      el.refresh = () => show(o.get());
      return el;
    }

    const G = {
      temp: 'linear-gradient(90deg, #3f6ed8, #b9b9b9 50%, #e4b531)',
      tint: 'linear-gradient(90deg, #3fae4a, #b9b9b9 50%, #cf48c4)',
      tone: 'linear-gradient(90deg, #111, #888 50%, #eee)',
      flat: 'linear-gradient(90deg, #4a4a4a, #9a9a9a)',
      sat: 'linear-gradient(90deg, #8a8a8a, #c84a4a 25%, #c8b84a 45%, #4ac85a 60%, #4a7ac8 80%, #b44ac8)'
    };
    const hueCss = (deg, s, l) => 'hsl(' + Math.round(deg) + ',' + s + '%,' + l + '%)';
    function bandGrad(b, mode) {
      if (mode === 'h') return 'linear-gradient(90deg, ' + hueCss(b.hue - 35, 70, 50) + ', ' + hueCss(b.hue, 70, 50) + ', ' + hueCss(b.hue + 35, 70, 50) + ')';
      if (mode === 's') return 'linear-gradient(90deg, #8a8a8a, ' + hueCss(b.hue, 80, 50) + ')';
      return 'linear-gradient(90deg, ' + hueCss(b.hue, 60, 12) + ', ' + hueCss(b.hue, 70, 50) + ', ' + hueCss(b.hue, 60, 88) + ')';
    }

    // ---------------------------------------------------------------- panneaux

    // Panneaux fermés à la première ouverture (le sommaire les ouvre en un clic).
    const FOLDED = { gradient: true, calib: true };
    function panel(id, title, body, onReset) {
      const s = st(), open = s.open[id] === undefined ? !FOLDED[id] : s.open[id] !== false;
      const reset = onReset ? h('button', { class: 'action quiet icon lr-reset', title: _T('Réinitialiser ce panneau') }, '↺') : null;
      const head = h('div', { class: 'lr-head' }, h('span', { class: 'lr-chev' }, open ? '▾' : '▸'), h('span', { class: 'lr-title' }, title), reset);
      const el = h('div', { class: 'lr-panel' + (open ? '' : ' closed'), 'data-panel': id }, head, h('div', { class: 'lr-body' }, body));
      head.addEventListener('click', e => {
        if (e.target === reset) return;
        s.open[id] = el.classList.contains('closed');
        el.classList.toggle('closed', !s.open[id]);
        head.querySelector('.lr-chev').textContent = s.open[id] ? '▾' : '▸';
        app.persist();
        if (s.open[id] && el.redraw) el.redraw();
      });
      if (reset) reset.addEventListener('click', () => { onReset(); app.persist(); render(); });
      return el;
    }
    const sub = text => h('div', { class: 'lr-sub' }, text);
    const keySlider = (label, key, o) => slider(label, Object.assign({ min: -100, max: 100, step: 1, get: () => P()[key], set: v => { P()[key] = v; } }, o || {}));
    const resetKeys = keys => () => { const d = D.defaults(); keys.forEach(k => { P()[k] = d[k]; }); };

    function basicPanel() {
      return panel('basic', _T('Réglages de base'), [
        sub(_T('Balance des blancs')),
        keySlider(_T('Température'), 'temp', { grad: G.temp }),
        keySlider(_T('Teinte'), 'tint', { grad: G.tint }),
        sub(_T('Tonalité')),
        keySlider(_T('Exposition'), 'exposure', { min: -5, max: 5, step: 0.01, decimals: 2, grad: G.tone }),
        keySlider(_T('Contraste'), 'contrast', { grad: G.tone }),
        keySlider(_T('Hautes lumières'), 'highlights', { grad: G.tone }),
        keySlider(_T('Ombres'), 'shadows', { grad: G.tone }),
        keySlider(_T('Blancs'), 'whites', { grad: G.tone }),
        keySlider(_T('Noirs'), 'blacks', { grad: G.tone }),
        sub(_T('Présence')),
        keySlider('Vibrance', 'vibrance', { grad: G.sat }),
        keySlider('Saturation', 'saturation', { grad: G.sat }),
        h('div', { class: 'note' }, _T('Texture, Clarté et Correction du voile dépendent des pixels voisins : une LUT ne peut pas les porter. Ils restent dans Lumetri (Créatif > Netteté, Tons foncés estompés).'))
      ], resetKeys(['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'vibrance', 'saturation']));
    }

    // Courbe : paramétrique (4 curseurs + séparations) ou à points (RVB, R, V, B).
    function curvePanel() {
      const s = st(), cv = h('canvas', { class: 'lr-curve' }), box = h('div');
      const chans = [{ v: 'param', label: _T('Paramétrique') }, { v: 'rgb', label: 'RVB' }, { v: 'r', label: 'R', cls: 'ch-r' }, { v: 'g', label: 'V', cls: 'ch-g' }, { v: 'b', label: 'B', cls: 'ch-b' }];
      const COL = { rgb: '#d8d8d8', r: '#e05050', g: '#4cc060', b: '#5a8cff', param: '#d8d8d8' };
      let drag = -1;
      const pts = () => P().curve[s.curveCh];
      function draw() {
        const { g, w, h: hh } = fitCanvas(cv, Math.max(150, Math.min(220, cv.clientWidth * 0.7)));
        const pad = 8, X = x => pad + x * (w - 2 * pad), Y = y => hh - pad - y * (hh - 2 * pad);
        g.clearRect(0, 0, w, hh);
        g.fillStyle = css('--bg-2'); g.fillRect(0, 0, w, hh);
        if (V.after) { // histogramme en fond, comme dans Lightroom
          const hg = D.histogram(V.after.getContext('2d').getImageData(0, 0, PW, PH).data, 64);
          g.fillStyle = 'rgba(128,128,128,0.18)';
          g.beginPath(); g.moveTo(X(0), Y(0));
          for (let i = 0; i < 64; i++) g.lineTo(X(i / 63), Y(Math.max(hg.r[i], hg.g[i], hg.b[i]) * 0.9));
          g.lineTo(X(1), Y(0)); g.fill();
        }
        g.strokeStyle = css('--grid'); g.lineWidth = 1;
        for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(X(k / 4), Y(0)); g.lineTo(X(k / 4), Y(1)); g.stroke(); g.beginPath(); g.moveTo(X(0), Y(k / 4)); g.lineTo(X(1), Y(k / 4)); g.stroke(); }
        g.setLineDash([3, 3]); g.strokeStyle = css('--text-3'); g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(1)); g.stroke(); g.setLineDash([]);
        const p = P();
        if (s.curveCh === 'param') {
          // Séparations des zones.
          [p.split1, p.split2, p.split3].forEach(v => { g.strokeStyle = css('--text-3'); g.beginPath(); g.moveTo(X(v / 100), Y(0)); g.lineTo(X(v / 100), Y(1)); g.stroke(); });
          g.strokeStyle = COL.param; g.lineWidth = 2; g.beginPath();
          for (let i = 0; i <= 120; i++) { const x = i / 120, y = D.tone(x, Object.assign(D.defaults(), { pHighlights: p.pHighlights, pLights: p.pLights, pDarks: p.pDarks, pShadows: p.pShadows, split1: p.split1, split2: p.split2, split3: p.split3 })); i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)); }
          g.stroke();
          return;
        }
        const t = D.curveTable(pts(), 256);
        g.strokeStyle = COL[s.curveCh]; g.lineWidth = 2; g.beginPath();
        for (let i = 0; i < 256; i++) { const x = i / 255; i ? g.lineTo(X(x), Y(t[i])) : g.moveTo(X(x), Y(t[i])); }
        g.stroke();
        pts().forEach((q, i) => { g.fillStyle = i === drag ? COL[s.curveCh] : css('--bg'); g.strokeStyle = COL[s.curveCh]; g.lineWidth = 1.6; g.beginPath(); g.arc(X(q[0]), Y(q[1]), 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); });
      }
      const local = e => { const r = cv.getBoundingClientRect(), pad = 8; return [(e.clientX - r.left - pad) / (r.width - 2 * pad), 1 - (e.clientY - r.top - pad) / (r.height - 2 * pad)]; };
      const hit = (x, y) => pts().findIndex(q => Math.abs(q[0] - x) < 0.04 && Math.abs(q[1] - y) < 0.06);
      cv.addEventListener('pointerdown', e => {
        if (s.curveCh === 'param') return;
        let [x, y] = local(e);
        x = Math.min(1, Math.max(0, x)); y = Math.min(1, Math.max(0, y));
        drag = hit(x, y);
        if (drag < 0) {
          const list = pts();
          list.push([x, y]);
          list.sort((a, b) => a[0] - b[0]);
          drag = list.findIndex(q => q[0] === x && q[1] === y);
        }
        cv.setPointerCapture(e.pointerId);
        draw(); schedule(false);
      });
      cv.addEventListener('pointermove', e => {
        if (drag < 0 || s.curveCh === 'param') return;
        const list = pts(), [x, y] = local(e);
        const lo = drag === 0 ? 0 : list[drag - 1][0] + 0.01, hi = drag === list.length - 1 ? 1 : list[drag + 1][0] - 0.01;
        list[drag] = [drag === 0 && list.length > 1 && list[0][0] === 0 ? 0 : Math.min(hi, Math.max(lo, x)), Math.min(1, Math.max(0, y))];
        if (drag === list.length - 1 && list[drag][0] > 0.99) list[drag][0] = 1;
        draw(); schedule(false);
      });
      const end = () => { if (drag >= 0) { drag = -1; draw(); schedule(true); } };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('dblclick', e => {
        if (s.curveCh === 'param') return;
        const [x, y] = local(e), i = hit(x, y), list = pts();
        if (i > 0 && i < list.length - 1) { list.splice(i, 1); draw(); schedule(true); }
      });
      const fill = () => {
        box.innerHTML = '';
        if (s.curveCh === 'param') {
          const pk = (label, key) => keySlider(label, key, { grad: G.tone });
          box.appendChild(pk(_T('Hautes lumières'), 'pHighlights'));
          box.appendChild(pk(_T('Tons clairs'), 'pLights'));
          box.appendChild(pk(_T('Tons foncés'), 'pDarks'));
          box.appendChild(pk(_T('Ombres'), 'pShadows'));
          box.appendChild(sub(_T('Séparations')));
          box.appendChild(keySlider(_T('Ombres | Tons foncés'), 'split1', { min: 5, max: 45, grad: G.flat, def: 25 }));
          box.appendChild(keySlider(_T('Tons foncés | clairs'), 'split2', { min: 30, max: 70, grad: G.flat, def: 50 }));
          box.appendChild(keySlider(_T('Tons clairs | Hautes l.'), 'split3', { min: 55, max: 95, grad: G.flat, def: 75 }));
        } else box.appendChild(h('div', { class: 'note' }, _T('Clique pour ajouter un point, glisse pour le déplacer, double-clic pour le retirer.')));
        requestAnimationFrame(draw);
      };
      const tabs = actionGroup(chans, s.curveCh, v => { s.curveCh = v; app.persist(); fill(); });
      const el = panel('curve', _T('Courbe des tonalités'), [tabs, cv, box], () => {
        const d = D.defaults();
        ['pHighlights', 'pLights', 'pDarks', 'pShadows', 'split1', 'split2', 'split3'].forEach(k => { P()[k] = d[k]; });
        P().curve = d.curve;
      });
      el.redraw = draw;
      V.curveDraw = draw;
      fill();
      return el;
    }

    function mixerPanel() {
      const s = st(), box = h('div');
      const fill = () => {
        box.innerHTML = '';
        D.BANDS.forEach(b => box.appendChild(slider(b.label, { min: -100, max: 100, step: 1, grad: bandGrad(b, s.mixMode), get: () => P().hsl[b.id][s.mixMode], set: v => { P().hsl[b.id][s.mixMode] = v; } })));
      };
      fill();
      return panel('mixer', _T('Mélangeur de couleurs'), [
        actionGroup([{ v: 'h', label: _T('Teinte') }, { v: 's', label: 'Saturation' }, { v: 'l', label: 'Luminance' }], s.mixMode, v => { s.mixMode = v; app.persist(); fill(); }),
        box
      ], () => { const d = D.defaults(); P().hsl = d.hsl; });
    }

    // Roue chromatique : teinte (angle) et saturation (rayon), comme dans Lightroom.
    const wheelImg = {};
    function wheelBitmap(size) {
      if (wheelImg[size]) return wheelImg[size];
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const g = c.getContext('2d'), img = g.createImageData(size, size), R = size / 2;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const dx = x - R + 0.5, dy = y - R + 0.5, d = Math.sqrt(dx * dx + dy * dy) / R, o = (y * size + x) * 4;
        if (d > 1) continue;
        const hue = (Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360, rgb = D.hsv2rgb(hue, d * 0.85, 0.82);
        img.data[o] = rgb[0] * 255; img.data[o + 1] = rgb[1] * 255; img.data[o + 2] = rgb[2] * 255; img.data[o + 3] = d > 0.985 ? 255 * (1 - d) / 0.015 : 255;
      }
      g.putImageData(img, 0, 0);
      return (wheelImg[size] = c);
    }
    function wheel(key, size) {
      const cv = h('canvas', { class: 'lr-wheel', width: size * 2, height: size * 2, style: { width: size + 'px', height: size + 'px' } });
      const W = () => P().grading[key];
      const draw = () => {
        const g = cv.getContext('2d'), S = cv.width, R = S / 2, w = W();
        g.clearRect(0, 0, S, S);
        g.drawImage(wheelBitmap(S), 0, 0);
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(R, 6); g.lineTo(R, S - 6); g.moveTo(6, R); g.lineTo(S - 6, R); g.stroke();
        const a = w.h * Math.PI / 180, rr = (w.s / 100) * (R - 6), px = R + Math.cos(a) * rr, py = R - Math.sin(a) * rr;
        g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
        g.beginPath(); g.arc(px, py, S * 0.045, 0, Math.PI * 2); g.fill(); g.stroke();
      };
      cv.addEventListener('pointerdown', e => {
        e.preventDefault();
        cv.setPointerCapture(e.pointerId);
        const set = ev => {
          const r = cv.getBoundingClientRect(), dx = ev.clientX - r.left - r.width / 2, dy = ev.clientY - r.top - r.height / 2, R = r.width / 2 - 3;
          const w = W();
          w.h = Math.round((Math.atan2(-dy, dx) * 180 / Math.PI + 360) % 360);
          w.s = Math.round(Math.min(1, Math.sqrt(dx * dx + dy * dy) / R) * 100);
          draw(); if (cv.onchange2) cv.onchange2(); schedule(false);
        };
        set(e);
        const up = () => { cv.removeEventListener('pointermove', set); cv.removeEventListener('pointerup', up); schedule(true); };
        cv.addEventListener('pointermove', set);
        cv.addEventListener('pointerup', up);
      });
      cv.addEventListener('dblclick', () => { W().h = 0; W().s = 0; draw(); if (cv.onchange2) cv.onchange2(); schedule(true); });
      draw();
      cv.redraw = draw;
      return cv;
    }

    function gradingPanel() {
      const s = st(), box = h('div');
      const labels = { shadows: _T('Ombres'), midtones: _T('Tons moyens'), highlights: _T('Hautes lumières'), global: 'Global' };
      const fill = () => {
        box.innerHTML = '';
        if (s.wheel === 'three') {
          const row3 = h('div', { class: 'lr-wheels' });
          ['shadows', 'midtones', 'highlights'].forEach(k => {
            const lum = slider('', { min: -100, max: 100, step: 1, grad: G.tone, get: () => P().grading[k].l, set: v => { P().grading[k].l = v; } });
            row3.appendChild(h('div', { class: 'lr-wheel-box' }, h('div', { class: 'lr-sub' }, labels[k]), wheel(k, 92), lum));
          });
          box.appendChild(row3);
        } else {
          const k = s.wheel, wl = wheel(k, 170);
          const hs = slider(_T('Teinte'), { min: 0, max: 360, step: 1, grad: 'linear-gradient(90deg, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%))', get: () => P().grading[k].h, set: v => { P().grading[k].h = v; wl.redraw(); } });
          const ss = slider('Saturation', { min: 0, max: 100, step: 1, grad: G.sat, get: () => P().grading[k].s, set: v => { P().grading[k].s = v; wl.redraw(); } });
          wl.onchange2 = () => { hs.refresh(); ss.refresh(); };
          box.appendChild(h('div', { class: 'lr-wheel-big' }, wl));
          box.appendChild(hs);
          box.appendChild(ss);
          box.appendChild(slider('Luminance', { min: -100, max: 100, step: 1, grad: G.tone, get: () => P().grading[k].l, set: v => { P().grading[k].l = v; } }));
        }
      };
      fill();
      return panel('grading', _T('Étalonnage des couleurs'), [
        actionGroup([{ v: 'three', label: _T('3 roues') }, { v: 'shadows', label: _T('Ombres') }, { v: 'midtones', label: _T('Moyens') }, { v: 'highlights', label: _T('Hautes l.') }, { v: 'global', label: 'Global' }], s.wheel, v => { s.wheel = v; app.persist(); fill(); }),
        box,
        keySlider(_T('Fusion'), 'blending', { min: 0, max: 100, grad: G.flat, def: 50 }),
        keySlider(_T('Équilibre'), 'balance', { grad: G.tone })
      ], () => { const d = D.defaults(); P().grading = d.grading; P().blending = 50; P().balance = 0; });
    }

    function calibPanel() {
      const prim = (label, hk, sk, hue) => [
        sub(label),
        keySlider(_T('Teinte'), hk, { grad: 'linear-gradient(90deg, ' + hueCss(hue - 40, 70, 50) + ', ' + hueCss(hue, 70, 50) + ', ' + hueCss(hue + 40, 70, 50) + ')' }),
        keySlider('Saturation', sk, { grad: 'linear-gradient(90deg, #8a8a8a, ' + hueCss(hue, 80, 50) + ')' })
      ];
      return panel('calib', _T('Calibrage'), [
        sub(_T('Ombres')),
        keySlider(_T('Teinte'), 'shadowTint', { grad: G.tint })
      ].concat(prim(_T('Primaire rouge'), 'redHue', 'redSat', 0), prim(_T('Primaire verte'), 'greenHue', 'greenSat', 120), prim(_T('Primaire bleue'), 'blueHue', 'blueSat', 240)),
      resetKeys(['shadowTint', 'redHue', 'redSat', 'greenHue', 'greenSat', 'blueHue', 'blueSat']));
    }

    // ---------------------------------------------------------------- looks

    // Vignettes des looks, gardées par jeu d'images (l'onglet se redessine à chaque look choisi).
    const thumbs = new WeakMap();
    function lookThumb(params, W, H) {
      const shots = Pv.shots(), key = W + 'x' + H + JSON.stringify(params);
      let cache = thumbs.get(shots);
      if (!cache) thumbs.set(shots, cache = new Map());
      const c = h('canvas', { width: W, height: H }), g = c.getContext('2d'), hit = cache.get(key);
      if (hit) { g.putImageData(hit, 0, 0); return c; }
      g.drawImage(shots.A, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H);
      A.applyLut(d.data, D.buildLut(params, 9));
      g.putImageData(d, 0, 0);
      cache.set(key, d);
      return c;
    }
    const userLooks = () => app.S.lib.items.filter(i => i.type === 'look');

    function setParams(params, name) {
      st().params = D.normalize(params);
      if (name) st().name = name;
      app.persist();
      render();
      app.renderCTA();
    }

    function looksPanel() {
      const grid = h('div', { class: 'lr-looks' });
      const card = (name, params, title) => {
        const c = h('div', { class: 'lr-look', title: title || name }, lookThumb(params, 120, 68), h('span', null, name));
        c.addEventListener('click', () => { setParams(params, name); app.status.finish('ok', _T('Look : ') + name, _T('Ajuste-le avec les panneaux, puis « Appliquer le look ».')); });
        return c;
      };
      grid.appendChild(card(_T('Aucun'), D.defaults(), _T('Tout remettre à zéro')));
      D.LOOKS.forEach(l => grid.appendChild(card(l.name, l.p)));
      userLooks().forEach(i => grid.appendChild(card('★ ' + i.name, i.data.params)));
      const amount = keySlider(_T('Intensité du look'), 'amount', { min: 0, max: 100, grad: G.flat, def: 100 });
      return panel('looks', 'Looks', [grid, amount]);
    }

    // ---------------------------------------------------------------- sorties

    const slug = s => A.fileSlug(s, 'look', 40).replace(/[ .]+/g, '-');

    function applyInPremiere() {
      const s = st(), name = s.name || _T('Mon look');
      return app.runTask('Look · ' + name, async () => {
        app.status.phase(_T('Fabrication de la LUT'));
        const cube = D.toCube(D.buildLut(P(), 33), name);
        let file = null;
        if (Store.fs) {
          const dir = Store.path.join(Store.dir, 'Looks');
          Store.fs.mkdirSync(dir, { recursive: true });
          // Nommé d'après son contenu : les calques déjà posés gardent leur LUT.
          file = Store.path.join(dir, 'RRFX ' + slug(name) + ' ' + A.hashText(cube) + '.cube');
          if (!Store.fs.existsSync(file)) Store.fs.writeFileSync(file, cube, 'utf8');
        }
        app.status.phase(_T('Calque de réglage'));
        const { res, fail } = await app.services.adjustmentLayer('RR FX · Look ' + name, await app.services.lumetriFx(file), { scope: s.target === 'sequence' ? 'sequence' : 'clip', history: 'Look · ' + name });
        if (fail) return fail;
        if (file) app.log(_T('LUT du look : ') + file, 'ok');
        const title = _T('Look posé · ') + app.plural(res.created.length, _T('calque Lumetri'), _T('calques Lumetri'));
        if (file && res.lutSet) return { kind: res.kind, title, detail: _T('LUT « ') + Store.path.basename(file) + _T(' » chargée dans Lumetri (LUT d\'entrée).') };
        // LUT non chargée par script : on l'installe aussi dans les Looks de Lumetri.
        if (file) {
          try {
            const sys = Store.systemDirs();
            Store.fs.mkdirSync(sys.luts, { recursive: true });
            Store.fs.copyFileSync(file, Store.path.join(sys.luts, Store.path.basename(file)));
          } catch (e) { app.log(_T('LUT non installée dans le dossier Adobe : ') + app.errorMessage(e), 'warn'); }
        }
        const copied = file && navigator.clipboard ? await navigator.clipboard.writeText(file).then(() => true, () => false) : false;
        return {
          kind: res.kind,
          title,
          detail: file
            ? _T('Lumetri > Correction de base > LUT d\'entrée (ou Créatif > Look) > Parcourir… et choisis « ') + Store.path.basename(file) + _T(' »') + (copied ? _T(' (chemin copié)') : '') + _T('. Après un redémarrage de Premiere, il est aussi dans la liste des Looks.')
            : _T('Mode démo : exporte la LUT (.cube) pour l\'essayer.')
        };
      });
    }

    function exportCube() {
      const name = st().name || _T('Mon look');
      const out = Store.exportText(D.toCube(D.buildLut(P(), 33), name), 'RRFX ' + slug(name) + '.cube', ['cube'], _T('Exporter la LUT (.cube)'));
      if (out) app.status.finish('ok', _T('LUT exportée'), out + ' · Premiere (Lumetri), Resolve, Final Cut, CapCut…');
    }
    function exportDctl() {
      const name = st().name || _T('Mon look');
      const out = Store.exportText(D.toDCTL(P(), name), 'RRFX ' + slug(name) + '.dctl', ['dctl'], _T('Exporter le DCTL (DaVinci Resolve)'));
      if (out) app.status.finish('ok', _T('DCTL exporté'), _T('Dans Resolve : copie-le dans le dossier LUT de Resolve, puis effet DCTL sur un nœud. Les curseurs Lightroom y sont réglables.'));
    }
    async function saveLook() {
      const name = await app.promptName(_T('Enregistrer le look'), st().name || _T('Mon look'));
      if (!name) return;
      const items = app.S.lib.items, old = items.find(i => i.type === 'look' && i.name === name);
      const data = { params: JSON.parse(JSON.stringify(P())) };
      if (old) { old.data = data; app.persist(); } else app.services.addItems([{ type: 'look', name, data }]);
      st().name = name;
      app.persist();
      render();
      app.renderCTA();
      app.status.finish('ok', _T('Look enregistré : ') + name, _T('Dans Mes effets : partage-le par code ou publie-le dans la Communauté.'));
    }

    function outPanel() {
      const s = st();
      const nameIn = h('input', { class: 'textfield', value: s.name });
      nameIn.addEventListener('input', () => { s.name = nameIn.value; app.persist(); app.renderCTA(); });
      const b = (label, fn, cls, title) => { const x = h('button', { class: 'action' + (cls ? ' ' + cls : ''), title }, label); x.addEventListener('click', fn); return x; };
      return panel('out', _T('Appliquer et exporter'), [
        row(_T('Nom'), nameIn),
        row(_T('Sur'), actionGroup([{ v: 'clip', label: _T('Clip visé ou sélection') }, { v: 'sequence', label: _T('Toute la séquence') }], s.target, v => { s.target = v; app.persist(); })),
        h('div', { class: 'row-buttons wrap' },
          b(_T('Enregistrer le look'), saveLook, '', _T('Dans Mes effets, partageable et publiable')),
          b(_T('Exporter .cube…'), exportCube, '', _T('LUT 33³ pour Premiere, Resolve, Final Cut, CapCut…')),
          b(_T('Exporter DCTL…'), exportDctl, '', _T('Pour DaVinci Resolve, avec les curseurs Lightroom'))),
        h('div', { class: 'note' }, _T('Dans Premiere, le look est une LUT .cube posée sur un calque de réglage Lumetri (« Appliquer le look » en haut). Premiere ne lit pas les DCTL : le DCTL est pour DaVinci Resolve, avec les mêmes curseurs que ce panneau.'))
      ]);
    }

    // ---------------------------------------------------------------- page

    const NAV = [['looks', 'Looks'], ['basic', _T('Réglages')], ['curve', _T('Courbe')], ['grading', _T('Roues')], ['luts', _T('Mes LUTs')], ['gradient', _T('Dégradés')], ['log', 'LOG'], ['fix', _T('Raccord')], ['out', _T('Exporter')]];
    function render(view) {
      if (view) V.view = view;
      view = V.view;
      if (!view || !view.isConnected || app.S.tab !== 'color') return;
      const s = st();
      view.innerHTML = '';
      V.src = null;
      V.histo = h('canvas', { class: 'lr-histo' });
      V.canvas = h('canvas', { class: 'pv-canvas', width: PW * 2, height: PH * 2 });
      const frame = h('div', { class: 'pv-frame lr-preview' }, V.canvas);
      // Séparateur avant / après à glisser.
      V.canvas.addEventListener('pointerdown', e => {
        if (s.view !== 'split') return;
        V.canvas.setPointerCapture(e.pointerId);
        const mv = ev => { const r = V.canvas.getBoundingClientRect(); s.split = Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)); drawPreview(); };
        mv(e);
        const up = () => { V.canvas.removeEventListener('pointermove', mv); V.canvas.removeEventListener('pointerup', up); app.persist(); };
        V.canvas.addEventListener('pointermove', mv);
        V.canvas.addEventListener('pointerup', up);
      });
      const realBtn = h('button', { class: 'action quiet', title: _T('Deux images de ta séquence autour de la coupe la plus proche') }, Pv.isReal() ? _T('Plans de test') : _T('📷 Ma vraie image'));
      realBtn.addEventListener('click', async () => {
        if (Pv.isReal()) { Pv.resetShots(); render(); return; }
        if (app.services.grabFrames) { await app.services.grabFrames(); render(); }
      });
      view.appendChild(h('div', { class: 'section' },
        V.histo, frame,
        h('div', { class: 'pv-bar lr-bar' },
          actionGroup([{ v: 'split', label: _T('Avant | Après') }, { v: 'after', label: _T('Après') }, { v: 'before', label: _T('Avant') }], s.view, v => { s.view = v; app.persist(); drawPreview(); }),
          actionGroup([{ v: 'A', label: _T('Plan 1') }, { v: 'B', label: _T('Plan 2') }], s.shot, v => { s.shot = v; V.src = null; app.persist(); update(true); }),
          realBtn)));
      // Sommaire collant : un clic amène au panneau (et l'ouvre).
      const nav = h('div', { class: 'sec-nav', role: 'navigation', 'aria-label': _T('Panneaux de l\'onglet Couleur') });
      view.appendChild(nav);
      if (app.conversion) view.appendChild(app.conversion.panel(panel, () => { V.src = null; update(true); }));
      if (app.correction) view.appendChild(app.correction.panel(panel));
      if (app.lutLibrary) view.appendChild(app.lutLibrary.panel(panel));
      if (app.gradients) view.appendChild(app.gradients.panel(panel));
      view.appendChild(looksPanel());
      view.appendChild(basicPanel());
      view.appendChild(curvePanel());
      view.appendChild(mixerPanel());
      view.appendChild(gradingPanel());
      view.appendChild(calibPanel());
      view.appendChild(outPanel());
      NAV.forEach(([id, label]) => {
        const el = view.querySelector('[data-panel="' + id + '"]');
        if (!el) return;
        const b = h('button', { class: 'action', 'data-target': id }, label);
        b.addEventListener('click', () => {
          if (el.classList.contains('closed')) el.querySelector('.lr-head').click();
          const sc = document.getElementById('scroll');
          sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - nav.offsetHeight - 4;
        });
        nav.appendChild(b);
      });
      requestAnimationFrame(() => update(true));
    }

    app.actions.applyLook = applyInPremiere;
    app.tabs.color = {
      render,
      cta: () => ({ label: _T('Appliquer le look · ') + (st().name || _T('Mon look')), run: applyInPremiere, enabled: true }),
      leave: () => { cancelAnimationFrame(V.timer); clearTimeout(V.hq); V.timer = 0; }
    };
    // Un look de la bibliothèque (Mes effets, communauté) s'ouvre ici.
    app.services.openLook = item => { st().params = D.normalize(item.data.params); st().name = item.name; app.persist(); app.switchTab('color'); };
  });
})(typeof self !== 'undefined' ? self : this);
