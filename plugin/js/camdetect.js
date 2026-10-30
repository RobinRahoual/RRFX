/* RR FX : reconnaît la caméra d'un rush d'après les métadonnées écrites dans le fichier
   (marque, modèle et, chez Sony, la courbe et le gamut du tournage : XML NonRealTimeMeta).
   Sans DOM, testé sous Node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXCam = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  // Codes modèle Sony → noms commerciaux (ceux de la liste des caméras).
  const SONY = {
    'ILCE-7M2': 'A7 II', 'ILCE-7M3': 'A7 III', 'ILCE-7M4': 'A7 IV', 'ILCE-7SM2': 'A7S II', 'ILCE-7SM3': 'A7S III', 'ILCE-7C': 'A7C', 'ILCE-7CM2': 'A7C II',
    'ILCE-7RM3': 'A7R III', 'ILCE-7RM4': 'A7R IV', 'ILCE-7RM5': 'A7R V', 'ILCE-1': 'A1', 'ILCE-1M2': 'A1 II', 'ILCE-9M3': 'A9 III',
    'ILME-FX3': 'FX3', 'ILME-FX30': 'FX30', 'ILME-FX6V': 'FX6', 'ILME-FX6': 'FX6', 'ZV-E1': 'ZV-E1', 'ZV-E10': 'ZV-E10', 'ZV-E10M2': 'ZV-E10 II',
    'ILCE-6400': 'A6400', 'ILCE-6600': 'A6600', 'ILCE-6700': 'A6700'
  };
  const PANASONIC = { 'DC-GH5': 'GH5', 'DC-GH5M2': 'GH5 II', 'DC-GH6': 'GH6', 'DC-GH7': 'GH7', 'DC-S5': 'S5', 'DC-S5M2': 'S5 II', 'DC-S5M2X': 'S5 IIX', 'DC-G9M2': 'G9 II', 'DC-S9': 'S9', 'DC-S1H': 'S1H', 'DC-S1': 'S1' };

  // Marque : chaîne caractéristique dans le fichier (l'ordre compte : la plus sûre d'abord).
  const BRANDS = [
    ['sony', /<NonRealTimeMeta|manufacturer="Sony"|\b(?:ILCE|ILME)-[0-9A-Z]+|\bZV-E1/],
    ['apple', /com\.apple\.quicktime\.(?:make|model)[\s\S]{0,4000}?iPhone|iPhone \d{2}/],
    ['dji', /\bDJI\b|DJI[ _](?:Mavic|Air|Mini|Osmo|Avata|Pocket|Action)|dji\.(?:mavic|osmo)/i],
    ['gopro', /GoPro|\bHERO\d{1,2}\b/],
    ['panasonic', /Panasonic|\bDC-(?:GH|S|G9)[0-9A-Z]+/],
    ['canon', /Canon(?: EOS|\b)/],
    ['fujifilm', /FUJIFILM/],
    ['nikon', /NIKON/],
    ['blackmagic', /Blackmagic/],
    ['samsung', /samsung|SM-S9\d\d/i],
    ['arri', /\bARRI\b|ALEXA/]
  ];

  // Noms de fichier par défaut des appareils (indice faible, quand le fichier ne dit rien).
  const NAMES = [
    ['sony', /^C\d{4}(?:M01)?\.(?:MP4|MXF)$/i], ['apple', /^IMG_\d{4}\.MOV$/i], ['dji', /^DJI_/i], ['gopro', /^G[HXL]\d{6}\.MP4$/i],
    ['panasonic', /^P\d{7}\.MOV$/i], ['canon', /^(?:MVI_\d{4}|A\d{3}C\d{3})/i], ['fujifilm', /^DSCF\d{4}\.MOV$/i], ['nikon', /^DSC_\d{4}\.MOV$/i]
  ];

  const xmlValue = (text, name) => { const m = new RegExp('name="' + name + '"\\s+value="([^"]*)"').exec(text); return m ? m[1] : ''; };

  function sonyProfile(gamma, primaries) {
    const g = String(gamma || '').toLowerCase(), p = String(primaries || '').toLowerCase();
    if (!g) return { profile: null, log: null };
    if (/s-log3/.test(g)) return { profile: /cine/.test(g) || /3cine/.test(p) ? 'slog3-sg3c' : 'slog3-sg3', log: true };
    if (/s-log2/.test(g)) return { profile: 'slog2-sg', log: true };
    return { profile: null, log: false };
  }

  /* text : début et fin du fichier (et le XML Sony à côté s'il existe), en latin1.
     → { brand, model, profile, log, gamma, source } ; brand null si rien de reconnu. */
  function detect(text, fileName) {
    text = String(text || '');
    const out = { brand: null, model: '', profile: null, log: null, gamma: '', source: '' };
    for (const [id, re] of BRANDS) if (re.test(text)) { out.brand = id; out.source = 'fichier'; break; }
    if (!out.brand) {
      const base = String(fileName || '').split(/[\\/]/).pop();
      const hit = NAMES.find(([, re]) => re.test(base));
      if (hit) { out.brand = hit[0]; out.source = _T('nom du fichier'); }
      return out;
    }
    let m;
    if (out.brand === 'sony') {
      m = /modelName="([^"]+)"/.exec(text) || /\b((?:ILCE|ILME)-[0-9A-Z]+|ZV-E1[0-9A-Z]*)/.exec(text);
      if (m) out.model = SONY[m[1]] || m[1];
      out.gamma = xmlValue(text, 'CaptureGammaEquation');
      Object.assign(out, sonyProfile(out.gamma, xmlValue(text, 'CaptureColorPrimaries')));
    } else if (out.brand === 'apple') {
      m = /iPhone \d{2}(?: Pro Max| Pro| Plus)?/.exec(text);
      if (m) out.model = m[0];
    } else if (out.brand === 'panasonic') {
      m = /\b(DC-[0-9A-Z]+)/.exec(text);
      if (m) out.model = PANASONIC[m[1]] || m[1];
    } else if (out.brand === 'canon') {
      m = /Canon (EOS [0-9A-Za-z]+(?: Mark II+| II+)?)/.exec(text);
      if (m) out.model = m[1].replace(/ Mark /, ' ');
    } else if (out.brand === 'fujifilm') {
      m = /\b(X-[A-Z]\d{1,3}[A-Z]*|GFX ?\d+[A-Z]*(?: II)?)/.exec(text);
      if (m) out.model = m[1];
    } else if (out.brand === 'nikon') {
      m = /NIKON (Z ?[0-9f]+)(?:_(\d))?/.exec(text);
      if (m) out.model = m[1].replace(' ', '') + (m[2] ? ' ' + ['', '', 'II', 'III', 'IV'][Number(m[2])] : '');
    } else if (out.brand === 'gopro') {
      m = /\bHERO(\d{1,2})/.exec(text);
      if (m) out.model = 'HERO' + m[1] + ' Black';
    }
    return out;
  }

  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /* Caméra enregistrée qui correspond au rush : même marque, puis même modèle, puis même
     profil log. null si aucune caméra de cette marque n'est enregistrée. */
  function match(det, cams, activeId) {
    if (!det || !det.brand) return null;
    const same = cams.filter(c => c.brand === det.brand);
    if (!same.length) return null;
    const score = c => (det.model && norm(c.model) && norm(c.model) === norm(det.model) ? 4 : 0) + (det.profile && c.profile === det.profile ? 2 : 0) + (c.id === activeId ? 1 : 0);
    return same.slice().sort((a, b) => score(b) - score(a))[0];
  }

  return { detect, match, sonyProfile, SONY, PANASONIC };
});
