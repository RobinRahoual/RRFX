/* RR FX : couleurs, palettes et dégradés. Lecture des couleurs collées (#hex, rgb(), lien
   Coolors), des nuanciers Adobe .ase, des dégradés CSS ; réglages de l'effet Dégradé (Ramp) de
   Premiere ; styles de texte (police, couleurs, contour, ombre, fond). Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXCouleurs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const h2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  const toHex = (r, g, b) => '#' + h2(r) + h2(g) + h2(b);

  /* « #abc », « abcdef », « rgb(1, 2, 3) » → « #aabbcc » (ou null). */
  function hex(s) {
    const t = String(s || '').trim();
    let m = /^#?([0-9a-f]{6})$/i.exec(t);
    if (m) return '#' + m[1].toLowerCase();
    m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(t);
    if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(t);
    return m ? toHex(+m[1], +m[2], +m[3]) : null;
  }
  const rgb = c => { const x = hex(c) || '#ffffff'; return [parseInt(x.slice(1, 3), 16), parseInt(x.slice(3, 5), 16), parseInt(x.slice(5, 7), 16)]; };

  /* Toutes les couleurs d'un texte collé : #hex, rgb(), lien Coolors (…/palette/264653-2a9d8f).
     → ['#rrggbb', …] sans doublon, dans l'ordre. */
  function parseColors(text) {
    const s = String(text || ''), out = [];
    const add = c => { const x = hex(c); if (x && out.indexOf(x) < 0) out.push(x); };
    const cool = /coolors\.co\/(?:palette\/)?([0-9a-f]{6}(?:-[0-9a-f]{6})+)/i.exec(s);
    if (cool) cool[1].split('-').forEach(add);
    (s.match(/rgba?\([^)]*\)/gi) || []).forEach(add);
    (s.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi) || []).forEach(add);
    // Codes sans « # », séparés par des espaces, virgules ou tirets (copiés d'un site de palettes).
    if (!out.length) (s.match(/\b[0-9a-f]{6}\b/gi) || []).forEach(add);
    return out;
  }

  /* Nuancier Adobe (.ase, Photoshop / Illustrator / Adobe Color) → [{ name, hex }]. */
  function parseASE(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'ASEF') throw new Error(_T('Ce fichier n\'est pas un nuancier Adobe (.ase).'));
    const n = dv.getUint32(8), out = [];
    let p = 12;
    for (let k = 0; k < n && p + 6 <= b.length; k++) {
      const type = dv.getUint16(p), len = dv.getUint32(p + 2), body = p + 6;
      p = body + len;
      if (type !== 1) continue;
      const nl = dv.getUint16(body);
      let name = '';
      for (let i = 0; i < nl - 1; i++) name += String.fromCharCode(dv.getUint16(body + 2 + i * 2));
      let q = body + 2 + nl * 2;
      const model = String.fromCharCode(b[q], b[q + 1], b[q + 2], b[q + 3]).trim();
      q += 4;
      const f = i => dv.getFloat32(q + i * 4);
      let c = null;
      if (model === 'RGB') c = toHex(f(0) * 255, f(1) * 255, f(2) * 255);
      else if (model === 'CMYK') { const k4 = f(3); c = toHex(255 * (1 - f(0)) * (1 - k4), 255 * (1 - f(1)) * (1 - k4), 255 * (1 - f(2)) * (1 - k4)); } else if (model === 'Gray') c = toHex(f(0) * 255, f(0) * 255, f(0) * 255);
      else if (model === 'LAB') {
        // L 0-1 (×100), a et b en valeurs directes → sRGB (D65).
        const L = f(0) * 100, A = f(1), B = f(2);
        const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - B / 200;
        const inv = t => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
        const X = 0.95047 * inv(fx), Y = inv(fy), Z = 1.08883 * inv(fz);
        const g = v => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
        c = toHex(g(3.2406 * X - 1.5372 * Y - 0.4986 * Z), g(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), g(0.0557 * X - 0.204 * Y + 1.057 * Z));
      }
      if (c) out.push({ name, hex: c });
    }
    return out;
  }

  /* Nuancier .ase (couleurs RVB) : pour exporter tes couleurs vers Photoshop, Illustrator… */
  function writeASE(colors) {
    const blocks = colors.map(c => {
      const name = (c.name || c.hex).slice(0, 60), [r, g, b] = rgb(c.hex);
      const len = 2 + (name.length + 1) * 2 + 4 + 12 + 2, buf = new DataView(new ArrayBuffer(6 + len));
      buf.setUint16(0, 1); buf.setUint32(2, len); buf.setUint16(6, name.length + 1);
      for (let i = 0; i < name.length; i++) buf.setUint16(8 + i * 2, name.charCodeAt(i));
      let q = 8 + (name.length + 1) * 2;
      'RGB '.split('').forEach((ch, i) => buf.setUint8(q + i, ch.charCodeAt(0)));
      q += 4;
      [r, g, b].forEach((v, i) => buf.setFloat32(q + i * 4, v / 255));
      buf.setUint16(q + 12, 2);
      return new Uint8Array(buf.buffer);
    });
    const total = 12 + blocks.reduce((s, x) => s + x.length, 0), out = new Uint8Array(total), dv = new DataView(out.buffer);
    'ASEF'.split('').forEach((ch, i) => { out[i] = ch.charCodeAt(0); });
    dv.setUint16(4, 1); dv.setUint16(6, 0); dv.setUint32(8, blocks.length);
    let p = 12;
    blocks.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }

  // ---------------------------------------------------------------- dégradés

  /* Dégradé : { type: linear | radial, angle (degrés, CSS : 0 = vers le haut, 90 = vers la
     droite), colors: ['#…', '#…'] }. Lu depuis du CSS (linear-gradient(…), radial-gradient(…))
     ou une simple liste de couleurs. → dégradé ou null. */
  function parseGradient(text) {
    const s = String(text || '').trim();
    const colors = parseColors(s);
    if (colors.length < 2) return null;
    const radial = /radial-gradient/i.test(s);
    let angle = 90;
    const deg = /linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg/i.exec(s), to = /linear-gradient\(\s*to\s+([a-z ]+)/i.exec(s);
    if (deg) angle = ((+deg[1] % 360) + 360) % 360;
    else if (to) {
      const w = to[1].trim().toLowerCase();
      const map = { top: 0, right: 90, bottom: 180, left: 270, 'top right': 45, 'right top': 45, 'bottom right': 135, 'right bottom': 135, 'bottom left': 225, 'left bottom': 225, 'top left': 315, 'left top': 315 };
      if (w in map) angle = map[w];
    }
    return { type: radial ? 'radial' : 'linear', angle, colors: colors.slice(0, 2) };
  }

  const gradientCss = g => (g.type === 'radial' ? 'radial-gradient(circle, ' : 'linear-gradient(' + g.angle + 'deg, ') + g.colors.join(', ') + ')';

  /* Réglages de l'effet Dégradé (Ramp) : points de départ et d'arrivée (0 à 1 dans le cadre),
     couleurs [r, v, b], forme (1 linéaire, 2 radial). */
  function rampOf(g) {
    const a = (g.angle || 0) * Math.PI / 180, dx = Math.sin(a) / 2, dy = -Math.cos(a) / 2;
    const radial = g.type === 'radial';
    return {
      start: radial ? [0.5, 0.5] : [0.5 - dx, 0.5 - dy], end: radial ? [1, 0.5] : [0.5 + dx, 0.5 + dy],
      startColor: rgb(g.colors[0]), endColor: rgb(g.colors[g.colors.length - 1]), shape: radial ? 2 : 1
    };
  }

  // ---------------------------------------------------------------- styles de texte

  const STYLE_DEFAULTS = { font: '', size: 0, caps: false, fill: '#ffffff', stroke: '', strokeWidth: 0, shadow: false, box: '', boxOpacity: 80 };
  /* Style de texte complété et nettoyé. size 0 / font vide : on garde ceux du modèle. */
  function normStyle(s) {
    const o = Object.assign({}, STYLE_DEFAULTS, s || {});
    return {
      font: String(o.font || '').trim().slice(0, 80), size: Math.max(0, Math.min(400, Math.round(+o.size || 0))), caps: !!o.caps,
      fill: hex(o.fill) || '#ffffff', stroke: hex(o.stroke) || '', strokeWidth: Math.max(0, Math.min(40, +o.strokeWidth || 0)),
      shadow: !!o.shadow, box: hex(o.box) || '', boxOpacity: Math.max(0, Math.min(100, Math.round(+o.boxOpacity || 0)))
    };
  }

  // Styles proposés d'emblée (copiables en « Mes styles »).
  const STYLES = [
    { id: 'blanc', name: _T('Blanc propre'), style: { fill: '#ffffff', shadow: true } },
    { id: 'reels', name: _T('Reels jaune'), style: { fill: '#ffd21e', stroke: '#000000', strokeWidth: 6, caps: true } },
    { id: 'bloc', name: _T('Bloc noir'), style: { fill: '#ffffff', box: '#000000', boxOpacity: 75 } },
    { id: 'pastel', name: _T('Pastel rose'), style: { fill: '#ffd1e8', shadow: true } },
    { id: 'neon', name: _T('Néon bleu'), style: { fill: '#7df9ff', stroke: '#0047ff', strokeWidth: 3 } },
    { id: 'corporate', name: _T('Entreprise'), style: { fill: '#ffffff', box: '#1473e6', boxOpacity: 90 } }
  ];

  const GRADIENTS = [
    { id: 'sunset', name: _T('Coucher de soleil'), g: { type: 'linear', angle: 180, colors: ['#ff7e5f', '#feb47b'] } },
    { id: 'teal-orange', name: 'Teal & orange', g: { type: 'linear', angle: 135, colors: ['#008080', '#ff8c00'] } },
    { id: 'sky', name: _T('Ciel bleu'), g: { type: 'linear', angle: 180, colors: ['#4facfe', '#00f2fe'] } },
    { id: 'rose-gold', name: _T('Rose doré'), g: { type: 'linear', angle: 90, colors: ['#f6d365', '#fda085'] } },
    { id: 'night', name: _T('Nuit violette'), g: { type: 'linear', angle: 160, colors: ['#4b1248', '#1c1b4b'] } },
    { id: 'vignette', name: _T('Vignette chaude'), g: { type: 'radial', angle: 0, colors: ['#ffe8c2', '#2b1200'] } }
  ];

  return { hex, rgb, toHex, parseColors, parseASE, writeASE, parseGradient, gradientCss, rampOf, normStyle, STYLE_DEFAULTS, STYLES, GRADIENTS };
});
