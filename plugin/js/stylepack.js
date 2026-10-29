/* RR FX : packs de style (.rrfxpack). Tout un style dans un seul fichier à partager : effets
   et rampes perso, looks, animation des textes (et son modèle .mogrt), overlays importés,
   enchaînement d'effets. Le fichier est un ZIP ordinaire : pack.json + les fichiers.
   Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXStylePack = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  const VERSION = 1, MANIFEST = 'pack.json';

  // ---------------------------------------------------------------- ZIP (sans dépendance)

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const utf8 = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8')));
  const fromUtf8 = b => (typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(b) : Buffer.from(b).toString('utf8'));

  function header(size) { const b = new Uint8Array(size); return { b, v: new DataView(b.buffer) }; }

  /* Morceaux successifs du ZIP (à écrire dans l'ordre). entries : [{ name, data: Uint8Array }].
     deflate (facultatif) compresse le texte ; les médias restent tels quels. */
  function* zipChunks(entries, deflate) {
    const central = [];
    let offset = 0;
    const now = new Date(), time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const e of entries) {
      const name = utf8(e.name), crc = crc32(e.data);
      let data = e.data, method = 0;
      if (deflate && /\.(json|txt|cube)$/i.test(e.name) && e.data.length > 256) {
        const z = deflate(e.data);
        if (z.length < e.data.length) { data = z; method = 8; }
      }
      const { b, v } = header(30);
      v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, method, true);
      v.setUint16(10, time, true); v.setUint16(12, date, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true);
      v.setUint32(22, e.data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true);
      central.push({ name, crc, method, csize: data.length, size: e.data.length, offset });
      yield b; yield name; yield data;
      offset += 30 + name.length + data.length;
    }
    let cdSize = 0;
    for (const c of central) {
      const { b, v } = header(46);
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, c.method, true);
      v.setUint16(12, time, true); v.setUint16(14, date, true); v.setUint32(16, c.crc, true); v.setUint32(20, c.csize, true); v.setUint32(24, c.size, true);
      v.setUint16(28, c.name.length, true); v.setUint32(42, c.offset, true);
      yield b; yield c.name;
      cdSize += 46 + c.name.length;
    }
    const { b, v } = header(22);
    v.setUint32(0, 0x06054b50, true); v.setUint16(8, central.length, true); v.setUint16(10, central.length, true);
    v.setUint32(12, cdSize, true); v.setUint32(16, offset, true);
    yield b;
  }

  function zip(entries, deflate) {
    const parts = Array.from(zipChunks(entries, deflate)), out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    parts.forEach(p => { out.set(p, o); o += p.length; });
    return out;
  }

  /* Contenu d'un ZIP : [{ name, data }]. inflate sert aux entrées compressées (méthode 8). */
  function unzip(bytes, inflate) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(_T('Ce fichier n\'est pas un pack RR FX (ZIP illisible).'));
    const n = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out = [];
    for (let k = 0; k < n; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) throw new Error(_T('Pack abîmé (répertoire du ZIP).'));
      const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true);
      const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
      const name = fromUtf8(bytes.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + xlen + clen;
      if (/\/$/.test(name)) continue;
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      let data = bytes.subarray(start, start + csize);
      if (method === 8) {
        if (!inflate) throw new Error(_T('Pack compressé : décompression indisponible ici.'));
        data = inflate(data);
      } else if (method !== 0) throw new Error(_T('Compression non prise en charge dans le pack (') + name + ').');
      if (crc32(data) !== crc) throw new Error(_T('Pack abîmé : « ') + name + _T(' » ne correspond pas.'));
      out.push({ name, data });
    }
    return out;
  }

  // ---------------------------------------------------------------- manifeste

  const safeName = s => String(s || 'fichier').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\-. ]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'fichier';

  /* Assemble le pack. src : { name, author, items, titles, look, chain, overlays: [{ name, kind,
     data, file }], mogrt: { file, data } } → [{ name, data }] prêts pour zip(). */
  function build(src) {
    const files = [], used = new Set();
    const add = (prefix, file, data) => {
      let n = prefix + '/' + safeName(file), k = 1;
      while (used.has(n)) n = prefix + '/' + (k++) + '-' + safeName(file);
      used.add(n);
      files.push({ name: n, data });
      return n;
    };
    const manifest = {
      rrfxpack: VERSION, name: String(src.name || _T('Mon pack')), author: String(src.author || ''), created: new Date().toISOString(),
      items: (src.items || []).map(it => ({ type: it.type, name: it.name, cat: it.cat, data: it.data })),
      overlays: (src.overlays || []).map(o => ({ name: o.name, kind: o.kind, file: add('overlays', o.file || o.name, o.data) })),
      titles: src.titles ? Object.assign({}, src.titles, { mogrt: src.mogrt ? add('titres', src.mogrt.file, src.mogrt.data) : '' }) : null,
      look: src.look || null,
      chain: src.chain || null
    };
    return [{ name: MANIFEST, data: utf8(JSON.stringify(manifest, null, 1)) }].concat(files);
  }

  /* Lit un pack : { manifest, files: Map(nom → données) }, après vérification. */
  function read(bytes, inflate) {
    const entries = unzip(bytes, inflate), files = new Map(entries.map(e => [e.name, e.data]));
    if (!files.has(MANIFEST)) throw new Error(_T('Ce ZIP n\'est pas un pack RR FX (pack.json manquant).'));
    let m;
    try { m = JSON.parse(fromUtf8(files.get(MANIFEST))); } catch (e) { throw new Error(_T('pack.json illisible.')); }
    if (!m || !m.rrfxpack) throw new Error(_T('Ce ZIP n\'est pas un pack RR FX.'));
    if (m.rrfxpack > VERSION) throw new Error(_T('Pack créé avec une version plus récente de RR FX : mets le plugin à jour.'));
    m.items = Array.isArray(m.items) ? m.items : [];
    m.overlays = (Array.isArray(m.overlays) ? m.overlays : []).filter(o => o && files.has(o.file));
    if (m.titles && m.titles.mogrt && !files.has(m.titles.mogrt)) m.titles.mogrt = '';
    return { manifest: m, files };
  }

  // Résumé lisible du contenu.
  function summary(m) {
    const n = (k, one, many) => (k ? k + ' ' + (k > 1 ? many : one) : '');
    const types = t => m.items.filter(i => i.type === t).length;
    return [
      n(types('preset') + types('captured'), 'effet', 'effets'), n(types('ramp'), 'rampe', 'rampes'), n(types('look') + (m.look ? 1 : 0), 'look', 'looks'),
      n(types('textStyle'), _T('style de texte perso'), _T('styles de texte perso')), n(types('titleAnim'), _T('animation de texte'), _T('animations de texte')),
      n(types('gradient'), _T('dégradé'), _T('dégradés')), n(types('palette'), 'palette', 'palettes'), n(types('xpStyle'), _T('style Express'), _T('styles Express')), n(types('projectTemplate'), _T('modèle de projet'), _T('modèles de projet')),
      n(m.overlays.length, 'overlay', 'overlays'), m.titles ? _T('style de texte') : '', m.chain && m.chain.length ? _T('enchaînement de ') + m.chain.length + _T(' effets') : ''
    ].filter(Boolean).join(', ') || 'vide';
  }

  return { crc32, zip, zipChunks, unzip, build, read, summary, safeName, VERSION };
});
