/* Style de texte posé par l'hôte : réglages exposés par le modèle, sinon Teinte et Ombre portée. */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');

const STYLE = { font: 'Montserrat-Black', size: 90, caps: true, fill: '#ffd21e', stroke: '#000000', strokeWidth: 8, shadow: true, box: '', boxOpacity: 80 };
const FX = {
  fill: { type: 'tint', names: ['Tint'], matchName: 'AE.ADBE Tint', props: [{ key: 'black', index: 0, color: true, static: [0, 0, 0] }, { key: 'white', index: 1, color: true, static: [255, 210, 30] }, { key: 'amount', index: 2, static: 100 }] },
  shadow: { type: 'shadow', names: ['Drop Shadow'], matchName: 'AE.ADBE Drop Shadow', props: [{ key: 'opacity', index: 1, static: 60 }] }
};

test('text style: font, size and caps in the text, colours and stroke from the model settings', () => {
  const env = makeEnv(25);
  env.setMgtProps(() => [
    new env.Param('Source Text', '{"textEditValue":"Titre","fontEditValue":["Arial"],"fontSizeEditValue":[40],"fontFSAllCapsValue":[false]}'),
    new env.Param('Fill Color', [255, 255, 255, 255]),
    new env.Param('Stroke', false), new env.Param('Stroke Color', [255, 255, 255, 255]), new env.Param('Stroke Width', 0),
    new env.Param('Shadow', false), new env.Param('Position', [0.5, 0.5])
  ]);
  const r = env.call('placeTitle', { mogrt: '/t/a.mogrt', start: 1, end: 4, text: 'Salut', fx: [], style: STYLE, styleFx: FX });
  assert.ok(r.ok, r.error);
  const it = env.seq.videoTracks[r.track].items[0], P = it._mgt.properties;
  const src = JSON.parse(P[0].getValue());
  assert.deepStrictEqual([src.textEditValue, src.fontEditValue, src.fontSizeEditValue, src.fontFSAllCapsValue], ['Salut', ['Montserrat-Black'], [90], [true]]);
  assert.deepStrictEqual(P[1].getValue(), [255, 255, 210, 30], 'fill');
  assert.deepStrictEqual([P[2].getValue(), P[3].getValue(), P[4].getValue()], [true, [255, 0, 0, 0], 8], 'stroke');
  assert.strictEqual(P[5].getValue(), true, 'shadow');
  assert.ok(!it.components.some(c => c.matchName === 'AE.ADBE Tint' || c.matchName === 'AE.ADBE Drop Shadow'), 'no fallback effect needed');
  assert.deepStrictEqual(r.warnings, []);
});

test('text style on a model without settings: Tint and Drop Shadow, missing stroke reported', () => {
  const env = makeEnv(25);
  const r = env.call('placeTitle', { mogrt: '/t/b.mogrt', start: 1, end: 4, text: 'Salut', fx: [], style: STYLE, styleFx: FX });
  assert.ok(r.ok, r.error);
  const it = env.seq.videoTracks[r.track].items[0];
  const tint = it.components.find(c => c.matchName === 'AE.ADBE Tint');
  assert.ok(tint, 'Tint added');
  assert.deepStrictEqual(tint.properties[1].getValue().slice(1), [255, 210, 30]);
  assert.ok(it.components.some(c => c.matchName === 'AE.ADBE Drop Shadow'), 'Drop Shadow added');
  assert.ok(r.warnings.some(w => /contour/.test(w)), r.warnings.join(' | '));
});

test('a white text with no shadow and no stroke adds nothing', () => {
  const env = makeEnv(25);
  const r = env.call('placeTitle', { mogrt: '/t/c.mogrt', start: 1, end: 4, text: 'Salut', fx: [], style: { fill: '#ffffff', stroke: '', shadow: false, box: '' }, styleFx: FX });
  assert.ok(r.ok, r.error);
  const it = env.seq.videoTracks[r.track].items[0];
  assert.ok(!it.components.some(c => /Tint|Drop Shadow/.test(c.matchName)));
  assert.deepStrictEqual(r.warnings, []);
});

test('gradient layer: Ramp colours and points, blend mode on the opacity', () => {
  const env = makeEnv(25);
  env.seq.videoTracks[0].add(new env.Item(env.seq, env.media, 0, 100 * env.F, 0));
  const fx = [
    { type: 'ramp', names: ['Ramp'], matchName: 'AE.ADBE Ramp', props: [{ key: 'start', index: 0, point: true, static: [0, 0.5] }, { key: 'startColor', index: 1, color: true, static: [255, 126, 95] }, { key: 'end', index: 2, point: true, static: [1, 0.5] }, { key: 'endColor', index: 3, color: true, static: [254, 180, 123] }, { key: 'shape', index: 4, static: 1 }] },
    { type: 'opacity', names: [], matchName: 'AE.ADBE Opacity', intrinsic: 'opacity', props: [{ key: 'opacity', index: 0, static: 45 }, { key: 'blend', index: 1, static: 13 }] }
  ];
  const res = env.call('resolve', { placement: 'sequence', sides: ['post'], frames: 1, target: 'adjustment' });
  assert.ok(res.ok, res.error);
  const r = env.call('apply', { target: 'adjustment', name: 'RR FX · Dégradé', targets: res.targets.map(t => Object.assign({}, t, { name: 'RR FX · Dégradé', fx })) });
  assert.ok(r.ok, r.error);
  const layer = [].concat(...[0, 1, 2].map(i => env.seq.videoTracks[i].items)).find(it => /Dégradé/.test(it.name));
  assert.ok(layer, 'adjustment layer');
  const ramp = layer.components.find(c => c.matchName === 'AE.ADBE Ramp');
  assert.deepStrictEqual(ramp.properties[1].getValue(), [255, 255, 126, 95]);
  assert.deepStrictEqual(ramp.properties[3].getValue(), [255, 254, 180, 123]);
  assert.strictEqual(ramp.properties[4].getValue(), 1);
  const op = layer.components.find(c => c.matchName === 'AE.ADBE Opacity');
  assert.deepStrictEqual([op.properties[0].getValue(), op.properties[1].getValue()], [45, 13]);
});
