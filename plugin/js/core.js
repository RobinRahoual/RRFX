/* RR FX : pure logic shared by the panel and the tests (no DOM, no host). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const round3 = v => Math.round(v * 1000) / 1000;

  // ---------------------------------------------------------------- curves

  const CURVE_PRESETS = {
    linear: { label: _T('Linéaire'), v: [0, 0, 1, 1] },
    easeIn: { label: 'Ease in', v: [0.55, 0, 1, 0.45] },
    expoIn: { label: 'Expo in', v: [0.8, 0, 0.95, 0.15] },
    easeOut: { label: 'Ease out', v: [0, 0.55, 0.45, 1] },
    easeInOut: { label: 'Ease in-out', v: [0.65, 0, 0.35, 1] },
    snap: { label: 'Snap', v: [0.95, 0, 1, 0.02] }
  };

  function curveValue(c) {
    if (typeof c === 'string') return (CURVE_PRESETS[c] || CURVE_PRESETS.easeIn).v.slice();
    return c && c.length === 4 ? c.slice() : CURVE_PRESETS.easeIn.v.slice();
  }

  // CSS-style cubic-bezier: f(x) for x in [0, 1].
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = u => ((ax * u + bx) * u + cx) * u;
    const sy = u => ((ay * u + by) * u + cy) * u;
    const dx = u => (3 * ax * u + 2 * bx) * u + cx;
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let u = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(u) - x;
        if (Math.abs(e) < 1e-7) return sy(u);
        const d = dx(u);
        if (Math.abs(d) < 1e-6) break;
        u -= e / d;
      }
      let lo = 0, hi = 1;
      u = x;
      for (let i = 0; i < 50; i++) {
        const v = sx(u);
        if (Math.abs(v - x) < 1e-7) break;
        if (x > v) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
      return sy(u);
    };
  }

  // ---------------------------------------------------------------- noise

  function hash(n, seed) {
    const x = Math.sin(n * 127.1 + seed * 311.7 + 0.1) * 43758.5453;
    return x - Math.floor(x);
  }
  function smoothNoise(x, seed) {
    const i = Math.floor(x), f = x - i;
    const a = hash(i, seed) * 2 - 1, b = hash(i + 1, seed) * 2 - 1;
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  }

  // ---------------------------------------------------------------- registry
  // Premiere effects the built-in library uses.
  //  - names: display names tried in turn (Premiere looks effects up by their
  //    localized name). At startup the panel also detects the real name from
  //    Premiere's effect list (resolveEffectNames).
  //  - props: parameter indexes (language independent).
  //  - match: [include, exclude] regexes on the parameter's display name. If the
  //    parameter at the expected index does not look right, the host searches the
  //    effect for one that does, so a reordered effect never animates the wrong value.
  // Everything here can be overridden from the panel's settings.

  const REGISTRY = {
    transform: {
      matchName: 'AE.ADBE Geometry2',
      names: ['Transform', 'Transformer', 'Transformation', 'Transformieren', 'Transformar', 'Trasforma'],
      props: { anchor: 0, position: 1, uniform: 2, scale: 3, scaleW: 4, skew: 5, skewAxis: 6, rotation: 7, opacity: 8, compShutter: 9, shutter: 10 },
      points: ['anchor', 'position'],
      match: {
        position: ['^(position|posici|posizione)'],
        scale: ['(scale|chelle|skal|escala|scala)', '(uniform|width|largeur|breite|ancho|anchura|larghez)'],
        rotation: ['(rotation|rotaci|drehung|rotazione)'],
        opacity: ['(opac|deckkraft|opacit)'],
        compShutter: ['(composition|komposition|composici|composizion)'],
        shutter: ['(shutter|obturat|verschluss|otturat)', '(composition|komposition|composici|composizion)']
      }
    },
    gaussian: {
      matchName: 'AE.ADBE Gaussian Blur 2',
      names: ['Gaussian Blur', 'Flou gaussien', 'Gaußscher Weichzeichner', 'Desenfoque gaussiano', 'Sfocatura gaussiana'],
      props: { blur: 0, dims: 1, repeat: 2 },
      match: {
        blur: ['(blur|flou|weich|st.rke|desenfo|sfoca|intensit)', '(dimension|repeat|p.ter|wiederhol|repetir|ripet)'],
        repeat: ['(repeat|p.ter|wiederhol|repetir|ripet)']
      }
    },
    directional: {
      matchName: 'AE.ADBE Motion Blur',
      names: ['Directional Blur', 'Flou directionnel', 'Direktionaler Weichzeichner', 'Desenfoque direccional', 'Sfocatura direzionale'],
      props: { direction: 0, length: 1 },
      match: {
        direction: ['(direction|richtung|direcci|direzion)', '(length|longueur|l.nge|longitud|lunghez)'],
        length: ['(length|longueur|l.nge|longitud|lunghez)']
      }
    },
    bc: {
      matchName: 'AE.ADBE Brightness & Contrast 2',
      names: ['Brightness & Contrast', 'Luminosité et contraste', 'Helligkeit und Kontrast', 'Brillo y contraste', 'Luminosità e contrasto'],
      props: { brightness: 0, contrast: 1 },
      match: { brightness: ['(bright|lumin|hellig|brillo)', 'contra'], contrast: ['contra'] }
    },
    offset: {
      matchName: 'AE.ADBE Offset',
      names: ['Offset', 'Décalage', 'Versatz', 'Desplazamiento', 'Sfalsamento'],
      props: { center: 0, blend: 1 },
      points: ['center'],
      match: {
        center: ['(shift|d.cal|cent|mittel|spost|versch)', '(blend|fusion|m.lange|misch|mezcl|fond)'],
        blend: ['(blend|fusion|m.lange|misch|mezcl|fond)']
      }
    },
    wave: {
      matchName: 'AE.ADBE Wave Warp',
      names: ['Wave Warp', 'Déformation de la vague', 'Déformation ondulatoire', 'Wellen-Warp', 'Deformación de onda', 'Distorsione onda'],
      props: { type: 0, height: 1, width: 2, direction: 3, speed: 4 },
      match: { height: ['(height|hauteur|h.he|altura|altezza|amplitude)'], width: ['(width|largeur|breite|anch|larghez)'] }
    },
    lens: {
      matchName: 'AE.ADBE Lens Distortion',
      names: ['Lens Distortion', 'Distorsion de l\'objectif', 'Distorsion de l’objectif', 'Objektivverzerrung', 'Distorsión de lente'],
      props: { curvature: 0 },
      match: { curvature: ['(curv|kr.mm)'] }
    },
    echo: {
      matchName: 'AE.ADBE Echo',
      names: ['Echo', 'Écho', 'Eco'],
      props: { time: 0, count: 1, intensity: 2, decay: 3 },
      match: {
        time: ['(time|temps|zeit|tiempo|tempo)', '(number|nombre|anzahl|n.mero)'],
        count: ['(number|nombre|anzahl|n.mero)'],
        intensity: ['(intens|st.rke)'],
        decay: ['(decay|att.nu|d.clin|abfall|ca.da|decad|diminu)']
      }
    },
    // Teinte : le blanc devient la couleur choisie (texte blanc mis en couleur, contour noir gardé).
    tint: {
      matchName: 'AE.ADBE Tint',
      names: ['Tint', 'Teinte', 'Färben', 'Tinte', 'Tinta'],
      props: { black: 0, white: 1, amount: 2 },
      colors: ['black', 'white'],
      match: { amount: ['(amount|quantit|st.rke|cantidad|quantit)'] }
    },
    motion: {
      matchName: 'AE.ADBE Motion', intrinsic: 'motion', names: [],
      props: { position: 0, scale: 1, scaleW: 2, uniform: 3, rotation: 4, anchor: 5 },
      points: ['position', 'anchor']
    },
    opacity: {
      matchName: 'AE.ADBE Opacity', intrinsic: 'opacity', names: [],
      props: { opacity: 0, blend: 1 }
    }
  };

  // Effect names in Premiere's list, any language (normalized: lower case, no accents).
  const EFFECT_PATTERNS = {
    transform: /^(transform|transformer|transformation|transformieren|transformar|trasforma)$/,
    gaussian: /gauss/,
    directional: /(directional|directionnel|direktional|direccional|direzional)/,
    bc: /(bright.*contrast|lumin.*contrast|hellig.*kontrast|brillo.*contrast)/,
    offset: /^(offset|decalage|versatz|desplazamiento|sfalsamento|desfase)$/,
    wave: /(wave warp|vague|ondul|wellen|onda)/,
    lens: /(lens.*distor|distor.*(objectif|lente|lens)|objektivverzerr)/,
    echo: /^(echo|eco)$/,
    tint: /^(tint|teinte|farben|tinte|tinta)$/
  };

  function normName(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’`]/g, '\'').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  // Premiere's effect list -> { type: display name or null }.
  function resolveEffectNames(list, registry) {
    registry = registry || REGISTRY;
    const names = (list || []).map(n => ({ raw: String(n), n: normName(n) }));
    const out = {};
    Object.keys(registry).forEach(type => {
      const reg = registry[type];
      if (reg.intrinsic) return;
      const wanted = (reg.names || []).map(normName);
      let hit = names.find(x => wanted.indexOf(x.n) >= 0);
      if (!hit && EFFECT_PATTERNS[type]) {
        hit = names.filter(x => EFFECT_PATTERNS[type].test(x.n)).sort((a, b) => a.n.length - b.n.length)[0];
      }
      out[type] = hit ? hit.raw : null;
    });
    return out;
  }

  function mergeRegistry(overrides, resolved) {
    const out = JSON.parse(JSON.stringify(REGISTRY));
    if (overrides && typeof overrides === 'object') {
      for (const type in overrides) {
        const o = overrides[type];
        if (!o || typeof o !== 'object') continue;
        if (!out[type]) out[type] = { names: [], props: {} };
        if (Array.isArray(o.names)) out[type].names = o.names.concat(out[type].names.filter(n => o.names.indexOf(n) < 0));
        if (o.props && typeof o.props === 'object') {
          Object.assign(out[type].props, o.props);
          // An index set by hand wins over the automatic name check.
          if (out[type].match) Object.keys(o.props).forEach(k => { delete out[type].match[k]; });
        }
        if (o.matchName) out[type].matchName = o.matchName;
        if (Array.isArray(o.points)) out[type].points = o.points;
      }
    }
    if (resolved) {
      for (const type in resolved) {
        const name = resolved[type];
        if (!name || !out[type]) continue;
        // Detected name first, after any name the user typed in the settings.
        const names = out[type].names.filter(n => n !== name);
        const at = overrides && overrides[type] && Array.isArray(overrides[type].names) ? Math.min(overrides[type].names.length, names.length) : 0;
        names.splice(at, 0, name);
        out[type].names = names;
      }
    }
    return out;
  }

  function typeForMatchName(registry, matchName) {
    for (const type in registry) if (registry[type].matchName === matchName) return type;
    return null;
  }
  function keyForIndex(registry, type, index) {
    const props = registry[type] && registry[type].props;
    if (!props) return null;
    for (const k in props) if (props[k] === index) return k;
    return null;
  }

  // ---------------------------------------------------------------- effect compile

  function paramDefaults(def) {
    const p = { frames: def.frames || 8, intensity: 100, curve: curveValue(def.curve || 'easeIn') };
    (def.params || []).forEach(q => { p[q.key] = q.def; });
    return p;
  }

  // The build context an effect recipe sees. Times are in "Pre orientation":
  // tp goes 0 -> 1 towards the cut. A Post is the mirror image (peak at the cut,
  // fading out), so one curve describes both sides.
  function makeCtx(N, side, p, fps) {
    const c = curveValue(p.curve);
    const curve = bezier(c[0], c[1], c[2], c[3]);
    const tp = i => {
      if (N <= 1) return 1;
      const t = clamp(i / (N - 1), 0, 1);
      return side === 'post' ? 1 - t : t;
    };
    const env = i => curve(tp(i));
    const vraw = [];
    let vmax = 0;
    for (let i = 0; i < N; i++) {
      const a = curve(tp(clamp(i - 0.5, 0, N - 1))), b = curve(tp(clamp(i + 0.5, 0, N - 1)));
      vraw[i] = Math.abs(b - a);
      vmax = Math.max(vmax, vraw[i]);
    }
    return {
      N, side, p, fps: fps || 25,
      k: (p.intensity == null ? 100 : p.intensity) / 100,
      sign: side === 'post' ? -1 : 1,
      tp, env,
      vel: i => (N <= 1 || vmax === 0) ? 1 : vraw[clamp(Math.round(i), 0, N - 1)] / vmax,
      rand: (i, seed) => hash(i, seed || 1),
      noise: (x, seed) => smoothNoise(x, seed || 1),
      clamp, lerp
    };
  }

  function sameValue(a, b) {
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;
  }
  function roundValue(v) {
    if (Array.isArray(v)) return v.map(round3);
    return typeof v === 'number' ? round3(v) : v;
  }

  // -> [{ type, names, matchName, intrinsic, props: [{ key, index, point, static | values }] }]
  function compileEffect(def, params, side, N, fps, registry) {
    registry = registry || REGISTRY;
    const p = Object.assign(paramDefaults(def), params || {});
    N = Math.max(1, Math.round(N || p.frames));
    const ctx = makeCtx(N, side, p, fps);
    const built = def.build(ctx) || [];
    const out = [];
    built.forEach(fx => {
      const reg = registry[fx.type];
      if (!reg) return;
      const props = [];
      Object.keys(fx.props).forEach(key => {
        const index = reg.props[key];
        if (index === undefined) return;
        const src = fx.props[key];
        const point = (reg.points || []).indexOf(key) >= 0;
        const base = { key, index, point };
        if ((reg.colors || []).indexOf(key) >= 0) base.color = true;
        if (reg.match && reg.match[key]) base.match = reg.match[key];
        if (typeof src === 'function') {
          const values = [];
          for (let i = 0; i < N; i++) values.push(roundValue(src(i)));
          if (values.every(v => sameValue(v, values[0]))) props.push(Object.assign(base, { static: values[0] }));
          else props.push(Object.assign(base, { values }));
        } else {
          props.push(Object.assign(base, { static: roundValue(src) }));
        }
      });
      if (def.sparse) props.forEach(pr => { if (pr.values) pr.sparse = true; });
      if (props.length) out.push({ type: fx.type, names: reg.names, matchName: reg.matchName, intrinsic: reg.intrinsic || null, props });
    });
    return out;
  }

  // ---------------------------------------------------------------- envoi à Premiere
  // Les valeurs sont calculées image par image ; seules les images clés utiles
  // partent vers Premiere : au milieu d'une plage de valeurs identiques, une clé
  // ne change rien (chaque appel ExtendScript coûte du temps).
  // sparse : une clé qui tombe sur la ligne droite entre ses voisines gardées ne change rien
  // non plus (interpolation linéaire de Premiere) ; utile pour les longs mouvements suivis.
  const near = (a, b) => (Array.isArray(a) ? a.every((v, j) => Math.abs(v - b[j]) < 7e-4) : Math.abs(a - b) < 7e-4);
  const mix = (a, b, u) => (Array.isArray(a) ? a.map((v, j) => v + (b[j] - v) * u) : a + (b - a) * u);
  function keysFromValues(values, sparse) {
    const out = [];
    let last = -1;
    for (let i = 0; i < values.length; i++) {
      const inner = i > 0 && i < values.length - 1;
      if (inner && sameValue(values[i - 1], values[i]) && sameValue(values[i], values[i + 1])) continue;
      if (inner && sparse && last >= 0 && typeof values[i] !== 'string') {
        // La ligne de la dernière clé gardée à l'image suivante passe-t-elle par tout l'entre-deux ?
        let fits = true;
        for (let j = last + 1; j <= i && fits; j++) fits = near(values[j], mix(values[last], values[i + 1], (j - last) / (i + 1 - last)));
        if (fits) continue;
      }
      out.push([i, values[i]]);
      last = i;
    }
    return out;
  }

  function toWire(fxList) {
    return fxList.map(fx => Object.assign({}, fx, {
      props: fx.props.map(pr => {
        if (!pr.values) return pr;
        const o = Object.assign({}, pr, { keys: keysFromValues(pr.values, pr.sparse) });
        delete o.values;
        delete o.sparse;
        return o;
      })
    }));
  }

  // ---------------------------------------------------------------- captured effects

  function resampleValues(values, N) {
    const D = values.length;
    if (D === N) return values.slice();
    if (D === 1) return Array.from({ length: N }, () => values[0]);
    const out = [];
    for (let i = 0; i < N; i++) {
      const x = N === 1 ? D - 1 : i * (D - 1) / (N - 1);
      const a = Math.floor(x), b = Math.min(D - 1, a + 1), t = x - a;
      const va = values[a], vb = values[b];
      if (typeof va === 'number' && typeof vb === 'number') out.push(round3(lerp(va, vb, t)));
      else if (Array.isArray(va) && Array.isArray(vb)) out.push(va.map((v, j) => round3(lerp(v, vb[j], t))));
      else out.push(t < 0.5 ? va : vb);
    }
    return out;
  }

  function fitValues(values, N, side, stretch) {
    if (stretch) return resampleValues(values, N);
    const D = values.length;
    if (D === N) return values.slice();
    if (side === 'pre') {
      if (D > N) return values.slice(D - N);
      return Array.from({ length: N - D }, () => values[0]).concat(values);
    }
    if (D > N) return values.slice(0, N);
    return values.concat(Array.from({ length: N - D }, () => values[D - 1]));
  }

  // A captured effect (see host capture()) applied to a window of N frames.
  function compileCaptured(cap, side, N, opts, registry) {
    registry = registry || REGISTRY;
    opts = opts || {};
    const mirror = opts.mirror !== false && cap.origin && cap.origin !== side && side !== 'full';
    const out = [];
    (cap.components || []).forEach(c => {
      const type = typeForMatchName(registry, c.matchName);
      const props = [];
      c.props.forEach(pr => {
        const key = type ? keyForIndex(registry, type, pr.index) : null;
        const base = { key, index: pr.index, raw: true };
        if (pr.values && pr.values.length) {
          let values = fitValues(pr.values, N, side === 'full' ? 'post' : side, opts.stretch !== false);
          if (mirror) values = values.slice().reverse();
          if (values.every(v => sameValue(v, values[0]))) props.push(Object.assign(base, { static: values[0] }));
          else props.push(Object.assign(base, { values }));
        } else if (pr.static !== undefined) {
          props.push(Object.assign(base, { static: pr.static }));
        }
      });
      if (props.length) {
        out.push({
          type: type || 'custom', names: [c.displayName], matchName: c.matchName,
          intrinsic: c.intrinsic || null, props, frameW: cap.frameW, frameH: cap.frameH
        });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- overlays
  // Un overlay (fichier vidéo ou image) posé sur la coupe : opacité qui monte jusqu'à la
  // coupe (PRE) ou redescend après (POST), mode de fusion fixe.
  function compileOverlay(params, side, N, blendValue) {
    N = Math.max(1, Math.round(N));
    const ctx = makeCtx(N, side, params, 25), max = clamp(params.intensity == null ? 100 : params.intensity, 0, 100);
    const values = [];
    for (let i = 0; i < N; i++) values.push(round3(max * ctx.env(i)));
    const props = [values.every(v => v === values[0]) ? { key: 'opacity', index: 0, static: values[0] } : { key: 'opacity', index: 0, values }];
    if (blendValue !== null && blendValue !== undefined && blendValue !== '') props.push({ key: 'blend', index: 1, static: Number(blendValue), raw: true });
    return [{ type: 'opacity', names: [], matchName: 'AE.ADBE Opacity', intrinsic: 'opacity', overlay: true, props }];
  }

  // ---------------------------------------------------------------- textes et paroles

  function splitLyrics(text, mode) {
    const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (mode === 'words') return lines.join(' ').split(/\s+/).filter(Boolean);
    return lines;
  }

  // Place chaque morceau de texte sur un temps : du temps i au temps i+1 (ou durée fixe).
  // opts : { from, fixed (s), lastDur (s), maxDur (s), gap (s) }
  function titleTimeline(chunks, times, opts) {
    opts = opts || {};
    const from = opts.from || 0, out = [];
    if (opts.fixed) {
      chunks.forEach((text, i) => {
        const start = from + i * opts.fixed, end = from + (i + 1) * opts.fixed - (opts.gap || 0);
        if (end > start) out.push({ text, start, end });
      });
      return out;
    }
    const t = (times || []).filter(x => x >= from - 1e-6).sort((a, b) => a - b);
    for (let i = 0; i < chunks.length && i < t.length; i++) {
      let end = i + 1 < t.length ? t[i + 1] - (opts.gap || 0) : t[i] + (opts.lastDur || 2);
      if (opts.maxDur) end = Math.min(end, t[i] + opts.maxDur);
      if (end > t[i]) out.push({ text: chunks[i], start: t[i], end });
    }
    return out;
  }

  // Animation d'entrée (POST : de l'état caché à l'état normal) et de sortie (PRE),
  // réunies sur un seul jeu d'images clés couvrant toute la durée du texte.
  function titleSpec(anim, params, durFrames, inF, outF, fps, registry) {
    durFrames = Math.max(1, Math.round(durFrames));
    inF = Math.max(0, Math.min(Math.round(inF), durFrames));
    outF = Math.max(0, Math.min(Math.round(outF), durFrames - inF));
    const parts = [];
    if (inF) parts.push({ at: 0, spec: compileEffect(anim, params, 'post', inF, fps, registry) });
    if (outF) parts.push({ at: durFrames - outF, spec: compileEffect(anim, params, 'pre', outF, fps, registry) });
    const byType = new Map();
    parts.forEach(part => part.spec.forEach(fx => {
      if (!byType.has(fx.type)) byType.set(fx.type, { fx: Object.assign({}, fx, { props: [] }), props: new Map() });
      const slot = byType.get(fx.type);
      fx.props.forEach(pr => {
        if (!slot.props.has(pr.key)) slot.props.set(pr.key, Object.assign({}, pr, { keys: [], values: undefined, static: undefined, consts: [] }));
        const acc = slot.props.get(pr.key);
        if (pr.values) pr.values.forEach((v, i) => acc.keys.push([part.at + i, v]));
        else acc.consts.push([part.at, pr.static]);
      });
    }));
    const out = [];
    byType.forEach(slot => {
      slot.props.forEach(acc => {
        const p = Object.assign({}, acc);
        delete p.values; delete p.static; delete p.consts;
        if (!acc.keys.length) {
          delete p.keys;
          p.static = acc.consts[0][1];
        } else {
          // Une valeur constante d'une des deux parties (ex. pas d'animation de sortie) tient sa plage.
          acc.consts.forEach(([at, v]) => acc.keys.push([at, v]));
          p.keys = acc.keys.sort((a, b) => a[0] - b[0]);
        }
        slot.fx.props.push(p);
      });
      out.push(slot.fx);
    });
    return out;
  }

  // ---------------------------------------------------------------- montage auto sur le rythme

  // beats : temps (s) triés ; rushes : [{ id, inT, outT }] (plage utilisable, s).
  // opts : { every, order: 'sequence' | 'random', pick: 'start' | 'middle' | 'random' | 'continue', seed }
  function planAutoEdit(beats, rushes, opts) {
    opts = opts || {};
    const every = Math.max(1, Math.round(opts.every || 1)), out = [];
    if (!rushes.length || beats.length < 2) return out;
    const t = beats.slice().sort((a, b) => a - b), seed = opts.seed || 1;
    let n = 0, cycle = [], last = -1;
    const cursor = rushes.map(r => r.inT);
    const nextRush = k => {
      if (opts.order !== 'random') return k % rushes.length;
      if (!cycle.length) {
        cycle = rushes.map((r, i) => i);
        for (let i = cycle.length - 1; i > 0; i--) { const j = Math.floor(hash(n * 31 + i, seed) * (i + 1)); const x = cycle[i]; cycle[i] = cycle[j]; cycle[j] = x; }
        if (cycle.length > 1 && cycle[cycle.length - 1] === last) { const x = cycle[0]; cycle[0] = cycle[cycle.length - 1]; cycle[cycle.length - 1] = x; }
      }
      return cycle.pop();
    };
    for (let k = 0; k + every < t.length; k += every, n++) {
      const ri = nextRush(n), r = rushes[ri], dur = Math.max(0, r.outT - r.inT);
      last = ri;
      const want = t[k + every] - t[k], len = Math.min(want, dur);
      if (len <= 0) continue;
      let srcIn = r.inT;
      if (opts.pick === 'middle') srcIn = r.inT + (dur - len) / 2;
      else if (opts.pick === 'random') srcIn = r.inT + hash(n * 7 + 3, seed + 11) * (dur - len);
      else if (opts.pick === 'continue') {
        if (cursor[ri] + len > r.outT) cursor[ri] = r.inT;
        srcIn = cursor[ri];
        cursor[ri] += len;
      }
      out.push({ rush: ri, id: r.id, seqStart: t[k], seqEnd: t[k] + len, srcIn, short: len < want - 1e-6 });
    }
    return out;
  }

  // ---------------------------------------------------------------- speed ramps
  // Points: [{ t: 0..1, v: speed % }]. Interpolated in log space with a
  // monotone cubic so the curve never overshoots between points.

  function rampFunction(points) {
    const pts = points.slice().sort((a, b) => a.t - b.t);
    const n = pts.length;
    if (n === 0) return () => 100;
    if (n === 1) return () => pts[0].v;
    const xs = pts.map(p => p.t), ys = pts.map(p => Math.log2(Math.max(1, p.v)));
    const d = [], m = [];
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; }
    }
    return function (t) {
      if (t <= xs[0]) return pts[0].v;
      if (t >= xs[n - 1]) return pts[n - 1].v;
      let i = 0;
      while (i < n - 2 && t > xs[i + 1]) i++;
      const hgt = xs[i + 1] - xs[i], u = (t - xs[i]) / hgt;
      const h00 = 2 * u * u * u - 3 * u * u + 1, h10 = u * u * u - 2 * u * u + u;
      const h01 = -2 * u * u * u + 3 * u * u, h11 = u * u * u - u * u;
      const y = h00 * ys[i] + h10 * hgt * m[i] + h01 * ys[i + 1] + h11 * hgt * m[i + 1];
      return Math.pow(2, y);
    };
  }

  // Splits N frames into K constant-speed pieces whose speeds follow the curve.
  function rampPieces(points, N, K) {
    N = Math.max(1, Math.round(N));
    K = clamp(Math.round(K), 1, N);
    const f = rampFunction(points);
    const base = Math.floor(N / K), rem = N % K;
    const pieces = [];
    let start = 0;
    for (let k = 0; k < K; k++) {
      const frames = base + (k < rem ? 1 : 0);
      let sum = 0;
      const S = 12;
      for (let j = 0; j < S; j++) sum += f((start + (j + 0.5) / S * frames) / N);
      pieces.push({ frames, speed: Math.round(sum / S * 10) / 10 });
      start += frames;
    }
    return pieces;
  }

  function rampSourceFrames(pieces) {
    return pieces.reduce((s, p) => s + p.frames * p.speed / 100, 0);
  }

  const RAMP_PRESETS = {
    intoCut: { label: _T('Accélération vers la coupe'), placement: 'pre', points: [{ t: 0, v: 100 }, { t: 0.55, v: 160 }, { t: 1, v: 600 }] },
    outOfCut: { label: _T('Décélération après la coupe'), placement: 'post', points: [{ t: 0, v: 600 }, { t: 0.45, v: 160 }, { t: 1, v: 100 }] },
    slowHit: { label: _T('Ralenti sur le temps fort'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.35, v: 30 }, { t: 0.65, v: 30 }, { t: 1, v: 100 }] },
    pulse: { label: _T('Pulse rapide'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.5, v: 500 }, { t: 1, v: 100 }] },
    slowDown: { label: _T('Ralenti progressif'), placement: 'full', points: [{ t: 0, v: 100 }, { t: 1, v: 25 }] },
    speedUp: { label: _T('Montée en vitesse'), placement: 'full', points: [{ t: 0, v: 30 }, { t: 1, v: 300 }] },
    // Coupe : ce qui arrive sur la coupe et ce qui en repart.
    whipIn: { label: _T('Coup de fouet vers la coupe'), placement: 'pre', points: [{ t: 0, v: 100 }, { t: 0.7, v: 200 }, { t: 0.9, v: 700 }, { t: 1, v: 1000 }] },
    whipOut: { label: _T('Coup de fouet après la coupe'), placement: 'post', points: [{ t: 0, v: 1000 }, { t: 0.1, v: 700 }, { t: 0.3, v: 200 }, { t: 1, v: 100 }] },
    slamIn: { label: _T('Ralenti puis claque sur la coupe'), placement: 'pre', points: [{ t: 0, v: 100 }, { t: 0.45, v: 35 }, { t: 0.8, v: 40 }, { t: 1, v: 600 }] },
    softLand: { label: _T('Atterrissage en douceur'), placement: 'post', points: [{ t: 0, v: 400 }, { t: 0.5, v: 120 }, { t: 1, v: 30 }] },
    // Temps fort : autour de la tête de lecture.
    dramatic: { label: _T('Ralenti dramatique'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.2, v: 20 }, { t: 0.8, v: 20 }, { t: 1, v: 100 }] },
    nearFreeze: { label: _T('Presque figé (bullet time)'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.25, v: 12 }, { t: 0.75, v: 12 }, { t: 1, v: 100 }] },
    doublePulse: { label: 'Double pulse', placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.25, v: 450 }, { t: 0.5, v: 100 }, { t: 0.75, v: 450 }, { t: 1, v: 100 }] },
    bounce: { label: _T('Rebond'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.3, v: 450 }, { t: 0.6, v: 50 }, { t: 1, v: 100 }] },
    breath: { label: _T('Respiration'), placement: 'playhead', points: [{ t: 0, v: 100 }, { t: 0.33, v: 65 }, { t: 0.66, v: 140 }, { t: 1, v: 100 }] },
    jumpHit: { label: _T('Saut (montée, ralenti, chute)'), placement: 'playhead', points: [{ t: 0, v: 250 }, { t: 0.4, v: 25 }, { t: 0.6, v: 25 }, { t: 1, v: 250 }] },
    // Plan entier.
    timelapse: { label: _T('Accéléré façon timelapse'), placement: 'full', points: [{ t: 0, v: 800 }, { t: 1, v: 800 }] },
    slowmoFull: { label: _T('Ralenti doux sur tout le plan'), placement: 'full', points: [{ t: 0, v: 50 }, { t: 1, v: 50 }] },
    accelDecel: { label: _T('Accélère puis ralentit'), placement: 'full', points: [{ t: 0, v: 60 }, { t: 0.5, v: 400 }, { t: 1, v: 60 }] },
    stairs: { label: _T('Paliers de vitesse'), placement: 'full', points: [{ t: 0, v: 100 }, { t: 0.32, v: 100 }, { t: 0.34, v: 200 }, { t: 0.65, v: 200 }, { t: 0.67, v: 400 }, { t: 1, v: 400 }] }
  };

  return {
    clamp, lerp, CURVE_PRESETS, curveValue, bezier, hash, smoothNoise,
    REGISTRY, EFFECT_PATTERNS, normName, resolveEffectNames, mergeRegistry, typeForMatchName, keyForIndex,
    paramDefaults, makeCtx, compileEffect, keysFromValues, toWire, resampleValues, fitValues, compileCaptured,
    compileOverlay, splitLyrics, titleTimeline, titleSpec, planAutoEdit,
    rampFunction, rampPieces, rampSourceFrames, RAMP_PRESETS
  };
});
