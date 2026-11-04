/* 2.16 : style d'un texte capturé dans la timeline et réappliqué en un clic ; préréglages gérés
   (intégrés masqués puis remis, corbeille). */
const { test } = require('node:test');
const assert = require('node:assert');
const { makeEnv } = require('./sim');
const Core = require('../plugin/js/core.js');
const C = require('../plugin/js/couleurs.js');
const M = require('../plugin/js/gerer.js');

const STYLE = { font: 'Montserrat-Black', size: 90, caps: true, fill: '#ffd21e', stroke: '#000000', strokeWidth: 8, shadow: true, box: '', boxOpacity: 80 };
const SHADOW = { type: 'shadow', names: ['Drop Shadow'], matchName: 'AE.ADBE Drop Shadow', props: [{ key: 'opacity', index: 1, static: 77 }] };

function setup() {
  const env = makeEnv(25);
  env.setMgtProps(() => [
    new env.Param('Source Text', '{"textEditValue":"Titre","fontEditValue":["Arial","Arial"],"fontSizeEditValue":[40,40],"fontFSAllCapsValue":[false,false],"fontTextRunLength":[2,3]}'),
    new env.Param('Fill Color', [255, 255, 255, 255]),
    new env.Param('Stroke', false), new env.Param('Stroke Color', [255, 255, 255, 255]), new env.Param('Stroke Width', 0),
    new env.Param('Shadow', false), new env.Param('Position', [0.5, 0.5])
  ]);
  return env;
}
const place = (env, start, extra) => {
  const r = env.call('placeTitle', Object.assign({ mogrt: '/t/a.mogrt', start, end: start + 3, text: 'Texte ' + start, fx: [] }, extra));
  assert.ok(r.ok, r.error);
  return env.seq.videoTracks[r.track].items.find(i => Math.abs(i._s - start * 254016000000) < 2);
};
const select = (env, it) => { env.seq.videoTracks.forEach(t => t.items.forEach(i => { i.selected = i === it; })); };

test('text look: captured from a styled text, applied in one click to another, no duplicate effect', () => {
  const env = setup();
  const a = place(env, 1, { style: STYLE, fx: [SHADOW] });
  const b = place(env, 10);
  select(env, null);
  assert.match(env.call('captureTextLook', {}).error, /Sélectionne/);
  select(env, a);
  const look = env.call('captureTextLook', {});
  assert.ok(look.ok, look.error);
  const props = look.graphics[0].props, by = n => props.find(p => p.name === n);
  assert.deepStrictEqual(by('Source Text').value, { fontEditValue: 'Montserrat-Black', fontSizeEditValue: 90, fontFSAllCapsValue: true });
  assert.strictEqual(by('Fill Color').value, 'ffd21e');
  assert.strictEqual(by('Stroke').value, true);
  assert.strictEqual(by('Stroke Width').value, 8);
  const shadow = look.effects.find(e => e.matchName === 'AE.ADBE Drop Shadow');
  assert.ok(shadow && shadow.props[1].static === 77, JSON.stringify(look.effects));
  assert.ok(!look.effects.some(e => /Motion|Opacity/.test(e.matchName)), 'placement and opacity are not style');

  // Approche pour l'aperçu.
  const st = C.styleFromLook(look);
  assert.deepStrictEqual([st.font, st.size, st.caps, st.fill, st.stroke, st.strokeWidth, st.shadow], ['Montserrat-Black', 90, true, '#ffd21e', '#000000', 8, true]);

  const fx = Core.compileCaptured({ components: look.effects, frameW: look.frameW, frameH: look.frameH }, 'full', 1, { mirror: false });
  select(env, b);
  let r = env.call('applyTextLook', { look, fx });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.done, 1);
  const P = b._mgt.properties, src = JSON.parse(P[0].getValue());
  assert.strictEqual(src.textEditValue, 'Texte 10', 'the text itself is kept');
  assert.deepStrictEqual([src.fontEditValue, src.fontSizeEditValue, src.fontFSAllCapsValue, src.fontTextRunLength], [['Montserrat-Black'], [90], [true], [8]], 'one style run for the whole text');
  assert.deepStrictEqual(P[1].getValue(), [255, 255, 210, 30]);
  assert.deepStrictEqual([P[2].getValue(), P[3].getValue(), P[4].getValue()], [true, [255, 0, 0, 0], 8]);
  const shadows = () => b.components.filter(c => c.matchName === 'AE.ADBE Drop Shadow');
  assert.strictEqual(shadows().length, 1);
  assert.strictEqual(shadows()[0].properties[1].getValue(), 77);
  r = env.call('applyTextLook', { look, fx });
  assert.ok(r.ok);
  assert.strictEqual(shadows().length, 1, 'applied twice: still one shadow');

  // Un style RR FX simple marche aussi sur la sélection.
  r = env.call('applyTextLook', { style: Object.assign({}, STYLE, { fill: '#ff0000' }), styleFx: {} });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(P[1].getValue(), [255, 255, 0, 0]);

  // Pose d'un texte avec le style capturé.
  const c = place(env, 20, { look, lookFx: fx });
  assert.strictEqual(JSON.parse(c._mgt.properties[0].getValue()).fontEditValue[0], 'Montserrat-Black');
  assert.ok(c.components.some(x => x.matchName === 'AE.ADBE Drop Shadow'));
});

test('text look: a plain video clip has nothing to capture or style', () => {
  const env = setup();
  const v = env.seq.videoTracks[0].add(new env.Item(env.seq, env.media, 0, 100 * env.F, 0));
  select(env, v);
  assert.match(env.call('captureTextLook', {}).error, /ni réglages de texte ni effets/);
  assert.match(env.call('applyTextLook', { look: { graphics: [{ matchName: '#mgt', props: [] }], effects: [] }, fx: [] }).error, /Aucun texte modifiable/);
});

test('manage: built-ins hidden then restored, deleted items go to a trash and come back', () => {
  const settings = {}, list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  M.setHidden(settings, 'titleAnim', 'b', true);
  M.setHidden(settings, 'titleAnim', 'c', true);
  M.setHidden(settings, 'effect', 'b:zoom', true);
  assert.deepStrictEqual(M.visible(settings, 'titleAnim', list, x => x.id).map(x => x.id), ['a']);
  assert.deepStrictEqual(M.visible(settings, 'titleAnim', list, x => x.id, 'c').map(x => x.id), ['a', 'c'], 'the chosen one stays');
  M.setHidden(settings, 'titleAnim', 'c', false);
  assert.deepStrictEqual(M.hiddenOf(settings, 'titleAnim'), ['b']);
  assert.strictEqual(M.restoreAll(settings, 'titleAnim'), 1);
  assert.deepStrictEqual(M.hiddenOf(settings, 'effect'), ['b:zoom'], 'other kinds untouched');
  assert.strictEqual(M.restoreAll(settings), 1);

  const it = { id: 'x1', type: 'titleAnim', name: 'Pop perso', data: {}, created: 1 };
  const lib = { items: [it], favorites: ['u:x1'], removed: [] };
  M.remove(lib, it);
  assert.deepStrictEqual([lib.items.length, lib.favorites.length, lib.removed, lib.trash.length], [0, 0, ['x1'], 1]);
  const back = M.restore(lib, lib.trash[0], 'x2');
  assert.deepStrictEqual([back.id, back.name, lib.items.length, lib.trash.length, 'deleted' in back], ['x2', 'Pop perso', 1, 0, false]);
  for (let i = 0; i < 70; i++) M.remove(lib, { id: 'n' + i, type: 'look', name: 'n' + i, data: {} });
  assert.strictEqual(lib.trash.length, 60, 'trash keeps the last 60');
});

const Lib = require('../plugin/js/library.js');
const animFx = (id, frames) => Core.titleSpec(Lib.titleById[id], Core.paramDefaults(Lib.titleById[id]), frames, 8, 8, 25);
// Effets dont se servent les animations de texte : retirés avant d'en poser une autre.
const REPLACE = Array.from(new Set([].concat(...Lib.TITLE_ANIMS.map(a => Core.titleSpec(a, Core.paramDefaults(a), 40, 8, 8, 25).filter(f => !f.intrinsic).map(f => f.matchName)))));

test('texts already in the timeline: animated where they are, a new animation replaces the old one', () => {
  const env = setup();
  env.setRemovable(true);
  const a = place(env, 1), b = place(env, 10);
  select(env, null);
  assert.match(env.call('selectedTexts', {}).error, /Sélectionne/);
  a.selected = true; b.selected = true;
  const sel = env.call('selectedTexts', {});
  assert.ok(sel.ok, sel.error);
  assert.deepStrictEqual(sel.items.map(x => [x.frames, x.kind]), [[75, 'mgt'], [75, 'mgt']]);
  const run = id => env.call('animateTexts', { replace: REPLACE, items: sel.items.map(x => ({ track: x.track, start: x.start, fx: animFx(id, x.frames) })) });
  let r = run('zoom-blur');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual([r.done, r.total], [2, 2]);
  const fxOf = it => it.components.map(c => c.matchName).filter(m => m !== 'AE.ADBE Motion' && m !== 'AE.ADBE Opacity');
  assert.deepStrictEqual(fxOf(a).sort(), ['AE.ADBE Gaussian Blur 2', 'AE.ADBE Geometry2'].sort(), fxOf(a).join());
  const geo = () => a.components.find(c => c.matchName === 'AE.ADBE Geometry2');
  const opacityKeys = () => geo().properties.find(p => /Opacit/i.test(p.displayName)).keys;
  const F = env.F, t0 = a._in;
  assert.ok(opacityKeys().some(k => k.t === t0) && opacityKeys().some(k => k.t === t0 + 74 * F), 'entry at the start, exit at the end');
  r = run('slide-up');
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(fxOf(a).sort(), ['AE.ADBE Geometry2', 'AE.ADBE Motion Blur'].sort(), 'old blur removed, one Transform only: ' + fxOf(a).join());
  // Une animation capturée (Opacité du clip) : ses images clés remplacent celles d'avant.
  const cap = { frameW: 1920, frameH: 1080, in: { frames: 4, components: [{ matchName: 'AE.ADBE Opacity', displayName: 'Opacity', intrinsic: 'opacity', props: [{ index: 0, name: 'Opacity', values: [0, 30, 70, 100] }] }] }, out: null };
  select(env, a);
  r = env.call('animateTexts', { replace: REPLACE, items: [{ track: sel.items[0].track, start: sel.items[0].start, fx: Core.titleSpecCaptured(cap, 75) }] });
  assert.ok(r.ok, r.error);
  const op = a.components.find(c => c.matchName === 'AE.ADBE Opacity').properties[0];
  assert.deepStrictEqual(op.keys.map(k => k.v), [0, 30, 70, 100]);
});

test('inspectText: a report of what Premiere shows for the selected text', () => {
  const env = setup();
  const a = place(env, 1);
  select(env, a);
  const r = env.call('inspectText', {});
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.kind, 'mgt');
  assert.ok(r.mgt.props.some(p => p.name === 'Source Text' && p.type === 'string' && /textEditValue/.test(p.value)));
  assert.ok(r.mgt.props.some(p => p.name === 'Fill Color' && p.type === 'color'));
  assert.ok(r.components.some(c => c.matchName === 'AE.ADBE Motion'));
});
