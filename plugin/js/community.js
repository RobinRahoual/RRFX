/* RR FX : bibliothèque partagée en ligne. Pas de serveur à faire tourner : chaque preset
   publié est une « issue » du dépôt GitHub de RR FX, créée avec le formulaire
   « Partager un effet » (.github/ISSUE_TEMPLATE/preset.yml) qui y range le code RRFX1.
   - lire : l'API publique de GitHub (sans compte), mise en cache 10 minutes ;
   - publier : le panneau ouvre le formulaire pré-rempli dans le navigateur, il reste à
     cliquer sur « Submit » (compte GitHub gratuit) ;
   - aimer : la réaction 👍 sur la page du preset ; les plus aimés passent en premier ;
   - modérer : fermer l'issue la retire de la bibliothèque. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXCommunity = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPO = 'RobinRahoual/RRFX';
  const LABEL = 'preset';
  const TEMPLATE = 'preset.yml';
  const API = 'https://api.github.com/repos/' + REPO + '/issues';
  const CACHE_MS = 10 * 60 * 1000;
  const KEY_CACHE = 'rrfx.community.cache';
  const MAX_URL = 7000; // au-delà, le navigateur ou GitHub peut couper l'adresse

  const TYPES = { preset: 'Preset', captured: 'Capturé', ramp: 'Rampe', look: 'Look' };

  function safeGet(storage, key) { try { return storage ? storage.getItem(key) : null; } catch (e) { return null; } }
  function safeSet(storage, key, v) { try { if (storage) storage.setItem(key, v); } catch (e) { /* cache facultatif */ } }

  // Section « ### Titre » d'une issue créée par le formulaire.
  function field(body, title) {
    const re = new RegExp('###\\s*' + title + '[^\\n]*\\n+([\\s\\S]*?)(?=\\n###\\s|$)', 'i');
    const m = re.exec(body || '');
    if (!m) return '';
    const v = m[1].trim();
    return v === '_No response_' ? '' : v;
  }

  // Une issue → une entrée de la bibliothèque, ou null si elle ne contient pas de code valide.
  function parseIssue(issue, decode) {
    if (!issue || issue.pull_request || issue.state === 'closed') return null;
    const code = /(?:RRFX|CUTFX)[01]:[A-Za-z0-9_\-]+/.exec(String(issue.body || '').replace(/\s+/g, ''));
    if (!code) return null;
    let items;
    try { items = decode(code[0]); } catch (e) { return null; }
    if (!items || !items.length) return null;
    const title = String(issue.title || '').replace(/^\s*\[(preset|effet|rrfx)\]\s*/i, '').trim();
    const reactions = issue.reactions || {};
    return {
      number: issue.number,
      name: field(issue.body, 'Nom') || title || items[0].name,
      desc: field(issue.body, 'Description').slice(0, 600),
      author: issue.user && issue.user.login ? issue.user.login : '?',
      url: issue.html_url || 'https://github.com/' + REPO + '/issues/' + issue.number,
      created: Date.parse(issue.created_at) || 0,
      likes: (reactions['+1'] || 0) + (reactions.heart || 0) + (reactions.hooray || 0),
      types: Array.from(new Set(items.map(i => i.type))),
      items,
      code: code[0]
    };
  }

  /* Liste des presets publiés (ouverts), depuis le cache s'il est récent.
     opts : { fetch, storage, now, force, decode, pages } → { list, cached, error } */
  async function load(opts) {
    const now = (opts.now || Date.now)();
    const cached = safeGet(opts.storage, KEY_CACHE);
    if (cached && !opts.force) {
      try {
        const c = JSON.parse(cached);
        if (now - c.time < CACHE_MS && Array.isArray(c.issues)) return { list: build(c.issues, opts.decode), cached: true };
      } catch (e) { /* cache abîmé : on relit */ }
    }
    const issues = [];
    try {
      for (let page = 1; page <= (opts.pages || 3); page++) {
        const res = await opts.fetch(API + '?labels=' + LABEL + '&state=open&per_page=100&page=' + page, { headers: { Accept: 'application/vnd.github+json' } });
        if (!res || !res.ok) {
          if (res && (res.status === 403 || res.status === 429)) throw new Error('GitHub limite les lectures : réessaie dans quelques minutes.');
          if (res && res.status === 404) throw new Error('Bibliothèque introuvable (dépôt ' + REPO + ' privé ou absent).');
          throw new Error('GitHub ne répond pas (' + (res ? res.status : 'hors ligne') + ').');
        }
        const batch = await res.json();
        if (!Array.isArray(batch)) break;
        // On ne garde que l'utile (le cache reste petit).
        batch.forEach(i => issues.push({ number: i.number, title: i.title, body: i.body, state: i.state, html_url: i.html_url, created_at: i.created_at, user: i.user ? { login: i.user.login } : null, reactions: i.reactions, pull_request: i.pull_request ? 1 : undefined }));
        if (batch.length < 100) break;
      }
    } catch (e) {
      if (cached) {
        try { return { list: build(JSON.parse(cached).issues, opts.decode), cached: true, error: e.message || String(e) }; } catch (e2) { /* rien en cache */ }
      }
      return { list: [], error: e.message || String(e) };
    }
    safeSet(opts.storage, KEY_CACHE, JSON.stringify({ time: now, issues }));
    return { list: build(issues, opts.decode), cached: false };
  }

  function build(issues, decode) {
    return issues.map(i => parseIssue(i, decode)).filter(Boolean);
  }

  /* Recherche, type et tri : 'popular' (j'aime, puis récents) ou 'recent'. */
  function filter(list, o) {
    const q = String(o.search || '').trim().toLowerCase();
    const out = list.filter(e => (!o.type || o.type === 'all' || e.types.indexOf(o.type) >= 0) &&
      (!q || (e.name + ' ' + e.desc + ' ' + e.author + ' ' + e.items.map(i => i.name).join(' ')).toLowerCase().indexOf(q) >= 0));
    out.sort(o.sort === 'recent' ? (a, b) => b.created - a.created : (a, b) => b.likes - a.likes || b.created - a.created);
    return out;
  }

  /* Adresse du formulaire « Partager un effet » pré-rempli. Si le code est trop long pour
     une adresse, il est laissé de côté (à coller à la main) : { url, withCode }. */
  function publishURL(o) {
    const base = 'https://github.com/' + REPO + '/issues/new?template=' + TEMPLATE;
    const q = (k, v) => '&' + k + '=' + encodeURIComponent(v);
    const head = base + q('title', '[Preset] ' + o.name) + q('nom', o.name) + q('description', o.desc || '');
    const full = head + q('code', o.code);
    return full.length <= MAX_URL ? { url: full, withCode: true } : { url: head, withCode: false };
  }

  return { REPO, LABEL, API, TYPES, field, parseIssue, load, filter, publishURL, CACHE_MS, MAX_URL };
});
