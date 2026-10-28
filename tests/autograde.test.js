/* Étalonnage automatique : exposition, balance des blancs, raccord entre caméras ; caméra des rushs. */
const { test } = require('node:test');
const assert = require('node:assert');
const G = require('../plugin/js/autograde.js');
const Cam = require('../plugin/js/camdetect.js');

// Image de test : dégradé de gris + quelques couleurs, puis une dominante et un gain.
function image(fn, w, h) {
  w = w || 160; h = h || 90;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, t = x / (w - 1), band = Math.floor(y / (h / 4));
    let c = band === 0 ? [t, t, t] : band === 1 ? [t, t * 0.8, t * 0.5] : band === 2 ? [t * 0.4, t * 0.7, t] : [t * 0.9, t, t * 0.6];
    c = fn ? fn(c) : c;
    px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; px[o + 3] = 255;
  }
  return px;
}
const apply = (px, fn) => { const out = new Uint8ClampedArray(px); for (let i = 0; i < out.length; i += 4) { const v = fn(out[i] / 255, out[i + 1] / 255, out[i + 2] / 255); out[i] = v[0] * 255; out[i + 1] = v[1] * 255; out[i + 2] = v[2] * 255; } return out; };
const cast = (k) => c => [G.disp(G.lin(c[0]) * k[0]), G.disp(G.lin(c[1]) * k[1]), G.disp(G.lin(c[2]) * k[2])];

test('auto white balance removes a blue cast and keeps a neutral picture neutral', () => {
  const blue = image(cast([0.85, 1, 1.25]));
  const p = G.autoParams(G.analyze(blue), { exposure: false, levels: false });
  assert.ok(p.gain[2] < 0.9 && p.gain[0] > 1.05, 'gains ' + p.gain);
  const fixed = G.analyze(apply(blue, G.correction(p)));
  assert.ok(Math.abs(fixed.neutral[0] - fixed.neutral[2]) < 0.02, 'neutral after: ' + fixed.neutral);
  const ok = G.autoParams(G.analyze(image()), { exposure: false, levels: false });
  ok.gain.forEach(g => assert.ok(Math.abs(g - 1) < 0.03, 'no change on a neutral image ' + ok.gain));
  // Force : 0 = rien.
  G.autoParams(G.analyze(blue), { strength: 0 }).gain.forEach(g => assert.strictEqual(g, 1));
});

test('auto exposure brightens a dark shot, darkens a bright one, within ±1.5 EV', () => {
  const dark = image(cast([0.25, 0.25, 0.25])), bright = image(c => c.map(v => Math.min(1, 0.35 + v * 0.65)));
  const pd = G.autoParams(G.analyze(dark), { wb: false, levels: false }), pb = G.autoParams(G.analyze(bright), { wb: false, levels: false });
  assert.ok(pd.ev > 0.8 && pd.ev <= 1.5, 'dark ' + pd.ev);
  assert.ok(pb.ev < 0, 'bright ' + pb.ev);
  const after = G.analyze(apply(dark, G.correction(pd)));
  assert.ok(G.percentile(after.hist, 0.5) > G.percentile(G.analyze(dark).hist, 0.5) + 0.1);
  assert.match(G.describe(pd), /^\+1/);
  assert.strictEqual(G.describe({ ev: 0, gain: [1, 1, 1], black: 0, white: 1 }), 'déjà juste');
});

test('match: a cool camera is brought onto a warm reference', () => {
  const ref = image(cast([1.15, 1, 0.8])), src = image(cast([0.85, 1, 1.2]));
  const sR = G.analyze(ref), sS = G.analyze(src), p = G.matchParams(sS, sR, 1);
  const out = G.analyze(apply(src, G.matcher(p)));
  assert.ok(Math.abs(out.cr - sR.cr) < Math.abs(sS.cr - sR.cr) * 0.35, 'red/cyan closer ' + [sS.cr, out.cr, sR.cr]);
  assert.ok(Math.abs(out.cb - sR.cb) < Math.abs(sS.cb - sR.cb) * 0.35, 'blue/yellow closer');
  // Courbe croissante, et force 0 = identité.
  for (let i = 1; i < 256; i++) assert.ok(p.curve[i] > p.curve[i - 1]);
  const id = G.matcher(G.matchParams(sS, sR, 0));
  [[0.2, 0.5, 0.7], [0.9, 0.1, 0.3]].forEach(c => id(...c).forEach((v, k) => assert.ok(Math.abs(v - c[k]) < 0.01)));
  // Plusieurs images d'une caméra → une statistique.
  const m = G.merge([sS, G.analyze(src)]);
  assert.ok(Math.abs(m.cb - sS.cb) < 1e-9);
  const lut = G.lutOf(G.matcher(p), 9);
  assert.strictEqual(lut.data.length, 9 * 9 * 9 * 3);
});

test('camera detection: Sony XML (model, S-Log3 Cine), iPhone, Panasonic, Nikon, file names', () => {
  const sony = '....<NonRealTimeMeta xmlns="urn:schemas-professionalDisc:nonRealTimeMeta:ver.2.00"><Device manufacturer="Sony" modelName="ILCE-7M3" serialNo="1"/>' +
    '<AcquisitionRecord><Group name="CameraUnitMetadataSet"><Item name="CaptureGammaEquation" value="s-log3-cine"/><Item name="CaptureColorPrimaries" value="S-Gamut3Cine"/></Group></AcquisitionRecord></NonRealTimeMeta>';
  assert.deepStrictEqual(Cam.detect(sony, 'C0001.MP4'), { brand: 'sony', model: 'A7 III', profile: 'slog3-sg3c', log: true, gamma: 's-log3-cine', source: 'fichier' });
  const s709 = Cam.detect(sony.replace('s-log3-cine', 'rec709'), 'C0002.MP4');
  assert.strictEqual(s709.log, false, 'a Rec.709 Sony clip is not log');
  assert.strictEqual(Cam.detect('<Device manufacturer="Sony" modelName="ILCE-7SM3"/><Item name="CaptureGammaEquation" value="s-log2"/>').profile, 'slog2-sg');
  const iphone = Cam.detect('\0\0mdtacom.apple.quicktime.make\0\0mdtacom.apple.quicktime.model\0\0\0data\0\0\0\0Apple\0\0data\0iPhone 15 Pro Max\0', 'IMG_0001.MOV');
  assert.deepStrictEqual([iphone.brand, iphone.model], ['apple', 'iPhone 15 Pro Max']);
  assert.deepStrictEqual([Cam.detect('PANA\0Panasonic\0DC-S5M2\0').model, Cam.detect('NIKON Z 6_2 ').model], ['S5 II', 'Z6 II']);
  assert.strictEqual(Cam.detect('', 'DJI_0042.MP4').brand, 'dji');
  assert.strictEqual(Cam.detect('', 'DJI_0042.MP4').source, 'nom du fichier');
  assert.strictEqual(Cam.detect('nothing here', 'clip.mov').brand, null);
  // Un MOV quelconque contient « Apple » (gestionnaire QuickTime) : ce n'est pas un iPhone.
  assert.strictEqual(Cam.detect('Apple Video Media Handler appl', 'export.mov').brand, null);
});

test('camera matching: brand, then model, then log profile, then the active camera', () => {
  const cams = [
    { id: 'a', brand: 'sony', model: 'FX3', profile: 'slog3-sg3c' },
    { id: 'b', brand: 'sony', model: 'A7 III', profile: 'slog2-sg' },
    { id: 'c', brand: 'apple', model: 'iPhone 16 Pro', profile: 'applelog' }
  ];
  assert.strictEqual(Cam.match({ brand: 'sony', model: 'A7 III' }, cams, 'a').id, 'b');
  assert.strictEqual(Cam.match({ brand: 'sony', model: 'A7S III', profile: 'slog3-sg3c' }, cams, 'b').id, 'a');
  assert.strictEqual(Cam.match({ brand: 'sony' }, cams, 'b').id, 'b');
  assert.strictEqual(Cam.match({ brand: 'apple', model: 'iPhone 15 Pro' }, cams).id, 'c');
  assert.strictEqual(Cam.match({ brand: 'dji' }, cams), null);
  assert.strictEqual(Cam.match({ brand: null }, cams), null);
});
