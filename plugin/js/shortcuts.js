/* RR FX : raccourcis clavier du panneau (actifs quand le panneau a le focus).
   Une touche (lettre ou chiffre, seule ou avec Maj) par action, au choix de l'utilisateur.
   La même liste d'actions sert à la télécommande (Stream Deck, Companion…). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports && typeof window === 'undefined') module.exports = factory();
  else root.RRFXShortcuts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const _T = (typeof self !== 'undefined' && self._T) || (s => s);

  // Actions dans l'ordre de la liste des Réglages, rangées par onglet.
  const ACTIONS = {
    express: _T('Lancer le montage express'),
    apply: _T('Appliquer l\'effet choisi'),
    ramp: _T('Appliquer la rampe'),
    capture: _T('Capturer la sélection'),
    undo: _T('Annuler la dernière opération'),
    history: _T('Historique des opérations'),
    palette: _T('Recherche rapide'),
    convert: _T('Convertir le LOG en Rec.709'),
    autoFix: _T('Expo et balance des blancs auto'),
    applyLook: _T('Appliquer le look en cours'),
    beats: _T('Poser les temps forts'),
    sync: _T('Synchroniser la sélection'),
    autoEdit: _T('Monter les rushs sur le rythme'),
    risers: _T('Risers avant les drops'),
    reverbTail: _T('Réverb de fin de musique'),
    titles: _T('Poser les textes'),
    progressBar: _T('Barre de progression'),
    countdown: _T('Compte à rebours'),
    cutSilences: _T('Couper les silences'),
    cutFillers: _T('Couper les « euh »'),
    breaths: _T('Atténuer respirations et clics'),
    captions: _T('Poser les sous-titres'),
    lowerThird: _T('Poser le bandeau'),
    broll: _T('Plans de coupe sur les mots clés'),
    punchIn: _T('Zoom visage'),
    levelVoice: _T('Égaliser la voix'),
    duckMusic: _T('Baisser la musique sous la voix'),
    formatCopy: _T('Copie au format réseau'),
    extracts: _T('Créer les extraits pour les réseaux'),
    preflight: _T('Vérifier avant export'),
    importLink: _T('Importer depuis un lien'),
    textCut: _T('Couper les phrases barrées (montage par le texte)'),
    fitMusic: _T('Ajuster la musique à la vidéo'),
    keepVersion: _T('Garder une version de la séquence'),
    tidyProject: _T('Ranger le projet'),
    proxies: _T('Créer les proxies'),
    splitEdits: _T('Poser les raccords J-cut / L-cut'),
    cleanCuts: _T('Recaler les coupes sur les blancs'),
    rhythm: _T('Analyser le rythme du montage'),
    exportBatch: _T('Exporter les séquences cochées (Media Encoder)'),
    nativeTransitions: _T('Poser les transitions de Premiere sur les coupes'),
    transcribe: _T('Transcrire les plans sélectionnés (Whisper)'),
    podcast: _T('Podcast multicam (caméra de celui qui parle)'),
    denoiseAI: _T('Débruiter la voix (IA)'),
    voiceOver: _T('Voix off témoin (IA)'),
    writePublish: _T('Titre, description et hashtags (IA locale)'),
    autoBroll: _T('Plans de coupe automatiques (IA locale)'),
    separate: _T('Séparer les pistes (IA)'),
    cutout: _T('Texte derrière le sujet (IA)'),
    smoothSlow: _T('Ralenti fluide (IA)'),
    upscale: _T('Agrandir un plan (IA)'),
    trackMask: _T('Masque qui suit un objet (IA)'),
    bokeh: _T('Flou d\'arrière-plan façon portrait (IA)'),
    denoiseVideo: _T('Débruiter l\'image (basse lumière)'),
    indexSounds: _T('Écouter mes sons (recherche par description)'),
    audioFades: _T('Fondus audio anti-clic sur toutes les coupes'),
    sceneEdits: _T('Détecter les changements de plan (Premiere)'),
    nativeCaptions: _T('Créer la piste de sous-titres de Premiere'),
    archive: _T('Archiver le projet')
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
  const label = (k, shiftName) => (k ? k.replace('Shift+', (shiftName || _T('Maj')) + '+') : '');

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
