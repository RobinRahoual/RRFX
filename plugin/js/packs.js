/* RR FX : packs d'overlays fournis avec le plugin. Rien à télécharger : chaque overlay est
   dessiné image par image (light leaks, flares, bokeh, poussière, brûlure de pellicule,
   VHS…) sur fond noir, pour un mode de fusion Écran / Ajout. Pour Premiere, la séquence
   d'images JPEG est fabriquée une fois, à la taille de la séquence, puis gardée sur disque. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXPacks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const TAU = Math.PI * 2;
  const DURATION = 2; // secondes d'overlay fabriquées

  // Générateur pseudo-aléatoire reproductible (mulberry32).
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
  const smooth = x => x * x * (3 - 2 * x);

  function glow(g, x, y, r, color, alpha) {
    if (!(r > 0) || alpha <= 0) return;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(color, alpha));
    gr.addColorStop(0.45, rgba(color, alpha * 0.45));
    gr.addColorStop(1, rgba(color, 0));
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ---------------------------------------------------------------- générateurs
  // draw(g, W, H, t, frame, def) : t de 0 à 1 sur la durée, frame = numéro d'image.

  const GENERATORS = {
    // Taches de lumière colorées qui dérivent et respirent.
    leak(g, W, H, t, frame, d) {
      const R = rng(d.seed), D = Math.max(W, H);
      for (let i = 0; i < 4; i++) {
        const cx = R(), cy = R(), ax = 0.15 + R() * 0.3, ay = 0.1 + R() * 0.2, sp = 0.3 + R() * 0.5, ph = R();
        const x = W * (cx + ax * Math.sin(TAU * (t * sp + ph))), y = H * (cy + ay * Math.cos(TAU * (t * sp * 0.8 + ph)));
        const pulse = 0.65 + 0.35 * Math.sin(TAU * (t * (1 + R()) + ph));
        glow(g, x, y, D * (0.3 + R() * 0.35), d.colors[i % d.colors.length], 0.75 * pulse);
      }
    },
    // Flare anamorphique : longue traînée horizontale, halo et reflets qui traversent l'image.
    flare(g, W, H, t, frame, d) {
      const R = rng(d.seed), y = H * (0.3 + R() * 0.4), x = W * (-0.15 + 1.3 * t), c = d.colors[0], c2 = d.colors[1] || c;
      const flick = 0.85 + 0.15 * Math.sin(frame * 1.7);
      for (let k = 0; k < 4; k++) {
        const h = H * (0.004 + k * 0.006), a = (0.5 - k * 0.1) * flick;
        const gr = g.createLinearGradient(0, 0, W, 0);
        gr.addColorStop(0, rgba(c, 0));
        gr.addColorStop(Math.max(0.01, Math.min(0.99, x / W)), rgba(c, a));
        gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr;
        g.fillRect(0, y - h, W, h * 2);
      }
      glow(g, x, y, H * 0.35, c2, 0.8 * flick);
      glow(g, x, y, H * 0.08, [255, 255, 255], 0.9 * flick);
      // Reflets sur l'axe qui passe par le centre de l'image.
      for (let k = 1; k <= 4; k++) {
        const u = -0.4 * k, gx = W / 2 + (x - W / 2) * u, gy = H / 2 + (y - H / 2) * u;
        glow(g, gx, gy, H * (0.03 + R() * 0.07), k % 2 ? c : c2, 0.25 * flick);
      }
    },
    // Bokeh : disques flous qui montent doucement et scintillent.
    bokeh(g, W, H, t, frame, d) {
      const R = rng(d.seed), D = Math.max(W, H);
      for (let i = 0; i < 28; i++) {
        const r = D * (0.015 + R() * 0.045), x = W * R() + Math.sin(TAU * (t + R())) * D * 0.02;
        const y = ((R() * 1.3 - 0.15 - t * (0.1 + R() * 0.2)) % 1.3 + 1.3) % 1.3 * H - 0.15 * H;
        const a = 0.18 + 0.3 * (0.5 + 0.5 * Math.sin(TAU * (t * 2 + R())));
        const c = d.colors[i % d.colors.length];
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, rgba(c, a * 0.6));
        gr.addColorStop(0.8, rgba(c, a));
        gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.fill();
      }
    },
    // Poussière et rayures de pellicule : différent à chaque image.
    dust(g, W, H, t, frame, d) {
      const R = rng(d.seed * 7919 + frame * 104729), D = Math.max(W, H), n = Math.round(d.amount * (0.6 + R() * 0.8));
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (let i = 0; i < n; i++) {
        const s = D * (0.0008 + R() * R() * 0.004);
        g.globalAlpha = 0.3 + R() * 0.7;
        g.beginPath();
        g.ellipse(W * R(), H * R(), s, s * (0.4 + R()), R() * Math.PI, 0, TAU);
        g.fill();
      }
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < (R() < 0.35 ? 1 + Math.floor(R() * 2) : 0); i++) {
        const x = W * R(), y = H * R(), L = D * (0.02 + R() * 0.05);
        g.globalAlpha = 0.5 + R() * 0.4;
        g.lineWidth = Math.max(1, D * 0.0008);
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + L * (R() - 0.5), y + L * R(), x + L * (R() - 0.5), y + L * R(), x + L * (R() - 0.5), y + L);
        g.stroke();
      }
      for (let i = 0; i < d.scratches; i++) {
        if (R() < 0.4) continue;
        const x = W * R();
        g.globalAlpha = 0.15 + R() * 0.35;
        g.lineWidth = Math.max(1, D * 0.0006);
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + D * 0.004 * (R() - 0.5), H);
        g.stroke();
      }
      g.globalAlpha = 1;
    },
    // Brûlure de pellicule : une flamme orange qui envahit l'image depuis un bord.
    burn(g, W, H, t, frame, d) {
      const R = rng(d.seed), side = Math.floor(R() * 4), D = Math.max(W, H), grow = smooth(Math.min(1, t * 1.4));
      const base = [[0, H * R()], [W, H * R()], [W * R(), 0], [W * R(), H]][side];
      const R2 = rng(d.seed * 31 + Math.floor(frame / 2));
      for (let i = 0; i < 7; i++) {
        const j = R2(), r = D * (0.15 + 0.55 * grow) * (0.5 + R() * 0.6);
        const x = base[0] + (R() - 0.5) * D * 0.4 * grow + (j - 0.5) * D * 0.02, y = base[1] + (R() - 0.5) * D * 0.4 * grow;
        glow(g, x, y, r, d.colors[i % d.colors.length], 0.55 + 0.35 * grow);
      }
      glow(g, base[0], base[1], D * (0.1 + 0.5 * grow * grow), [255, 245, 220], 0.85 * grow * grow);
    },
    // VHS : lignes parasites, bande de défilement qui descend, bavure de couleur.
    vhs(g, W, H, t, frame, d) {
      const R = rng(d.seed * 13 + frame * 7);
      const bandY = ((t * 1.6 + 0.2) % 1.2 - 0.1) * H, bandH = H * 0.06;
      g.fillStyle = 'rgba(255,255,255,0.10)';
      g.fillRect(0, bandY, W, bandH);
      for (let i = 0; i < 26; i++) {
        const y = R() < 0.5 ? bandY + R() * bandH : R() * H, h = Math.max(1, H * (0.001 + R() * 0.003)), x = W * R() * 0.6;
        const c = R() < 0.5 ? [255, 255, 255] : R() < 0.5 ? [255, 60, 90] : [60, 140, 255];
        g.fillStyle = rgba(c, 0.15 + R() * 0.45);
        g.fillRect(x, y, W * (0.2 + R() * 0.8), h);
      }
      g.fillStyle = 'rgba(255,255,255,0.035)';
      for (let y = 0; y < H; y += Math.max(2, Math.round(H / 270))) g.fillRect(0, y, W, 1);
    },
    // Glitch RGB : blocs rouges, verts, bleus qui changent toutes les deux images.
    rgb(g, W, H, t, frame, d) {
      const R = rng(d.seed * 17 + Math.floor(frame / 2) * 3), cols = [[255, 0, 40], [0, 255, 120], [40, 80, 255]];
      const n = R() < 0.25 ? 0 : 4 + Math.floor(R() * 10);
      for (let i = 0; i < n; i++) {
        g.fillStyle = rgba(cols[Math.floor(R() * 3)], 0.25 + R() * 0.5);
        g.fillRect(W * R() * 0.9, H * R(), W * (0.05 + R() * 0.5), H * (0.005 + R() * 0.05));
      }
    },
    // Balayage de lumière en diagonale.
    sweep(g, W, H, t, frame, d) {
      const D = Math.hypot(W, H), x = -0.3 * D + 1.6 * D * smooth(t), c = d.colors[0];
      g.save();
      g.translate(W / 2, H / 2);
      g.rotate(d.angle * Math.PI / 180);
      g.translate(-D / 2, -D / 2);
      const w = D * 0.18, gr = g.createLinearGradient(x - w, 0, x + w, 0);
      gr.addColorStop(0, rgba(c, 0));
      gr.addColorStop(0.5, rgba(c, 0.85));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.fillRect(x - w, 0, w * 2, D);
      g.restore();
    }
  };

  // ---------------------------------------------------------------- packs

  const WARM = [[255, 120, 30], [255, 190, 70], [255, 70, 20]];
  const PACKS = [
    { id: 'leaks', name: 'Light leaks', items: [
      { id: 'leak-warm', name: _T('Leak chaud'), gen: 'leak', seed: 11, colors: WARM },
      { id: 'leak-pink', name: _T('Leak rose'), gen: 'leak', seed: 23, colors: [[255, 60, 140], [255, 140, 60], [170, 50, 255]] },
      { id: 'leak-teal', name: _T('Leak bleu'), gen: 'leak', seed: 37, colors: [[40, 190, 255], [110, 255, 200], [70, 90, 255]] },
      { id: 'leak-gold', name: _T('Leak doré'), gen: 'leak', seed: 41, colors: [[255, 205, 120], [255, 160, 60], [255, 235, 190]] }
    ] },
    { id: 'flares', name: 'Flares', items: [
      { id: 'flare-blue', name: _T('Flare anamorphique'), gen: 'flare', seed: 5, colors: [[70, 150, 255], [140, 200, 255]] },
      { id: 'flare-warm', name: _T('Flare soleil'), gen: 'flare', seed: 9, colors: [[255, 150, 60], [255, 210, 140]] }
    ] },
    { id: 'bokeh', name: 'Bokeh', items: [
      { id: 'bokeh-warm', name: _T('Bokeh chaud'), gen: 'bokeh', seed: 3, colors: WARM.concat([[255, 230, 180]]) },
      { id: 'bokeh-cool', name: _T('Bokeh froid'), gen: 'bokeh', seed: 8, colors: [[120, 180, 255], [200, 120, 255], [150, 255, 230]] }
    ] },
    { id: 'film', name: _T('Pellicule'), items: [
      { id: 'dust', name: _T('Poussière'), gen: 'dust', seed: 2, amount: 40, scratches: 2 },
      { id: 'dust-heavy', name: _T('Vieux film'), gen: 'dust', seed: 6, amount: 120, scratches: 5 },
      { id: 'burn-orange', name: _T('Brûlure'), gen: 'burn', seed: 4, colors: WARM },
      { id: 'burn-red', name: _T('Brûlure rouge'), gen: 'burn', seed: 12, colors: [[255, 40, 20], [255, 110, 30], [200, 20, 60]] }
    ] },
    { id: 'retro', name: 'VHS & glitch', items: [
      { id: 'vhs', name: 'VHS', gen: 'vhs', seed: 1 },
      { id: 'rgb-glitch', name: 'Glitch RGB', gen: 'rgb', seed: 7 }
    ] },
    { id: 'light', name: _T('Lumière'), items: [
      { id: 'sweep-white', name: _T('Balayage'), gen: 'sweep', angle: -25, colors: [[255, 255, 255]] },
      { id: 'sweep-warm', name: _T('Balayage chaud'), gen: 'sweep', angle: 20, colors: [[255, 180, 90]] }
    ] }
  ];
  const ALL = [];
  const byId = {};
  PACKS.forEach(p => p.items.forEach(it => { it.pack = p.id; it.packName = p.name; ALL.push(it); byId[it.id] = it; }));

  // Une image de l'overlay `def`, sur fond noir.
  function draw(g, W, H, t, frame, def) {
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    GENERATORS[def.gen](g, W, H, Math.max(0, Math.min(1, t)), frame, def);
    g.restore();
  }

  // Nombre d'images fabriquées (2 s, entre 24 et 60 images) et noms des fichiers.
  const frameCount = fps => Math.max(24, Math.min(60, Math.round((fps || 25) * DURATION)));
  const folderName = (def, W, H, fps) => def.id + '-' + W + 'x' + H + '-' + frameCount(fps);
  const fileName = (def, i) => def.id + '_' + String(i).padStart(3, '0') + '.jpg';
  // Taille fabriquée : celle de la séquence (au plus 3840 de côté).
  function frameSize(w, h) {
    w = w || 1920; h = h || 1080;
    const k = Math.min(1, 3840 / Math.max(w, h));
    return { W: Math.max(2, Math.round(w * k)), H: Math.max(2, Math.round(h * k)) };
  }

  return { PACKS, ALL, byId, GENERATORS, draw, rng, frameCount, folderName, fileName, frameSize, DURATION };
});
