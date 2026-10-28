/* Couleurs, nuanciers, dégradés, styles de texte, liens, rampes. */
const { test } = require('node:test');
const assert = require('node:assert');
global.self = global;
const Core = require('../plugin/js/core.js');
const C = require('../plugin/js/couleurs.js');
const L = require('../plugin/js/liens.js');

test('colours: hex, rgb(), Coolors links and pasted lists', () => {
  assert.strictEqual(C.hex('#ABC'), '#aabbcc');
  assert.strictEqual(C.hex('ff8800'), '#ff8800');
  assert.strictEqual(C.hex('rgb(255, 0, 128)'), '#ff0080');
  assert.strictEqual(C.hex('nope'), null);
  assert.deepStrictEqual(C.parseColors('https://coolors.co/palette/264653-2a9d8f-e9c46a'), ['#264653', '#2a9d8f', '#e9c46a']);
  assert.deepStrictEqual(C.parseColors('#fff, rgb(0,0,0) et #FFFFFF'), ['#000000', '#ffffff']);
  assert.deepStrictEqual(C.parseColors('264653 2a9d8f'), ['#264653', '#2a9d8f']);
  assert.deepStrictEqual(C.rgb('#102030'), [16, 32, 48]);
});

test('Adobe swatches (.ase): written then read back, CMYK and grey read too', () => {
  const ase = C.writeASE([{ name: 'Rouge marque', hex: '#e63946' }, { hex: '#1d3557' }]);
  assert.strictEqual(String.fromCharCode(...ase.slice(0, 4)), 'ASEF');
  assert.deepStrictEqual(C.parseASE(ase), [{ name: 'Rouge marque', hex: '#e63946' }, { name: '#1d3557', hex: '#1d3557' }]);
  // Un bloc CMYK et un bloc gris faits à la main.
  const block = (name, model, vals) => {
    const len = 2 + (name.length + 1) * 2 + 4 + vals.length * 4 + 2, dv = new DataView(new ArrayBuffer(6 + len));
    dv.setUint16(0, 1); dv.setUint32(2, len); dv.setUint16(6, name.length + 1);
    for (let i = 0; i < name.length; i++) dv.setUint16(8 + i * 2, name.charCodeAt(i));
    let q = 8 + (name.length + 1) * 2;
    model.split('').forEach((c, i) => dv.setUint8(q + i, c.charCodeAt(0)));
    q += 4;
    vals.forEach((v, i) => dv.setFloat32(q + i * 4, v));
    return new Uint8Array(dv.buffer);
  };
  const b1 = block('Cyan', 'CMYK', [1, 0, 0, 0]), b2 = block('Gris', 'Gray', [0.5]);
  const all = new Uint8Array(12 + b1.length + b2.length), dv = new DataView(all.buffer);
  'ASEF'.split('').forEach((c, i) => { all[i] = c.charCodeAt(0); });
  dv.setUint16(4, 1); dv.setUint32(8, 2);
  all.set(b1, 12); all.set(b2, 12 + b1.length);
  assert.deepStrictEqual(C.parseASE(all).map(c => c.hex), ['#00ffff', '#808080']);
  assert.throws(() => C.parseASE(new Uint8Array(20)), /nuancier/);
});

test('gradients: CSS read, Ramp settings (points from the angle, colours, shape)', () => {
  assert.deepStrictEqual(C.parseGradient('linear-gradient(90deg, #ff7e5f 0%, #feb47b 100%)'), { type: 'linear', angle: 90, colors: ['#ff7e5f', '#feb47b'] });
  assert.strictEqual(C.parseGradient('linear-gradient(to bottom right, #000, #fff)').angle, 135);
  assert.strictEqual(C.parseGradient('radial-gradient(circle, #000, #fff)').type, 'radial');
  assert.strictEqual(C.parseGradient('#000'), null);
  const r = C.rampOf({ type: 'linear', angle: 90, colors: ['#ff0000', '#0000ff'] });
  assert.deepStrictEqual(r.start.map(v => +v.toFixed(6)), [0, 0.5]);
  assert.deepStrictEqual(r.end.map(v => +v.toFixed(6)), [1, 0.5]);
  assert.deepStrictEqual([r.startColor, r.endColor, r.shape], [[255, 0, 0], [0, 0, 255], 1]);
  const down = C.rampOf({ type: 'linear', angle: 180, colors: ['#000', '#fff'] });
  assert.ok(down.start[1] < down.end[1], 'top to bottom');
  assert.strictEqual(C.rampOf({ type: 'radial', angle: 0, colors: ['#000', '#fff'] }).shape, 2);
  assert.ok(/^linear-gradient\(90deg, #ff0000, #0000ff\)$/.test(C.gradientCss({ type: 'linear', angle: 90, colors: ['#ff0000', '#0000ff'] })));
  C.GRADIENTS.forEach(g => assert.ok(g.g.colors.every(c => C.hex(c)), g.id));
});

test('text styles: cleaned up, model kept when empty, built-in styles valid', () => {
  assert.deepStrictEqual(C.normStyle({}), { font: '', size: 0, caps: false, fill: '#ffffff', stroke: '', strokeWidth: 0, shadow: false, box: '', boxOpacity: 80 });
  const s = C.normStyle({ font: '  Montserrat-Bold ', size: 999, fill: 'nope', stroke: '#000', strokeWidth: -3, boxOpacity: 150 });
  assert.deepStrictEqual([s.font, s.size, s.fill, s.stroke, s.strokeWidth, s.boxOpacity], ['Montserrat-Bold', 400, '#ffffff', '#000000', 0, 100]);
  C.STYLES.forEach(x => assert.ok(C.normStyle(x.style).fill, x.id));
  // La couleur passe comme réglage de couleur (Teinte) dans le registre.
  const fx = Core.compileEffect({ params: [], build: () => [{ type: 'tint', props: { white: C.rgb('#ffd21e'), amount: 100 } }] }, {}, 'post', 1, 25);
  assert.deepStrictEqual(fx[0].props[0], { key: 'white', index: 1, point: false, color: true, static: [255, 210, 30] });
});

test('links: direct files, Dropbox and Drive turned into downloads, platforms, refusals', () => {
  assert.deepStrictEqual(L.classify('https://exemple.fr/media/Mon%20clip.mp4?x=1'), { ok: true, kind: 'direct', url: 'https://exemple.fr/media/Mon%20clip.mp4?x=1', ext: 'mp4', host: 'exemple.fr' });
  const db = L.classify('https://www.dropbox.com/s/abc/son.mp3?dl=0');
  assert.ok(db.ok && db.kind === 'direct' && /dl=1/.test(db.url) && db.ext === 'mp3');
  assert.strictEqual(L.classify('https://drive.google.com/file/d/1AbC-d_9/view?usp=sharing').url, 'https://drive.google.com/uc?export=download&id=1AbC-d_9');
  ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://vimeo.com/123', 'https://soundcloud.com/a/b'].forEach(u => assert.strictEqual(L.classify(u).kind, 'platform', u));
  assert.ok(!L.classify('pas un lien').ok);
  assert.ok(!L.classify('ftp://a.b/c.mp4').ok);
  assert.ok(!L.classify('https://exemple.fr/page.html').ok);
  assert.strictEqual(L.nameFromUrl('https://a.b/dir/Mon%20son%3A1.mp3', 'mp3'), 'Mon son 1.mp3');
  assert.strictEqual(L.safeName('  ..a/b*c  '), 'a b c');
  assert.strictEqual(L.progressOf('[download]  42.3% of 10.00MiB'), 0.423);
  assert.strictEqual(L.progressOf('[info] x'), null);
});

test('yt-dlp: MP3 with ffmpeg, M4A without, MP4 video, no playlist, final path printed', () => {
  const a = L.ytdlpArgs({ url: 'https://youtu.be/x', mode: 'audio', out: '/dl/', ffmpeg: '/bin/ffmpeg' });
  assert.ok(a.includes('--no-playlist') && a.includes('mp3') && a.includes('/bin/ffmpeg'));
  assert.deepStrictEqual(a.slice(-2), ['--', 'https://youtu.be/x'], 'the link can never be read as an option');
  assert.strictEqual(a[a.indexOf('-o') + 1], '/dl/%(title).70s [%(id)s].%(ext)s');
  assert.ok(a.includes('after_move:filepath'));
  const b = L.ytdlpArgs({ url: 'u', mode: 'audio', out: '/dl', ffmpeg: '' });
  assert.ok(b.includes('ba[ext=m4a]/ba') && !b.includes('mp3'));
  const v = L.ytdlpArgs({ url: 'u', mode: 'video', out: '/dl', ffmpeg: '' });
  assert.ok(v.includes('b[ext=mp4]/b'));
  assert.ok(L.candidates('yt-dlp', 'win32', { LOCALAPPDATA: 'C:\\L', USERPROFILE: 'C:\\U' }).includes('C:\\L\\Microsoft\\WinGet\\Links\\yt-dlp.exe'));
  assert.ok(L.candidates('ffmpeg', 'darwin', { HOME: '/Users/r' }).includes('/opt/homebrew/bin/ffmpeg'));
});

test('ramp presets: 20, grouped by use, speeds within Premiere limits, start and end set', () => {
  const P = Core.RAMP_PRESETS, keys = Object.keys(P);
  assert.ok(keys.length >= 20);
  keys.forEach(k => {
    const p = P[k];
    assert.ok(['pre', 'post', 'playhead', 'full'].includes(p.placement), k);
    assert.strictEqual(p.points[0].t, 0, k);
    assert.strictEqual(p.points[p.points.length - 1].t, 1, k);
    p.points.forEach(q => assert.ok(q.v >= 10 && q.v <= 1000, k + ' ' + q.v));
    for (let i = 1; i < p.points.length; i++) assert.ok(p.points[i].t > p.points[i - 1].t, k);
    assert.ok(p.label && p.label.length > 3, k);
  });
});

test('share codes and packs carry the new kinds (text style, gradient, palette…)', () => {
  const Share = require('../plugin/js/share.js'), P = require('../plugin/js/stylepack.js');
  const items = [
    { id: 'a', type: 'textStyle', name: 'Jaune', data: { style: { fill: '#ffd21e' } } },
    { id: 'b', type: 'gradient', name: 'Soleil', data: { g: { type: 'linear', angle: 90, colors: ['#ff7e5f', '#feb47b'] } } },
    { id: 'c', type: 'palette', name: 'Marque', data: { colors: ['#264653'] } },
    { id: 'd', type: 'mystery', name: 'x', data: {} }
  ];
  const back = Share.decode(Share.encode(items, null), null);
  assert.deepStrictEqual(back.map(i => i.type), ['textStyle', 'gradient', 'palette']);
  assert.ok(back.every(i => !('id' in i)), 'no local id');
  assert.strictEqual(P.summary({ items: back, overlays: [] }), '1 style de texte perso, 1 dégradé, 1 palette');
});
