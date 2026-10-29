/* RR FX : langue du panneau, français ou anglais.
   Le texte du code est écrit en français ; _T('…') rend sa traduction anglaise quand le panneau
   est en anglais (dictionnaire de i18n-en.js), sinon le texte tel quel. La langue est choisie au
   premier lancement (accueil) et se change dans les Réglages : le panneau se recharge.
   Les messages renvoyés par Premiere (hôte) sont traduits par morceaux (host). Chargé en premier :
   les autres scripts traduisent leurs textes dès leur chargement. */
(function (root) {
  'use strict';

  const KEY = 'rrfx-lang';
  // Dans Premiere, le choix est aussi écrit sur disque (Documents/RRFX/langue.txt) : il survit à
  // tout, même si le stockage du panneau est vidé.
  const file = (() => {
    try {
      const req = (root.cep_node && root.cep_node.require) || (typeof root.require === 'function' ? root.require : null);
      if (!req) return null;
      const fs = req('fs'), path = req('path'), os = req('os');
      return { fs, dir: path.join(os.homedir(), 'Documents', 'RRFX'), name: path.join(os.homedir(), 'Documents', 'RRFX', 'langue.txt') };
    } catch (e) { return null; }
  })();
  let lang = 'fr', chosen = false;
  const take = v => { if (v === 'en' || v === 'fr') { lang = v; chosen = true; return true; } return false; };
  try { if (file && file.fs.existsSync(file.name)) take(String(file.fs.readFileSync(file.name, 'utf8')).trim()); } catch (e) { /* fichier illisible */ }
  if (!chosen) {
    try { take(root.localStorage && root.localStorage.getItem(KEY)); } catch (e) { /* stockage indisponible : français */ }
  }

  const en = () => root.RRFX_EN || { dict: {}, host: [] };

  /* Texte français → texte de la langue du panneau. */
  function T(s) {
    if (lang !== 'en' || typeof s !== 'string') return s;
    const v = en().dict[s];
    return v === undefined ? s : v;
  }

  /* Message de Premiere : phrase connue, sinon ses morceaux connus (les plus longs d'abord). */
  function host(msg) {
    if (lang !== 'en' || typeof msg !== 'string' || !msg) return msg;
    const d = en().dict;
    if (d[msg] !== undefined) return d[msg];
    let out = msg;
    en().host.forEach(p => { if (out.indexOf(p[0]) >= 0) out = out.split(p[0]).join(p[1]); });
    return out;
  }

  function setLang(l) {
    const v = l === 'en' ? 'en' : 'fr';
    try { root.localStorage.setItem(KEY, v); } catch (e) { /* tant pis */ }
    try { if (file) { file.fs.mkdirSync(file.dir, { recursive: true }); file.fs.writeFileSync(file.name, v, 'utf8'); } } catch (e) { /* disque indisponible */ }
  }

  /* Change de langue et recharge le panneau. Le rechargement attend un peu : un rechargement
     immédiat peut perdre l'écriture du choix (stockage pas encore enregistré). */
  function switchTo(l) {
    setLang(l);
    root.setTimeout(() => root.location.reload(), file ? 100 : 700);
  }

  // Textes fixes de index.html (boutons, titres, info-bulles).
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  function translateDom(el) {
    if (lang !== 'en' || !el) return;
    const walker = root.document.createTreeWalker(el, 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(n => {
      const t = n.nodeValue, k = t.trim();
      if (k && T(k) !== k) n.nodeValue = t.replace(k, T(k));
    });
    el.querySelectorAll('*').forEach(x => ATTRS.forEach(a => { const v = x.getAttribute(a); if (v && T(v) !== v) x.setAttribute(a, T(v)); }));
  }

  // Langue proposée au premier lancement : celle de l'ordinateur.
  const suggest = () => (/^fr/i.test((root.navigator && root.navigator.language) || 'fr') ? 'fr' : 'en');

  root._T = T;
  root.RRFXI18n = { get lang() { return lang; }, get chosen() { return chosen; }, setLang, switchTo, t: T, host, translateDom, suggest };
  if (root.document) root.document.addEventListener('DOMContentLoaded', () => { root.document.documentElement.lang = lang; translateDom(root.document.body); });
})(typeof self !== 'undefined' ? self : this);
