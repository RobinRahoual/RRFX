/* RR FX : traduction des sous-titres, sans DOM (testée sous Node). Les timings ne bougent pas,
   seul le texte change. Deux services :
   - MyMemory : gratuit, sans compte (environ 5 000 caractères par jour, 50 000 avec ton e-mail) ;
   - DeepL : meilleure qualité, avec ta clé API (gratuite jusqu'à 500 000 caractères par mois).
   Ce module prépare les requêtes et lit les réponses ; le panneau les envoie. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXTraduction = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const LANGS = [
    ['fr', _T('Français')], ['en', _T('Anglais')], ['es', _T('Espagnol')], ['de', _T('Allemand')], ['it', _T('Italien')], ['pt', _T('Portugais')],
    ['nl', _T('Néerlandais')], ['pl', _T('Polonais')], ['ro', _T('Roumain')], ['tr', _T('Turc')], ['ar', _T('Arabe')], ['ru', _T('Russe')],
    ['uk', _T('Ukrainien')], ['zh', _T('Chinois')], ['ja', _T('Japonais')], ['ko', _T('Coréen')], ['hi', 'Hindi'], ['id', _T('Indonésien')],
    ['sv', _T('Suédois')], ['da', _T('Danois')], ['no', _T('Norvégien')], ['fi', _T('Finnois')], ['el', _T('Grec')], ['cs', _T('Tchèque')]
  ];
  // DeepL veut une variante pour l'anglais et le portugais.
  const DEEPL_TARGET = { en: 'EN-GB', pt: 'PT-PT', zh: 'ZH', no: 'NB' };

  const oneLine = t => String(t || '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();

  /* Texte coupé en lignes d'au plus max caractères (2 lignes de sous-titre en général). */
  function wrap(text, max) {
    const m = max || 42, words = oneLine(text).split(' '), lines = [];
    let cur = '';
    words.forEach(w => { if (cur && (cur + ' ' + w).length > m) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; });
    if (cur) lines.push(cur);
    // Deux lignes équilibrées plutôt qu'une longue et une courte.
    if (lines.length === 2 && oneLine(text).length <= m * 2) {
      const all = oneLine(text), mid = all.length / 2;
      let best = -1;
      for (let i = 0; i < all.length; i++) if (all[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
      if (best > 0 && best <= m && all.length - best - 1 <= m) return all.slice(0, best) + '\n' + all.slice(best + 1);
    }
    return lines.join('\n');
  }

  /* Lots de textes à envoyer : au plus maxItems textes et maxChars caractères par lot. */
  function batches(texts, maxItems, maxChars) {
    const out = [];
    let cur = [], size = 0;
    texts.forEach((t, i) => {
      const n = t.length;
      if (cur.length && (cur.length >= maxItems || size + n > maxChars)) { out.push(cur); cur = []; size = 0; }
      cur.push(i); size += n;
    });
    if (cur.length) out.push(cur);
    return out;
  }

  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = t => String(t || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
  });

  /* Requête MyMemory pour un texte. → { url } */
  function myMemoryRequest(text, from, to, email) {
    const q = 'q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(from + '|' + to) + (email ? '&de=' + encodeURIComponent(email) : '');
    return { method: 'GET', url: 'https://api.mymemory.translated.net/get?' + q };
  }
  function myMemoryParse(json) {
    const d = json && json.responseData;
    const status = Number(json && json.responseStatus);
    if (status && status !== 200) throw new Error(/QUOTA|LIMIT/i.test(String(json.responseDetails || '')) ? _T('Quota MyMemory du jour atteint : réessaie demain, ajoute ton e-mail, ou passe par DeepL.') : 'MyMemory : ' + (json.responseDetails || status));
    if (!d || typeof d.translatedText !== 'string') throw new Error(_T('Réponse de MyMemory illisible.'));
    if (/MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(d.translatedText)) throw new Error(_T('Quota MyMemory du jour atteint : réessaie demain, ajoute ton e-mail, ou passe par DeepL.'));
    return decode(d.translatedText);
  }

  /* Requête DeepL pour un lot de textes. Clé « …:fx » : compte gratuit. → { url, headers, body } */
  function deeplRequest(texts, from, to, key) {
    const free = /:fx$/.test(String(key || '').trim());
    const body = texts.map(t => 'text=' + encodeURIComponent(t)).join('&') + '&target_lang=' + (DEEPL_TARGET[to] || to.toUpperCase()) + (from && from !== 'auto' ? '&source_lang=' + from.toUpperCase() : '') + '&preserve_formatting=1';
    return {
      method: 'POST',
      url: 'https://' + (free ? 'api-free' : 'api') + '.deepl.com/v2/translate',
      headers: { Authorization: 'DeepL-Auth-Key ' + String(key || '').trim(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    };
  }
  function deeplParse(json, n) {
    if (!json || !Array.isArray(json.translations) || json.translations.length !== n) throw new Error(json && json.message ? 'DeepL : ' + json.message : _T('Réponse de DeepL illisible.'));
    return json.translations.map(t => String(t.text || ''));
  }
  function httpError(status, service) {
    if (service === 'deepl' && status === 403) return _T('Clé DeepL refusée : vérifie-la (Compte DeepL > Clé d\'authentification API).');
    if (service === 'deepl' && status === 456) return _T('Quota DeepL du mois atteint.');
    if (status === 429) return _T('Trop de demandes d\'un coup : réessaie dans une minute.');
    return (service === 'deepl' ? 'DeepL' : 'MyMemory') + _T(' a répondu ') + status + '.';
  }

  /* Sous-titres → texte .srt. */
  const stamp = t => {
    const ms = Math.max(0, Math.round(t * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0');
  };
  function toSrt(cues) {
    return cues.map((c, i) => (i + 1) + '\n' + stamp(c.start) + ' --> ' + stamp(c.end) + '\n' + c.text).join('\n\n') + '\n';
  }

  /* Textes traduits remis dans les sous-titres (mêmes temps). */
  function apply(cues, texts) {
    return cues.map((c, i) => Object.assign({}, c, { text: wrap(texts[i] !== undefined ? texts[i] : c.text, 42) }));
  }

  const chars = cues => cues.reduce((s, c) => s + oneLine(c.text).length, 0);

  return { LANGS, oneLine, wrap, batches, decode, myMemoryRequest, myMemoryParse, deeplRequest, deeplParse, httpError, toSrt, apply, chars };
});
