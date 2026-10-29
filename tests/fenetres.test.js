const { test } = require('node:test');
const assert = require('node:assert');
const Ly = require('../plugin/js/fenetres.js');

const extras = { speech: [{ id: 'texte', title: 'Montage par le texte' }, { id: 'raccords', title: 'Raccords' }], formats: [{ id: 'verif', title: 'Vérifier' }, { id: 'export', title: 'Export' }, { id: 'rythme', title: 'Rythme' }] };

test('groupes : chaque onglet est dans un seul groupe', () => {
  const all = Ly.GROUPS.flatMap(g => g.tabs);
  assert.deepStrictEqual(all.slice().sort(), Object.keys(Ly.TABS).sort());
  assert.strictEqual(new Set(all).size, all.length);
  assert.strictEqual(Ly.groupOf('ramp').id, 'montage');
  assert.strictEqual(Ly.groupOf('mine').id, 'library');
});

test('espace « Tout » : rien de masqué ; les autres masquent onglets et outils', () => {
  assert.deepStrictEqual(Ly.hiddenFor('all', extras), []);
  const ess = Ly.hiddenFor('essential', extras);
  assert.ok(ess.includes('tab:ramp') && ess.includes('tab:mine'));
  assert.ok(ess.includes('speech:chapitres') && ess.includes('speech:raccords'));
  assert.ok(!ess.includes('speech:texte') && !ess.includes('speech:silences'));
  assert.ok(ess.includes('formats:rythme') && !ess.includes('formats:export'));
  // Réglages ne se masque jamais.
  Ly.SPACES.forEach(s => assert.ok(!Ly.hiddenFor(s.id, extras).includes('tab:settings'), s.id));
});

test('onglet visible et repli', () => {
  const hidden = ['tab:express', 'tab:effects', 'tab:ramp'];
  assert.ok(!Ly.tabVisible(hidden, 'effects'));
  assert.ok(Ly.tabVisible(hidden, 'settings'));
  assert.deepStrictEqual(Ly.visibleTabs(hidden, Ly.groupOf('music')), ['music']);
  assert.strictEqual(Ly.fallbackTab(hidden), 'music');
  assert.strictEqual(Ly.fallbackTab(['tab:ramp'], 'ramp'), 'effects');
  assert.strictEqual(Ly.fallbackTab(Object.keys(Ly.TABS).map(Ly.tabKey)), 'settings');
});

test('feuille de style : sections, panneaux et boutons du sommaire', () => {
  const css = Ly.css(['tab:ramp', 'speech:chapitres', 'color:curve']);
  assert.ok(!/ramp/.test(css));
  assert.ok(css.includes('#view-speech .section[data-sec="chapitres"]'));
  assert.ok(css.includes('#view-speech .sec-nav [data-target="chapitres"]'));
  assert.ok(css.includes('#view-color .lr-panel[data-panel="curve"]'));
  assert.strictEqual(css.split('\n').length, 2);
});

test('sections d\'un onglet : fixes puis ajoutées par les modules', () => {
  const s = Ly.sectionsOf('speech', extras).map(x => x[0]);
  assert.strictEqual(s[0], 'silences');
  assert.deepStrictEqual(s.slice(-2), ['texte', 'raccords']);
  assert.strictEqual(new Set(s).size, s.length);
});
