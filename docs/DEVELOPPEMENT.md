# RR FX : développement

Notes techniques : tests, publication, organisation du code. Le mode d'emploi est dans le
[guide complet](GUIDE.md).

## Tests

```bash
npm test          # Node 18+ : cœur, modules, cohérence du projet, et le vrai script Premiere sur une timeline simulée
npm run smoke     # interface en mode démo dans Chromium (nécessite Playwright)
npm run screenshots # captures de chaque page et de chaque outil, images du README (docs/captures)
npm run package   # fabrique dist/RRFX-<version>-installation.zip
```

Ouvrir `plugin/index.html` dans un navigateur lance le panneau en **mode démo** (rien n'est modifié).
Quand le panneau tourne dans Premiere, ses outils de développement sont sur `http://localhost:8088`
(version de développement uniquement : le fichier `.debug` n'est pas inclus dans le pack).

## Publier une nouvelle version

1. Change `version` dans `package.json`, `plugin/CSXS/manifest.xml`, `plugin/js/host.js` et `plugin/jsx/host.jsx`
   (un test vérifie qu'elles sont identiques).
2. Écris les nouveautés dans `.github/release-notes/vX.Y.Z.md` (ajoutées sous les étapes d'installation).
3. Pousse un tag du même numéro (`git tag vX.Y.Z && git push origin vX.Y.Z`), ou lance le workflow à la main :
   *Actions > Release > Run workflow*. GitHub Actions lance les tests, fabrique le pack et publie la release
   (`.github/workflows/release.yml`).

## Structure

```
plugin/                  l'extension CEP (copiée telle quelle dans le dossier des extensions Adobe)
  CSXS/manifest.xml      manifeste (Premiere Pro 15.0+)
  index.html, css/       panneau
  js/main.js             onglets, bloc d'état, application, overlays, partage, historique, raccourcis, menu
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
  js/assets.js           ressources : indexation des dossiers liés, classement, filtres, LUT .cube (testé)
  js/ressources.js       onglet Ressources : vignettes, aperçus, actions
  js/core.js             courbes, compilation des effets, rampes, détection des noms (sans DOM, testé)
  js/library.js          les 20 recettes d'effets + les animations de texte
  js/preview.js          aperçus simulés
  js/widgets.js          composants façon Spectrum, valeurs glissables, éditeurs de courbes
  js/storage.js          bibliothèque perso sur disque
  js/shortcuts.js        raccourcis clavier
  js/updates.js          vérification des nouvelles versions sur GitHub
  js/host.js, mock.js    pont vers Premiere / faux Premiere du mode démo
  jsx/host.jsx           tout ce qui touche Premiere (ExtendScript ES3)
install/                 scripts d'installation + LISEZMOI
docs/captures/           captures d'écran du README (npm run screenshots les refait)
.github/ISSUE_TEMPLATE/  formulaire « Partager un effet RR FX » (bibliothèque en ligne)
scripts/                 fabrication du pack, test d'interface, ressources de démonstration, captures
tests/                   tests Node (sim.js = timeline Premiere simulée)
```

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

## Pourquoi pas un `.ccx` comme Rotate ?
Rotate est un plugin UXP. L'API UXP de Premiere ne permet pas (encore) de découper un clip ni de changer sa vitesse :
les speed ramps seraient impossibles. RR FX est donc une extension CEP (HTML + ExtendScript), avec la même interface.

