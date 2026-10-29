/* RR FX : calculs des outils de la 2.5, sans DOM (testés sous Node).
   - textCuts / afterCuts : montage par le texte (phrases barrées du .srt → passages à couper).
   - fitPlan : musique raccourcie sur les temps forts pour finir avec la vidéo.
   - versionName : nom de la version suivante d'une séquence (« Interview v03 »).
   - renamePlan : renommage en série (« Interview_### » → Interview_001, Interview_002…).
   - activity : temps passé sur un projet (minutes où quelque chose a bougé dans Premiere).
   - savedMinutes / duration : temps gagné estimé par opération, et son affichage. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXOutils = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  // ---------------------------------------------------------------- montage par le texte

  /* Sous-titres barrés (indices) → passages à couper [{ a, b }] (temps du .srt). Chaque passage
     va du milieu du blanc d'avant au milieu du blanc d'après (au plus pad s de part et d'autre) :
     la phrase part avec sa respiration, pas avec un bout de la voisine. Passages voisins réunis. */
  function textCuts(cues, struck, pad) {
    const p = pad === undefined ? 0.2 : pad, on = new Set(struck || []), out = [];
    cues.forEach((c, i) => {
      if (!on.has(i)) return;
      const prev = cues[i - 1], next = cues[i + 1];
      const a = prev ? Math.max(c.start - p, prev.end + Math.max(0, c.start - prev.end) / 2) : Math.max(0, c.start - p);
      const b = next ? Math.min(c.end + p, c.end + Math.max(0, next.start - c.end) / 2) : c.end + p;
      const last = out[out.length - 1];
      if (last && a <= last.b + 0.05) last.b = Math.max(last.b, b); else out.push({ a, b });
    });
    return out.map(r => ({ a: Math.max(0, r.a), b: r.b })).filter(r => r.b - r.a >= 0.05);
  }

  /* Sous-titres restants après les coupes, recollés (mêmes règles que la timeline). */
  function afterCuts(cues, struck, ranges) {
    const on = new Set(struck || []), rs = ranges.slice().sort((p, q) => p.a - q.a);
    const map = t => t - rs.reduce((s, r) => s + Math.min(Math.max(0, t - r.a), r.b - r.a), 0);
    return cues.filter((c, i) => !on.has(i)).map(c => Object.assign({}, c, { start: map(c.start), end: map(c.end) })).filter(c => c.end - c.start >= 0.05);
  }

  /* Mot cherché dans les sous-titres → indices des sous-titres qui le contiennent. */
  const bare = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function findText(cues, query) {
    const q = bare(query).trim();
    if (!q) return [];
    return cues.map((c, i) => (bare(c.text).indexOf(q) >= 0 ? i : -1)).filter(i => i >= 0);
  }

  // ---------------------------------------------------------------- musique à la durée

  /* Musique [mStart, mEnd] (temps de la séquence) plus longue que la vidéo (fin : target) :
     un passage entre deux temps forts est retiré pour que la fin naturelle du morceau tombe
     avec la fin de la vidéo. On cherche au milieu du morceau (ni l'intro ni la fin), de
     préférence un nombre entier de mesures (4 temps), et la durée la plus proche de l'excédent.
     → { a, b, removed, end (fin de la musique après coupe), trim (fin à couper, ou 0) } ou
     { error }. */
  function fitPlan(beats, mStart, mEnd, target, opts) {
    const o = opts || {}, extra = mEnd - target;
    if (extra <= 0.05) return { error: extra < -0.05 ? 'short' : 'fits', extra };
    const b = (beats || []).filter(t => t > mStart && t < mEnd).sort((p, q) => p - q);
    const lo = mStart + (mEnd - mStart) * (o.from === undefined ? 0.2 : o.from), hi = mEnd - (mEnd - mStart) * (o.keepEnd === undefined ? 0.25 : o.keepEnd);
    let best = null;
    for (let i = 0; i < b.length; i++) {
      if (b[i] < lo) continue;
      if (b[i] > hi) break;
      for (let j = i + 1; j < b.length && b[j] - b[i] <= extra + 1; j++) {
        if (b[j] > mEnd - (mEnd - mStart) * 0.1) break;
        const len = b[j] - b[i], miss = Math.abs(extra - len);
        // Un passage plus long que l'excédent laisserait la vidéo finir sans musique : pénalisé.
        const score = miss + ((j - i) % 4 ? 0.25 : 0) + (len > extra ? 0.5 + (len - extra) * 2 : 0);
        if (!best || score < best.score) best = { a: b[i], b: b[j], score };
      }
    }
    if (!best) {
      // Pas de temps forts exploitables : coupe nette à la fin de la vidéo.
      return { a: 0, b: 0, removed: 0, end: target, trim: target, extra };
    }
    const removed = best.b - best.a, end = mEnd - removed;
    return { a: best.a, b: best.b, removed, end: Math.min(end, mEnd), trim: end > target + 0.04 ? target : 0, extra };
  }

  // ---------------------------------------------------------------- versions, renommage

  const VERSION = /\s+v(\d{1,3})(\s.*)?$/i;
  const baseName = name => String(name || '').replace(VERSION, '').trim();
  /* Nom de la prochaine version : « Base v02 » (ou la suivante des versions existantes). */
  function versionName(name, existing) {
    const base = baseName(name);
    let n = 1;
    (existing || []).concat([name]).forEach(e => {
      if (baseName(e) !== base) return;
      const m = VERSION.exec(String(e));
      n = Math.max(n, m ? Number(m[1]) + 1 : 2);
    });
    return base + ' v' + String(n).padStart(2, '0');
  }
  /* Versions d'une séquence parmi les noms du projet, de la plus récente à la plus ancienne. */
  function versionsOf(name, list) {
    const base = baseName(name);
    return list.filter(q => baseName(q.name) === base && VERSION.test(q.name))
      .sort((p, q) => Number(VERSION.exec(q.name)[1]) - Number(VERSION.exec(p.name)[1]));
  }

  /* Noms en série : « # » remplacés par le numéro (autant de chiffres que de #), « {nom} »
     par le nom d'origine (sans extension). Sans # : numéro ajouté à la fin. */
  function renamePlan(names, pattern, start) {
    const pat = String(pattern || '').trim() || '{nom}_###';
    const first = Number(start) >= 0 ? Number(start) : 1;
    return names.map((n, i) => {
      const num = first + i, stem = String(n).replace(/\.[a-z0-9]{2,5}$/i, '');
      let out = pat.replace(/\{nom\}|\{name\}/gi, stem);
      if (/#+/.test(out)) out = out.replace(/#+/, m => String(num).padStart(m.length, '0'));
      else out = out + '_' + String(num).padStart(2, '0');
      return out;
    });
  }

  // ---------------------------------------------------------------- temps passé

  /* Une minute compte si quelque chose a changé dans Premiere (lecture, montage, séquence)
     depuis moins de idle ms. state : { sig, changed, last } (gardé entre deux appels).
     → { state, add } : minutes à ajouter depuis le dernier appel (au plus 2 par appel). */
  function activity(state, sig, now, idle) {
    const s = Object.assign({ sig: '', changed: 0, last: null }, state || {});
    const lim = idle || 5 * 60000;
    if (sig !== s.sig) { s.sig = sig; s.changed = now; }
    const since = s.last === null ? 0 : Math.min(now - s.last, 2 * 60000);
    const add = now - s.changed <= lim ? since / 60000 : 0;
    s.last = now;
    return { state: s, add };
  }

  /* Tableau du temps passé : projets triés du plus récent, en CSV (Excel, Numbers…). */
  function timeCsv(projects, rate) {
    const r = Number(rate) || 0, esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    const head = [_T('Projet'), _T('Fichier'), _T('Heures'), _T('Dernier jour')].concat(r ? [_T('Montant')] : []);
    const rows = Object.keys(projects || {}).map(k => projects[k]).sort((p, q) => (q.lastDay || '').localeCompare(p.lastDay || ''))
      .map(p => [p.name, p.path || '', (p.minutes / 60).toFixed(2).replace('.', ','), p.lastDay || ''].concat(r ? [(p.minutes / 60 * r).toFixed(2).replace('.', ',')] : []));
    return [head].concat(rows).map(l => l.map(esc).join(';')).join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------- temps gagné

  /* Minutes qu'aurait prises à la main une opération qui pose n éléments (coupe, calque, image
     clé, marqueur, sous-titre…) : une demi-minute pour s'y mettre, 20 s par élément, 45 min au
     plus. Volontairement prudent. */
  const savedMinutes = n => Math.min(45, 0.5 + Math.max(0, Number(n) || 0) / 3);

  /* 75 → « 1 h 15 », 42 → « 42 min ». */
  function duration(min, hLabel) {
    const m = Math.round(Math.max(0, min || 0));
    if (m < 60) return m + ' min';
    const hh = Math.floor(m / 60), mm = m % 60;
    return hh + ' ' + (hLabel || 'h') + (mm ? ' ' + String(mm).padStart(2, '0') : '');
  }

  const monthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const dayKey = d => monthKey(d) + '-' + String(d.getDate()).padStart(2, '0');

  return { textCuts, afterCuts, findText, fitPlan, baseName, versionName, versionsOf, renamePlan, activity, timeCsv, savedMinutes, duration, monthKey, dayKey };
});
