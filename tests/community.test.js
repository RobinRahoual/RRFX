/* Bibliothèque en ligne : lecture des issues GitHub, cache, tri, adresse de publication. */
const { test } = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const C = require('../plugin/js/community.js');
const Share = require('../plugin/js/share.js');

const zip = { deflate: b => new Uint8Array(zlib.deflateRawSync(Buffer.from(b))), inflate: b => new Uint8Array(zlib.inflateRawSync(Buffer.from(b))) };
const decode = code => Share.decode(code, zip);
const preset = name => ({ type: 'preset', name, cat: 'zooms', data: { base: 'zoom-in', params: { frames: 8, intensity: 120 } } });
const body = (name, desc, code) => '### Nom\n\n' + name + '\n\n### Description\n\n' + (desc || '_No response_') + '\n\n### Code CutFX\n\n' + code + '\n';
const issue = (n, name, opts) => Object.assign({
  number: n, title: '[Preset] ' + name, state: 'open', html_url: 'https://github.com/x/issues/' + n,
  created_at: new Date(2026, 0, n).toISOString(), user: { login: 'user' + n }, reactions: { '+1': 0 },
  body: body(name, 'Zoom pour les drops', Share.encode([preset(name)], zip))
}, opts || {});
function memory() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
const reply = list => async () => ({ ok: true, status: 200, json: async () => list });

test('community: issues become presets, invalid or closed ones are skipped', () => {
  const e = C.parseIssue(issue(4, 'Zoom drop', { reactions: { '+1': 3, heart: 2 } }), decode);
  assert.strictEqual(e.name, 'Zoom drop');
  assert.strictEqual(e.desc, 'Zoom pour les drops');
  assert.strictEqual(e.author, 'user4');
  assert.strictEqual(e.likes, 5);
  assert.deepStrictEqual(e.types, ['preset']);
  assert.strictEqual(e.items[0].data.base, 'zoom-in');
  assert.strictEqual(C.parseIssue(issue(5, 'x', { body: 'pas de code' }), decode), null);
  assert.strictEqual(C.parseIssue(issue(6, 'x', { body: body('x', '', 'CUTFX1:abimé') }), decode), null);
  assert.strictEqual(C.parseIssue(issue(7, 'x', { state: 'closed' }), decode), null);
  assert.strictEqual(C.parseIssue(issue(8, 'x', { pull_request: {} }), decode), null);
  // Code coupé sur plusieurs lignes par un copier-coller : retrouvé quand même.
  const code = Share.encode([preset('Long')], zip);
  const split = C.parseIssue(issue(9, 'Long', { body: body('Long', '', code.slice(0, 20) + '\n' + code.slice(20)) }), decode);
  assert.ok(split && split.items[0].name === 'Long');
});

test('community: load uses the cache for 10 minutes, then GitHub again', async () => {
  const storage = memory();
  let calls = 0;
  const fetch = async (url) => { calls++; assert.ok(/labels=preset&state=open/.test(url)); return reply([issue(1, 'A'), issue(2, 'B'), { number: 3, title: 'bug', body: 'rien', state: 'open' }])(); };
  let r = await C.load({ fetch, storage, decode, now: () => 1000 });
  assert.strictEqual(r.list.length, 2);
  assert.strictEqual(r.cached, false);
  r = await C.load({ fetch, storage, decode, now: () => 1000 + 60000 });
  assert.strictEqual(r.cached, true);
  assert.strictEqual(calls, 1);
  await C.load({ fetch, storage, decode, now: () => 1000 + C.CACHE_MS + 1 });
  assert.strictEqual(calls, 2);
  await C.load({ fetch, storage, decode, now: () => 1000 + C.CACHE_MS + 2, force: true });
  assert.strictEqual(calls, 3);
});

test('community: offline or rate-limited → clear message, old list kept', async () => {
  const storage = memory();
  await C.load({ fetch: reply([issue(1, 'A')]), storage, decode, now: () => 0 });
  const limited = await C.load({ fetch: async () => ({ ok: false, status: 403 }), storage, decode, now: () => C.CACHE_MS * 2 });
  assert.match(limited.error, /limite/);
  assert.strictEqual(limited.list.length, 1, 'cached list still shown');
  const none = await C.load({ fetch: async () => { throw new Error('offline'); }, storage: memory(), decode });
  assert.deepStrictEqual(none.list, []);
  assert.ok(none.error);
  const missing = await C.load({ fetch: async () => ({ ok: false, status: 404 }), storage: memory(), decode });
  assert.match(missing.error, /introuvable/);
});

test('community: pages of 100 are all read', async () => {
  const many = Array.from({ length: 100 }, (_, i) => issue(i + 1, 'P' + i));
  const pages = [];
  const fetch = async url => { const p = Number(/[?&]page=(\d+)/.exec(url)[1]); pages.push(p); return reply(p === 1 ? many : [issue(500, 'Last')])(); };
  const r = await C.load({ fetch, storage: memory(), decode });
  assert.deepStrictEqual(pages, [1, 2]);
  assert.strictEqual(r.list.length, 101);
});

test('community: search, type filter and sort', () => {
  const list = [issue(1, 'Zoom doux'), issue(2, 'Flash drop', { reactions: { '+1': 9 } }), issue(3, 'Shake')].map(i => C.parseIssue(i, decode));
  list[2].types = ['ramp'];
  assert.deepStrictEqual(C.filter(list, { sort: 'popular' }).map(e => e.number), [2, 3, 1]);
  assert.deepStrictEqual(C.filter(list, { sort: 'recent' }).map(e => e.number), [3, 2, 1]);
  assert.deepStrictEqual(C.filter(list, { search: 'DOUX' }).map(e => e.number), [1]);
  assert.deepStrictEqual(C.filter(list, { search: 'user2' }).map(e => e.number), [2]);
  assert.deepStrictEqual(C.filter(list, { type: 'ramp' }).map(e => e.number), [3]);
});

test('community: publish link pre-fills the form, long codes are pasted by hand', () => {
  const code = Share.encode([preset('Mon zoom')], zip);
  const p = C.publishURL({ name: 'Mon zoom & co', desc: 'Pour les drops', code });
  assert.ok(p.withCode);
  const u = new URL(p.url);
  assert.strictEqual(u.searchParams.get('template'), 'preset.yml');
  assert.strictEqual(u.searchParams.get('nom'), 'Mon zoom & co');
  assert.strictEqual(u.searchParams.get('title'), '[Preset] Mon zoom & co');
  assert.strictEqual(u.searchParams.get('code'), code);
  const long = C.publishURL({ name: 'Gros', desc: '', code: 'CUTFX1:' + 'a'.repeat(9000) });
  assert.strictEqual(long.withCode, false);
  assert.ok(long.url.length < C.MAX_URL && !/code=/.test(long.url));
});
