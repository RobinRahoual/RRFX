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
- [ ] Thème clair de Premiere : tout reste lisible

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

## 16. Glisser-déposer, double-clic, calque automatique, couleur (2.11)

- [ ] 🔴 *Effets* : **double-clic** sur une vignette : l'effet est posé à la tête de lecture (calque `RR FX · …`), le réglage *Position* ne change pas
- [ ] 🔴 *Effets* : **glisser une vignette sur une piste** de la timeline : l'effet est posé à l'endroit lâché, sur cette piste ; le petit fichier transparent n'apparaît ni dans la timeline ni dans le panneau Projet
- [ ] Pendant une installation d'outils (Réglages › Outils gratuits) : glisser et double-cliquer un effet marche, l'avancement de l'installation reste affiché dans la section des outils
- [ ] Glisser une vignette dans le panneau Projet : message « Lâche l'effet sur une piste », le fichier glissé est retiré du projet
- [ ] 🔴 *Réglages › Calques › Choisir un projet modèle…* (un petit projet avec seulement un calque de réglage) ; dans un projet **sans** calque de réglage, *Appliquer* : le calque est importé tout seul, l'effet est posé
- [ ] 🔴 *Colorimétrie* sans clip sélectionné : réglages grisés, message, bouton *Appliquer* inactif ; sélectionne un plan : tout se réactive (en 2 s)
- [ ] *Colorimétrie* : *Régler toute la séquence* dans le message déverrouille sans sélection
- [ ] 🔴 *Textes › Dégradé sur un texte ou une forme* : un texte sélectionné, *Appliquer le dégradé* : seules les lettres prennent le dégradé ; sans sélection : message « Aucun texte sélectionné »
- [ ] *Colorimétrie* : un plan sélectionné pendant un téléchargement d'outil ou de modèle : les réglages se dégrisent
- [ ] *Réglages › Outils gratuits* : coche 2 outils (ou *Tout cocher*), *Installer la sélection* : ils s'installent l'un après l'autre, le bilan liste les échecs éventuels ; *Arrêter* au milieu : rien de cassé
- [ ] *Désinstaller* un outil (fichier, Python, et Ollama lancé) : il repasse à « non installé », ses fichiers ont disparu de Documents/RRFX/Outils
- [ ] Installateur Windows et Mac : le message final indique le dossier des extensions Adobe ; supprimer ensuite le dossier téléchargé ne retire pas RR FX


## 17. Plusieurs actions à la fois (2.12)

- [ ] 🔴 Lance un téléchargement long (outil ou modèle) puis applique un effet : l'effet est posé tout de suite, le téléchargement continue sur sa ligne sous le bloc d'état
- [ ] 🔴 Pendant une transcription ou un traitement IA (Débruiter, Séparer…) : appliquer un look, couper les silences, poser un texte marchent
- [ ] *Arrêter* sur la ligne d'une tâche n'arrête que celle-là ; *Arrêter* du bloc d'état n'arrête que la tâche qu'il montre
- [ ] Une tâche qui finit pendant qu'une autre tourne : son résultat apparaît sur une ligne quelques secondes et dans le journal
- [ ] *Annuler* (↶) et l'historique restent utilisables pendant une tâche
- [ ] L'onglet s'appelle *Colorimétrie* (en anglais : *Color grading*)


## 18. Démarrage et affichage (2.13)

- [ ] 🔴 Ferme puis relance Premiere : RR FX s'ouvre tout seul ; décoche *Réglages › Démarrage et affichage › Ouvrir RR FX au lancement de Premiere*, relance : il ne s'ouvre plus (Fenêtre › Extensions › RR FX le rouvre)
- [ ] 🔴 Premier lancement (réglages effacés) : langue, accueil, Instagram s'ouvre une fois, puis la fenêtre « Équipe RR FX » propose les outils (tous cochés) ; *Installer la sélection* les installe pendant que tu montes
- [ ] Masque un outil (▦ Fenêtres) puis redémarre Premiere : il reste masqué, sans rien avoir enregistré (*Mon espace*)
- [ ] *Réinitialiser l'affichage* : tous les onglets et outils réapparaissent
- [ ] Le bouton *Réduire* n'existe plus en haut du panneau
- [ ] 🔴 Dans un projet **avec** un calque de réglage : `Documents/RRFX/Modele calque de reglage.prproj` apparaît (journal : « gardé comme modèle »), aucune séquence en plus dans le projet
- [ ] 🔴 Puis dans un **nouveau projet vide** : glisser un effet sur la timeline : le calque de réglage est ajouté tout seul, l'effet posé dessus (`RR FX · …`)


## 19. Colorimétrie en direct (2.14)

- [ ] 🔴 Un plan sélectionné, bouge *Exposition* puis relâche : le plan change dans Premiere en moins d'une seconde ; « ● En direct sur 1 plan »
- [ ] 🔴 Clique sur un look, puis modifie la courbe : chaque changement arrive dans Premiere ; *Options d'effet* : un seul Lumetri sur le plan
- [ ] Deux plans sélectionnés : les deux changent ; ↶ Annuler retire le Lumetri ajouté
- [ ] Aucun calque de réglage posé pour un plan ; *Toute la séquence* : un calque de réglage
- [ ] *Exporter › En direct* décoché : plus rien ne part tant qu'on ne clique pas sur *Appliquer*
- [ ] 🔴 Glisse *Exposition* sans relâcher : l'image change dans Premiere pendant le glissement
- [ ] Double-clic sur un curseur (piste ou nom) : il revient à sa valeur par défaut, et Premiere aussi
- [ ] Le look reste après fermeture et réouverture du projet (la LUT est dans Documents/RRFX/Looks/En direct)


## 20. Annuler, courbe, animation de texte capturée (2.15)

- [ ] 🔴 *Colorimétrie* : monte l'exposition, clique dans le panneau puis Ctrl+Z (Cmd+Z) : l'exposition revient, Premiere aussi ; Ctrl+Maj+Z la rétablit
- [ ] Ctrl+Z dans un autre onglet du panneau : Premiere annule sa dernière action
- [ ] 🔴 *Courbe des tonalités* (paramétrique) : clique sur la courbe à gauche et glisse vers le haut : les ombres montent, l'image suit
- [ ] 🔴 *Textes › Capturer depuis la timeline* sur un texte animé à la main (entrée et sortie) : l'animation est enregistrée (★) ; pose d'autres textes avec : même entrée et même sortie, sur des durées différentes
- [ ] Une animation capturée dans *Parole › Sous-titres* ou *Bandeau* : rejouée pareil

## 21. Préréglages gérés, styles de texte capturés, image exportée (2.16)

- [ ] 🔴 *Réglages › Tester mon Premiere* (surtout sur Windows) : « Exporter une image de la timeline » ✓
- [ ] *Colorimétrie › Égaliser les rushs* ou *Aperçu réel* (Effets) : les images de la timeline arrivent
- [ ] 🔴 *Textes › Style du texte › Capturer depuis la timeline* sur un texte stylé à la main (police, couleur, contour, ombre portée) : le style est enregistré (★ ◎)
- [ ] 🔴 Sélectionne 2 autres textes, *Appliquer aux textes sélectionnés* : police, couleurs, contour et ombre suivent, le texte ne change pas ; recommencer ne double pas l'ombre portée
- [ ] Pose des textes avec ce style capturé (Textes, Sous-titres) : le style est appliqué
- [ ] 🔴 *Gérer…* à côté de l'animation : masquer une intégrée (elle quitte le menu), renommer une des tiennes, la supprimer puis la restaurer depuis la corbeille, *Tout remettre*
- [ ] *Onglet Effets* : *Masquer* un effet intégré, puis *Remettre* sous la grille ; ⟳ sur un preset le met à jour
- [ ] *Mes effets* : supprimer un élément → *Corbeille* le restaure ; *Remettre les intégrés masqués*

## 22. Textes de la timeline (2.17)

- [ ] 🔴 Sélectionne 2 textes faits avec l'outil Texte, animation *Pop*, *Appliquer aux textes sélectionnés* : chacun entre et sort à sa place, sur sa propre durée
- [ ] 🔴 Même chose sur des textes `.mogrt` posés en bas à gauche : ils restent en bas à gauche
- [ ] Appliquer ensuite *Glissement* : l'animation est remplacée (un seul effet Transformer, plus de flou gaussien)
- [ ] Animation capturée (★) appliquée à la sélection : rejouée sur chaque texte
- [ ] 🔴 Style *Reels jaune* sur un `.mogrt` à réglages : police, couleur et contour changent, le texte reste le même
- [ ] Style sur un texte de l'outil Texte : couleur par Teinte, ombre portée ; message pour la police
- [ ] *Analyser le texte sélectionné* : rapport lisible, *Copier le rapport* marche
- [ ] *Créer des textes (paroles)* : poser des paroles marche toujours (et depuis Express)

## 23. Import par lien rangé dans le projet (2.18)

- [ ] 🔴 Projet enregistré, *Importer depuis un lien* en 🎬 Vidéo (yt-dlp) : le fichier arrive dans `<dossier du projet>/assets/VIDEOS`, chutier *assets › VIDEOS*, posé à la tête de lecture
- [ ] 🔴 Même chose en 🎵 Son : `assets/SFX`, chutier *assets › SFX*
- [ ] Un lien direct .mp3 : `assets/SFX` aussi
- [ ] Nouveau projet jamais enregistré : `Documents/RRFX/Téléchargements` et message pour enregistrer le projet

## 24. Dossier assets rangé tout seul (2.19)

- [ ] 🔴 Import par lien d'une musique (🎵, plus de 45 s) : `assets/MUSIQUE`, chutier *assets › MUSIQUE* ; un bruitage court : `assets/SFX`
- [ ] Voix off (Parole) : `assets/VOIX/Voix off` ; détourage d'un plan : `assets/VIDEOS/Détourages`
- [ ] Effet avec whoosh : `assets/SFX/RRFX Whoosh.wav`, chutier *assets › SFX*
- [ ] 🔴 Dépose en vrac dans `assets` une vidéo, une image, un .srt et une musique, *Ressources › Ranger le dossier assets* : chacun dans son dossier
- [ ] 🔴 Un fichier en vrac déjà importé dans le projet : déplacé et toujours en ligne dans Premiere (relié)
- [ ] Option *Ranger aussi ce que je dépose* : un fichier déposé se range dans les 20 s
- [ ] *Ouvrir le dossier* ouvre `assets` dans l'Explorateur / le Finder

## 25. Corrections de l'audit (novembre 2026)

Corrigé et couvert par les tests automatiques, mais certaines corrections reposent sur le comportement de
Premiere : à confirmer ici. ⚠ = hypothèse sur Premiere à vérifier en priorité.

**Premiere 2021 (CEP 10, Node 12.3)** :
- [ ] 🔴 Le panneau s'affiche normalement (mise en page, fenêtres de confirmation, avant/après des LUT)
- [ ] 🔴 Mise à jour en un clic : installée sans erreur, `Documents/RRFX/Sauvegarde du panneau` remplacée
- [ ] 🔴 Un téléchargement d'outil en cours + un effet appliqué : *Arrêter* sur la ligne du téléchargement n'arrête que lui, Échap n'arrête que l'effet
- [ ] Réinstaller un outil déjà installé (ffmpeg) : pas d'erreur de dossier existant

**Script Premiere** :
- [ ] 🔴 ⚠ Effet en *copie du plan* sur un plan ralenti à 50 % puis accéléré à 200 % : l'animation tient toute sa durée (les images clés suivent la vitesse du plan)
- [ ] ⚠ *Capturer la sélection* sur un plan à vitesse modifiée : l'animation reposée ailleurs a la même durée
- [ ] 🔴 Deux rushs qui portent le même nom (C0001.MP4 de deux cartes) : un effet en copie sur chacun montre la bonne image
- [ ] Effets en copie sur des coupes de deux pistes (V1 et V2) : chaque copie est au-dessus de son plan, visible
- [ ] ⚠ Timeline affichée en images (*Affichage* > images, ou pieds+images) : couper les silences, poser les transitions et les temps forts coupent au bon endroit (29,97 et 25 i/s)
- [ ] Barre de progression et compte à rebours « à la fin » : ils trouvent la fin de la séquence
- [ ] *Vérifier avant export* sur un montage auto (*RR FX · Montage*) : pas de fausse « image noire »
- [ ] *Égaliser la voix* avec *Réduire le bruit de fond*, puis ↶ Annuler : le volume et l'effet DeNoise partent
- [ ] Ré-animer un texte qui avait déjà une animation, puis ↶ Annuler : l'ancienne animation revient (ou le journal dit qu'elle n'a pas pu être remise)
- [ ] Rampe refusée par Premiere : aucun morceau orphelin ne reste dans la timeline
- [ ] Premiere en japonais, coréen, russe ou chinois : le calque de réglage et le volume sont trouvés
- [ ] Son seul (WAV d'un micro) : J-cut / L-cut et pose d'un son des Ressources gardent la bonne durée

**Colorimétrie** :
- [ ] 🔴 Sélectionne le calque *RR FX · Conversion*, bouge *Exposition* : la LUT de conversion LOG reste, un Lumetri « en direct » s'ajoute
- [ ] 🔴 Un rush coupé en deux morceaux : étalonne le premier, puis le second : le premier garde son réglage
- [ ] Bouge un curseur puis clique tout de suite sur un autre plan : le second plan ne reçoit pas le réglage du premier
- [ ] Panneau en anglais, *Expo et balance auto* sur des plans déjà justes : aucun calque *RR FX · Auto* inutile
- [ ] Relancer *Expo et balance auto* tout décoché : les anciens calques Auto partent
- [ ] Une LUT .cube exportée de DaVinci Resolve avec un *shaper* 1D : aperçu et vignette justes
- [ ] *Zoom suivi (objet)* sur 3 plans : l'objet est suivi dans chacun (ou un message dit qu'il n'est pas retrouvé)
- [ ] *Expo et balance auto* pendant une copie 9:16 qui suit le visage : les deux finissent sans erreur d'images

**Parole et textes** :
- [ ] 🔴 Couper les « euh » puis poser les sous-titres : ils tombent au bon moment jusqu'à la fin de la vidéo
- [ ] 🔴 Coupe des silences sur une copie, retour à la séquence d'origine, poser les sous-titres : ils ne sont pas décalés
- [ ] *Respirations et clics* sur un plan caméra en V2 avec son son en A1 : le son de ce plan est baissé, pas la musique
- [ ] Parole > Poser les sous-titres sans jamais avoir ouvert l'onglet Textes : le modèle de texte est trouvé
- [ ] Montage par le texte après une coupe des silences : ce sont bien les phrases barrées qui partent
- [ ] Chapitres YouTube avec un premier marqueur à 5 s : il devient 00:00 avec son titre
- [ ] « Nous nous sommes vus » transcrit : rien n'est coupé par *Couper les « euh »*
- [ ] Téléchargement du modèle Whisper coupé (Wi-Fi) : message clair, pas de modèle « prêt » abîmé
- [ ] *Tout corriger* sur un sous-titre avec une adresse (https://…) et une heure (12:30) : rien n'est cassé
- [ ] Panneau en anglais : un message d'erreur venant de Premiere (sélection vide, transition introuvable) s'affiche en anglais

**Outils, import, ressources** :
- [ ] 🔴 Import YouTube avec yt-dlp installé par RR FX (pas dans le PATH) : l'import marche
- [ ] Deux liens Google Drive importés l'un après l'autre : deux fichiers distincts, le premier n'est pas remplacé
- [ ] Projet dans un dossier avec `%` dans le nom : l'import yt-dlp marche
- [ ] Désinstaller *SAM 2 + Depth Anything* : Demucs, VoiceFixer et rembg marchent encore
- [ ] Deux .prproj dans le même dossier, *Ranger le dossier assets* : RR FX demande confirmation en nommant l'autre projet
- [ ] Dossier surveillé : un gros fichier en cours de copie arrive une fois la copie finie
- [ ] Archive arrêtée en cours : le bilan dit « Archive incomplète », le LISEZMOI aussi
- [ ] Un pack `.rrfxpack` ou un code de partage abîmé : message clair, rien d'écrit hors de `Documents/RRFX/Packs`

**Panneau** :
- [ ] 🔴 Documents sur OneDrive, fichiers « à la demande » hors ligne : au démarrage, message « library.json n'a pas pu être lu », et ta bibliothèque n'est pas vidée
- [ ] 🔴 Synchro : nouvel ordinateur relié au dossier de synchro : il reprend les réglages de l'autre, et l'autre garde les siens (macros, raccourcis, favoris)
- [ ] Clavier AZERTY (Windows) : la touche A applique l'effet, Q ne fait rien
- [ ] *Tout effacer ?* : Tab jusqu'à *Garder* puis Entrée : rien n'est effacé
- [ ] Échap dans un champ de saisie pendant une tâche : la tâche continue
- [ ] *Tout effacer (séquence)* sur la séquence B : les opérations de la séquence A restent annulables
- [ ] Double clic sur *Lancer* (Express) : un seul montage express
- [ ] Musique calme sans temps forts, Express *Reels dynamique* : arrêt après « temps forts », rien posé sur d'anciens marqueurs

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
