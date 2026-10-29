/* Synchro entre ordinateurs : ce qui part, et comment ça se fond dans l'autre bibliothèque. */
const { test } = require('node:test');
const assert = require('node:assert');
const SD = require('../plugin/js/syncdata.js');

const lib = (items, settings, extra) => Object.assign({ items, favorites: [], removed: [], settings }, extra || {});
const it = (id, name) => ({ id, type: 'preset', name, data: { base: 'zoom-in' } });

test('sync: machine-specific settings never leave the computer', () => {
  const p = SD.pack(lib([it('a', 'A')], { adjNodeId: 'n1', sync: { dir: '/x' }, remote: { token: 't' }, lang: 'en', speech: { level: 'soft' }, myColors: ['#fff'] }), 'mac', 1000);
  assert.deepStrictEqual(Object.keys(p.settings).sort(), ['myColors', 'speech']);
  assert.ok(SD.valid(p));
  assert.ok(!SD.valid({ kind: 'other' }));
});

test('sync: libraries are joined, the newest side wins on the same item and on settings', () => {
  const local = lib([it('a', 'A local'), it('b', 'B')], { speech: { level: 'soft' }, adjNodeId: 'mine', sync: { dir: '/l' } });
  const remote = SD.pack(lib([it('a', 'A distant'), it('c', 'C')], { speech: { level: 'strong' }, adjNodeId: 'theirs' }), 'pc', 5000);
  const older = SD.merge(local, remote, 9000);
  assert.deepStrictEqual(older.lib.items.map(i => i.name).sort(), ['A local', 'B', 'C']);
  assert.strictEqual(older.settings, false);
  assert.strictEqual(older.lib.settings.speech.level, 'soft');
  const newer = SD.merge(local, remote, 1000);
  assert.deepStrictEqual(newer.lib.items.map(i => i.name).sort(), ['A distant', 'B', 'C']);
  assert.strictEqual(newer.added, 1);
  assert.strictEqual(newer.lib.settings.speech.level, 'strong');
  assert.strictEqual(newer.lib.settings.adjNodeId, 'mine', 'local keys kept');
  assert.deepStrictEqual(newer.lib.settings.sync, { dir: '/l' });
  assert.strictEqual(local.items[0].name, 'A local', 'local library untouched');
});

test('sync: an item deleted on one computer is deleted on the other', () => {
  const local = lib([it('a', 'A'), it('b', 'B')], {}, { removed: [] });
  const remote = SD.pack(lib([it('a', 'A')], {}, { removed: ['b'] }), 'pc', 10);
  const r = SD.merge(local, remote, 5);
  assert.deepStrictEqual(r.lib.items.map(i => i.id), ['a']);
  assert.strictEqual(r.removed, 1);
  // Et pas ressuscité par l'autre côté.
  const back = SD.merge(lib([it('a', 'A')], {}, { removed: ['b'] }), SD.pack(lib([it('a', 'A'), it('b', 'B')], {}), 'pc', 99), 1);
  assert.deepStrictEqual(back.lib.items.map(i => i.id), ['a']);
  assert.throws(() => SD.merge(local, { kind: 'x' }, 0), /illisible/);
});
