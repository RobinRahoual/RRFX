/* Packs d'overlays fournis : définitions, dessin image par image, import dans Premiere. */
const { test } = require('node:test');
const assert = require('node:assert');
const Packs = require('../plugin/js/packs.js');
const Core = require('../plugin/js/core.js');
const { makeEnv } = require('./sim');

// Contexte 2D factice : enregistre les appels et refuse les nombres invalides.
function stubContext() {
  const calls = [];
  const check = (name, args) => {
    args.forEach(a => { if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(name + ' reçoit ' + a); });
    calls.push(name);
  };
  const gradient = () => ({ addColorStop(o, c) { check('addColorStop', [o]); if (o < 0 || o > 1 || !/^rgba\(/.test(c)) throw new Error('arrêt de couleur invalide ' + o + ' ' + c); } });
  const g = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return (...a) => { check(k, a); return gradient(); };
      return (...a) => check(k, a);
    },
    set(t, k, v) { if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(k + ' = ' + v); t[k] = v; return true; }
  });
  return g;
}

test('packs: ids unique, every overlay has a generator and a name', () => {
  const ids = Packs.ALL.map(d => d.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(Packs.ALL.length >= 12);
  Packs.ALL.forEach(d => {
    assert.ok(Packs.GENERATORS[d.gen], d.id);
    assert.ok(d.name && d.packName, d.id);
    assert.strictEqual(Packs.byId[d.id], d);
  });
});

test('packs: every overlay draws every frame with valid values (landscape and vertical)', () => {
  Packs.ALL.forEach(d => {
    [[1920, 1080], [1080, 1920], [160, 90]].forEach(([W, H]) => {
      const n = Packs.frameCount(25);
      for (let i = 0; i < n; i += 7) {
        const g = stubContext();
        assert.doesNotThrow(() => Packs.draw(g, W, H, i / (n - 1), i, d), d.id + ' image ' + i);
        assert.ok(g.calls.length > 2, d.id + ' dessine quelque chose');
      }
    });
  });
});

test('packs: dust changes every frame, light leaks are reproducible', () => {
  const rec = (d, i) => { const g = stubContext(); Packs.draw(g, 320, 180, i / 49, i, d); return g.calls.join(','); };
  assert.notStrictEqual(rec(Packs.byId.dust, 3), rec(Packs.byId.dust, 4));
  assert.strictEqual(rec(Packs.byId['leak-warm'], 5), rec(Packs.byId['leak-warm'], 5));
  const r1 = Packs.rng(42), r2 = Packs.rng(42);
  assert.strictEqual(r1(), r2());
});

test('packs: frames, sizes and file names', () => {
  assert.strictEqual(Packs.frameCount(25), 50);
  assert.strictEqual(Packs.frameCount(60), 60);
  assert.strictEqual(Packs.frameCount(8), 24);
  assert.deepStrictEqual(Packs.frameSize(1920, 1080), { W: 1920, H: 1080 });
  assert.deepStrictEqual(Packs.frameSize(7680, 4320), { W: 3840, H: 2160 });
  assert.deepStrictEqual(Packs.frameSize(1080, 1920), { W: 1080, H: 1920 });
  assert.deepStrictEqual(Packs.frameSize(0, 0), { W: 1920, H: 1080 });
  assert.strictEqual(Packs.fileName(Packs.byId.vhs, 7), 'vhs_007.jpg');
  assert.strictEqual(Packs.folderName(Packs.byId.vhs, 1920, 1080, 25), 'vhs-1920x1080-50');
});

test('host: pack overlay imported as numbered stills at the sequence frame rate, used directly', () => {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 200 * F, 20 * F));
  seq._ph = 97 * F;
  const r = env.call('resolve', { placement: 'cut', sides: ['pre', 'post'], frames: 10, target: 'adjustment' });
  const targets = r.targets.map(t => Object.assign({}, t, { fx: Core.toWire(Core.compileOverlay({ intensity: 80 }, t.side, t.frames, 8)) }));
  const overlay = { path: '/Docs/CutFX/Overlays/vhs-1920x1080-50/vhs_000.jpg', name: 'VHS', kind: 'sequence', fps: 25, start: 'random', seed: 3 };
  const res = env.call('apply', { target: 'overlay', name: 'CutFX · VHS', overlay, targets });
  assert.ok(res.ok, res.error);
  assert.deepStrictEqual(env.imports.map(i => i.stills), [true], 'imported once, as numbered stills');
  const items = seq.videoTracks[1].items.sort((a, b) => a._s - b._s);
  assert.deepStrictEqual(items.map(i => [i._s / F, i._e / F]), [[90, 100], [100, 110]]);
  assert.strictEqual(items[0].projectItem.fps, 25, 'frame rate forced');
  assert.ok(!items[0].projectItem.videoOnly, 'no video-only subclip needed');
  assert.ok(items.every(i => i._in >= 0 && i._out <= 50 * F), 'inside the 50 images');
});
