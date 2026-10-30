# RR FX : checklist de test dans Premiere Pro

Tout RR FX est testé automatiquement sur une timeline **simulée**. Cette checklist sert à vérifier
qu'il marche dans un **vrai** Premiere. Pour chaque ligne : fais l'action, regarde le résultat attendu,
coche. Si ce n'est pas le cas, note-le avec le modèle en bas de page.

🔴 = à tester en priorité (le premier passage de 45 min). Le reste peut venir ensuite.

---

## 0. Préparer le test (une fois)

**Les versions à couvrir** (au moins 2 au début) :
- [ ] Premiere Pro 2025 ou 2026, **Windows**
- [ ] Premiere Pro 2025 ou 2026, **Mac**
- [ ] Une version plus ancienne (2022 à 2024)
- [ ] Un Premiere en **anglais** (les noms d'effets et de transitions changent selon la langue)

**Un projet de test** « Test RR FX.prproj » avec :
- [ ] Une **interview** : 2 rushs de 2 à 5 min avec leur son, avec des blancs et des « euh »
- [ ] Une **musique** rythmée de 2 à 3 min
- [ ] Un rush filmé en **LOG** (S-Log3, V-Log, C-Log…) et un rush **iPhone**
- [ ] Un fichier **.srt** de l'interview (Premiere : *Texte > Transcription*, puis *Sous-titres > Exporter en fichier SRT*)
- [ ] Une **vidéo déjà montée**, en un seul fichier (une pub, un ancien rendu)
- [ ] Un **dossier de ressources** : 2 sons (whoosh, impact), 1 LUT .cube, 1 police .ttf, 1 overlay .mov
- [ ] Un **calque de réglage** dans le projet (*Fichier > Nouveau > Calque de réglage*)

**Pour remonter les problèmes**, garde sous la main :
- *Voir le détail* sous le message du panneau ;
- *Réglages > Plus > Journal* ;
- *Réglages > Plus > Test de compatibilité > Copier le rapport*.

---

## 1. 🔴 Installation et démarrage

- [ ] 🔴 L'installateur (Windows `.bat`, Mac `.command`) se termine sans erreur
- [ ] 🔴 *Fenêtre > Extensions > RR FX* ouvre le panneau, sans message rouge
- [ ] 🔴 Premier lancement : choix de la langue, puis l'accueil. Instagram ne s'ouvre **que** si tu cliques sur « Suivre »
- [ ] 🔴 *Réglages > Plus > Test de compatibilité* : tout est vert. Sinon, copie le rapport
- [ ] La ligne d'état montre la séquence ouverte, sa cadence et les clips sélectionnés, et se met à jour quand tu changes de sélection
- [ ] Fermer et rouvrir Premiere : le panneau revient sur le dernier onglet, avec tes réglages
- [ ] Panneau en anglais (*Réglages > Langue*) : tout le panneau passe en anglais, messages compris

## 2. 🔴 Navigation et fenêtres

- [ ] 🔴 Les onglets tiennent sur une ligne. **Montage** ouvre Effets · Rampe · Musique · Premiere ; **📚** ouvre Ressources · Mes effets
- [ ] 🔴 ▦ *Fenêtres* : décocher un outil le masque, décocher un onglet le retire de la barre
- [ ] Espaces de travail : *Essentiel*, *Interview et YouTube*, *Réseaux sociaux*, *Clip et événement*, puis *Tout*
- [ ] « Enregistrer cet espace… » : l'espace revient après avoir redémarré Premiere
- [ ] Ctrl+K sur un outil masqué : il se réaffiche et le panneau y va
- [ ] Mode réduit (*▴ Réduire*), puis thème clair de Premiere : tout reste lisible

## 3. 🔴 Express

- [ ] 🔴 Style **Reels dynamique**, avec la musique dans la séquence : chaque étape est cochée verte dans le compte rendu
- [ ] 🔴 Dans la timeline : marqueurs des temps forts, rushs montés, calque de couleur, effets et sons sur les coupes, copie 9:16 créée
- [ ] 🔴 *↶ Annuler* plusieurs fois : chaque étape part, l'une après l'autre, et la timeline revient comme avant
- [ ] Style **Interview / témoignage**, sans musique : silences coupés sur une copie, sous-titres, bandeau, copie 9:16 sur fond flou
- [ ] « 2. Avant de lancer » signale bien ce qui manque (pas de musique, pas de .srt…)

## 4. Montage › Effets et Rampe

- [ ] 🔴 Un effet (Zoom in) sur **la coupe** : calque « RR FX · … » au-dessus, effet visible à la lecture
- [ ] 🔴 L'effet est modifiable dans *Options d'effet* (images clés présentes)
- [ ] Le même effet sur **toutes les coupes**, puis sur **les marqueurs**, puis sur **chaque temps fort**
- [ ] Avec un **son** (whoosh) : il tombe pile sur la coupe
- [ ] **Zoom visage** sur un plan d'interview : le zoom suit les yeux
- [ ] 🔴 Zoom visage sur un visage **de profil**, de **trois quarts** et **en faible lumière** : le visage est trouvé (détection YuNet). Le panneau reste fluide pendant l'analyse
- [ ] Le journal ne dit pas « Détection précise des visages indisponible » (sinon, copie la ligne)
- [ ] **Zoom suivi (objet)** : entoure un objet, le zoom le suit pendant le plan
- [ ] **Overlay** (Leak chaud) : posé en mode de fusion, avec un fondu
- [ ] **Enchaînement** de 3 effets (Maj + clic) sur les temps forts
- [ ] **Capturer la sélection** sur un plan avec un effet tiers : il apparaît dans Mes effets et se repose ailleurs
- [ ] 🔴 **Rampe** sur une coupe : la vitesse change, **la coupe et le son restent à leur place**
- [ ] *↶ Annuler* retire chaque effet et chaque rampe

## 5. Montage › Musique

- [ ] 🔴 Analyse de la musique, puis *Poser les marqueurs des temps forts* : les marqueurs tombent sur les kicks
- [ ] Montage auto des rushs sélectionnés (panneau Projet) sur le rythme
- [ ] Synchro **playback** (son de caméra et musique) : l'image se cale sur la musique
- [ ] Synchro **multicam** (2 caméras) puis multicam sur le rythme : une caméra par temps fort
- [ ] Risers avant les drops, réverb de fin : les sons sont posés aux bons endroits
- [ ] 🔴 **Musique à la durée** : la musique finit avec la vidéo, la coupe ne s'entend pas
- [ ] Crédits musique et sons : la liste est juste, *Copier la liste* marche

## 6. 🔴 Montage › Premiere (outils natifs)

C'est la partie la plus à risque : elle passe par des fonctions de Premiere peu documentées.

- [ ] 🔴 *Poser les transitions* (Fondu enchaîné, 12 images, toutes les coupes) : un vrai *Fondu enchaîné* de Premiere sur chaque coupe
- [ ] 🔴 La même chose dans un Premiere **anglais** (Cross Dissolve) et dans ta langue
- [ ] 🔴 *↶ Annuler* retire les transitions. Si elles restent, note-le : c'est l'info qui me manque
- [ ] Fondu au noir, Fondu au blanc, Fondu enchaîné (film), Morph Cut sur un jump cut d'interview
- [ ] **Fondus audio anti-clic** après une coupe des silences : plus de clic à l'écoute
- [ ] Position *Avant*, *Centrée*, *Après* : la transition se place comme prévu
- [ ] **Changements de plan** sur la vidéo déjà montée : marqueurs, puis coupes (Ctrl+Z dans Premiere pour revenir)
- [ ] **Sous-titres de Premiere** : une piste de sous-titres apparaît, modifiable dans le panneau Texte, au bon timing

## 7. Parole

- [ ] 🔴 *Analyser* puis *Couper les silences* : une **copie** « … (sans silences) » est créée, image et son toujours synchro
- [ ] 🔴 L'original n'a pas bougé
- [ ] « Euh » et répétitions : marqués, puis coupés sur une copie
- [ ] 🔴 **Montage par le texte** : barrer 2 phrases, *Couper les phrases barrées* : elles disparaissent, le reste est synchro
- [ ] Zoom visage un plan sur deux après la coupe des silences
- [ ] 🔴 Sous-titres depuis le .srt : textes animés au bon moment, mot par mot, mots clés en couleur
- [ ] Après une coupe des silences, les sous-titres sont **recalés** sur le nouveau montage
- [ ] Bandeau nom et fonction : animé, en bas à gauche
- [ ] 🔴 *Égaliser la voix* : vérifie avec le *Loudness Radar* de Premiere, autour de -14 LUFS, jamais au-dessus de -1 dB
- [ ] Musique sous la voix : la musique baisse quand on parle
- [ ] Respirations et clics : baissés, rien n'est coupé
- [ ] Chapitres YouTube : la liste « 00:00 Titre » est juste
- [ ] Traduction (MyMemory) : le .srt traduit garde les timings
- [ ] 🔴 **J-cut / L-cut** : le son passe avant ou après l'image ; *↶ Annuler* remet les coupes droites
- [ ] Coupes sur les blancs : plus aucun mot coupé en deux
- [ ] Correcteur de sous-titres : *Tout corriger* puis *Poser les sous-titres*
- [ ] Plans de coupe sur les mots clés : le plan apparaît quand le mot est dit

### Transcription (Whisper)

- [ ] 🔴 Installer whisper.cpp (Mac : `brew install whisper-cpp` ; Windows : `whisper-bin-x64.zip` de GitHub décompressé dans `Documents/RRFX/Outils`). *Parole › Transcrire* le trouve tout seul
- [ ] 🔴 *Télécharger le modèle* (Base, 148 Mo) : la barre avance, « modèle prêt »
- [ ] 🔴 Transcrire 2 plans d'interview : le .srt apparaît dans *Sous-titres*, une phrase par sous-titre, au bon moment dans la séquence
- [ ] Le texte est juste en français (et en anglais avec *Langue : English*)
- [ ] *Couper les « euh »* après la transcription : les « euh » et les répétitions tombent au mot près
- [ ] Extraits pour les réseaux et chapitres YouTube après la transcription : plus justes qu'avant
- [ ] Sans Whisper installé : un message clair dit comment l'installer
- [ ] Modèle *Small* : plus juste, plus lent (note le temps pour 5 min de son)

## 8. Couleur

- [ ] 🔴 Ajouter ta caméra LOG avec la LUT du fabricant, *Convertir* : calque Lumetri avec la LUT chargée, image correcte
- [ ] La même chose avec la LUT **calculée** par RR FX
- [ ] Deux caméras dans la séquence : chaque rush reçoit la bonne LUT (reconnaissance de la caméra)
- [ ] Expo et balance auto : les plans trop sombres ou trop bleus sont corrigés
- [ ] Raccord iPhone sur le boîtier, puis raccord sur une **image de film**
- [ ] 🔴 Un look (Clip musical) *Appliquer* : le calque Lumetri ressemble à l'aperçu
- [ ] Export LUT .cube (relue dans Premiere) et DCTL (relue dans DaVinci Resolve si tu l'as)
- [ ] Mes LUTs : import d'un dossier, vignettes sur ta vraie image, double-clic pose la LUT
- [ ] Dégradé de couleur : posé en mode de fusion, réglable

## 9. Textes

- [ ] 🔴 Exporter un titre de Premiere en modèle (.mogrt), le choisir, poser des paroles sur les temps forts
- [ ] Style de texte : police, couleur, contour appliqués dans Premiere
- [ ] Mes couleurs : import d'un nuancier .ase
- [ ] Barre de progression et compte à rebours

## 10. Formats et livraison

- [ ] 🔴 Copie **9:16** en recadrage auto : séquence 1080×1920, sujet suivi
- [ ] 9:16 **qui suit le visage**, puis **sur fond flou**
- [ ] Extraits pour les réseaux : les passages trouvés sont bons, une séquence par extrait
- [ ] 🔴 Vérifier avant export : un média hors ligne et un trou dans la timeline sont bien signalés
- [ ] 🔴 **Plusieurs séquences › Export** : 2 séquences cochées partent dans Media Encoder, fichiers bien nommés dans le bon dossier
- [ ] Plusieurs séquences › une autre action (look, vérification) sur 2 séquences
- [ ] Rythme du montage : graphique juste, *Marquer les plans longs*
- [ ] Versions de la séquence, et nouveau projet depuis un modèle

## 11. 📚 Bibliothèque

- [ ] Lier le dossier de ressources : sons, LUT, police, overlay classés
- [ ] Écouter un son, poser un whoosh sur chaque coupe, installer la police (visible dans Premiere après redémarrage)
- [ ] Import depuis un lien direct (.mp4), puis depuis YouTube (avec yt-dlp installé)
- [ ] Dossier surveillé : un fichier copié dans le dossier arrive tout seul dans le chutier (en 1 min)
- [ ] 🔴 Ranger le projet puis *↶ Annuler* : tout revient à sa place
- [ ] Renommer en série puis *↶ Annuler*
- [ ] 🔴 Proxies : Media Encoder les fabrique, ils s'attachent, le bouton active ou désactive les proxies
- [ ] 🔴 Archiver le projet : le dossier contient les médias utilisés et le projet ; le projet copié s'ouvre et retrouve ses médias
- [ ] Mes effets : export, import, pack de style, code de partage

## 12. Réglages et flux de travail

- [ ] Macro « Interview prête » de bout en bout
- [ ] Un raccourci clavier personnalisé
- [ ] Télécommande : l'adresse copiée, ouverte dans un navigateur, lance l'action
- [ ] Synchro entre ordinateurs (dossier Dropbox ou iCloud) : un look créé sur un ordinateur arrive sur l'autre
- [ ] 🔴 Historique 🕘 : annuler une opération **ancienne** sans toucher aux récentes
- [ ] Tout effacer (séquence) : tout ce que RR FX a posé disparaît, rien d'autre
- [ ] Temps passé par projet : les minutes avancent quand tu montes, l'export CSV s'ouvre dans Excel

## 13. Cas limites

- [ ] Aucune séquence ouverte, puis une séquence vide : messages clairs, pas d'erreur rouge
- [ ] Séquences en 23,976, 29,97 (drop frame) et 50 i/s : coupes et effets tombent sur les bonnes images
- [ ] Séquence verticale 1080×1920 de départ
- [ ] Noms de fichiers avec accents et espaces, projet dans OneDrive (Windows)
- [ ] Un long projet (1 h de rushs) : silences, euh et extraits ne bloquent pas Premiere ; *Arrêter* marche
- [ ] Une opération lancée, puis Ctrl+Z dans Premiere : rien ne casse dans le panneau
- [ ] Mise à jour en un clic (quand une nouvelle version sort) : installée, Premiere redémarré, réglages gardés

## 14. Outils gratuits et IA locale (2.9)

**Installation** (*Réglages › Outils gratuits*) :
- [ ] 🔴 *Installer* ffmpeg : la carte passe à « ✓ installé », le fichier est dans `Documents/RRFX/Outils/ffmpeg`
- [ ] 🔴 *Installer* Ollama, puis *Télécharger les modèles choisis* : les trois modèles passent à « ✓ prêt »
- [ ] Un outil Python (Demucs ou Piper) : Python est trouvé, ou installé (Windows) / son installateur s'ouvre (Mac)
- [ ] Sur Mac : un outil installé se lance sans alerte « développeur non identifié » (sinon, note-le)
- [ ] Une fonction dont l'outil manque propose « Installer maintenant », puis continue toute seule
- [ ] *Arrêter* pendant un téléchargement : rien de cassé, l'installation peut reprendre

**Parole** :
- [ ] 🔴 *Couper les silences* avec « Détecter la voix par l'IA » : sur une interview avec musique de fond, les blancs sont justes (compare en décochant)
- [ ] 🔴 *Podcast* : 2 caméras + 2 micros, la caméra suit celui qui parle, aucun plan trop court ; ↶ Annuler réactive tout
- [ ] *Podcast* avec 3 caméras : la 3e sert de plan large quand on parle à deux
- [ ] *Podcast* « Un seul (IA) » sur un seul micro : les voix sont reconnues (sherpa-onnx)
- [ ] 🔴 *Débruiter la voix* : la voix propre est posée, le son d'origine coupé ; ↶ Annuler remet tout
- [ ] *Voix off témoin* : la voix est posée à la tête de lecture, en français et en anglais
- [ ] *Publier* : titres, description et hashtags cohérents avec ce qui est dit
- [ ] *Traduire* avec « IA locale (Ollama) » : même nombre de sous-titres, mêmes timings
- [ ] *Correcteur › Corriger les fautes (IA locale)* : fautes corrigées, rien de reformulé
- [ ] *Chapitres* avec « Titres écrits par l'IA locale » : un vrai titre par chapitre

**Musique, formats, bibliothèque** :
- [ ] 🔴 *Séparer les pistes* (Voix / reste) sur un rush avec musique : la voix seule est posée et calée
- [ ] *Séparer* en 4 pistes, puis *Temps forts sur la batterie* : les marqueurs tombent sur la batterie
- [ ] *Détection › IA : chaque temps* (Beat This!) puis *premier temps de chaque mesure*
- [ ] *Extraits* avec « Choisis par l'IA locale » : les extraits ont une accroche, et tiennent seuls
- [ ] 🔴 *Recherche › Décrire les rushs* sur 10 rushs, puis une recherche en mots : le bon rush arrive en premier
- [ ] *Poser les plans de coupe* sur une interview transcrite : des rushs cohérents avec les phrases
- [ ] *Agrandir un plan* ×2 sur un plan 720p : la copie agrandie est posée au-dessus

**Textes et rampe** :
- [ ] 🔴 *Texte derrière le sujet* sur un plan de 5 s : copie transparente au-dessus, un titre glissé entre les deux passe derrière la personne
- [ ] *Ralenti fluide* ×4 sur un plan court : pas de saccade ; sans carte graphique compatible, le calcul passe sur le processeur
- [ ] Un fichier MXF ou Opus (son illisible avant) : le son est lu grâce à ffmpeg

## 15. IA image et son (2.10)

**Installation** :
- [ ] 🔴 *Installer* « SAM 2 + Depth Anything » : torch et transformers s'installent dans `Documents/RRFX/Outils/python`, la carte passe à « ✓ installé »
- [ ] *Installer* VoiceFixer, puis CLAP : CLAP va dans son propre environnement (`python-clap`), sans casser les autres outils Python
- [ ] Premier usage de SAM 2, Depth Anything et CLAP : le modèle se télécharge (Hugging Face), puis la suite tourne sans Internet

**Image** :
- [ ] 🔴 *Masque › Suivre un objet* « Flouter l'objet » sur un visage qui bouge : le visage reste flouté jusqu'au bout (10 s)
- [ ] *Masque* « Flouter autour » puis « Isoler (transparent) » : un titre glissé sous la copie isolée passe derrière l'objet
- [ ] *Masque* en « Précise » : plus lent, contour plus juste ; *Arrêter* en cours : rien de posé, rien de cassé
- [ ] 🔴 *Portrait › Flouter l'arrière-plan* sur une interview : le sujet net, le fond flou, sans pompage d'une image à l'autre
- [ ] *Portrait* avec « Très près » puis « Plus loin » : la zone nette change bien
- [ ] 🔴 *Grain › Débruiter l'image* « Normale » sur un plan de nuit : grain enlevé, détails gardés ; « Légère » est nettement plus rapide
- [ ] *Texte derrière le sujet* avec « Précis, cheveux fins (BiRefNet) » : les cheveux sont mieux détourés qu'en « Rapide »

**Son** :
- [ ] 🔴 *Débruiter la voix › Voix studio* sur une voix qui résonne ou au téléphone : voix pleine, posée, l'original coupé
- [ ] *Voix studio* « Très abîmée » sur un son saturé : mieux qu'en « Normale »
- [ ] 🔴 *Sons IA › Écouter mes sons* sur un dossier de bruitages lié : tous écoutés ; relancé : seuls les nouveaux sons
- [ ] Recherche « whoosh » puis « foule qui applaudit » : les bons sons en tête ; *Écouter* joue le son, *Poser* le met à la tête de lecture
- [ ] Recherche en français avec Ollama installé : « Cherché en anglais » s'affiche ; sans Ollama, la recherche marche quand même

---

## Remonter un problème

Copie ce modèle dans une [issue GitHub](https://github.com/RobinRahoual/RRFX/issues) ou un message :

```
Outil : (ex. Montage › Premiere › Poser les transitions)
Premiere : (version, Windows ou Mac, langue de Premiere)
Ce que j'ai fait :
Ce qui devait se passer :
Ce qui s'est passé :
Message du panneau (« Voir le détail ») :
Journal (Réglages > Plus > Journal) : les dernières lignes
Rapport du test de compatibilité : (Copier le rapport)
```
