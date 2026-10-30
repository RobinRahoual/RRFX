/* RR FX : mise à jour en un clic. Le pack de la nouvelle version est téléchargé, vérifié en
   entier (ZIP intact, panneau complet, bon numéro de version), la version en place est
   sauvegardée, puis les fichiers du panneau sont remplacés. Si une écriture échoue, la
   sauvegarde est remise. Il reste à redémarrer Premiere. La partie « quels fichiers » est
   pure et testée sous Node ; l'écriture passe par fs (fourni par le panneau). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory(root.RRFXStylePack || (typeof require === 'function' ? require('./stylepack.js') : null));
  else root.RRFXInstaller = factory(root.RRFXStylePack);
})(typeof self !== 'undefined' ? self : this, function (Zip) {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const REQUIRED = ['CSXS/manifest.xml', 'index.html', 'jsx/host.jsx', 'js/main.js'];
  /* Clé publique (ed25519, SPKI en base64) des packs signés : node scripts/keys.js la met ici.
     Tant qu'elle est vide, les packs ne sont pas vérifiés (versions d'avant la signature). */
  const PUBLIC_KEY = '';

  /* Le pack vient bien de RR FX : signature ed25519 (fichier .sig de la release, base64) du ZIP
     entier. crypto : le module Node. → true, ou une erreur claire. */
  function verifySignature(crypto, bytes, signature, publicKey) {
    const key = publicKey === undefined ? PUBLIC_KEY : publicKey;
    if (!key) return true;
    if (!signature) throw new Error(_T('Pack non signé : mise à jour refusée. Télécharge-le depuis la page des versions.'));
    if (!crypto || typeof crypto.verify !== 'function') throw new Error(_T('Vérification de signature indisponible dans ce Premiere : télécharge le pack depuis la page des versions.'));
    const pub = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    const ok = crypto.verify(null, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), pub, Buffer.from(String(signature).trim(), 'base64'));
    if (!ok) throw new Error(_T('Signature invalide : ce pack ne vient pas de RR FX, mise à jour refusée.'));
    return true;
  }

  /* Fichiers du panneau dans le pack d'installation (dossier « …/RRFX/ »), vérifiés.
     → [{ rel, data }] ; lève une erreur claire si le pack n'est pas le bon. */
  function filesOf(bytes, inflate, version) {
    const entries = Zip.unzip(bytes, inflate);
    const man = entries.find(e => /(^|\/)RRFX\/CSXS\/manifest\.xml$/.test(e.name));
    if (!man) throw new Error(_T('Ce fichier n\'est pas un pack d\'installation RR FX.'));
    const prefix = man.name.slice(0, man.name.length - 'CSXS/manifest.xml'.length);
    const files = entries.filter(e => e.name.startsWith(prefix) && e.name.length > prefix.length && !/\/$/.test(e.name))
      .map(e => ({ rel: e.name.slice(prefix.length), data: e.data }));
    REQUIRED.forEach(r => { if (!files.some(f => f.rel === r)) throw new Error(_T('Pack incomplet : ') + r + _T(' manque.')); });
    if (files.some(f => /(^|\/)\.\.(\/|$)/.test(f.rel) || /^[\\/]/.test(f.rel))) throw new Error(_T('Pack refusé : chemin de fichier invalide.'));
    if (version) {
      const text = new TextDecoder().decode(files.find(f => f.rel === 'CSXS/manifest.xml').data);
      const m = /ExtensionBundleVersion="([^"]+)"/.exec(text);
      if (!m || m[1] !== version) throw new Error(_T('Le pack téléchargé est la version ') + (m ? m[1] : '?') + _T(', pas la ') + version + '.');
    }
    return files;
  }

  /* Dossier du panneau d'après l'adresse de la page (file:///…/RRFX/index.html). */
  function extensionDir(href) {
    const u = new URL(href);
    if (u.protocol !== 'file:') return null;
    let p = decodeURIComponent(u.pathname).replace(/\/[^/]*$/, '');
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1).replace(/\//g, '\\');
    return p;
  }

  /* Téléchargement (Node https), redirections de GitHub comprises. → Uint8Array */
  function download(https, url, onProgress, hops) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'RRFX-updater', Accept: 'application/octet-stream' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if ((hops || 0) > 5) return reject(new Error(_T('Trop de redirections.')));
          return resolve(download(https, new URL(res.headers.location, url).toString(), onProgress, (hops || 0) + 1));
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(_T('Téléchargement refusé (') + res.statusCode + ').')); }
        const total = Number(res.headers['content-length']) || 0, parts = [];
        let got = 0;
        res.on('data', c => { parts.push(c); got += c.length; if (onProgress && total) onProgress(got / total); });
        res.on('end', () => { const b = Buffer.concat(parts); resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(60000, () => req.destroy(new Error(_T('Téléchargement trop long.'))));
    });
  }

  /* Remplace les fichiers du panneau. fs, path : Node. backupDir : sauvegarde de la version
     en place (refaite à chaque mise à jour). En cas d'échec, tout est remis comme avant. */
  function install(fs, path, dir, files, backupDir) {
    if (!fs.existsSync(path.join(dir, 'CSXS', 'manifest.xml'))) throw new Error(_T('Dossier du panneau introuvable (') + dir + ').');
    const copyTree = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      fs.readdirSync(from).forEach(n => {
        const a = path.join(from, n), b = path.join(to, n);
        if (fs.statSync(a).isDirectory()) copyTree(a, b); else fs.copyFileSync(a, b);
      });
    };
    fs.rmSync(backupDir, { recursive: true, force: true });
    copyTree(dir, backupDir);
    try {
      files.forEach(f => {
        const out = path.join(dir, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
      });
    } catch (e) {
      copyTree(backupDir, dir);
      throw new Error(_T('Mise à jour annulée, rien n\'a changé : ') + (e && e.message ? e.message : e));
    }
    return files.length;
  }

  return { filesOf, extensionDir, download, install, verifySignature, PUBLIC_KEY, REQUIRED };
});
