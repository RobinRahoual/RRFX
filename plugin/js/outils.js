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

  /* Phrases à barrer d'office (indices) : prises ratées et phrases de reprise.
     - une phrase reprise juste après (« Aujourd'hui on va… » puis « Aujourd'hui on va voir… ») :
       la première prise part ;
     - une phrase qui ne contient que des mots de reprise (« euh attends je recommence »). */
  const RECOVER = new Set(('euh heu hum hmm bah ben bon alors donc attends attend pardon non oups zut merde desole excuse moi ' +
    'je j recommence recommencer reprends reprend reprenons refais refait on la le coupe coupez stop vas y ok okay').split(' '));
  const TRIGGER = /^(recommence|recommencer|reprends|reprend|reprenons|refais|refait|pardon|oups|zut|coupe|coupez|stop|euh|heu|hum|hmm|attends|attend)$/;
  const words = t => bare(t).replace(/[^a-z0-9' ]+/g, ' ').split(/[\s']+/).filter(Boolean);
  function retakes(cues) {
    const out = new Set(), w = cues.map(c => words(c.text));
    cues.forEach((c, i) => {
      const a = w[i];
      if (!a.length) return;
      if (a.every(x => RECOVER.has(x)) && a.some(x => TRIGGER.test(x))) { out.add(i); return; }
      const b = w[i + 1];
      if (!b || a.length < 2 || cues[i + 1].start - c.end > 4) return;
      const n = Math.min(3, a.length);
      const sameStart = a.slice(0, n).join(' ') === b.slice(0, n).join(' ');
      const setB = new Set(b), common = a.filter(x => setB.has(x)).length;
      if ((sameStart && a.length <= b.length + 1) || (common / Math.max(a.length, b.length) >= 0.7 && a.length <= b.length)) out.add(i);
    });
    return Array.from(out).sort((p, q) => p - q);
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
  function renamePlan(names, pattern, start, find, by) {
    const pat = String(pattern || '').trim() || '{nom}_###';
    const first = Number(start) >= 0 ? Number(start) : 1;
    return names.map((n, i) => {
      const num = first + i;
      let stem = String(n).replace(/\.[a-z0-9]{2,5}$/i, '');
      // Remplacer : un bout du nom actuel (sans tenir compte des majuscules), avant le modèle.
      if (find) stem = stem.split(new RegExp(String(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).join(by || '');
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

  /* Tableau du temps passé : projets triés du plus récent, en CSV (Excel, Numbers…). byDay : une
     ligne par projet et par jour (pour une facture détaillée). */
  function timeCsv(projects, rate, byDay) {
    const r = Number(rate) || 0, esc = v => '"' + String(v).replace(/"/g, '""') + '"';
    if (byDay) {
      const head = [_T('Jour'), _T('Projet'), _T('Heures')].concat(r ? [_T('Montant')] : []), rows = [];
      Object.keys(projects || {}).forEach(k => {
        const p = projects[k];
        Object.keys(p.days || {}).forEach(d => rows.push([d, p.name, (p.days[d] / 60).toFixed(2).replace('.', ',')].concat(r ? [(p.days[d] / 60 * r).toFixed(2).replace('.', ',')] : [])));
      });
      rows.sort((a, b) => b[0].localeCompare(a[0]) || a[1].localeCompare(b[1]));
      return [head].concat(rows).map(l => l.map(esc).join(';')).join('\r\n') + '\r\n';
    }
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

  // ---------------------------------------------------------------- 2.6 : rythme du montage

  /* Durées des plans (secondes) → statistiques et plans trop longs. clips : [{ start, end, name }]
     (s), sur la piste du dessus ou toutes. max : au-delà, un plan est « long ». */
  function rhythm(clips, max) {
    const L = clips.map(c => Object.assign({}, c, { len: c.end - c.start })).filter(c => c.len > 0.04).sort((p, q) => p.start - q.start);
    if (!L.length) return { count: 0, avg: 0, median: 0, long: [], total: 0 };
    const lens = L.map(c => c.len).sort((p, q) => p - q), total = L.reduce((n, c) => n + c.len, 0);
    const lim = max || Math.max(4, lens[Math.floor(lens.length / 2)] * 2.5);
    return {
      count: L.length, total, avg: total / L.length, median: lens[Math.floor(lens.length / 2)], max: lim,
      shortest: lens[0], longest: lens[lens.length - 1],
      long: L.filter(c => c.len > lim).map(c => ({ start: c.start, end: c.end, len: c.len, name: c.name })),
      shots: L.map(c => ({ start: c.start, len: c.len }))
    };
  }

  // ---------------------------------------------------------------- 2.6 : coupes sur les blancs

  /* Énergie (moyenne quadratique) d'un son par fenêtre de step s. → Float32Array */
  function energy(samples, sr, step) {
    const n = Math.max(1, Math.round(sr * step)), out = new Float32Array(Math.floor(samples.length / n));
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (let k = i * n; k < (i + 1) * n; k++) s += samples[k] * samples[k];
      out[i] = Math.sqrt(s / n);
    }
    return out;
  }
  /* Meilleur décalage d'une coupe : costA[k] / costB[k] = bruit de chaque côté pour un décalage
     de (k - mid) pas. On garde 0 si la coupe est déjà dans un blanc ou si rien n'est nettement
     plus calme. → décalage en pas (négatif : plus tôt). */
  function quietOffset(costA, costB, mid) {
    const at = k => (costA[k] || 0) + (costB[k] || 0), here = at(mid);
    let best = mid;
    for (let k = 0; k < Math.min(costA.length, costB.length); k++) {
      const c = at(k) + Math.abs(k - mid) * here * 0.01;
      if (c < at(best) + Math.abs(best - mid) * here * 0.01) best = k;
    }
    return here > 0 && at(best) < here * 0.5 ? best - mid : 0;
  }

  // ---------------------------------------------------------------- 2.6 : correcteur de sous-titres

  /* Problèmes des sous-titres : lignes trop longues, lecture trop rapide (caractères par seconde),
     trop courts, majuscule manquante, espaces en trop, ponctuation collée (français).
     → [{ i, kind, text }] (kind : long, fast, short, caps, spaces, punct) */
  function checkCues(cues, o) {
    const opt = Object.assign({ maxLine: 42, maxCps: 20, minDur: 0.8, lang: 'fr' }, o || {}), out = [];
    cues.forEach((c, i) => {
      const lines = String(c.text).split('\n'), flat = lines.join(' '), d = c.end - c.start;
      if (lines.some(l => l.length > opt.maxLine) || lines.length > 2) out.push({ i, kind: 'long' });
      if (d > 0 && flat.replace(/\s+/g, '').length / d > opt.maxCps) out.push({ i, kind: 'fast' });
      if (d < opt.minDur) out.push({ i, kind: 'short' });
      const prev = cues[i - 1], ends = !prev || /[.!?…]["»”)]?\s*$/.test(prev.text);
      if (ends && /^[a-zàâçéèêëîïôûùüÿœ]/.test(flat)) out.push({ i, kind: 'caps' });
      if (/ {2,}|^\s|\s$/m.test(c.text)) out.push({ i, kind: 'spaces' });
      if (opt.lang === 'fr' && /[^\s  ][:;!?»]/.test(flat.replace(/https?:\S+|\d+:\d+/g, ''))) out.push({ i, kind: 'punct' });
    });
    return out;
  }
  /* Corrige ce qui peut l'être sans changer le sens : lignes recoupées, majuscules, espaces,
     ponctuation française ; sous-titres trop rapides ou trop courts allongés dans le blanc qui
     suit. → { cues, fixed } */
  function fixCues(cues, wrapFn, o) {
    const opt = Object.assign({ maxLine: 42, maxCps: 20, minDur: 0.8, lang: 'fr' }, o || {});
    let fixed = 0;
    const out = cues.map(c => Object.assign({}, c));
    out.forEach((c, i) => {
      const before = c.text + '|' + c.end;
      let t = String(c.text).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      if (opt.lang === 'fr') t = t.replace(/(\S)\s*([:;!?»])/g, (m, a, p) => (/\d/.test(a) && p === ':' ? a + p : a + ' ' + p)).replace(/«\s*/g, '« ');
      const prev = out[i - 1];
      if ((!prev || /[.!?…]["»”)]?\s*$/.test(prev.text)) && /^[a-zàâçéèêëîïôûùüÿœ]/.test(t)) t = t.charAt(0).toUpperCase() + t.slice(1);
      if (t.split('\n').some(l => l.length > opt.maxLine) || t.split('\n').length > 2) t = wrapFn ? wrapFn(t.replace(/\n/g, ' '), opt.maxLine) : t;
      c.text = t;
      // Durée : assez pour lire, sans mordre sur le suivant (0,1 s d'écart).
      const need = Math.max(opt.minDur, t.replace(/\s+/g, '').length / opt.maxCps), next = out[i + 1];
      if (c.end - c.start < need) c.end = Math.max(c.end, Math.min(c.start + need, next ? next.start - 0.1 : c.start + need));
      if (c.text + '|' + c.end !== before) fixed++;
    });
    return { cues: out, fixed };
  }

  // ---------------------------------------------------------------- 2.6 : export en lot

  /* Nom de fichier d'une séquence : {client}, {projet}, {sequence}, {format} (16x9, 9x16…),
     {date} (2026-10-29), {v} ou {vv} (numéro de version). Caractères interdits retirés. */
  function exportName(pattern, v) {
    const ratio = (w, h) => { if (!w || !h) return ''; const g = (a, b) => (b ? g(b, a % b) : a), d = g(w, h); const r = w / d + 'x' + h / d; return { '16x9': '16x9', '9x16': '9x16', '4x5': '4x5', '1x1': '1x1', '256x135': '17x9' }[r] || (w + 'x' + h); };
    const now = v.date || new Date();
    const map = { client: v.client || '', projet: v.projet || '', project: v.projet || '', sequence: v.sequence || '', format: ratio(v.w, v.h), date: dayKey(now), v: String(v.version || 1), vv: String(v.version || 1).padStart(2, '0') };
    return String(pattern || '{sequence}_{format}_v{vv}').replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m))
      .replace(/[\\/:*?"<>|]+/g, '-').replace(/[_\- ]{2,}/g, m => m[0]).replace(/^[_\- ]+|[_\- ]+$/g, '') || 'export';
  }

  // ---------------------------------------------------------------- 2.6 : badges

  /* Badges débloqués selon le temps gagné (minutes), le nombre d'opérations et d'outils différents. */
  const BADGES = [
    { id: 'h1', kind: 'min', at: 60, icon: '⏱️' }, { id: 'h5', kind: 'min', at: 300, icon: '🚀' },
    { id: 'h10', kind: 'min', at: 600, icon: '🔥' }, { id: 'h24', kind: 'min', at: 1440, icon: '🏆' },
    { id: 'h100', kind: 'min', at: 6000, icon: '👑' },
    { id: 'ops10', kind: 'ops', at: 10, icon: '✂️' }, { id: 'ops100', kind: 'ops', at: 100, icon: '⚡' },
    { id: 'ops1000', kind: 'ops', at: 1000, icon: '🎖️' },
    { id: 'tools5', kind: 'tools', at: 5, icon: '🧰' }, { id: 'tools15', kind: 'tools', at: 15, icon: '🎨' }
  ];
  function badges(stats) {
    const v = { min: stats.minutes || 0, ops: stats.ops || 0, tools: stats.tools || 0 };
    return BADGES.map(b => Object.assign({}, b, { done: v[b.kind] >= b.at, progress: Math.min(1, v[b.kind] / b.at) }));
  }

  const monthKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const dayKey = d => monthKey(d) + '-' + String(d.getDate()).padStart(2, '0');

  return { rhythm, energy, quietOffset, checkCues, fixCues, exportName, badges, BADGES, textCuts, afterCuts, findText, retakes, fitPlan, baseName, versionName, versionsOf, renamePlan, activity, timeCsv, savedMinutes, duration, monthKey, dayKey };
});
