# RR FX : guide complet

Tout ce que fait chaque onglet, en détail. Pour découvrir le plugin en deux minutes, va plutôt sur la
[page d'accueil](../README.md).

## Installation en détail

1. Télécharge `RRFX-<version>-installation.zip` depuis la
   [dernière release](https://github.com/RobinRahoual/RRFX/releases/latest) (section *Assets*) et décompresse-le.
2. Ferme Premiere Pro, puis :
   - **Windows** : double-clique sur `Installer RR FX (Windows).bat` (si Windows affiche « Windows a protégé
     votre ordinateur » : *Informations complémentaires* > *Exécuter quand même*) ;
   - **Mac** : clic droit sur `Installer RR FX (Mac).command` > *Ouvrir*.
3. Dans Premiere : *Fenêtre > Extensions > RR FX*.

Le script copie le panneau dans le dossier des extensions Adobe et autorise les extensions non signées
(`PlayerDebugMode`). Compatible Premiere Pro 2021 à 2026, Windows et macOS. Pour mettre à jour : **Installer la mise à jour**
dans le bandeau du panneau (ou relance le script de la nouvelle version) ; tes effets perso sont gardés. Pour désinstaller : supprime le dossier `RRFX` de
`%APPDATA%\Adobe\CEP\extensions` (Windows) ou `~/Library/Application Support/Adobe/CEP/extensions` (Mac).

**Il faut un calque de réglage dans le projet** (une fois par projet) : *Fichier > Nouveau > Calque de réglage*.
RR FX le retrouve tout seul.

## Le panneau

À la première ouverture, un **accueil** montre par où commencer (il revient avec *Ctrl+K > Afficher l'accueil*).
En haut du panneau, toujours visibles : le crédit, **🔍 la recherche rapide**, **▴ Réduire**, les onglets (sur deux lignes si le panneau est
étroit : aucun n'est caché), le **bouton principal** (son action dépend de l'onglet) et le **bloc d'état**. Un clic
sur le titre d'une section la replie (gardé d'une session à l'autre), et chaque onglet retrouve sa position quand
on y revient.

### Onglet Express : ton montage en un clic

1. **Style** : *Reels dynamique* (coupes sur le son, zooms traversants, sous-titres mot par mot, 9:16), *Face cam
   / UGC* (silences, punch-in, sous-titres 3 mots, 9:16), *YouTube face cam* (silences, punch-in, whip pans et
   whooshs), *Interview / témoignage* (silences, punch-in, fondus, bandeau, sous-titres, 9:16 sur fond flou),
   *Entreprise épuré* (fondus flous, pushs et zooms doux sur chaque coupe, bandeau), *Aftermovie* (montage sur la
   musique, flashs, leaks dorés), *Mariage / cérémonie* (fondus blancs, bokeh, lumière chaude), *Vlog voyage*,
   *Cinématique*, *Rap énergique*, *Drill sombre*, *Pop lumineux*, *Chill / lofi*, *Rétro VHS*, ou **Mon style**
   (ton enchaînement d'effets et ton look en cours). Ce sont des points de départ, utilisables pour n'importe
   quelle vidéo : décoche les étapes inutiles.
2. **Avant de lancer** : RR FX vérifie ce dont ce style a besoin : séquence ouverte, calque de réglage, musique
   (seulement pour les étapes qui suivent le rythme), plans où l'on parle sélectionnés (coupe des silences), rushs
   sélectionnés dans le panneau *Projet* (montage), caméras (conversion), paroles, sous-titres ou bandeau. Ce qui
   manque est expliqué ; une étape impossible est simplement passée.
3. **Étapes** (à cocher, gardées par style) : couper les silences → temps forts → montage auto → conversion LOG →
   expo et balance auto → look → zoom un plan sur deux → effets enchaînés (sur les temps forts, ou sur toutes les
   coupes de la séquence pour les styles sans musique) + sons → paroles → sous-titres → bandeau → copie au format
   réseau (recadrée, ou sur fond flou).

**Lancer** (bouton du haut, touche **E**) enchaîne tout, avec le compte rendu de chaque étape. La coupe des
silences se fait sur une copie de ta séquence : la suite du montage express continue sur cette copie, et les
sous-titres sont recalés sur la coupe. Chaque étape est une opération à part : **↶ Annuler** en retire une à la
fois. Les réglages de tes autres onglets sont rendus tels quels à la fin.

### Onglet Effets

1. Place la tête de lecture près d'une coupe, sélectionne des clips, ou pose des **marqueurs** sur les temps forts.
2. Choisis un effet : le survol d'une vignette l'anime, l'aperçu montre le résultat sur deux plans de test, ou sur
   **ta vraie image** (bouton 📷 *Ma vraie image* : deux images de ta séquence autour de la coupe la plus proche).
3. Règle-le comme dans *Options d'effet* : glisse les **valeurs bleues** (Maj = ×10, clic = saisie).
4. Clique sur **Appliquer · <effet>**.

| Réglage | Rôle |
| --- | --- |
| **Côté** | **PRE** = fin du plan sortant (monte jusqu'à la coupe), **POST** = début du plan entrant (redescend), ou les deux |
| **Position** | Coupe la plus proche · Toutes les coupes de la sélection · **Toutes les coupes de la séquence** (sans rien sélectionner) · **Marqueurs de la séquence** · **Temps forts de la musique** (détectés directement, sans poser de marqueurs) · Tête de lecture · Début / fin des clips · Clips entiers · **Tous les plans de la séquence** |
| **Plans** | Positions « clips entiers » : tous, ou **un sur deux** (punch-in sur les jump cuts : alterne cadre large et serré) |
| **Entre les coupes** | Plusieurs coupes ou marqueurs : identique partout, variation aléatoire (shakes, flickers, glitchs différents à chaque fois), **un effet au hasard** (même catégorie ou favoris), ou un **enchaînement** : 2 à 4 effets choisis (Maj + clic sur les cartes) qui se succèdent sur chaque temps fort, dans l'ordre ou au hasard |
| **Posé sur** | Toujours un **calque de réglage** au-dessus du clip (`RR FX · …`) ; Motion blur : copie du plan (CLIP FX) ; overlays : le média lui-même |
| **Son sur les coupes** | Sons fournis par RR FX (whooshs, impacts, hit, riser, glitch), fabriqués par le plugin (rien à télécharger, aucun droit à gérer) et calés pour que leur moment fort tombe pile sur la coupe ; *Whooshs variés + impacts* met un impact sur les temps forts. Piste audio libre, ta musique n'est pas touchée |
| **Intensité qui suit le volume** | En option : l'intensité de chaque coupe est modulée par le volume de la musique à cet instant (doux sur un couplet, fort sur un drop) ; *Influence* règle l'écart |
| **Durée / Intensité** | Images de chaque côté · force de toute l'animation (0–200 %) |
| **Courbe** | Courbe d'animation éditable ; la moitié POST est le miroir de la PRE |

Toutes les animations sont écrites en images clés dans les effets natifs de Premiere (Transformer, Flou gaussien,
Flou directionnel, Luminosité et contraste, Décalage, Déformation de la vague, Distorsion de l'objectif, Écho) :
tout reste modifiable ensuite dans *Options d'effet*.

**Les 36 effets** : Flash blanc, Glow flash, Dip noir, Double flash, Fondu au blanc, Fondu au noir · Flicker,
Stroboscope · Défocus, Flou directionnel, Fondu flou · Zoom in, Zoom out, Zoom rebond, Zoom rotation (flou de
mouvement réel), Zoom lent, Zoom traversant, Pop · Shake, Impact, Bass drop · Slide, Whip pan, Push · Onde, Bulge,
Glitch · **Mouvements** sur tout le plan : **Zoom visage**, **Zoom visage progressif**, **Stabiliser le visage**, **Zoom suivi (objet)** (voir plus bas), Punch-in, Ken Burns (photos et plans fixes d'événement), Respiration,
Caméra à l'épaule · Motion blur (vraie fusion d'images, sur une copie du plan). Choisir un mouvement passe la
position sur *Clips entiers*.

### Zoom visage

*Zoom visage* et *Zoom visage progressif* (catégorie Mouvements) zooment sur la personne qui parle en gardant son
regard en place. Pour chaque plan visé, RR FX exporte quelques images propres de la timeline (une toutes les
0,6 s environ, sans looks ni titres), y cherche le visage (détecteur de Viola-Jones d'OpenCV, intégré au
panneau, rien n'est envoyé en ligne), en déduit la ligne des yeux et la suit sur toute la durée du plan. Le zoom
est posé sur un calque de réglage (effet Transformer) avec peu d'images clés, modifiables ensuite.

| Réglage | Rôle |
| --- | --- |
| **Zoom** | +20 % par défaut (*progressif* : de 100 % à 115 % sur le plan) |
| **Yeux** | *À leur place* : le zoom se fait autour des yeux, ils ne bougent pas à l'écran ; *Recentrés* : ils viennent au milieu, au tiers haut, sans jamais laisser voir de bord |
| **Suivi** | *Doux* (mouvement posé), *Serré* (colle aux mouvements de tête) ou *Fixe* (une seule position) |
| **Arrivée** | *Sèche* (punch-in) ou *Douce* (le zoom s'installe sur 8 images) |

*Stabiliser le visage* tient les yeux à leur position moyenne dans le plan (léger zoom de 8 % pour ne jamais
voir de bord). *Zoom suivi (objet)* : à l'application, la première image du plan s'affiche ; trace un rectangle
autour de l'objet (produit, logo, personne). RR FX le retrouve image par image (une toutes les 0,3 s) par
corrélation, et garde la dernière position connue s'il le perd de vue.

Visage de face, assez grand et éclairé : c'est ce que le détecteur reconnaît le mieux. Dans un plan où il ne
trouve pas de visage, le zoom se fait vers le haut du cadre et le journal le signale.

### Overlays

**16 overlays fournis**, en 6 packs : *Light leaks* (chaud, rose, bleu, doré), *Flares* (anamorphique, soleil),
*Bokeh* (chaud, froid), *Pellicule* (poussière, vieux film, brûlure, brûlure rouge), *VHS & glitch* (VHS, glitch
RGB), *Lumière* (balayages). Rien à télécharger : RR FX les dessine lui-même. À la première utilisation, chaque
overlay est fabriqué en images (2 s, à la taille et à la cadence de ta séquence, rangé dans
`Documents/RRFX/Overlays`), puis réutilisé. Le survol d'une vignette l'anime ; avec *Entre les coupes : un effet au
hasard*, chaque coupe reçoit un overlay différent du pack.

Tes propres overlays : *Ajouter des overlays* (vidéos MOV/MP4/WEBM ou images PNG/JPG) ou *Ajouter un dossier* (un
pack entier). Un overlay se pose comme un effet (sur la coupe, toutes les coupes, les marqueurs…) sur une piste
au-dessus du clip, avec un fondu d'opacité animé (durée, courbe, opacité), un point de départ au hasard dans la vidéo
(différent à chaque coupe) et un **mode de fusion** (Écran par défaut). Si le mode posé n'est pas le bon dans ta
version de Premiere : règle-le à la main sur un clip, sélectionne-le et clique sur **Apprendre**. Les fichiers sont
importés dans le chutier « RR FX Overlays ».

### Les copies du plan

Pour les rampes et le Motion blur (« CLIP FX »), RR FX pose **une copie du passage sur une piste juste
au-dessus du clip** (insérée si besoin, donc toujours sous tes calques de réglage) et travaille dessus :

- la copie vient d'un **sous-clip vidéo seule** du rush (`RR FX · <rush> · vidéo`, chutier « RR FX », créé une fois) :
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
- RR FX vérifie qu'il y a assez de média avant de poser quoi que ce soit.
- **↶ Annuler** retire la rampe ; **＋ Enregistrer** la garde dans les préréglages.
- **Caler sur le tempo** : la durée de la rampe devient ½, 1, 2 ou 4 temps de la musique de la séquence.

Premiere ne laisse pas les scripts piloter le *remappage temporel* : la copie est faite de morceaux de vitesse
constante (« RR FX · Rampe »). Avec 8 à 16 morceaux et l'interpolation *Flux optique*, c'est fluide.

### Conversion LOG → Rec.709 en un clic (onglet Couleur)

Tu filmes en LOG ? Enregistre **une seule fois** ta caméra et sa LUT de conversion, elles servent ensuite à **tous
tes projets** :

1. *Couleur > Conversion LOG → Rec.709 > + Ajouter une caméra* : marque, modèle (ex. Sony **A7 III**), profil
   (ex. **S-Log3 / S-Gamut3.Cine**) ;
2. **LUT du fabricant** : *Importer la LUT .cube…* (le bouton *Trouver la LUT officielle* lance la recherche). RR FX
   la garde dans `Documents/RRFX/Conversion` et la copie dans le dossier *LUTs/Technical* d'Adobe (elle apparaît
   aussi dans la liste *LUT d'entrée* de Lumetri). Ou **Calculée** : sans fichier, RR FX calcule la conversion
   d'après les courbes publiées par le fabricant, avec la compensation si tu exposes ton log plus haut (ex. +1,7 IL)
   et un rendu Doux, Standard ou Contrasté ;
3. **Convertir en Rec.709** (ou la touche **L**, ou le menu du panneau) : un **calque de réglage Lumetri** est posé
   **juste au-dessus des rushs**, du premier au dernier rush de la timeline (ou au-dessus des **rushs choisis**),
   avec la LUT chargée en *LUT d'entrée*. Les copies du plan posées par RR FX (rampes…) comptent comme des rushs ;
   les looks, titres et overlays restent au-dessus. Si la piste du dessus est prise, une piste est insérée : la
   conversion passe toujours **avant** les looks. Reconvertir **remplace** l'ancienne conversion à cet endroit
   (jamais deux à la suite ; une conversion de toute la timeline est coupée autour des rushs reconvertis), et
   ↶ Annuler la retire.

Plusieurs caméras (A7 III + iPhone en Apple Log…) : enregistre-les toutes et choisis **Caméra : Reconnue par
plan**. RR FX lit la marque et le modèle dans chaque fichier (Sony, Apple, DJI, GoPro, Panasonic, Canon, Fujifilm,
Nikon, Blackmagic, Samsung, ARRI ; à défaut, le nom du fichier) et pose **un calque par caméra** avec la bonne LUT.
Chez Sony, il lit même la courbe du tournage : un plan filmé en Rec.709 ou HLG est laissé tel quel. Les plans non
reconnus prennent la caméra cochée (ou sont laissés de côté, au choix). Sinon, à la main : coche une caméra,
sélectionne ses rushs et choisis *Rushs choisis* (les angles masqués du montage multicam sont ignorés).
L'option **Puis expo et balance des blancs auto** enchaîne la correction de chaque plan (ci-dessous). L'option *Aperçu en LOG* convertit tes vraies images (📷) avant le look dans
l'aperçu. Profils : Sony S-Log3 / S-Log2, Panasonic V-Log (L), Canon C-Log / C-Log2 / C-Log3, Fujifilm F-Log /
F-Log2, Nikon N-Log, DJI D-Log (et D-Log M avec la LUT DJI), Apple Log, Blackmagic Film Gen 5, GoPro GP-Log et
Samsung Log (LUT du fabricant), ARRI LogC3 / LogC4. Premiere 25 qui convertit déjà le log tout seul (*Gestion des
couleurs > Détection automatique du log*) : coupe cette option, sinon l'image est convertie deux fois.

### Expo, balance et raccord entre caméras (onglet Couleur)

- **Expo et balance des blancs auto** : RR FX exporte l'image du milieu de chaque plan (après la conversion, sans
  les looks ni les titres, coupés le temps de l'export), l'analyse et corrige exposition, balance des blancs et
  noirs/blancs, avec mesure (±1,5 IL au plus ; force Légère, Normale ou Forte). Un calque Lumetri par plan, juste
  au-dessus de la conversion ; les plans déjà justes ne sont pas touchés.
- **Raccord entre caméras** : tête de lecture sur un plan de la caméra qui a le bon rendu, **Prendre la
  référence** ; sélectionne les plans de l'autre caméra, **Raccorder la sélection**. RR FX égalise la luminance
  (histogrammes), la saturation et la teinte par zone (ombres, tons moyens, hautes lumières), montre l'avant/après
  et pose une LUT de raccord au-dessus de l'expo auto.

L'ordre des calques est toujours le même, de bas en haut : rushs, **conversion**, **expo auto**, **raccord**, puis tes
**looks**, titres et overlays. Relancer une étape remplace ses calques sans toucher aux autres.

### Onglet Couleur (façon Lightroom)

La colorimétrie comme en retouche photo, avec les panneaux et les réglages du module Développement de Lightroom :

- **Histogramme** RVB et **aperçu avant | après** (séparateur à glisser, ou Après / Avant seuls), sur les plans de
  test ou **ta vraie image** (📷) ;
- **Looks** en vignettes (Clip musical, Film chaud, Noir et blanc, Pastel, Nuit bleue, Ciné désaturé, Été vintage,
  Punchy, et les tiens) et **Intensité du look** ;
- **Réglages de base** : Température, Teinte · Exposition, Contraste, Hautes lumières, Ombres, Blancs, Noirs ·
  Vibrance, Saturation ;
- **Courbe des tonalités** : paramétrique (Hautes lumières, Tons clairs, Tons foncés, Ombres, séparations) ou à points
  (RVB, R, V, B), avec l'histogramme en fond ;
- **Mélangeur de couleurs** : Teinte, Saturation, Luminance des 8 couleurs (rouge… magenta) ;
- **Étalonnage des couleurs** : roues Ombres, Tons moyens, Hautes lumières (3 roues ou une par une) et Global,
  Luminance, Fusion, Équilibre ;
- **Calibrage** : teinte des ombres, teinte et saturation des primaires rouge, verte, bleue.

Curseurs comme dans Lightroom : glisser (Maj = fin), double-clic sur le nom = valeur par défaut, clic sur la valeur =
saisie ; ↺ remet un panneau à zéro.

**Appliquer le look** (bouton du haut) : RR FX fabrique une **LUT .cube** (33³), l'installe dans le dossier des LUT
d'Adobe et pose un **calque de réglage Lumetri** sur le clip visé (ou la sélection, ou **toute la séquence**), avec la
LUT **déjà chargée** dans *Correction de base > LUT d'entrée*. Si une version de Premiere refuse, le chemin est copié
et il reste *LUT d'entrée (ou Créatif > Look) > Parcourir…*. **Exporter .cube…** sert aussi pour Resolve,
Final Cut, CapCut… **Exporter DCTL…** crée un vrai **DCTL pour DaVinci Resolve** avec les mêmes curseurs (60 curseurs,
courbes intégrées) : Premiere ne lit pas les DCTL. Aperçu, LUT et DCTL font exactement le même calcul (vérifié par
les tests : le DCTL y est compilé en C et comparé au panneau). **Enregistrer le look** le range dans Mes effets :
partageable par code et publiable dans la Communauté.

Texture, Clarté, Correction du voile, vignettage et grain dépendent des pixels voisins : une LUT ne peut pas les
porter, ils restent dans Lumetri.

### Onglet Musique

La musique est le plus long clip son de la séquence (ou le clip son sélectionné). **Analyser** la lit et affiche sa
forme d'onde avec les temps forts. Formats : WAV, AIFF, MP3, et le son des MOV/MP4. Si le fichier est introuvable ou
illisible, **Choisir un fichier…** : il est calé sur la musique de la séquence.

- **Temps forts** : détection *grosse caisse*, *tous les coups*, *caisse claire et charleston* ou *grille du tempo*,
  avec sensibilité, écart minimum et « garder un temps sur 1/2/4/8 ». Le bouton principal pose un **marqueur**
  `RR FX · …` sur chacun (les anciens marqueurs RR FX de la zone sont remplacés). Les effets (Position *Marqueurs de
  la séquence*), les textes et le montage auto s'en servent.
- **Montage auto sur le rythme** : sélectionne des rushs dans le panneau *Projet* ; ils sont posés l'un après l'autre,
  un plan tous les 1/2/4/8 temps, dans l'ordre ou au hasard, extrait au hasard / début / milieu / à la suite, sur une
  piste libre et **en vidéo seule** (ta musique n'est pas touchée). **Découper les clips sélectionnés** coupe à chaque
  marqueur.
- **Synchroniser le son et l'image** (touche **S**), *Caler sur* :
  - **la musique / le son externe** : pour un tournage en playback (ou un enregistreur posé dans la séquence), RR FX
    compare le son de la caméra à la musique (corrélation par bandes de fréquences) et **cale l'image en un clic** ;
  - **une des caméras** (multicam) : les caméras sont calées entre elles sur une caméra de référence (le plan le plus
    long, ou celui de la piste la plus basse), qui ne bouge pas. Les longs rushs sont lus par morceaux d'une minute
    (jusqu'à 40 min de référence).

  Clips sélectionnés dans la timeline : déplacés avec leur son. Rushs sélectionnés dans le panneau Projet : posés
  calés, une caméra par piste (en multicam, la référence est posée à la tête de lecture **avec son son**). Chaque clip
  affiche son décalage et la fiabilité ; un résultat douteux n'est pas appliqué.
- **Alterner les caméras (multicam)** : sélectionne tes caméras synchronisées, empilées une par piste. À chaque
  marqueur ou temps fort (un tous les 1/2/4/8 temps), une seule caméra reste active, dans l'ordre des pistes ou au
  hasard (jamais deux fois de suite la même) ; si une caméra n'a pas d'image à cet endroit, une autre prend le
  relais. Les autres plans sont **désactivés, pas supprimés** : ↶ Annuler ou *Tout effacer* les réactive. Tu peux
  aussi, après la synchro, utiliser *Imbriquer > Activer le multicaméra* de Premiere.

### Onglet Textes

Titres et **paroles animés** : colle les paroles (une ligne par texte, ou un mot par texte), choisis le rythme
(*marqueurs*, *temps forts détectés* ou *durée fixe*) et l'animation (Fondu, Pop, Zoom flou, Glissement, Flou, Impact,
réglable comme un effet, avec aperçu). Chaque texte est posé avec un **modèle de texte** `.mogrt` : ceux de
Premiere sont trouvés automatiquement ; pour ta police et ton style, crée un texte dans Premiere, puis clic droit >
*Exporter comme modèle d'animations graphiques* et **Ajouter un .mogrt…** (rangé dans `Documents/RRFX/Titres`).

### Onglet Parole

Pour tout ce qui parle : YouTube, vlogs, interviews, podcasts filmés, témoignages, conférences.

En haut, un **sommaire** (Silences, Euh, Visage, Sous-titres, Bandeau, Voix, Musique, Chapitres) amène à la
section voulue et la déplie. Le bouton bleu du haut reprend le dernier outil utilisé dans l'onglet.

- **Couper les silences** : sélectionne dans la timeline les plans où l'on parle (image et son liés, ou le son seul
  d'un micro). **Analyser** écoute le son (WAV, MOV/MP4) et montre les blancs en rouge sur une barre, sans rien
  toucher. **Couper les silences** retire les blancs sur les pistes des plans choisis (image et son, toujours
  synchro) et recolle la suite. *Sensibilité* (douce, normale, forte), *Silence minimum* (les pauses plus courtes
  restent) et *Marge gardée* autour des mots se règlent. *Résultat* : **sur une copie** de la séquence
  (« … (sans silences) », par défaut), dans la séquence (Ctrl+Z dans Premiere pour revenir), ou **marquer
  seulement** (un marqueur au début de chaque silence). Avec deux caméras, RR FX ne coupe que là où personne ne
  parle. À faire avant d'ajouter musique, plans de coupe et titres : les autres pistes ne sont pas décalées (RR FX
  les nomme).
- **« Euh » et répétitions** : RR FX écoute les plans choisis et repère les « euh », « hum » et voyelles tenues
  (un bout de voix court, isolé entre deux petites pauses, d'une hauteur et d'un volume presque constants). Avec
  un `.srt`, il trouve aussi les répétitions (« je je », « on va, on va ») et les faux départs (« c'est- c'est »).
  *Résultat* : sur une copie (« … (sans euh) »), dans la séquence, ou marquer seulement. Une répétition n'est
  coupée que si son temps est exact (sous-titres mot par mot) ; sinon elle est listée dans le journal.
- **Zoom visage** : sur un plan sur deux (ou tous) de la séquence, un zoom (+20 % par défaut) sur les yeux, qui
  sont suivis ; la coupe devient un changement de cadre et le regard ne bouge pas. *Yeux* : à leur place ou
  recentrés. Décoche *Suivre le visage* pour un punch-in fixe vers le haut du cadre.
- **Sous-titres** : importe ou colle un `.srt` / `.vtt` (Premiere : *Texte > Transcription*, puis *Sous-titres >
  Exporter en fichier SRT*). Chaque sous-titre devient un texte animé (modèle de l'onglet Textes), en phrase
  entière, 3 mots ou **mot par mot** (style TikTok, temps partagé selon la longueur des mots). *Départ du
  .srt* : début de la séquence, tête de lecture ou début des clips sélectionnés. Après une coupe des silences,
  les sous-titres faits avant la coupe sont recalés (ce qui tombait dans un silence disparaît).
- **Mots clés** (sous-titres) : chiffres, mots en MAJUSCULES ou suivis de « ! », mots forts et *Tes mots*
  ressortent dans la couleur choisie (effet Teinte sur le texte), un sur quatre au plus. *Emoji* : 💰 🔥 💡 ⏱️…
  après le mot clé (selon la police du modèle). *Son « pop »* : sur les mots clés ou sur chaque texte.
- **Bandeau nom et fonction** : nom et fonction sur deux lignes, posés à la tête de lecture (durée, place : bas
  gauche, bas centre, haut gauche ; animation).

- **Son de la voix** : chaque plan parlé (avec son son lié, ou le son seul) est mesuré en LUFS (norme EBU R128)
  et son *Niveau* (Volume) est réglé pour atteindre -14 (YouTube, réseaux), -16 (podcast) ou -23 LUFS (TV), sans
  dépasser -1 dB de crête. *Réduire le bruit de fond* ajoute l'effet DeNoise de Premiere. ↶ Annuler remet le volume.
- **Musique sous la voix** : la voix des plans choisis (sans ses silences) fait baisser la musique de la séquence
  (-12 dB par défaut) avec une descente de 0,25 s et une remontée de 0,5 s ; les pauses de moins d'une seconde
  gardent la musique basse. Images clés sur le *Niveau* du clip de musique ; ↶ Annuler remet le volume d'avant.
- **Chapitres YouTube** : depuis tes marqueurs nommés (les marqueurs automatiques de RR FX sont ignorés) ou depuis
  les grands blancs du `.srt`. Règles YouTube respectées : 00:00 en premier, au moins 3 chapitres de 10 s.
  *Copier* pour la description ; *Poser les marqueurs* depuis les sous-titres.

### Onglet Formats

Une **copie de la séquence** au format des réseaux, en un clic : **9:16** (Reels, TikTok, Shorts), **4:5**
(Instagram), **1:1** ou **16:9**. Les rushs reçoivent l'effet **Recadrage automatique** de Premiere, qui suit le
sujet (analyse en arrière-plan), sont agrandis et centrés (*Remplir, centré*), **suivent le visage** (RR FX cherche le visage dans chaque rush et anime la *Position* pour le garder au centre,
sans montrer de bord), ou posés **sur fond flou** (le plan
entier, net, au centre ; dessous, le même plan agrandi avec un Flou gaussien : interviews, conférences, vidéos
d'entreprise). L'aperçu montre la **zone sûre**
(ce que cachent les boutons et la légende de l'app). La séquence d'origine n'est pas modifiée ; les titres et calques
gardent leur place, à vérifier dans le nouveau cadre.

### Onglet Ressources

**Lie le dossier de ton disque** où tu ranges tes effets, SFX, polices, LUTs, titres et overlays (*＋ Lier un
dossier…*, autant de dossiers que tu veux, disques externes compris). RR FX le parcourt (sous-dossiers compris, jusqu'à
50 000 fichiers) et classe tout ; les fichiers restent où ils sont.

| Type | Aperçu | Actions |
| --- | --- | --- |
| **Sons & SFX** (wav, mp3, aif, m4a, flac…) | forme d'onde, ▶ écoute | poser à la tête de lecture ou **sur chaque marqueur** (whooshs et impacts sur les coupes), sur une piste audio libre ; la musique n'est jamais touchée |
| **Vidéos / images** (mov, mp4, webm, png, jpg…) | image, lecture | poser au-dessus de tes plans (vidéo seule), sur chaque marqueur, **utiliser comme overlay** (onglet Effets), importer |
| **LUTs** (.cube, .3dl, .look…) | **la LUT appliquée** au plan de test ou à ta vraie image (maintenir = avant) | calque de réglage Lumetri sur le clip (LUT chargée en *LUT d'entrée*), **installer dans Lumetri** |
| **Polices** (ttf, otf…) | ton texte dans la police | **installer la police** (dossier de polices de l'utilisateur) |
| **Titres** (.mogrt) | nom du modèle | poser à la tête de lecture, utiliser dans l'onglet Textes |
| **Presets** (.prfpset, exports RR FX…) | nom du preset | ajouter à Mes effets (exports RR FX), marche à suivre pour les autres |

Recherche (nom, dossier, type), filtres par type et par dossier, tri, favoris ★. Les vignettes se chargent au fil du
défilement. L'index est gardé (`Documents/RRFX/ressources-index.json`) et relu en arrière-plan au-delà d'une heure ;
**↻ Actualiser** le relit tout de suite. Un disque débranché garde son index (signalé dans la liste).

*Calque de réglage Lumetri* charge la LUT directement dans *Correction de base > LUT d'entrée* (si ta version de
Premiere refuse, le chemin est copié : *LUT d'entrée > Parcourir…*). Les LUT et polices **installées** apparaissent
dans les listes de Premiere après un redémarrage.

### Onglet Mes effets

- **Preset** : sur un effet, **＋ Preset** garde tes réglages (catégorie « Mes effets »).
- **Capture** : monte n'importe quel effet dans Premiere (sur un clip ou un calque de réglage, avec tes images clés,
  effets tiers compris), sélectionne-le dans la timeline et clique sur **Capturer la sélection**. Effets, valeurs et
  animations sont enregistrés ; tu le réappliques comme un effet intégré (durée réglable par étirement, miroir
  PRE/POST automatique).
- **Partager** (⇪ sur un effet, ou *Tout partager*) : un **code** `RRFX1:…` à envoyer en message ; la personne le
  colle dans **Coller un code…**. Aucun chemin de fichier ni info perso dans le code.
- **Importer / exporter** en `.json` pour sauvegarder tes effets.
- **Packs de style** (`.rrfxpack`) : *Créer un pack…* rassemble dans un seul fichier tes effets et rampes perso, tes
  looks (et celui en cours dans l'onglet Couleur), l'animation des textes et son modèle `.mogrt`, tes overlays
  importés (fichiers compris) et ton enchaînement d'effets. *Importer un pack…* (ou depuis l'onglet Ressources)
  ajoute tout en un clic, fichiers rangés dans `Documents/RRFX/Packs`. C'est un ZIP ordinaire.

### Bibliothèque en ligne (🌐 Communauté)

En haut de *Mes effets* : **Ma bibliothèque | 🌐 Communauté**. La communauté liste les effets publiés par tous les
utilisateurs de RR FX : recherche (nom, auteur, description), tri *les plus aimés* / *les plus récents*, filtre par
type, vignette animée. **Ajouter** range l'effet dans ta bibliothèque (il devient **Ouvrir**).

- **Publier** : bouton du haut, ou 🌐 sur un de tes effets. RR FX ouvre dans ton navigateur le formulaire « Partager
  un effet RR FX » déjà rempli (nom, description, code) : il reste à cliquer sur *Submit new issue* (compte GitHub
  gratuit). Si le code est trop long pour l'adresse, il est copié : colle-le dans le champ *Code RR FX*.
- **Aimer** : ❤ ouvre la page de l'effet, ajoute la réaction 👍. Le tri « les plus aimés » s'en sert.
- **Comment ça marche** : pas de serveur. Chaque effet publié est une *issue* du dépôt GitHub de RR FX, créée par le
  formulaire `.github/ISSUE_TEMPLATE/preset.yml` (étiquette `preset`). Le panneau lit les issues ouvertes par l'API
  publique de GitHub (sans compte, mise en cache 10 minutes). Le code ne contient que des réglages d'effets, jamais de
  chemin de fichier.
- **Modération** (propriétaire du dépôt) : fermer une issue la retire de la bibliothèque. Il faut que le dépôt soit
  **public** avec les *Issues* activées, et que le formulaire `preset.yml` soit sur la branche par défaut.

Tout est enregistré dans `Documents/RRFX/library.json`.

### Annuler la dernière opération

Le bouton **↶ Annuler (n)** de la ligne d'état retire ce que RR FX a posé lors de la dernière opération : les calques
de réglage, copies du plan et morceaux de rampe `RR FX · …`. Les 10 dernières opérations
sont mémorisées, même après avoir fermé Premiere. Un calque renommé ou un clip modifié entre-temps n'est pas touché.

**Tout effacer** (*Réglages > Nettoyage*, ou le menu du panneau) retire d'un coup tout ce que RR FX a posé dans la
séquence ou dans la zone sélectionnée (calques, copies, overlays, textes, sons `RR FX · …`), réactive les caméras
éteintes par le montage multicam et, au choix, retire les marqueurs RR FX. Tes clips ne sont pas supprimés.

### Suivi de l'opération

Pendant l'application, le bloc d'état montre que ça tourne (icône animée, temps écoulé), où on en est
(« 3/12 · Glitch POST »), une barre de progression et le temps restant. **Arrêter** (ou Échap) interrompt proprement
après la zone en cours. À la fin : **✓ vert**, **⚠ orange** (remarques dans le journal) ou **✕ rouge**, avec
**Voir le détail**. Au repos, la ligne d'état résume la séquence : cadence, clips sélectionnés, marqueurs.

### Recherche rapide

**Ctrl+K** (⌘K sur Mac), **/** ou 🔍 : tape quelques lettres pour trouver une action (montage express, couper les silences, temps forts,
conversion…), un onglet, un effet, un overlay, un look ou un style ; ↑ ↓ et Entrée pour lancer, Échap pour fermer.

### Sans cliquer : menu et raccourcis

Le menu du panneau (☰ en haut à droite du panneau) propose : montage express, recherche rapide, appliquer l'effet, appliquer la rampe, capturer,
poser les temps forts, synchroniser, convertir le LOG en Rec.709, annuler, tout effacer, mode réduit.

Quand le panneau RR FX est sélectionné (clique dedans), une touche suffit :

| Touche | Action |
| --- | --- |
| **A** | Appliquer l'effet choisi |
| **R** | Appliquer la rampe |
| **U** | Annuler la dernière opération |
| **C** | Capturer la sélection |
| **B** | Poser les marqueurs des temps forts |
| **S** | Synchroniser la sélection sur la musique |
| **L** | Convertir le LOG en Rec.709 (caméra enregistrée) |
| **E** | Lancer le montage express |
| **Échap** | Arrêter l'opération en cours |

Pour changer une touche : *Réglages > Raccourcis clavier*, clique sur la touche puis appuie sur la nouvelle
(Retour arrière pour n'en mettre aucune).

### Signal de fin, mode réduit, mises à jour

- Au-delà de 8 secondes (beaucoup de coupes, rampes), le bilan clignote et un petit son est joué (désactivable).
- **▴ Réduire** ne garde que le crédit, le bouton principal et l'état. **▾ Réglages** réaffiche tout.
- Au démarrage, RR FX vérifie sur GitHub (au plus toutes les 6 heures) si une nouvelle version est publiée et propose
  **Installer la mise à jour**, **Nouveautés** ou **Plus tard**. L'installation télécharge le pack, le vérifie en
  entier (ZIP intact, panneau complet, bon numéro de version), garde la version en place dans
  `Documents/RRFX/Sauvegarde du panneau`, puis remplace les fichiers ; si une écriture échoue, tout est remis comme
  avant. Il reste à redémarrer Premiere.

### Test de compatibilité

*Réglages > Test de compatibilité > Tester mon Premiere* : RR FX copie ta séquence, y essaie chaque fonction de
Premiere dont il se sert (calque de réglage, Lumetri et sa LUT d'entrée, insertion de piste, découpe, désactivation
d'un plan, marqueurs, export d'image, taille du cadre, recadrage automatique, modèles de texte), puis supprime la
copie. Chaque ligne dit à quoi elle sert ; **Copier le rapport** donne un texte à envoyer en cas de souci.

## Langue de Premiere et mises à jour de Premiere

Premiere cherche les effets par leur nom affiché, qui dépend de la langue. Au démarrage, RR FX lit la liste des
effets de ton Premiere et **détecte automatiquement le bon nom** (*Réglages > Effets Premiere utilisés* : ✓ ou ✕).
Chaque paramètre animé est aussi **vérifié par son nom** : si une version de Premiere réordonne les paramètres d'un
effet, RR FX retrouve le bon au lieu d'animer le mauvais. Au démarrage, il vérifie que les fonctions de Premiere dont
il a besoin existent toujours et affiche « Plugin à mettre à jour » dans le cas contraire.

Si un effet reste introuvable : *Réglages > Avancé*, *Lister les effets vidéo*, puis ajoute son nom exact, par ex.
`{"wave": {"names": ["Déformation de la vague"]}}`. *Analyser le clip sélectionné* liste les paramètres de chaque
effet avec leur numéro.

### Fonctions de Premiere à confirmer

Ces fonctions sont utilisées par RR FX mais peu documentées par Adobe ; elles sont testées sur une timeline
simulée, pas encore sur toutes les versions de Premiere. En cas de souci, le journal (*Voir le détail*) dit laquelle :

- `exportFramePNG` (aperçu sur la vraie image) ;
- `importMGT` et le remplacement du texte d'un `.mogrt` (onglet Textes) ;
- le numéro du **mode de fusion** dans l'Opacité (overlays : bouton *Apprendre* en secours) ;
- `createMarker` / `move` (marqueurs, synchro) ;
- l'import d'une **séquence d'images** (`importFiles` « images numérotées ») et `setOverrideFrameRate` (overlays
  fournis) ;
- `trackItem.disabled` (montage multicam) : si ta version ne le permet pas, RR FX le dit sans rien toucher ;
- l'ajout d'une piste audio par QE (son de la caméra de référence, SFX des Ressources) ;
- le dossier des LUT de l'utilisateur (`Adobe/Common/LUTs/Creative`) lu par Lumetri ;
- la copie de séquence (`clone`, `setSettings` pour la taille du cadre), l'effet **Recadrage automatique**
  ajouté par QE, et la désactivation temporaire des looks et titres pendant l'export des images d'analyse
  (`exportFramePNG`) ;
- la **LUT d'entrée de Lumetri** remplie par script (champ sans nom après *Correction de base*, connu depuis
  Premiere 23.4) et l'insertion d'une piste vidéo au milieu par QE (`addTracks`) : si Premiere refuse, le calque est
  posé quand même et le chemin de la LUT est copié ;
- le décodage du son **AAC** des MOV/MP4 dans le panneau : s'il échoue, exporte le son en WAV, ou utilise
  *Clip > Synchroniser* de Premiere ;
- la coupe des silences : la lame QE (`razor`) sur les pistes audio, `remove` puis `move` des morceaux suivants
  (le son lié qui suit son image est vérifié avant d'être décalé) ;
- la position d'un texte `.mogrt` par la *Trajectoire* du clip graphique (bandeau, sous-titres).

### Ancien nom (CutFX)

Si tu as installé une version de test nommée CutFX : l'installateur de RR FX retire l'ancien panneau, ta
bibliothèque (`Documents/CutFX/library.json`) est reprise au premier lancement, et les anciens codes de partage
`CUTFX1:` s'ouvrent toujours.

