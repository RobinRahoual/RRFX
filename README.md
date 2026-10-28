# CutFX — plugin Premiere Pro

Plugin gratuit créé par **Robin Rahoual** — suis-moi sur Instagram : [@robin.rahoual](https://www.instagram.com/robin.rahoual/).

Des **transitions et effets de clip musical posés en un clic autour des coupes** (flashs, flickers, flous, zooms,
shakes, slides, glitchs, motion blur), des **speed ramps** qui ne décalent jamais la coupe, et **tes propres effets**
capturés depuis Premiere pour les réutiliser partout.

**Ton clip n'est jamais modifié** : tout se passe sur des calques au-dessus (calques de réglage, ou copies du plan pour
les rampes et le motion blur), que le bouton ↶ Annuler retire.

**[⬇ Télécharger CutFX](https://github.com/RobinRahoual/CutFX/releases/latest)** — fichier `CutFX-<version>-installation.zip`.

## Installation

1. Télécharge `CutFX-<version>-installation.zip` depuis la
   [dernière release](https://github.com/RobinRahoual/CutFX/releases/latest) (section *Assets*) et décompresse-le.
2. Ferme Premiere Pro, puis :
   - **Windows** : double-clique sur `Installer CutFX (Windows).bat` (si Windows affiche « Windows a protégé
     votre ordinateur » : *Informations complémentaires* > *Exécuter quand même*) ;
   - **Mac** : clic droit sur `Installer CutFX (Mac).command` > *Ouvrir*.
3. Dans Premiere : *Fenêtre > Extensions > CutFX*.

Le script copie le panneau dans le dossier des extensions Adobe et autorise les extensions non signées
(`PlayerDebugMode`). Compatible Premiere Pro 2021 à 2026, Windows et macOS. Pour mettre à jour : relance le script
de la nouvelle version (tes effets perso sont gardés). Pour désinstaller : supprime le dossier `CutFX` de
`%APPDATA%\Adobe\CEP\extensions` (Windows) ou `~/Library/Application Support/Adobe/CEP/extensions` (Mac).

**Il faut un calque de réglage dans le projet** (une fois par projet) : *Fichier > Nouveau > Calque de réglage*.
CutFX le retrouve tout seul.

### Pourquoi pas un `.ccx` comme Rotate ?
Rotate est un plugin UXP. L'API UXP de Premiere ne permet pas (encore) de découper un clip ni de changer sa vitesse :
les speed ramps seraient impossibles. CutFX est donc une extension CEP (HTML + ExtendScript), avec la même interface.

## Utilisation

En haut du panneau, toujours visibles : le crédit, **▴ Réduire**, les onglets, le **bouton principal** (son action
dépend de l'onglet) et le **bloc d'état**.

### Onglet Effets

1. Place la tête de lecture près d'une coupe, sélectionne des clips, ou pose des **marqueurs** sur les temps forts.
2. Choisis un effet : le survol d'une vignette l'anime, l'aperçu montre le résultat sur deux plans de test.
3. Règle-le comme dans *Options d'effet* : glisse les **valeurs bleues** (Maj = ×10, clic = saisie).
4. Clique sur **Appliquer · <effet>**.

| Réglage | Rôle |
| --- | --- |
| **Côté** | **PRE** = fin du plan sortant (monte jusqu'à la coupe), **POST** = début du plan entrant (redescend), ou les deux |
| **Position** | Coupe la plus proche · Toutes les coupes de la sélection · **Marqueurs de la séquence** · Tête de lecture · Début / fin des clips · Clips entiers |
| **Entre les coupes** | Plusieurs coupes ou marqueurs : identique partout, variation aléatoire (shakes, flickers, glitchs différents à chaque fois), ou **un effet au hasard** (même catégorie ou favoris) |
| **Cible** | Calque de réglage au-dessus du clip (nommé `CutFX · …`, recommandé) ou **copie du plan** posée juste au-dessus (pour les effets qui ont besoin des images du plan) |
| **Durée / Intensité** | Images de chaque côté · force de toute l'animation (0–200 %) |
| **Courbe** | Courbe d'animation éditable ; la moitié POST est le miroir de la PRE |

Toutes les animations sont écrites en images clés dans les effets natifs de Premiere (Transformer, Flou gaussien,
Flou directionnel, Luminosité et contraste, Décalage, Déformation de la vague, Distorsion de l'objectif, Écho) :
tout reste modifiable ensuite dans *Options d'effet*.

**Les 20 effets** : Flash blanc, Glow flash, Dip noir, Double flash · Flicker, Stroboscope · Défocus, Flou
directionnel · Zoom in, Zoom out, Zoom rebond, Zoom rotation (flou de mouvement réel) · Shake, Impact, Bass drop ·
Slide, Whip pan · Onde, Bulge, Glitch · Motion blur (vraie fusion d'images, sur une copie du plan).

### Les copies du plan

Pour les rampes, le Motion blur et la cible « Copie du plan », CutFX pose **une copie du passage sur une piste juste
au-dessus du clip** (insérée si besoin, donc toujours sous tes calques de réglage) et travaille dessus :

- la copie vient d'un **sous-clip vidéo seule** du rush (`CutFX · <rush> · vidéo`, chutier « CutFX », créé une fois) :
  rien n'est posé sur les pistes audio, ta musique ne peut pas être écrasée ;
- le **cadrage et l'étalonnage** du clip (Trajectoire, Opacité, effets, images clés comprises) sont recopiés dessus.
  Les courbes et LUT de Lumetri ne se recopient pas : étalonne plutôt sur un calque de réglage (option désactivable
  dans *Réglages*) ;
- le clip d'origine, son son et la coupe ne bougent pas ; ↶ Annuler retire la copie.

### Onglet Speed ramp

- Dessine la courbe de vitesse (10 % à 1000 %) : glisse les points, double-clic pour en ajouter ou retirer.
  Préréglages : accélération vers la coupe, décélération après, ralenti sur le temps fort, pulse…
- La rampe est posée sur **une copie du passage** juste au-dessus du clip (voir « Les copies du plan ») :
  **le clip d'origine, son son et la coupe ne bougent pas**. L'*ancre* choisit l'image qui reste en place.
- CutFX vérifie qu'il y a assez de média avant de poser quoi que ce soit.
- **↶ Annuler** retire la rampe ; **＋ Enregistrer** la garde dans les préréglages.

Premiere ne laisse pas les scripts piloter le *remappage temporel* : la copie est faite de morceaux de vitesse
constante (« CutFX · Rampe »). Avec 8 à 16 morceaux et l'interpolation *Flux optique*, c'est fluide.

### Onglet Mes effets

- **Preset** : sur un effet, **＋ Preset** garde tes réglages (catégorie « Mes effets »).
- **Capture** : monte n'importe quel effet dans Premiere — sur un clip ou un calque de réglage, avec tes images clés,
  effets tiers compris — sélectionne-le dans la timeline et clique sur **Capturer la sélection**. Effets, valeurs et
  animations sont enregistrés ; tu le réappliques comme un effet intégré (durée réglable par étirement, miroir
  PRE/POST automatique).
- **Importer / exporter** en `.json` pour sauvegarder ou partager tes effets.

Tout est enregistré dans `Documents/CutFX/library.json`.

### Annuler la dernière opération

Le bouton **↶ Annuler (n)** de la ligne d'état retire ce que CutFX a posé lors de la dernière opération : les calques
de réglage, copies du plan et morceaux de rampe `CutFX · …`. Les 10 dernières opérations
sont mémorisées, même après avoir fermé Premiere. Un calque renommé ou un clip modifié entre-temps n'est pas touché.

### Suivi de l'opération

Pendant l'application, le bloc d'état montre que ça tourne (icône animée, temps écoulé), où on en est
(« 3/12 · Glitch POST »), une barre de progression et le temps restant. **Arrêter** (ou Échap) interrompt proprement
après la zone en cours. À la fin : **✓ vert**, **⚠ orange** (remarques dans le journal) ou **✕ rouge**, avec
**Voir le détail**. Au repos, la ligne d'état résume la séquence : cadence, clips sélectionnés, marqueurs.

### Sans cliquer : menu et raccourcis

Le menu du panneau (☰ en haut à droite du panneau) propose : appliquer l'effet, appliquer la rampe, capturer,
annuler, mode réduit.

Quand le panneau CutFX est sélectionné (clique dedans), une touche suffit :

| Touche | Action |
| --- | --- |
| **A** | Appliquer l'effet choisi |
| **R** | Appliquer la rampe |
| **U** | Annuler la dernière opération |
| **C** | Capturer la sélection |
| **Échap** | Arrêter l'opération en cours |

Pour changer une touche : *Réglages > Raccourcis clavier*, clique sur la touche puis appuie sur la nouvelle
(Retour arrière pour n'en mettre aucune).

### Signal de fin, mode réduit, mises à jour

- Au-delà de 8 secondes (beaucoup de coupes, rampes), le bilan clignote et un petit son est joué (désactivable).
- **▴ Réduire** ne garde que le crédit, le bouton principal et l'état. **▾ Réglages** réaffiche tout.
- Au démarrage, CutFX vérifie sur GitHub (au plus toutes les 6 heures) si une nouvelle version est publiée et propose
  **Télécharger**, **Nouveautés** ou **Plus tard**. Nécessite que le dépôt GitHub soit public.

## Langue de Premiere et mises à jour de Premiere

Premiere cherche les effets par leur nom affiché, qui dépend de la langue. Au démarrage, CutFX lit la liste des
effets de ton Premiere et **détecte automatiquement le bon nom** (*Réglages > Effets Premiere utilisés* : ✓ ou ✕).
Chaque paramètre animé est aussi **vérifié par son nom** : si une version de Premiere réordonne les paramètres d'un
effet, CutFX retrouve le bon au lieu d'animer le mauvais. Au démarrage, il vérifie que les fonctions de Premiere dont
il a besoin existent toujours et affiche « Plugin à mettre à jour » dans le cas contraire.

Si un effet reste introuvable : *Réglages > Avancé*, *Lister les effets vidéo*, puis ajoute son nom exact, par ex.
`{"wave": {"names": ["Déformation de la vague"]}}`. *Analyser le clip sélectionné* liste les paramètres de chaque
effet avec leur numéro.

## Performances

- Les valeurs sont calculées image par image, mais seules les images clés utiles partent vers Premiere (une plage
  de valeurs identiques n'en garde que les extrémités).
- Plusieurs coupes = une zone à la fois : l'interface reste réactive, la progression est exacte, l'arrêt est possible.
- La recherche du calque de réglage est mise en cache et revérifiée une fois par opération.
- La ligne d'état interroge Premiere toutes les 2 s seulement quand le panneau est visible et inactif.

## Tests

```bash
npm test          # Node 18+ : cœur, modules, cohérence du projet, et le vrai script Premiere sur une timeline simulée
npm run smoke     # interface en mode démo dans Chromium (nécessite Playwright)
npm run package   # fabrique dist/CutFX-<version>-installation.zip
```

Ouvrir `plugin/index.html` dans un navigateur lance le panneau en **mode démo** (rien n'est modifié).
Quand le panneau tourne dans Premiere, ses outils de développement sont sur `http://localhost:8088`
(version de développement uniquement : le fichier `.debug` n'est pas inclus dans le pack).

### Publier une nouvelle version

Change `version` dans `package.json`, `plugin/CSXS/manifest.xml`, `plugin/js/host.js` et `plugin/jsx/host.jsx`
(un test vérifie qu'elles sont identiques), puis pousse un tag du même numéro
(`git tag v1.1.0 && git push origin v1.1.0`). GitHub Actions lance les tests, fabrique le pack et publie la release
(`.github/workflows/release.yml`).

## Structure

```
plugin/                  l'extension CEP (copiée telle quelle dans le dossier des extensions Adobe)
  CSXS/manifest.xml      manifeste (Premiere Pro 15.0+)
  index.html, css/       panneau
  js/main.js             onglets, bloc d'état, application, historique, raccourcis, menu
  js/core.js             courbes, compilation des effets, rampes, détection des noms (sans DOM, testé)
  js/library.js          les 20 recettes d'effets (ajouter un effet = ajouter une entrée)
  js/preview.js          aperçus simulés
  js/widgets.js          composants façon Spectrum, valeurs glissables, éditeurs de courbes
  js/storage.js          bibliothèque perso sur disque
  js/shortcuts.js        raccourcis clavier
  js/updates.js          vérification des nouvelles versions sur GitHub
  js/host.js, mock.js    pont vers Premiere / faux Premiere du mode démo
  jsx/host.jsx           tout ce qui touche Premiere (ExtendScript ES3)
install/                 scripts d'installation + LISEZMOI
scripts/                 fabrication du pack, test d'interface
tests/                   tests Node (sim.js = timeline Premiere simulée)
```
