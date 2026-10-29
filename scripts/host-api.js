#!/usr/bin/env node
/*
 * Le contrat entre le panneau et Premiere : chaque fonction de src/host/*.jsx appelée par le
 * panneau (Host.call('nom', {...})), avec ce qu'elle fait. C'est la liste à refaire le jour où
 * RR FX passe à UXP (le reste du panneau ne change pas). → docs/HOST-API.md
 *
 *   node scripts/host-api.js           écrit docs/HOST-API.md
 *   node scripts/host-api.js --check   vérifie qu'il est à jour (tests)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.join(root, 'src', 'host');
const out = path.join(root, 'docs', 'HOST-API.md');

// é → é : les commentaires de host.jsx sont en ASCII.
// Pour les fonctions sans commentaire dans le code.
const DESC = {
  markerList: 'Les marqueurs de la séquence, la tête de lecture et la plage sélectionnée (secondes).',
  clearAll: 'Retire tout ce que RR FX a posé (calques « RR FX · … », copies, marqueurs) sur la séquence ou la sélection.',
  getContext: 'La séquence active : nom, id, cadence, taille, plans sélectionnés, marqueurs, nom du projet.',
  resolve: 'Les cibles d\'un effet : la coupe, les coupes, les marqueurs, les plans entiers (selon le placement).',
  apply: 'Pose les effets compilés (images clés) sur les calques de réglage ou les plans visés. → ce qu\'il faut pour annuler.',
  undo: 'Annule une opération RR FX à partir de ce qu\'elle a posé (calques, effets, coupes, volumes, transitions…).',
  capture: 'Lit les effets et images clés du plan sélectionné (effets tiers compris) pour les réutiliser.',
  diagnose: 'Diagnostic du plan sélectionné : ses effets et leurs paramètres (journal).',
  listEffects: 'Noms des effets vidéo de ce Premiere (dans sa langue), pour retrouver ceux qu\'utilise RR FX.',
  adjustmentInfo: 'Le calque de réglage du projet (celui que RR FX duplique), retrouvé tout seul.',
  adjustmentFromSelection: 'Le calque de réglage choisi dans le panneau Projet devient celui de RR FX.',
  placeRushes: 'Montage auto : pose les rushs l\'un après l\'autre aux temps donnés (un plan tous les N temps).',
  cutAtTimes: 'Coupe les plans sélectionnés aux temps donnés (marqueurs, temps forts).',
  multicamSwitch: 'Multicam sur le rythme : une caméra active différente entre chaque temps fort.',
  syncInfo: 'Les plans à synchroniser (son de caméra et son externe / musique), avec leurs fichiers.',
  grabFrames: 'Exporte des images de la séquence (aperçus sur la vraie image).',
  framesEnd: 'Réactive ce que framesBegin avait désactivé, une fois les images analysées.',
  formatCopy: 'Copie de la séquence en 9:16, 4:5 ou 1:1 : recadrage auto, suivi du visage ou fond flou.',
  speechInfo: 'Les plans parlés sélectionnés, avec leurs fichiers et leurs points d\'entrée (silences, euh, voix).',
  rampResolve: 'Le passage visé par une speed ramp (avant, après, autour de la coupe), avec sa marge de média.',
  openSequence: 'Ouvre une séquence du projet par son id (plusieurs séquences, versions).',
  rollEdits: 'Déplace des coupes (image et son ensemble) : coupes recalées sur les blancs.'
};

const fromAscii = s => s.replace(/\\u([0-9a-f]{4})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));

function doc() {
  const parts = fs.readdirSync(dir).filter(n => /\.jsx$/.test(n)).sort();
  const lines = ['# RR FX : contrat panneau ↔ Premiere', '',
    'Généré par `node scripts/host-api.js` depuis `src/host/` : ne pas modifier à la main.', '',
    'Le panneau (HTML/JS) ne parle à Premiere que par `Host.call(nom, objet)` → `{ ok: true, … }` ou',
    '`{ ok: false, error }`. Toutes les fonctions ci-dessous sont dans `plugin/jsx/host.jsx` (ExtendScript, CEP).',
    'Pour passer à UXP, il suffit de refaire ces fonctions avec l\'API UXP de Premiere (mêmes noms, mêmes',
    'objets en entrée et en sortie) : le reste du panneau ne change pas, et `tests/sim.js` décrit le',
    'comportement attendu de chacune.', ''];
  let total = 0;
  parts.forEach(n => {
    const src = fs.readFileSync(path.join(dir, n), 'utf8').split('\n');
    const api = [];
    src.forEach(l => { const m = /^\s+api\.(\w+) = guard\((\w+)\);/.exec(l); if (m) api.push([m[1], m[2]]); });
    if (!api.length) return;
    const title = (src.find(l => /\/\/ =+ /.test(l)) || '').replace(/^\s*\/\/ =+ /, '') || 'Noyau';
    lines.push('## ' + fromAscii(title) + ' (`' + n + '`)', '', '| Fonction | Rôle |', '|---|---|');
    api.forEach(([name, fn]) => {
      const i = src.findIndex(l => new RegExp('^\\s+function ' + fn + '\\(').test(l));
      // Le commentaire juste au-dessus de la fonction.
      const notes = [];
      for (let k = i - 1; k >= 0; k--) {
        const t = src[k].trim();
        if (/^\/\//.test(t)) notes.unshift(t.replace(/^\/\/\s?/, ''));
        else if (/\*\/$/.test(t)) {
          let j = k;
          while (j >= 0 && !/\/\*/.test(src[j])) j--;
          notes.unshift(src.slice(j, k + 1).map(x => x.trim().replace(/^\/\*\s?|\s?\*\/$/g, '')).join(' '));
          break;
        } else break;
      }
      lines.push('| `' + name + '` | ' + (DESC[name] || fromAscii(notes.join(' ').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()) || '—') + ' |');
      total++;
    });
    lines.push('');
  });
  lines.splice(4, 0, '**' + total + ' fonctions.**', '');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const text = doc();
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== text) { console.error('docs/HOST-API.md n\'est pas à jour : node scripts/host-api.js'); process.exit(1); }
  } else {
    fs.writeFileSync(out, text);
    console.log('docs/HOST-API.md');
  }
}

module.exports = { doc };
