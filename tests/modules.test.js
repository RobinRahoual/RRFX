/* Raccourcis clavier et mises à jour (modules repris de Rotate). */
const { test } = require('node:test');
const assert = require('node:assert');
const Keys = require('../plugin/js/shortcuts.js');
const Updates = require('../plugin/js/updates.js');

test('shortcuts: letters, digits on AZERTY, modifiers ignored', () => {
  assert.strictEqual(Keys.normalizeKey({ key: 'a' }), 'A');
  assert.strictEqual(Keys.normalizeKey({ key: '&', code: 'Digit1' }), '1');
  assert.strictEqual(Keys.normalizeKey({ key: 'a', ctrlKey: true }), null);
  assert.strictEqual(Keys.normalizeKey({ key: 'Enter', code: 'Enter' }), null);
});

test('shortcuts: one key per action, defaults filled in', () => {
  let map = Keys.withDefaults({ apply: 'Z', ramp: 'nope' });
  assert.strictEqual(map.apply, 'Z');
  assert.strictEqual(map.ramp, '');
  assert.strictEqual(map.undo, 'U');
  map = Keys.assign(map, 'capture', 'Z');
  assert.strictEqual(map.capture, 'Z');
  assert.strictEqual(map.apply, '');
  assert.strictEqual(Keys.actionFor(map, 'Z'), 'capture');
  assert.strictEqual(Keys.actionFor(map, ''), null);
});

test('shortcuts: key codes registered with Premiere (Mac and Windows)', () => {
  const map = Keys.withDefaults(null);
  const mac = Keys.keyInterest(map, true).map(k => k.keyCode);
  const win = Keys.keyInterest(map, false).map(k => k.keyCode);
  assert.ok(mac.includes(Keys.MAC_CODES.A) && mac.includes(53), 'A and Escape on Mac');
  assert.ok(win.includes(65) && win.includes(27), 'A and Escape on Windows');
  assert.ok(!win.includes(81), 'unassigned keys stay with Premiere');
});

function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const release = (tag, assets) => ({ ok: true, json: async () => ({ tag_name: tag, html_url: 'https://github.com/x/releases/' + tag, assets: assets || [] }) });

test('updates: compares versions', () => {
  assert.strictEqual(Updates.compareVersions('1.2.0', '1.10.0'), -1);
  assert.strictEqual(Updates.compareVersions('v1.1.0', '1.1'), 0);
  assert.strictEqual(Updates.compareVersions('2.0.0', '1.9.9'), 1);
});

test('updates: newer release found, installation pack preferred, cache and dismiss', async () => {
  const storage = memoryStorage();
  let calls = 0;
  const fetch = async () => { calls++; return release('v1.2.0', [{ name: 'RRFX-1.2.0-installation.zip', browser_download_url: 'zip' }]); };
  const u = await Updates.checkForUpdate({ fetch, storage, currentVersion: '1.1.0', now: () => 1000 });
  assert.strictEqual(u.version, '1.2.0');
  assert.strictEqual(u.downloadUrl, 'zip');
  await Updates.checkForUpdate({ fetch, storage, currentVersion: '1.1.0', now: () => 2000 });
  assert.strictEqual(calls, 1, 'checked at most every 6 hours');
  Updates.dismissUpdate(storage, '1.2.0');
  assert.strictEqual(await Updates.checkForUpdate({ fetch, storage, currentVersion: '1.1.0', now: () => 3000 }), null);
  assert.ok(await Updates.checkForUpdate({ fetch, storage, currentVersion: '1.1.0', now: () => 3000, force: true }));
});

test('updates: no network, no repository, same version = no banner, no error', async () => {
  const storage = memoryStorage();
  assert.strictEqual(await Updates.checkForUpdate({ fetch: async () => { throw new Error('offline'); }, storage, currentVersion: '1.1.0' }), null);
  assert.strictEqual(await Updates.checkForUpdate({ fetch: async () => ({ ok: false }), storage, currentVersion: '1.1.0', force: true }), null);
  assert.strictEqual(await Updates.checkForUpdate({ fetch: async () => release('v1.1.0'), storage, currentVersion: '1.1.0', force: true }), null);
});
