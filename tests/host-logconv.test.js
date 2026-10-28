/* Conversion LOG → Rec.709 côté Premiere : calque Lumetri juste au-dessus des rushs, LUT d'entrée. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

const LUT = '/Users/robin/Documents/RRFX/Conversion/Sony A7 III S-Log3.cube';
const NAME = 'RR FX · Conversion Sony A7 III S-Log3';

function setup() {
  const env = makeEnv(25);
  const { seq, F, media, media2, Item } = env;
  seq.videoTracks[0].add(new Item(seq, media, 0, 100 * F, 50 * F));
  seq.videoTracks[0].add(new Item(seq, media2, 100 * F, 260 * F, 20 * F));
  return env;
}
const lumetri = it => it.components.find(c => c.matchName === 'AE.ADBE Lumetri');
const convert = (env, o) => env.call('logConvert', Object.assign({ name: NAME, lutPath: LUT, fxNames: ['Lumetri Color'], scope: 'sequence' }, o || {}));

test('one click: a Lumetri layer over all the rushes with the conversion LUT as input LUT', () => {
  const env = setup();
  const r = convert(env);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.lutSet, 1);
  const layer = env.seq.videoTracks[1].items[0];
  assert.strictEqual(layer.name, NAME);
  assert.deepStrictEqual([layer._s / env.F, layer._e / env.F], [0, 260]);
  const P = lumetri(layer).properties;
  assert.strictEqual(P[3].getValue(), LUT + '/', 'path ends with a separator');
  assert.strictEqual(P[5].getValue(), 1, 'custom input LUT selected');
  assert.strictEqual(P[6].getValue(), 0, 'second menu untouched');
  assert.strictEqual(P[2].getValue(), 1, 'basic correction on');
  // ↶ Annuler retire le calque.
  assert.strictEqual(env.call('undo', { entries: r.created }).removed, 1);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 0);
});

test('placed just above the rushes, under a look and titles already on the timeline', () => {
  const env = setup();
  const { seq, F, adj, Item } = env;
  const look = seq.videoTracks[1].add(new Item(seq, adj, 0, 260 * F, 0, 'RR FX · Look Nuit POST'));
  const r = convert(env);
  assert.ok(r.ok, r.error);
  assert.strictEqual(seq.videoTracks.length, 4, 'a track was inserted');
  assert.strictEqual(seq.videoTracks[1].items[0].name, NAME, 'conversion on V2, right above V1');
  assert.strictEqual(seq.videoTracks[2].items[0], look, 'look pushed to V3, applied after the conversion');
  assert.match(r.warnings.join(' '), /ajoutée juste au-dessus/);
  assert.strictEqual(r.created[0].track, 1);
});

test('B-roll on V2: the layer goes above the highest rush; titles below are reported', () => {
  const env = setup();
  const { seq, F, media, Item } = env;
  seq.videoTracks[1].add(new Item(seq, media, 300 * F, 340 * F, 0));
  const r = convert(env);
  assert.ok(r.ok, r.error);
  const layer = seq.videoTracks[2].items[0];
  assert.deepStrictEqual([layer._s / F, layer._e / F], [0, 340]);

  // Un titre entre deux pistes de rushs : signalé (il serait converti lui aussi).
  const env2 = setup();
  env2.seq.importMGT('/t/Titre.mogrt', String(50 * env2.F), 1);
  env2.seq.videoTracks[2].add(new Item(env2.seq, env2.media, 0, 40 * env2.F, 0));
  const r2 = convert(env2);
  assert.ok(r2.ok, r2.error);
  assert.match(r2.warnings.join(' '), /1 titre\(s\) ou calque\(s\) sous/);
  const layer2 = env2.seq.videoTracks[3].items[0];
  assert.deepStrictEqual([layer2._s / env2.F, layer2._e / env2.F], [0, 260], 'the title is not a rush: the layer stops at the last rush');
});

test('applying again replaces the conversion instead of stacking two', () => {
  const env = setup();
  assert.ok(convert(env).ok);
  const r = convert(env, { name: 'RR FX · Conversion Sony A7 III S-Log3 (calcul)' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.replaced, 1);
  const layers = env.seq.videoTracks.flatMap(t => t.items).filter(i => /Conversion/.test(i.name));
  assert.strictEqual(layers.length, 1);
  assert.match(layers[0].name, /calcul/);
});

test('selection: one layer per group of selected rushes, only above them', () => {
  const env = setup();
  const { seq, F, media, Item } = env;
  const far = seq.videoTracks[0].add(new Item(seq, media, 400 * F, 450 * F, 0));
  seq.videoTracks[0].items[0].selected = true;
  far.selected = true;
  seq.getSelection = () => seq.videoTracks.flatMap(t => t.items).filter(i => i.selected);
  const r = convert(env, { scope: 'selection' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.layers, 2);
  assert.deepStrictEqual(seq.videoTracks[1].items.map(i => [i._s / F, i._e / F]).sort((a, b) => a[0] - b[0]), [[0, 100], [400, 450]]);
  seq.videoTracks.forEach(t => t.items.forEach(i => { i.selected = false; }));
  assert.match(convert(env, { scope: 'selection' }).error, /Sélectionne les rushs/);
});

test('a Premiere whose Lumetri does not expose the input LUT: layer placed, LUT left to the user', () => {
  const env = setup();
  env.setParamNames('AE.ADBE Lumetri', ['Lumetri p0', 'Lumetri p1']);
  const r = convert(env);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.lutSet, 0);
  assert.match(r.warnings.join(' '), /choisis-la à la main/);
  assert.strictEqual(env.seq.videoTracks[1].items.length, 1);
});

test('empty sequence and missing adjustment layer are explained', () => {
  const env = makeEnv(25);
  assert.match(convert(env).error, /Aucun rush/);
});

test('looks: the generated LUT is loaded as input LUT on the look layer too', () => {
  const env = setup();
  const r = env.call('resolve', { placement: 'sequence', sides: ['post'], frames: 1, target: 'adjustment' });
  const fx = [{ type: 'lumetri', names: ['Lumetri Color'], props: [], lut: '/Users/robin/Documents/RRFX/Looks/RRFX Nuit.cube' }];
  const res = env.call('apply', { target: 'adjustment', name: 'RR FX · Look Nuit', targets: r.targets.map(t => Object.assign({}, t, { name: 'RR FX · Look Nuit', fx })) });
  assert.ok(res.ok, res.error);
  assert.strictEqual(res.lutSet, 1);
  assert.strictEqual(lumetri(env.seq.videoTracks[1].items[0]).properties[3].getValue(), '/Users/robin/Documents/RRFX/Looks/RRFX Nuit.cube/');
});
