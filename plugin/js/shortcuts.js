/* RR FX : raccourcis clavier du panneau (actifs quand le panneau a le focus).
   Une touche (lettre ou chiffre, seule ou avec Maj) par action, au choix de l'utilisateur.
   La même liste d'actions sert à la télécommande (Stream Deck, Companion…). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RRFXShortcuts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Actions dans l'ordre de la liste des Réglages, rangées par onglet.
  const ACTIONS = {
    express: 'Lancer le montage express',
    apply: 'Appliquer l\'effet choisi',
    ramp: 'Appliquer la rampe',
    capture: 'Capturer la sélection',
    undo: 'Annuler la dernière opération',
    history: 'Historique des opérations',
    palette: 'Recherche rapide',
    convert: 'Convertir le LOG en Rec.709',
    autoFix: 'Expo et balance des blancs auto',
    applyLook: 'Appliquer le look en cours',
    beats: 'Poser les temps forts',
    sync: 'Synchroniser la sélection',
    autoEdit: 'Monter les rushs sur le rythme',
    risers: 'Risers avant les drops',
    reverbTail: 'Réverb de fin de musique',
    titles: 'Poser les textes',
    progressBar: 'Barre de progression',
    countdown: 'Compte à rebours',
    cutSilences: 'Couper les silences',
    cutFillers: 'Couper les « euh »',
    breaths: 'Atténuer respirations et clics',
    captions: 'Poser les sous-titres',
    lowerThird: 'Poser le bandeau',
    broll: 'Plans de coupe sur les mots clés',
    punchIn: 'Zoom visage',
    levelVoice: 'Égaliser la voix',
    duckMusic: 'Baisser la musique sous la voix',
    formatCopy: 'Copie au format réseau',
    extracts: 'Créer les extraits pour les réseaux',
    preflight: 'Vérifier avant export',
    importLink: 'Importer depuis un lien'
  };

  const DEFAULTS = { apply: 'A', ramp: 'R', undo: 'U', capture: 'C', beats: 'B', sync: 'S', convert: 'L', express: 'E' };

  const KEY = /^(Shift\+)?[A-Z0-9]$/;

  /* Touche utilisable comme raccourci (lettre ou chiffre, avec ou sans Maj, sans Ctrl/Cmd/Alt) :
     'A', 'Shift+A'… ; sinon null. */
  function normalizeKey(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return null;
    const key = String(event.key || ''), shift = event.shiftKey ? 'Shift+' : '';
    // Clavier AZERTY : les chiffres donnent & é " ' ( … (sans Maj) ; on se rabat sur le code physique.
    const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(String(event.code || ''));
    if (code) return shift + (code[1] || code[2]);
    if (/^[a-z0-9]$/i.test(key)) return shift + key.toUpperCase();
    return null;
  }

  /* Touche à afficher : « Maj+A » (« Shift+A » en anglais). */
  const label = (k, shiftName) => (k ? k.replace('Shift+', (shiftName || 'Maj') + '+') : '');

  /* Complète une configuration enregistrée avec les valeurs par défaut. */
  function withDefaults(saved) {
    const map = Object.assign({}, DEFAULTS);
    if (saved && typeof saved === 'object') {
      Object.keys(ACTIONS).forEach(action => {
        if (action in saved) map[action] = KEY.test(saved[action]) ? saved[action] : '';
      });
    }
    return map;
  }

  /* Attribue `key` à `action` ; la touche est retirée de l'action qui l'utilisait. "" = aucune touche. */
  function assign(map, action, key) {
    const next = Object.assign({}, map);
    if (key) Object.keys(next).forEach(other => { if (next[other] === key) next[other] = ''; });
    next[action] = key || '';
    return next;
  }

  function actionFor(map, key) {
    if (!key) return null;
    return Object.keys(map).find(action => map[action] === key) || null;
  }

  // Dans un panneau CEP, Premiere garde les touches pour lui sauf celles que le
  // panneau déclare (registerKeyEventsInterest). Codes de touches par système.
  const MAC_CODES = {
    A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17,
    1: 18, 2: 19, 3: 20, 4: 21, 6: 22, 5: 23, 9: 25, 7: 26, 8: 28, 0: 29, O: 31, U: 32, I: 34, P: 35, L: 37, J: 38,
    K: 40, N: 45, M: 46, Escape: 53
  };
  function winCode(key) {
    if (key === 'Escape') return 27;
    return key.charCodeAt(0); // A-Z = 65-90, 0-9 = 48-57 (codes VK de Windows)
  }

  /* Liste à passer à registerKeyEventsInterest : les touches attribuées (avec et sans Maj) + Échap. */
  function keyInterest(map, isMac) {
    const keys = Array.from(new Set(Object.keys(map).map(a => String(map[a] || '').replace('Shift+', '')).filter(Boolean))).concat(['Escape']);
    const out = [];
    keys.forEach(k => {
      const code = isMac ? MAC_CODES[k] : winCode(k);
      if (code === undefined) return;
      out.push({ keyCode: code });
      out.push({ keyCode: code, shiftKey: true });
    });
    return out;
  }

  return { ACTIONS, DEFAULTS, normalizeKey, withDefaults, assign, actionFor, keyInterest, label, MAC_CODES };
});
