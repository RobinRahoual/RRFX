/* Visages : détection, suivi des yeux, zoom qui garde le regard en place. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
global.self = global;
const Core = require('../plugin/js/core.js');
const Lib = require('../plugin/js/library.js');
const F = require('../plugin/js/faces.js');

const W = 320, H = 180;
const photo = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'astronaute-320x180.gray')));
// Image RVBA décalée de dx pixels (la personne bouge dans le cadre).
function frame(dx, dy) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const sx = x - dx, sy = y - (dy || 0), v = sx >= 0 && sx < W && sy >= 0 && sy < H ? photo[sy * W + sx] : 90;
    const p = (y * W + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  return { data, width: W, height: H };
}

test('the face is found, the eye line read from it; nothing found in a plain or noisy image', () => {
  const faces = F.detect(photo, W, H);
  assert.strictEqual(faces.length, 1, JSON.stringify(faces));
  const e = F.eyesIn(frame(0));
  // Entre les deux yeux de l'astronaute (repéré à la main sur l'image).
  assert.ok(Math.abs(e.x - 0.372) < 0.02 && Math.abs(e.y - 0.205) < 0.025, JSON.stringify(e));
  const moved = F.eyesIn(frame(60, 10), e);
  assert.ok(Math.abs(moved.x - e.x - 60 / W) < 0.02 && Math.abs(moved.y - e.y - 10 / H) < 0.025, JSON.stringify(moved));
  assert.strictEqual(F.eyesIn({ data: new Uint8ClampedArray(W * H * 4).fill(128), width: W, height: H }), null);
  let seed = 9;
  const noise = new Uint8ClampedArray(W * H * 4).map((_, i) => (i % 4 === 3 ? 255 : (seed = (seed * 16807) % 2147483647) % 256));
  assert.strictEqual(F.eyesIn({ data: noise, width: W, height: H }), null);
});

test('tracking: eyes followed over the clip, a false detection dropped, few straight segments', () => {
  const s = [0, 0.25, 0.5, 0.75, 1].map((at, k) => ({ at, eyes: { x: 0.3 + 0.02 * k, y: 0.4 } }));
  s[2].eyes = { x: 0.9, y: 0.9 }; // fausse détection
  s.push({ at: 0.6, eyes: null });
  const t = F.track(s, 101, { smooth: 0 });
  assert.strictEqual(t.length, 101);
  assert.ok(Math.abs(t[0][0] - 0.3) < 1e-6 && Math.abs(t[100][0] - 0.38) < 1e-6);
  assert.ok(t.every(p => p[0] < 0.4 && Math.abs(p[1] - 0.4) < 1e-9), 'outlier ignored');
  assert.ok(Math.abs(t[50][0] - 0.34) < 1e-6, 'interpolated across the gap');
  const fixed = F.track(s, 10, { fixed: true });
  assert.ok(fixed.every(p => p[0] === fixed[0][0]));
  assert.strictEqual(F.track([{ at: 0, eyes: null }], 10), null);
  // Plan de 10 s, échantillonné : budget respecté, au moins 2 images par plan.
  const plan = F.sampling([{ a: 0, b: 10 }, { a: 10, b: 10.2 }], { every: 0.5, max: 20, budget: 12 });
  assert.ok(plan[0].times.length + plan[1].times.length <= 12 && plan[1].times.length === 2);
  assert.ok(plan[0].times.every(x => x > 0 && x < 10));
});

test('zoom keeps the eyes where they are on screen, or recentres them without showing an edge', () => {
  const e = [0.3, 0.35], z = 1.2;
  const p = F.framing(e, z, 'keep');
  // Transformer, ancre au centre : point à l'écran = position + (point - centre) × zoom.
  [0, 1].forEach(j => assert.ok(Math.abs(p[j] + (e[j] - 0.5) * z - e[j]) < 1e-9));
  const c = F.framing(e, z, 'center');
  [0, 1].forEach(j => assert.ok(Math.abs(c[j] - 0.5) <= (z - 1) / 2 + 1e-9, 'no black edge'));
  assert.ok(c[0] > 0.5, 'image pushed right to bring the left eyes toward the middle');
});

test('Zoom visage: +20 % that follows the eyes, as a few keyframes for Premiere', () => {
  const def = Lib.byId['face-zoom'], N = 250;
  const face = F.track([0, 0.5, 1].map((at, k) => ({ at, eyes: { x: 0.3 + 0.05 * k, y: 0.38 } })), N);
  const fx = Core.compileEffect(def, { face, amount: 20 }, 'post', N, 25);
  const pos = fx[0].props.find(q => q.key === 'position'), scale = fx[0].props.find(q => q.key === 'scale');
  assert.strictEqual(scale.static, 120);
  pos.values.forEach((v, i) => [0, 1].forEach(j => assert.ok(Math.abs(v[j] + (face[i][j] - 0.5) * 1.2 - face[i][j]) < 1e-3, 'eyes stay put at ' + i)));
  const keys = Core.toWire(fx)[0].props.find(q => q.key === 'position').keys;
  assert.ok(keys.length < 60 && keys[0][0] === 0 && keys[keys.length - 1][0] === N - 1, keys.length + ' keys');
  // Sans analyse (aperçu) : yeux typiques d'une face cam ; progressif : de 100 à 115 %.
  const preview = Core.compileEffect(def, {}, 'post', 10, 25)[0].props.find(q => q.key === 'position');
  assert.deepStrictEqual(preview.static, [0.5, 0.52]);
  const push = Core.compileEffect(Lib.byId['face-push'], { face: face.slice(0, 50) }, 'post', 50, 25)[0].props.find(q => q.key === 'scale');
  assert.deepStrictEqual([push.values[0], push.values[49]], [100, 115]);
  // Les autres effets gardent une clé par image utile (pas de simplification).
  const other = Core.toWire(Core.compileEffect(Lib.byId['zoom-in'], {}, 'post', 10, 25))[0].props.find(q => q.keys);
  assert.ok(other.keys.length >= 9);
});
