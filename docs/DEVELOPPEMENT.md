# RR FX : développement

Notes techniques : tests, publication, organisation du code. Le mode d'emploi est dans le
[guide complet](GUIDE.md).

## Tests

```bash
npm test          # Node 18+ : cœur, modules, cohérence du projet, et le vrai script Premiere sur une timeline simulée
npm run smoke     # interface en mode démo dans Chromium (nécessite Playwright)
npm run screenshots # captures de chaque page et de chaque outil, galerie et animations du README (docs/captures)
npm run package   # fabrique dist/RRFX-<version>-installation.zip
```

Ouvrir `plugin/index.html` dans un navigateur lance le panneau en **mode démo** (rien n'est modifié).
Quand le panneau tourne dans Premiere, ses outils de développement sont sur `http://localhost:8088`
(version de développement uniquement : le fichier `.debug` n'est pas inclus dans le pack).

## Publier une nouvelle version

1. Change `version` dans `package.json`, `plugin/CSXS/manifest.xml`, `plugin/js/host.js` et
   `src/host/01-noyau.jsx`, puis `node scripts/build-host.js` (un test vérifie qu'elles sont identiques).
2. Écris les nouveautés dans `.github/release-notes/vX.Y.Z.md` (ajoutées sous les étapes d'installation).
3. Pousse un tag du même numéro (`git tag vX.Y.Z && git push origin vX.Y.Z`), ou lance le workflow à la main :
   *Actions > Release > Run workflow*. GitHub Actions lance les tests, fabrique le pack et publie la release
   (`.github/workflows/release.yml`). Le pack est **signé** (fichier `.sig` à côté du ZIP) si une clé est en place.

### Signature des mises à jour

La mise à jour en un clic vérifie que le pack vient bien de RR FX (signature ed25519 du ZIP entier) avant
d'écrire quoi que ce soit. À faire une fois, **sur ton ordinateur** :

```bash
node scripts/keys.js
gh secret set RRFX_SIGNING_KEY --repo RobinRahoual/RRFX < ~/.rrfx-signing-key.pem
```

`keys.js` garde la clé privée dans `~/.rrfx-signing-key.pem` (jamais dans le dépôt) et écrit la clé publique dans
`plugin/js/installer.js` : commit ce fichier. Dès qu'une clé publique est dans le panneau, le workflow refuse de
publier sans le secret, et les panneaux refusent un pack non signé ou mal signé. Clé perdue : `node scripts/keys.js
--force`, mais les panneaux déjà installés devront être mis à jour à la main une fois.

## Modèle de visage (YuNet)

`plugin/js/vendor/yunet-model.js` vient de `face_detection_yunet_2023mar.onnx` (OpenCV Zoo, licence MIT) :
`python3 scripts/dev/yunet-convert.py face_detection_yunet_2023mar.onnx` (il faut le module Python `onnx`).
`tests/yunet.test.js` compare le moteur JavaScript aux sorties d'onnxruntime (`tests/fixtures/yunet-astronaute.json`).

## Modèle de voix (Silero VAD)

`plugin/js/vendor/silero-model.js` vient de `silero_vad_16k_op15.onnx` (paquet PyPI `silero-vad`, licence MIT) :
`python3 scripts/dev/silero-convert.py silero_vad_16k_op15.onnx`. La STFT du modèle est recalculée par FFT (le
script vérifie qu'elle est bien une transformée de Fourier à fenêtre de Hann). `tests/vad.test.js` compare le
moteur aux probabilités d'onnxruntime (`tests/fixtures/silero-reference.json`).

## Outils gratuits (Réglages > Outils gratuits)

Le catalogue est dans `plugin/js/libres.js` : adresse de téléchargement par système, type d'installation (fichier,
archive décompressée par `tar`, exécutable pris dans un paquet PyPI, paquet Python dans l'environnement
`Documents/RRFX/Outils/python`, Homebrew) et modèles. Pour changer une version, modifier l'adresse et vérifier le
nom de l'exécutable (`exe`). Les arguments et la lecture des sorties sont testés dans `tests/libres.test.js` ; les
outils eux-mêmes se testent dans Premiere (voir la checklist).

Les outils `script: true` (SAM 2 + Depth Anything, VoiceFixer, CLAP) n'ont pas d'exécutable à eux : ce sont des
paquets Python. Un fichier témoin `rrfx-<id>.ok` dans l'environnement dit qu'ils sont installés, et
`app.tools.runPy(id, script, args)` écrit l'un des scripts de `plugin/js/pyscripts.js` dans le dossier de travail
puis le lance avec le Python de l'environnement (progression : lignes `PROGRESS i n`). CLAP (msclap) demande
numpy < 2 : il a son propre environnement (`venv: 'clap'` → `Documents/RRFX/Outils/python-clap`). Les scripts sont
compilés par les tests (`tests/pyscripts.test.js`) ; leurs appels à transformers et msclap suivent les sources de
ces bibliothèques et restent à confirmer sur une vraie machine.

## Tester dans Premiere

Les tests automatiques tournent sur une timeline simulée. La [checklist de test](CHECKLIST-TESTS.md) liste ce qu'il
faut essayer dans un vrai Premiere (🔴 : le premier passage).

## Côté Premiere : `src/host`

`plugin/jsx/host.jsx` (le seul fichier que charge Premiere) est **assemblé** à partir de `src/host/*.jsx`, une partie
par domaine (noyau, effets, musique, couleur, parole, projet, outils de Premiere…) : `node scripts/build-host.js`.
Chaque partie ajoute ses fonctions publiques (`api.nom = guard(nom);`). ExtendScript = ES3 et ASCII (un test le
vérifie). [HOST-API.md](HOST-API.md) liste chaque fonction appelée par le panneau (`node scripts/host-api.js`) :
c'est le contrat à refaire pour passer à UXP, le reste du panneau ne change pas.

## Structure

```
plugin/                  l'extension CEP (copiée telle quelle dans le dossier des extensions Adobe)
  CSXS/manifest.xml      manifeste (Premiere Pro 15.0+)
  index.html, css/       panneau
  js/main.js             état, bloc d'état, fenêtres, historique, raccourcis, onglets regroupés, démarrage
  js/effets.js           onglet Effets : effets, aperçus, overlays, application, enchaînement
  js/rampe.js            onglet Rampe : speed ramps
  js/bibliotheque.js     onglet Mes effets : capture, bibliothèque, import, partage, communauté
  js/reglages.js         onglet Réglages, rangé par thème
  js/fenetres.js         groupes d'onglets, menu Fenêtres, espaces de travail (testé)
  js/natifs.js           onglet Montage > Premiere : transitions, changements de plan, sous-titres de Premiere
  js/music.js            onglet Musique : temps forts, montage auto, synchro son/image, volume
  js/titles.js           onglet Textes : titres et paroles animés (.mogrt)
  js/audio.js            analyse du son : filtres, attaques, tempo, volume, corrélation (sans DOM, testé)
  js/media.js            lecture du son des WAV / MOV / MP4 (PCM et AAC) par morceaux
  js/share.js            codes de partage RRFX1
  js/packs.js            les 16 overlays fournis, dessinés image par image
  js/community.js        bibliothèque en ligne (issues GitHub : lecture, tri, lien de publication)
  js/develop.js          moteur couleur façon Lightroom : réglages, LUT .cube, DCTL (testé, DCTL compilé en C)
  js/couleur.js          onglet Couleur : histogramme, avant/après, panneaux Lightroom, looks
  js/logconv.js          conversion LOG → Rec.709 : courbes des fabricants, gamuts, LUT calculée (testé)
  js/conversion.js       caméras enregistrées, LUT de conversion, calque au-dessus des rushs en un clic
  js/camdetect.js        caméra d'un rush d'après ses métadonnées (marque, modèle, courbe Sony) (testé)
  js/autograde.js        analyse d'image : expo et balance auto, raccord sur une référence (testé)
  js/correction.js       panneau Expo, balance et raccord (onglet Couleur)
  js/formats.js          onglet Formats : copie 9:16, 4:5, 1:1, recadrage automatique, zones sûres
  js/stylepack.js        packs de style .rrfxpack : ZIP sans dépendance, manifeste (testé)
  js/mespacks.js         créer et importer un pack de style (Mes effets, Ressources)
  js/express.js          onglet Express : vérifications, styles, étapes enchaînées, compte rendu
  js/recipes.js          styles de montage (recettes) et étapes du montage express (testé)
  js/speech.js           silences dans le son, lecture .srt / .vtt, sous-titres courts (testé)
  js/faces.js            détection du visage (Viola-Jones, repli), suivi des yeux, cadrage du zoom visage (testé)
  js/yunet.js            détection du visage YuNet : moteur du réseau de neurones, sans dépendance (testé)
  js/vendor/yunet-model.js le modèle YuNet d'OpenCV Zoo (licence MIT), converti par scripts/dev/yunet-convert.py
  js/vendor/haar-face.js cascade « visage de face » d'OpenCV (licences BSD / Intel en tête du fichier)
  js/whisper.js          transcription Whisper : lecture du JSON, sous-titres, « euh », répétitions (testé)
  js/transcription.js    Parole > Transcrire : outil, modèle, transcription des plans
  js/vad.js              détection de la voix Silero : moteur (FFT, convolutions, LSTM), passages et blancs (testé)
  js/vendor/silero-model.js le modèle Silero VAD (licence MIT), converti par scripts/dev/silero-convert.py
  js/libres.js           outils gratuits : catalogue, paquets par système, lignes de commande et sorties (testé)
  js/outils-panel.js     Réglages > Outils gratuits : trouver, installer, lancer les outils ; client Ollama
  js/ia.js               IA locale : demandes à Ollama et lecture des réponses (testé)
  js/ia-panel.js         traduction, correction, chapitres, extraits, Publier, recherche dans les rushs
  js/podcast.js          podcast multicam : qui parle, plans, caméras (testé)
  js/pyscripts.js        scripts Python lancés par RR FX : SAM 2, profondeur (Depth Anything), CLAP (testé)
  js/fonctions-libres.js podcast, débruitage, voix studio, voix off, pistes séparées, détourage, ralenti,
                         agrandissement, masque qui suit un objet, flou portrait, image débruitée, sons par description
  js/visage.js           images des plans, suivi du visage ou de l'objet entouré, 9:16 qui suit le visage
  js/voix.js             sonie LUFS (BS.1770), « euh » dans le son, courbe de ducking (testé)
  js/tracker.js          suivi d'un objet par corrélation (testé)
  js/parole.js           onglet Parole : couper les silences, zoom visage, sous-titres, bandeau
  js/sons.js             sons fournis (whooshs, impacts, riser, glitch) fabriqués par le plugin, WAV (testé)
  js/diagnostic.js       test de compatibilité Premiere (Réglages)
  js/installer.js        mise à jour en un clic : téléchargement, vérification, sauvegarde, retour arrière (testé)
  js/accueil.js          accueil de la première ouverture, recherche rapide (Ctrl+K)
  js/assets.js           ressources : indexation des dossiers liés, classement, filtres, LUT .cube (testé)
  js/ressources.js       onglet Ressources : vignettes, aperçus, actions
  js/core.js             courbes, compilation des effets, rampes, détection des noms (sans DOM, testé)
  js/library.js          les 20 recettes d'effets + les animations de texte
  js/preview.js          aperçus simulés
  js/widgets.js          composants façon Spectrum, valeurs glissables, éditeurs de courbes
  js/storage.js          bibliothèque perso sur disque
  js/shortcuts.js        raccourcis clavier (toutes les actions)
  js/outils.js           calculs de la 2.5 : montage par le texte, musique à la durée, versions, temps (testé)
  js/texte.js            montage par le texte (onglet Parole)
  js/duree.js            musique à la durée de la vidéo (onglet Musique)
  js/projet.js           dossiers surveillés, rangement, renommage, proxies (Ressources) ; versions (Formats)
  js/macros.js           macros : enchaînements d'actions sur un bouton, une touche, la télécommande
  js/temps.js            temps passé par projet, temps gagné, badges et carte à partager (Réglages)
  js/raccords.js         J-cut / L-cut, coupes sur les blancs, correcteur de sous-titres (Parole)
  js/livraison.js        rythme du montage, export en lot (Formats) ; archive (Ressources) ; crédits (Musique)
  js/astuces.js          astuce du jour (un outil pas encore utilisé)
  js/updates.js          vérification des nouvelles versions sur GitHub
  js/host.js, mock.js    pont vers Premiere / faux Premiere du mode démo
  jsx/host.jsx           tout ce qui touche Premiere (ExtendScript ES3), assemblé depuis src/host
src/host/                le script Premiere, une partie par domaine (node scripts/build-host.js)
install/                 scripts d'installation + LISEZMOI
docs/captures/           captures et animations du README (npm run screenshots les refait ;
                         ONLY=nom node scripts/readme-gallery.js refait une seule étape de la galerie)
.github/ISSUE_TEMPLATE/  formulaire « Partager un effet RR FX » (bibliothèque en ligne)
scripts/                 pack, test d'interface, captures, build-host, host-api, keys et sign (signature)
tests/                   tests Node (sim.js = timeline Premiere simulée)
```

## Langues (français / anglais)

Le code est écrit en français. Chaque texte affiché passe par `_T('…')` : la traduction anglaise est cherchée dans
`plugin/js/i18n-en.js` (clé : le texte français exact, espaces compris). Sous Node, `_T` rend le texte tel quel.

- Un nouveau texte : `_T('Mon texte')` dans le code, et sa traduction dans `i18n-en.js`. `tests/i18n.test.js`
  échoue s'il en manque une.
- Garde les espaces de début et de fin des morceaux collés (`_T(' sur ')` → `' on '`), sauf l'espace française
  avant « : ; ! ? » et autour des guillemets « ».
- Les messages de Premiere (`host.jsx`, en ASCII) sont traduits par morceaux : la liste `host` de `i18n-en.js`.
- Les textes de `index.html` (boutons, info-bulles) sont traduits au chargement par `RRFXI18n.translateDom`.
- Les noms de calques `RR FX · …` et les noms d'effets de Premiere ne se traduisent pas : RR FX les reconnaît par
  ces noms.

## Performances

- Les valeurs sont calculées image par image, mais seules les images clés utiles partent vers Premiere (une plage
  de valeurs identiques n'en garde que les extrémités).
- Plusieurs coupes = une zone à la fois : l'interface reste réactive, la progression est exacte, l'arrêt est possible.
- La recherche du calque de réglage est mise en cache et revérifiée une fois par opération.
- La ligne d'état interroge Premiere toutes les 2 s seulement quand le panneau est visible et inactif ; la
  sélection est lue en un seul passage sur la timeline, même sur une longue séquence.
- Musique : seule la partie utilisée dans la séquence est lue et analysée (un mix d'une heure n'est pas chargé en
  entier). Synchro : les en-têtes de chaque fichier ne sont lus qu'une fois, les longs rushs minute par minute.
- Montage multicam : chaque piste n'est lue qu'une fois ; RR FX vérifie que Premiere sait désactiver un plan
  **avant** de couper quoi que ce soit.
- Les réglages sont enregistrés aussi à la fermeture du panneau ; les vidéos d'overlays ne tournent que pendant
  leur aperçu.
