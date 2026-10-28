/* CutFX — codes de partage : un ou plusieurs effets perso dans un texte à copier-coller
   (message, commentaire, story…). « CUTFX1: » = JSON compressé (deflate) en base64url,
   « CUTFX0: » = JSON non compressé (si la compression n'est pas disponible). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CutFXShare = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = ['preset', 'captured', 'ramp'];

  function toB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(text) {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const utf8 = s => new TextEncoder().encode(s);
  const fromUtf8 = b => new TextDecoder().decode(b);

  // Garde seulement ce qui se partage : pas d'identifiant local, pas de chemin de fichier.
  function clean(items) {
    return items.filter(i => i && TYPES.indexOf(i.type) >= 0 && i.data && typeof i.name === 'string')
      .map(i => ({ type: i.type, name: i.name, cat: i.cat, data: i.data }));
  }

  // zip : { deflate(Uint8Array) -> Uint8Array, inflate(Uint8Array) -> Uint8Array } ou null.
  function encode(items, zip) {
    const json = JSON.stringify({ cutfx: 1, items: clean(items) });
    if (zip) return 'CUTFX1:' + toB64url(zip.deflate(utf8(json)));
    return 'CUTFX0:' + toB64url(utf8(json));
  }

  function decode(code, zip) {
    const m = /CUTFX([01]):([A-Za-z0-9_\-]+)/.exec(String(code || '').replace(/\s+/g, ''));
    if (!m) throw new Error('Ce n\'est pas un code CutFX (il commence par « CUTFX1: »).');
    let bytes = fromB64url(m[2]);
    if (m[1] === '1') {
      if (!zip) throw new Error('Décompression indisponible ici.');
      bytes = zip.inflate(bytes);
    }
    let data;
    try { data = JSON.parse(fromUtf8(bytes)); } catch (e) { throw new Error('Code abîmé : copie-le en entier.'); }
    const items = clean(data && Array.isArray(data.items) ? data.items : []);
    if (!items.length) throw new Error('Ce code ne contient aucun effet.');
    return items;
  }

  return { encode, decode, clean };
});
