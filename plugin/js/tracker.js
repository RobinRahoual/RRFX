/* RR FX : suivi d'un objet (produit, personne, logo…) d'image en image. Tu entoures l'objet
   sur la première image ; RR FX le retrouve dans les suivantes par corrélation (le motif le plus
   ressemblant autour de sa dernière position) et en tire sa trajectoire, pour un zoom qui le
   suit. Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXTracker = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SIDE = 24; // motif ramené à 24 × 24 points au plus (rapide et assez précis)

  // Motif : les points d'un rectangle (en pixels) échantillonnés sur une grille, centrés et normés.
  function patch(g, w, h, cx, cy, bw, bh, n) {
    const out = new Float32Array(n * n);
    let m = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = Math.min(w - 1, Math.max(0, Math.round(cx - bw / 2 + (i + 0.5) * bw / n)));
      const y = Math.min(h - 1, Math.max(0, Math.round(cy - bh / 2 + (j + 0.5) * bh / n)));
      out[j * n + i] = g[y * w + x];
      m += out[j * n + i];
    }
    m /= out.length;
    let e = 0;
    for (let k = 0; k < out.length; k++) { out[k] -= m; e += out[k] * out[k]; }
    const s = Math.sqrt(e) || 1;
    for (let k = 0; k < out.length; k++) out[k] /= s;
    return out;
  }
  const ncc = (a, b) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };

  /* frames : [{ g (gris), w, h }] dans l'ordre ; box : { x, y, w, h } (0 à 1) sur la première.
     → [{ x, y, score }] : centre de l'objet (0 à 1) dans chaque image ; score < 0,5 : perdu
     (la position précédente est gardée). */
  function track(frames, box, opts) {
    const o = Object.assign({ search: 1.2, keep: 0.5 }, opts || {});
    const f0 = frames[0], bw = box.w * f0.w, bh = box.h * f0.h, n = Math.max(8, Math.min(SIDE, Math.round(Math.min(bw, bh))));
    let cx = (box.x + box.w / 2) * f0.w, cy = (box.y + box.h / 2) * f0.h, vx = 0, vy = 0;
    const first = patch(f0.g, f0.w, f0.h, cx, cy, bw, bh, n);
    let tpl = first;
    const out = [{ x: cx / f0.w, y: cy / f0.h, score: 1 }];
    for (let k = 1; k < frames.length; k++) {
      const f = frames[k], R = Math.max(bw, bh) * o.search;
      // Recherche grossière (pas de 2 px) autour de la position prévue, puis affinée au pixel.
      const px = cx + vx, py = cy + vy;
      let best = -2, bx = px, by = py;
      const scan = (x0, x1, y0, y1, st) => {
        for (let y = y0; y <= y1; y += st) for (let x = x0; x <= x1; x += st) {
          const s = ncc(tpl, patch(f.g, f.w, f.h, x, y, bw, bh, n));
          if (s > best) { best = s; bx = x; by = y; }
        }
      };
      scan(Math.round(px - R), Math.round(px + R), Math.round(py - R), Math.round(py + R), 2);
      scan(bx - 2, bx + 2, by - 2, by + 2, 1);
      if (best >= o.keep) {
        vx = (bx - cx) * 0.5; vy = (by - cy) * 0.5;
        cx = bx; cy = by;
        // Le motif s'adapte doucement (lumière, angle) sans oublier l'objet de départ.
        const cur = patch(f.g, f.w, f.h, cx, cy, bw, bh, n), mix = new Float32Array(tpl.length);
        let e = 0;
        for (let i = 0; i < mix.length; i++) { mix[i] = 0.6 * tpl[i] + 0.25 * cur[i] + 0.15 * first[i]; e += mix[i] * mix[i]; }
        e = Math.sqrt(e) || 1;
        for (let i = 0; i < mix.length; i++) mix[i] /= e;
        tpl = mix;
      } else { vx = 0; vy = 0; }
      out.push({ x: cx / f.w, y: cy / f.h, score: best });
    }
    return out;
  }

  return { track };
});
