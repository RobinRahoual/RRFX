/* RR FX : vérification des mises à jour : au démarrage, le panneau regarde sur
   GitHub si une version plus récente a été publiée (au plus une fois toutes les
   6 heures). Une extension ne peut pas s'installer elle-même : on propose de
   télécharger le pack d'installation et d'ouvrir la page de la version. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXUpdates = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REPO = 'RobinRahoual/RRFX';
  const API_URL = 'https://api.github.com/repos/' + REPO + '/releases/latest';
  const RELEASES_URL = 'https://github.com/' + REPO + '/releases/latest';
  const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

  const KEY_LAST_CHECK = 'rrfx.update.lastCheck';
  const KEY_LATEST = 'rrfx.update.latest';
  const KEY_DISMISSED = 'rrfx.update.dismissed';

  /* Compare deux versions « 1.2.3 » (un « v » devant est accepté). Renvoie -1, 0 ou 1. */
  function compareVersions(a, b) {
    const parse = v => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
    const x = parse(a), y = parse(b);
    for (let i = 0; i < 3; i++) {
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0) ? 1 : -1;
    }
    return 0;
  }

  function safeGet(storage, key) {
    try { return storage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(storage, key, value) {
    try { storage.setItem(key, value); } catch (e) { /* on revérifiera au prochain démarrage */ }
  }

  /* Informations utiles d'une release GitHub. */
  function parseRelease(release) {
    if (!release || !release.tag_name) return null;
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const pick = re => (assets.find(a => re.test(a.name || '')) || {}).browser_download_url || '';
    return {
      version: String(release.tag_name).replace(/^v/i, ''),
      pageUrl: release.html_url || RELEASES_URL,
      downloadUrl: pick(/-installation\.zip$/i) || pick(/\.zip$/i) || release.html_url || RELEASES_URL,
      // Signature du pack (ed25519), vérifiée avant l'installation.
      signatureUrl: pick(/-installation\.zip\.sig$/i)
    };
  }

  /* deps : { fetch, storage, currentVersion, now(), force }. Ne lève jamais d'erreur :
     pas de réseau (ou dépôt pas encore publié) = pas de bandeau. */
  async function checkForUpdate(deps) {
    const now = deps.now ? deps.now() : Date.now();
    const last = Number(safeGet(deps.storage, KEY_LAST_CHECK)) || 0;
    let latest = null;
    if (!deps.force && last && now - last < CHECK_EVERY_MS) {
      try { latest = JSON.parse(safeGet(deps.storage, KEY_LATEST) || 'null'); } catch (e) { latest = null; }
    } else {
      try {
        const response = await deps.fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!response || !response.ok) return null;
        latest = parseRelease(await response.json());
        safeSet(deps.storage, KEY_LAST_CHECK, String(now));
        safeSet(deps.storage, KEY_LATEST, JSON.stringify(latest));
      } catch (e) {
        return null;
      }
    }
    if (!latest || compareVersions(latest.version, deps.currentVersion) <= 0) return null;
    if (!deps.force && safeGet(deps.storage, KEY_DISMISSED) === latest.version) return null;
    return latest;
  }

  /* « Plus tard » : ne plus afficher le bandeau pour cette version précise. */
  function dismissUpdate(storage, version) {
    safeSet(storage, KEY_DISMISSED, version);
  }

  return { REPO, API_URL, RELEASES_URL, CHECK_EVERY_MS, compareVersions, parseRelease, checkForUpdate, dismissUpdate };
});
