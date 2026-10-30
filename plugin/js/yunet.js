/* RR FX : détection de visage YuNet (petit réseau de neurones d'OpenCV, 75 000 poids), sans
   dépendance. Bien plus fiable que Viola-Jones de profil, de trois quarts et en faible lumière, et il
   donne directement les yeux, le nez et la bouche.
   - Moteur : les 8 opérations du modèle (Conv, Relu, Sigmoid, Add, MaxPool, Resize, Transpose,
     Reshape) sur des tenseurs NCHW en Float32Array.
   - detect(rgba, w, h) : l'image réduite (côté long 320, multiple de 32), passée dans le réseau,
     puis les boîtes décodées comme OpenCV (FaceDetectorYN) et filtrées (NMS).
   La fabrique n'utilise rien d'extérieur : elle tourne aussi dans un Worker (visage.js). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXYuNet = factory();
})(typeof self !== 'undefined' ? self : this, function yunetFactory() {
  'use strict';

  let net = null;

  // Poids : base64 → Float32Array (une fois).
  function load(model) {
    if (net && net.model === model) return net;
    const bin = typeof atob === 'function' ? atob(model.weights) : Buffer.from(model.weights, 'base64').toString('binary');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const all = new Float32Array(bytes.buffer);
    const consts = {};
    Object.keys(model.tensors).forEach(k => {
      const t = model.tensors[k];
      consts[k] = t.ints ? { ints: t.ints, dims: t.dims } : { data: all.subarray(t.o, t.o + t.n), dims: t.dims };
    });
    net = { model, consts };
    return net;
  }

  // ------------------------------------------------------------------ opérations

  function conv(x, w, b, at) {
    const [, C, H, W] = x.dims, [M, Cg, KH, KW] = w.dims, g = at.group || 1;
    const [sh, sw] = at.strides || [1, 1], p = at.pads || [0, 0, 0, 0], [dh, dw] = at.dilations || [1, 1];
    const OH = Math.floor((H + p[0] + p[2] - dh * (KH - 1) - 1) / sh) + 1, OW = Math.floor((W + p[1] + p[3] - dw * (KW - 1) - 1) / sw) + 1;
    const out = new Float32Array(M * OH * OW), xd = x.data, wd = w.data, Mg = M / g, HW = H * W;
    // 1×1 (la plupart des couches) : une somme pondérée des canaux, pixel par pixel.
    if (KH === 1 && KW === 1 && g === 1 && sh === 1 && sw === 1 && !p.some(Boolean)) {
      for (let m = 0; m < M; m++) {
        const o = out.subarray(m * HW, (m + 1) * HW);
        o.fill(b ? b.data[m] : 0);
        let c = 0;
        // Quatre canaux à la fois : quatre fois moins d'écritures.
        for (; c + 3 < C; c += 4) {
          const k0 = wd[m * C + c], k1 = wd[m * C + c + 1], k2 = wd[m * C + c + 2], k3 = wd[m * C + c + 3];
          const a0 = xd.subarray(c * HW, (c + 1) * HW), a1 = xd.subarray((c + 1) * HW, (c + 2) * HW), a2 = xd.subarray((c + 2) * HW, (c + 3) * HW), a3 = xd.subarray((c + 3) * HW, (c + 4) * HW);
          for (let i = 0; i < HW; i++) o[i] += k0 * a0[i] + k1 * a1[i] + k2 * a2[i] + k3 * a3[i];
        }
        for (; c < C; c++) {
          const k = wd[m * C + c], a = xd.subarray(c * HW, (c + 1) * HW);
          for (let i = 0; i < HW; i++) o[i] += k * a[i];
        }
      }
      return { data: out, dims: [1, M, OH, OW] };
    }
    // 3×3 par canal (depthwise), pas de 1, marge de 1 : l'intérieur sans test de bord.
    if (KH === 3 && KW === 3 && g === C && M === C && sh === 1 && sw === 1 && p.every(v => v === 1) && dh === 1 && dw === 1) {
      for (let c = 0; c < C; c++) {
        const k = wd.subarray(c * 9, c * 9 + 9), bias = b ? b.data[c] : 0, x0 = c * HW;
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
          let v = bias;
          if (y > 0 && y < H - 1 && xx > 0 && xx < W - 1) {
            const q = x0 + y * W + xx;
            v += k[0] * xd[q - W - 1] + k[1] * xd[q - W] + k[2] * xd[q - W + 1] + k[3] * xd[q - 1] + k[4] * xd[q] + k[5] * xd[q + 1] + k[6] * xd[q + W - 1] + k[7] * xd[q + W] + k[8] * xd[q + W + 1];
          } else {
            for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
              const iy = y + ky - 1, ix = xx + kx - 1;
              if (iy >= 0 && iy < H && ix >= 0 && ix < W) v += k[ky * 3 + kx] * xd[x0 + iy * W + ix];
            }
          }
          out[x0 + y * W + xx] = v;
        }
      }
      return { data: out, dims: [1, M, OH, OW] };
    }
    for (let m = 0; m < M; m++) {
      const grp = Math.floor(m / Mg), bias = b ? b.data[m] : 0, o0 = m * OH * OW;
      for (let i = 0; i < OH * OW; i++) out[o0 + i] = bias;
      for (let c = 0; c < Cg; c++) {
        const xc = (grp * Cg + c) * H * W;
        for (let ky = 0; ky < KH; ky++) {
          for (let kx = 0; kx < KW; kx++) {
            const k = wd[((m * Cg + c) * KH + ky) * KW + kx];
            if (k === 0) continue;
            // Les colonnes de sortie dont l'entrée est dans l'image, calculées une fois.
            const off = kx * dw - p[1], ox0 = Math.max(0, Math.ceil(-off / sw)), ox1 = Math.min(OW - 1, Math.floor((W - 1 - off) / sw));
            for (let oy = 0; oy < OH; oy++) {
              const iy = oy * sh - p[0] + ky * dh;
              if (iy < 0 || iy >= H) continue;
              const row = xc + iy * W + off, orow = o0 + oy * OW;
              for (let ox = ox0; ox <= ox1; ox++) out[orow + ox] += k * xd[row + ox * sw];
            }
          }
        }
      }
    }
    return { data: out, dims: [1, M, OH, OW] };
  }
  function maxpool(x, at) {
    const [, C, H, W] = x.dims, [KH, KW] = at.kernel_shape, [sh, sw] = at.strides || at.kernel_shape;
    const OH = Math.floor((H - KH) / sh) + 1, OW = Math.floor((W - KW) / sw) + 1, out = new Float32Array(C * OH * OW);
    for (let c = 0; c < C; c++) for (let oy = 0; oy < OH; oy++) for (let ox = 0; ox < OW; ox++) {
      let v = -Infinity;
      for (let ky = 0; ky < KH; ky++) for (let kx = 0; kx < KW; kx++) { const t = x.data[(c * H + oy * sh + ky) * W + ox * sw + kx]; if (t > v) v = t; }
      out[(c * OH + oy) * OW + ox] = v;
    }
    return { data: out, dims: [1, C, OH, OW] };
  }
  // Agrandissement au plus proche (x2 dans YuNet).
  function resize(x, scales) {
    const [, C, H, W] = x.dims, fy = scales[2], fx = scales[3], OH = Math.floor(H * fy), OW = Math.floor(W * fx), out = new Float32Array(C * OH * OW);
    for (let c = 0; c < C; c++) for (let y = 0; y < OH; y++) {
      const sy = Math.min(H - 1, Math.floor(y / fy));
      for (let xx = 0; xx < OW; xx++) out[(c * OH + y) * OW + xx] = x.data[(c * H + sy) * W + Math.min(W - 1, Math.floor(xx / fx))];
    }
    return { data: out, dims: [1, C, OH, OW] };
  }
  function transpose(x, perm) {
    const d = x.dims, od = perm.map(i => d[i]), out = new Float32Array(x.data.length);
    // Seul cas du modèle : NCHW → NHWC.
    const [, C, H, W] = d;
    if (perm.join() !== '0,2,3,1') throw new Error('YuNet : transposition inattendue ' + perm);
    for (let c = 0; c < C; c++) for (let i = 0; i < H * W; i++) out[i * C + c] = x.data[c * H * W + i];
    return { data: out, dims: od };
  }
  function reshape(x, shape) {
    const n = x.data.length, known = shape.reduce((a, v) => (v > 0 ? a * v : a), 1);
    return { data: x.data, dims: shape.map(v => (v === -1 ? n / known : v === 0 ? 1 : v)) };
  }
  function relu(x) { const d = x.data, out = new Float32Array(d.length); for (let i = 0; i < d.length; i++) out[i] = d[i] > 0 ? d[i] : 0; return { data: out, dims: x.dims }; }
  function sigmoid(x) { const d = x.data, out = new Float32Array(d.length); for (let i = 0; i < d.length; i++) out[i] = 1 / (1 + Math.exp(-d[i])); return { data: out, dims: x.dims }; }

  // Passe une image (Float32Array 3×H×W, BGR, 0 à 255) dans le réseau → les sorties par nom.
  function run(model, input, H, W) {
    const { consts } = load(model), env = {};
    env[model.input] = { data: input, dims: [1, 3, H, W] };
    const get = k => env[k] || consts[k];
    model.nodes.forEach(n => {
      const a = get(n.in[0]);
      let r;
      switch (n.op) {
        case 'Conv': r = conv(a, get(n.in[1]), n.in[2] ? get(n.in[2]) : null, n.at); break;
        case 'Relu': r = relu(a); break;
        case 'Sigmoid': r = sigmoid(a); break;
        case 'Add': { const b = get(n.in[1]), out = new Float32Array(a.data.length); for (let i = 0; i < out.length; i++) out[i] = a.data[i] + b.data[i]; r = { data: out, dims: a.dims }; break; }
        case 'MaxPool': r = maxpool(a, n.at); break;
        case 'Resize': r = resize(a, (get(n.in[2]) || {}).data || [1, 1, 2, 2]); break;
        case 'Transpose': r = transpose(a, n.at.perm); break;
        case 'Reshape': r = reshape(a, get(n.in[1]).ints); break;
        default: throw new Error('YuNet : opération inconnue ' + n.op);
      }
      env[n.out[0]] = r;
    });
    const out = {};
    model.outputs.forEach(k => { out[k] = env[k]; });
    return out;
  }

  // ------------------------------------------------------------------ visages

  const iou = (a, b) => {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    return i / (a.w * a.h + b.w * b.h - i || 1);
  };

  /* Sorties du réseau → visages { x, y, w, h, score, eyes: [[x, y], [x, y]], nose, mouth }, en pixels
     de l'entrée du réseau, comme FaceDetectorYN d'OpenCV (score = √(classe × présence)). */
  function decode(out, H, W, o) {
    const faces = [];
    [8, 16, 32].forEach(s => {
      const cols = W / s, rows = H / s, cls = out['cls_' + s].data, obj = out['obj_' + s].data, box = out['bbox_' + s].data, kps = out['kps_' + s].data;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const i = r * cols + c, score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (score < o.threshold) continue;
        const cx = (c + box[i * 4]) * s, cy = (r + box[i * 4 + 1]) * s, w = Math.exp(box[i * 4 + 2]) * s, h = Math.exp(box[i * 4 + 3]) * s;
        const k = n => [(kps[i * 10 + 2 * n] + c) * s, (kps[i * 10 + 2 * n + 1] + r) * s];
        faces.push({ x: cx - w / 2, y: cy - h / 2, w, h, score, eyes: [k(0), k(1)], nose: k(2), mouth: [k(3), k(4)] });
      }
    });
    faces.sort((a, b) => b.score - a.score);
    const keep = [];
    faces.forEach(f => { if (!keep.some(k => iou(k, f) > o.nms)) keep.push(f); });
    return keep.slice(0, o.top);
  }

  /* Visages d'une image RVBA (Uint8ClampedArray, w×h) → [{ x, y, w, h, score, eyes, nose, mouth }]
     en pixels de l'image, le plus sûr d'abord. opts : size (côté long du réseau, 320), threshold
     (0,6), nms (0,3), top (10). */
  function detect(model, rgba, w, h, opts) {
    const o = Object.assign({ size: 320, threshold: 0.6, nms: 0.3, top: 10 }, opts || {});
    const k = o.size / Math.max(w, h), W = Math.max(32, Math.ceil(w * k / 32) * 32), H = Math.max(32, Math.ceil(h * k / 32) * 32);
    const sw = Math.round(w * k), sh = Math.round(h * k), input = new Float32Array(3 * W * H);
    // Réduction par moyenne des pixels couverts, l'image en haut à gauche (le reste noir), en BGR.
    for (let y = 0; y < sh; y++) {
      const y0 = Math.floor(y / k), y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) / k)));
      for (let x = 0; x < sw; x++) {
        const x0 = Math.floor(x / k), x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) / k)));
        let r = 0, g = 0, b = 0, n = 0;
        for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) { const p = (yy * w + xx) * 4; r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2]; n++; }
        const q = y * W + x;
        input[q] = b / n; input[W * H + q] = g / n; input[2 * W * H + q] = r / n;
      }
    }
    const faces = decode(run(model, input, H, W), H, W, o);
    const back = p => [p[0] / k, p[1] / k];
    return faces.map(f => ({ x: f.x / k, y: f.y / k, w: f.w / k, h: f.h / k, score: f.score, eyes: f.eyes.map(back), nose: back(f.nose), mouth: f.mouth.map(back) }));
  }

  return { load, run, decode, detect, factory: yunetFactory };
});
