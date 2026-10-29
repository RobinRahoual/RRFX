'use strict';
/* Panneau en anglais : chaque texte _T('…') du code a sa traduction, et la traduction garde les
   mêmes espaces en début et fin (les textes sont souvent collés à d'autres morceaux), sauf
   l'espace française avant « : ; ! ? » » et après « « ». */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'plugin', 'js');
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(DIR, 'i18n-en.js'), 'utf8'), { self: ctx });
const EN = ctx.RRFX_EN;

// Littéraux de _T('…') ou _T("…"), échappements compris.
function calls(src) {
  const out = [], re = /_T\((['"])((?:\\.|(?!\1)[^\\\n])*)\1\)/g;
  let m;
  while ((m = re.exec(src))) out.push(JSON.parse('"' + m[2].replace(/\\'/g, "'").replace(/"/g, '\\"') + '"'));
  return out;
}

test('chaque _T() du panneau a sa traduction anglaise', () => {
  const missing = [];
  fs.readdirSync(DIR).filter(f => f.endsWith('.js') && !/^i18n/.test(f)).forEach(f => {
    calls(fs.readFileSync(path.join(DIR, f), 'utf8')).forEach(s => { if (!(s in EN.dict)) missing.push(f + ' : ' + s); });
  });
  assert.deepStrictEqual(missing, []);
});

test('les traductions gardent les espaces de début et de fin', () => {
  const fr = /^\s[:;»!?]/, frEnd = /«\s$/;
  const bad = Object.keys(EN.dict).filter(k => (/^\s/.test(k) !== /^\s/.test(EN.dict[k]) && !fr.test(k)) || (/\s$/.test(k) !== /\s$/.test(EN.dict[k]) && !frEnd.test(k)));
  assert.deepStrictEqual(bad, []);
});

test('le dictionnaire des messages de Premiere va du plus long au plus court', () => {
  for (let i = 1; i < EN.host.length; i++) assert.ok(EN.host[i - 1][0].length >= EN.host[i][0].length, EN.host[i][0]);
});

test('textes de index.html traduits', () => {
  const html = fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '');
  const texts = [];
  html.replace(/>([^<>]+)</g, (m, t) => { t = t.trim(); if (/[a-zàâçéèêëîïôûùüÿœ]{3}/i.test(t) && !/^RR FX$/.test(t)) texts.push(t); return m; });
  html.replace(/(?:title|placeholder|aria-label)="([^"]+)"/g, (m, t) => { texts.push(t); return m; });
  const missing = texts.filter(t => !(t.replace(/&amp;/g, '&').replace(/&#39;/g, "'") in EN.dict) && /[éèàùç]|\b(le|la|les|des|du|un|une|et|ou)\b/i.test(t));
  assert.deepStrictEqual(missing, []);
});
