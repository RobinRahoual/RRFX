/* RR FX : visages. Trouve le visage dans des images de la timeline (détecteur de Viola-Jones,
   cascade d'OpenCV, sans connexion), en déduit la ligne des yeux et la suit dans le temps, pour
   les zooms « visage » : le plan grossit mais les yeux restent à leur place à l'écran (ou sont
   recentrés). Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory(require('./vendor/haar-face.js'));
  else root.RRFXFaces = factory(root.RRFXHaarFace);
})(typeof self !== 'undefined' ? self : this, function (CASCADE) {
  'use strict';

  // Place des yeux dans le cadre du visage trouvé (milieu des deux yeux).
  const EYES_X = 0.5, EYES_Y = 0.4;

  /* Luminance 0-255 d'une image RVBA (ImageData.data). */
  function luma(data, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    return g;
  }

  /* Images intégrales (somme et somme des carrés), décalées d'une ligne et d'une colonne. */
  function integrals(g, w, h) {
    const W = w + 1, S = new Float64Array(W * (h + 1)), Q = new Float64Array(W * (h + 1));
    for (let y = 0; y < h; y++) {
      let rs = 0, rq = 0;
      for (let x = 0; x < w; x++) {
        const v = g[y * w + x];
        rs += v; rq += v * v;
        S[(y + 1) * W + x + 1] = S[y * W + x + 1] + rs;
        Q[(y + 1) * W + x + 1] = Q[y * W + x + 1] + rq;
      }
    }
    return { S, Q, W };
  }

  /* Cascade mise à l'échelle s pour une image intégrale de largeur W : chaque rectangle devient
     4 décalages dans l'image intégrale (calculés une fois par échelle, pas à chaque fenêtre).
     Même disposition que la cascade, les rectangles remplacés par [o1, o2, o3, o4, poids]. */
  function scaled(d, s, W) {
    const out = new Float64Array(d.length);
    out[0] = d[0]; out[1] = d[1];
    for (let w = 2; w < d.length;) {
      out[w] = d[w]; w++;
      let nodes = out[w] = d[w]; w++;
      while (nodes--) {
        out[w] = d[w]; w++;
        const nr = out[w] = d[w]; w++;
        for (let r = 0; r < nr; r++) {
          const x0 = (d[w] * s + 0.5) | 0, y0 = (d[w + 1] * s + 0.5) | 0;
          const x1 = x0 + ((d[w + 2] * s + 0.5) | 0), y1 = y0 + ((d[w + 3] * s + 0.5) | 0);
          out[w] = y1 * W + x1; out[w + 1] = y0 * W + x1; out[w + 2] = y1 * W + x0; out[w + 3] = y0 * W + x0; out[w + 4] = d[w + 4];
          w += 5;
        }
        out[w] = d[w]; out[w + 1] = d[w + 1]; out[w + 2] = d[w + 2];
        w += 3;
      }
    }
    return out;
  }

  // La fenêtre dont le coin est à `base` dans l'image intégrale passe-t-elle tous les étages ?
  function passes(c, S, base, inv, sd) {
    for (let w = 2; w < c.length;) {
      const stageThr = c[w++];
      let nodes = c[w++], sum = 0;
      while (nodes--) {
        w++; // incliné : jamais dans cette cascade
        const nr = c[w++];
        let rs = 0;
        for (let r = 0; r < nr; r++, w += 5) rs += (S[base + c[w]] - S[base + c[w + 1]] - S[base + c[w + 2]] + S[base + c[w + 3]]) * c[w + 4];
        sum += rs * inv < c[w] * sd ? c[w + 1] : c[w + 2];
        w += 3;
      }
      if (sum < stageThr) return false;
    }
    return true;
  }

  // Regroupe les fenêtres qui se recouvrent (un vrai visage en donne plusieurs voisines).
  function group(rects, minNeighbors) {
    const parent = rects.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const close = (a, b) => {
      const d = 0.2 * (Math.min(a.w, b.w) + Math.min(a.w, b.w)) / 2;
      return Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d && Math.abs(a.x + a.w - b.x - b.w) <= d && Math.abs(a.y + a.h - b.y - b.h) <= d;
    };
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (close(rects[i], rects[j])) parent[find(i)] = find(j);
    const groups = new Map();
    rects.forEach((r, i) => {
      const k = find(i), g = groups.get(k) || { x: 0, y: 0, w: 0, h: 0, n: 0 };
      g.x += r.x; g.y += r.y; g.w += r.w; g.h += r.h; g.n++;
      groups.set(k, g);
    });
    return Array.from(groups.values()).filter(g => g.n >= minNeighbors).map(g => ({ x: g.x / g.n, y: g.y / g.n, w: g.w / g.n, h: g.h / g.n, n: g.n }));
  }

  /* Visages d'une image en niveaux de gris → [{ x, y, w, h, n }] en pixels, le plus sûr d'abord.
     opts : minSize, maxSize (part du petit côté : 0.14, 1), scaleFactor (1.1), step (1),
     minNeighbors (3), roi ({ x0, y0, x1, y1 } en pixels : ne chercher que là). */
  function detect(g, w, h, opts) {
    const o = Object.assign({ minSize: 0.14, maxSize: 1, scaleFactor: 1.1, step: 1, minNeighbors: 3, roi: null }, opts || {});
    const d = CASCADE, base = d[0], { S, Q, W } = integrals(g, w, h), rects = [];
    const lo = Math.max(base, Math.round(Math.min(w, h) * o.minSize)), hi = Math.min(w, h) * o.maxSize;
    for (let s = lo / base; base * s <= hi; s *= o.scaleFactor) {
      const b = Math.round(base * s), step = Math.max(1, Math.round(s * o.step)), inv = 1 / (b * b), cs = scaled(d, s, W);
      const r = o.roi || { x0: 0, y0: 0, x1: w, y1: h };
      for (let y = Math.max(0, Math.round(r.y0)); y + b < Math.min(h, r.y1); y += step) {
        for (let x = Math.max(0, Math.round(r.x0)); x + b < Math.min(w, r.x1); x += step) {
          const a = y * W + x, c = (y + b) * W + x + b;
          const sum = S[c] - S[y * W + x + b] - S[(y + b) * W + x] + S[a];
          const sq = Q[c] - Q[y * W + x + b] - Q[(y + b) * W + x] + Q[a];
          const mean = sum * inv, v = sq * inv - mean * mean;
          // Zone unie (mur, ciel) : pas de visage, on passe vite.
          if (v < 60) continue;
          if (passes(cs, S, a, inv, Math.sqrt(v))) rects.push({ x, y, w: b, h: b });
        }
      }
    }
    return group(rects, o.minNeighbors).sort((p, q) => q.n * q.w - p.n * p.w);
  }

  /* Visage d'une image RVBA → { x, y } des yeux (0 à 1 dans le cadre) et la taille, ou null. */
  function eyesIn(img, prev, opts) {
    const W = img.width, H = img.height, g = luma(img.data, W, H);
    let faces = [];
    // Visage déjà vu : on cherche d'abord autour de lui, à une taille voisine (bien plus rapide).
    if (prev && prev.size) {
      const fw = prev.size * W, m = Math.min(W, H);
      faces = detect(g, W, H, Object.assign({}, opts, {
        minSize: Math.max(0.05, fw * 0.75 / m), maxSize: Math.min(1, fw * 1.35 / m),
        roi: { x0: prev.x * W - fw * 1.4, y0: prev.y * H - fw * 1.1, x1: prev.x * W + fw * 1.4, y1: prev.y * H + fw * 1.6 }
      }));
    }
    if (!faces.length) faces = detect(g, W, H, opts);
    if (!faces.length) return null;
    // Plusieurs visages : le plus proche du précédent, sinon le plus grand et le plus sûr.
    let f = faces[0];
    if (prev) {
      const dist = q => Math.hypot((q.x + q.w * EYES_X) / img.width - prev.x, (q.y + q.h * EYES_Y) / img.height - prev.y);
      f = faces.slice().sort((p, q) => dist(p) - dist(q))[0];
      if (dist(f) > 0.25) f = faces[0];
    }
    return { x: (f.x + f.w * EYES_X) / img.width, y: (f.y + f.h * EYES_Y) / img.height, size: f.w / img.width };
  }

  /* Suivi : yeux trouvés à quelques instants → une position par image du plan.
     samples : [{ at (0 à 1 dans le plan), eyes: { x, y } | null }] ; N : images du plan ;
     smooth : 0 (suivi serré) à 1 (très doux) ; fixed : une seule position (la médiane).
     → [[x, y], …] (N valeurs), ou null si aucun visage. Les valeurs sont posées tous les
     `knot` images et reliées en ligne droite : peu d'images clés dans Premiere. */
  function track(samples, N, opts) {
    const o = Object.assign({ smooth: 0.5, fixed: false, knot: 5 }, opts || {});
    let pts = samples.filter(s => s.eyes).map(s => ({ i: s.at * Math.max(0, N - 1), x: s.eyes.x, y: s.eyes.y })).sort((a, b) => a.i - b.i);
    if (!pts.length) return null;
    const med = a => a.slice().sort((p, q) => p - q)[a.length >> 1];
    // Détection isolée trop loin de ses voisines : on l'écarte (fausse détection).
    if (pts.length >= 3) {
      pts = pts.filter((p, k) => {
        const nb = pts.slice(Math.max(0, k - 2), k + 3);
        return Math.hypot(p.x - med(nb.map(q => q.x)), p.y - med(nb.map(q => q.y))) < 0.12;
      });
      if (!pts.length) return null;
    }
    if (o.fixed) {
      const m = [med(pts.map(p => p.x)), med(pts.map(p => p.y))];
      return Array.from({ length: N }, () => m.slice());
    }
    // Position à chaque image : interpolée entre les détections, tenue avant et après.
    const at = i => {
      if (i <= pts[0].i) return [pts[0].x, pts[0].y];
      const l = pts[pts.length - 1];
      if (i >= l.i) return [l.x, l.y];
      let k = 1;
      while (pts[k].i < i) k++;
      const a = pts[k - 1], b = pts[k], u = (i - a.i) / Math.max(1e-9, b.i - a.i);
      return [a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u];
    };
    const raw = Array.from({ length: N }, (_, i) => at(i));
    // Lissage (moyenne glissante) pour un mouvement de caméra posé.
    const r = Math.round(o.smooth * 12);
    const sm = raw.map((_, i) => {
      let sx = 0, sy = 0, n = 0;
      for (let j = Math.max(0, i - r); j <= Math.min(N - 1, i + r); j++) { sx += raw[j][0]; sy += raw[j][1]; n++; }
      return [sx / n, sy / n];
    });
    // Nœuds tous les `knot` images, reliés en ligne droite.
    const out = new Array(N);
    for (let a = 0; a < N; a += o.knot) {
      const b = Math.min(N - 1, a + o.knot);
      for (let i = a; i <= b; i++) {
        const u = b === a ? 0 : (i - a) / (b - a);
        out[i] = [sm[a][0] + (sm[b][0] - sm[a][0]) * u, sm[a][1] + (sm[b][1] - sm[a][1]) * u];
      }
    }
    return out;
  }

  /* Transformer (ancre au centre) pour un zoom z (1.2 = +20 %) quand les yeux sont en e :
     keep : les yeux restent où ils sont à l'écran ; center : ils vont en `to` (milieu, au tiers
     haut), sans jamais laisser voir de bord noir. → position [x, y] (0 à 1). */
  function framing(e, z, mode, to) {
    if (mode !== 'center') return [0.5 + (e[0] - 0.5) * (1 - z), 0.5 + (e[1] - 0.5) * (1 - z)];
    const t = to || [0.5, 0.4], m = (z - 1) / 2;
    const c = v => Math.min(0.5 + m, Math.max(0.5 - m, v));
    return [c(t[0] - (e[0] - 0.5) * z), c(t[1] - (e[1] - 0.5) * z)];
  }

  /* Instants à analyser pour une liste de plans (en secondes) : un tous les `every` s, au moins
     2 et au plus `max` par plan, `budget` en tout. → [{ times: [s], at: [0 à 1] }] */
  function sampling(spans, opts) {
    const o = Object.assign({ every: 0.4, max: 24, budget: 160 }, opts || {});
    let per = spans.map(s => Math.min(o.max, Math.max(2, Math.round((s.b - s.a) / o.every) + 1)));
    const total = per.reduce((a, b) => a + b, 0);
    if (total > o.budget) per = per.map(n => Math.max(2, Math.floor(n * o.budget / total)));
    return spans.map((s, k) => {
      const at = Array.from({ length: per[k] }, (_, i) => 0.04 + 0.92 * i / (per[k] - 1));
      return { at, times: at.map(u => s.a + (s.b - s.a) * u) };
    });
  }

  /* Visages trouvés par YuNet (yunet.js : boîtes et repères en pixels) → les yeux à suivre,
     comme eyesIn : le visage le plus proche du précédent, sinon le plus sûr ; null si aucun.
     Les yeux viennent des repères du réseau (milieu des deux yeux), pas d'une proportion de la boîte. */
  function pickFace(faces, W, H, prev) {
    if (!faces || !faces.length) return null;
    const eyes = f => ({ x: (f.eyes[0][0] + f.eyes[1][0]) / 2 / W, y: (f.eyes[0][1] + f.eyes[1][1]) / 2 / H, size: f.w / W });
    let f = faces[0];
    if (prev) {
      const dist = q => { const e = eyes(q); return Math.hypot(e.x - prev.x, e.y - prev.y); };
      const near = faces.slice().sort((p, q) => dist(p) - dist(q))[0];
      if (dist(near) <= 0.25) f = near;
    }
    return eyes(f);
  }

  return { EYES_X, EYES_Y, luma, detect, eyesIn, pickFace, track, framing, sampling };
});
