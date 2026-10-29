# RR FX : contrat panneau ↔ Premiere

Généré par `node scripts/host-api.js` depuis `src/host/` : ne pas modifier à la main.

**67 fonctions.**

Le panneau (HTML/JS) ne parle à Premiere que par `Host.call(nom, objet)` → `{ ok: true, … }` ou
`{ ok: false, error }`. Toutes les fonctions ci-dessous sont dans `plugin/jsx/host.jsx` (ExtendScript, CEP).
Pour passer à UXP, il suffit de refaire ces fonctions avec l'API UXP de Premiere (mêmes noms, mêmes
objets en entrée et en sortie) : le reste du panneau ne change pas, et `tests/sim.js` décrit le
comportement attendu de chacune.

## Contexte, cibles, application des effets, capture, marqueurs, tout effacer (`02-effets.jsx`)

| Fonction | Rôle |
|---|---|
| `compat` | What this Premiere offers. Required = without it nothing works. |
| `markerList` | Les marqueurs de la séquence, la tête de lecture et la plage sélectionnée (secondes). |
| `addMarkers` | Pose des marqueurs aux temps donnes (secondes de sequence), nommes " RR FX . ... ". |
| `clearAll` | Retire tout ce que RR FX a posé (calques « RR FX · … », copies, marqueurs) sur la séquence ou la sélection. |
| `getContext` | La séquence active : nom, id, cadence, taille, plans sélectionnés, marqueurs, nom du projet. |
| `resolve` | Les cibles d'un effet : la coupe, les coupes, les marqueurs, les plans entiers (selon le placement). |
| `apply` | Pose les effets compilés (images clés) sur les calques de réglage ou les plans visés. → ce qu'il faut pour annuler. |
| `undo` | Annule une opération RR FX à partir de ce qu'elle a posé (calques, effets, coupes, volumes, transitions…). |
| `capture` | Lit les effets et images clés du plan sélectionné (effets tiers compris) pour les réutiliser. |
| `diagnose` | Diagnostic du plan sélectionné : ses effets et leurs paramètres (journal). |
| `listEffects` | Noms des effets vidéo de ce Premiere (dans sa langue), pour retrouver ceux qu'utilise RR FX. |
| `adjustmentInfo` | Le calque de réglage du projet (celui que RR FX duplique), retrouvé tout seul. |
| `adjustmentFromSelection` | Le calque de réglage choisi dans le panneau Projet devient celui de RR FX. |

## Musique : rushs, decoupe sur le rythme, synchronisation, multicam, apercu (`03-musique.jsx`)

| Fonction | Rôle |
|---|---|
| `musicInfo` | La musique : le clip son selectionne, sinon le plus long clip son de la sequence. |
| `projectRushes` | Rushs selectionnes dans le panneau Projet, avec leur plage utile (points d'entree/sortie). |
| `placeRushes` | Montage auto : pose les rushs l'un après l'autre aux temps donnés (un plan tous les N temps). |
| `cutAtTimes` | Coupe les plans sélectionnés aux temps donnés (marqueurs, temps forts). |
| `multicamSwitch` | Multicam sur le rythme : une caméra active différente entre chaque temps fort. |
| `syncInfo` | Les plans à synchroniser (son de caméra et son externe / musique), avec leurs fichiers. |
| `moveClips` | moves : [{ track, start (s), name, delta (s) }] - clips de la timeline, avec leur son lie. |
| `grabFrames` | Exporte des images de la séquence (aperçus sur la vraie image). |

## Textes animes (MOGRT) (`04-textes.jsx`)

| Fonction | Rôle |
|---|---|
| `placeTitle` | Un texte : modele .mogrt pose de start a end (s), texte remplace, animation (fx) ajoutee. |

## Lumetri, conversion LOG -> Rec.709 (`05-couleur.jsx`)

| Fonction | Rôle |
|---|---|
| `logConvert` | Conversion LOG -> Rec.709 d'une seule camera. o.scope : 'sequence' (un calque du premier au dernier rush) ou 'selection' (un calque par groupe de rushs choisis). |
| `placeGrades` | Pose des calques Lumetri d'etalonnage. o.layer : 'conversion', 'auto' ou 'match' ; o.groups : [{ name, lutPath, spans: [{ a, b, top }] }] (ticks ; top = piste du plan). Chaque calque va juste au-dessus des rushs de sa zone (et des calques d'etalonnage d'un niveau inferieur) : une piste est inseree si besoin, pour rester sous les looks. |
| `rushList` | Les plans de la sequence pour le panneau (camera, analyse) : chemin du media, piste, bornes. o.scope : 'sequence' ou 'selection'. |
| `framesBegin` | Images « propres » de la timeline pour l'analyse : a chaque instant, les looks, titres, overlays et calques au-dessus sont desactives (on garde les rushs et les etalonnages de niveau < o.level). Premiere ecrit les images apres coup : le panneau attend les fichiers puis appelle framesEnd pour tout reactiver. |
| `framesEnd` | Réactive ce que framesBegin avait désactivé, une fois les images analysées. |
| `setPlayhead` | Tete de lecture a o.t (secondes). |

## Formats 9:16, 4:5, 1:1 (`06-formats.jsx`)

| Fonction | Rôle |
|---|---|
| `formatCopy` | Copie de la séquence en 9:16, 4:5 ou 1:1 : recadrage auto, suivi du visage ou fond flou. |

## Parole (silences) et son (voix, musique) (`07-parole-son.jsx`)

| Fonction | Rôle |
|---|---|
| `speechInfo` | Les plans parlés sélectionnés, avec leurs fichiers et leurs points d'entrée (silences, euh, voix). |
| `cutSilences` | Retire les silences (o.ranges, secondes de sequence) des plans selectionnes : coupe a la lame sur leurs pistes (image et son), supprime les morceaux muets et recolle la suite. o.copy : sur une copie de la sequence (l'original reste intact). |
| `duckMusic` | Musique qui baisse sous la voix : o.track, o.start (s, debut du clip de musique), o.keys [[s de sequence, gain dB]]. La courbe de volume existante est remplacee. |
| `voiceLevel` | Voix : o.clips [{ track, start (s), gain (dB) }] ; o.denoise : noms possibles de l'effet de reduction du bruit (ajoute a chaque clip), ou rien. |

## Test de compatibilite (`08-compat.jsx`)

| Fonction | Rôle |
|---|---|
| `selfTest` | Essaie, sur une copie jetable de la sequence active, chaque fonction de Premiere peu documentee dont RR FX se sert, puis supprime la copie. o.lutPath : petite LUT de test ; o.folder, o.prefix : image exportee (le panneau verifie qu'elle arrive). |

## Ressources (dossiers lies) et overlays (`09-ressources.jsx`)

| Fonction | Rôle |
|---|---|
| `placeAsset` | Pose une ressource du disque a chaque instant de o.times (s) : video (sans son, au-dessus de tout), image (o.imageDur s), son (piste audio libre) ou modele de titre .mogrt. Les elements gardent leur nom : " Tout effacer " ne les retire pas, ? Annuler oui. |
| `importAssets` | Importe des fichiers du disque dans le chutier " RR FX Ressources " (sans rien poser). |
| `readBlend` | Mode de fusion de l'Opacite du clip selectionne (pour l'apprendre une fois). |

## Speed ramps (`10-rampes.jsx`)

| Fonction | Rôle |
|---|---|
| `rampResolve` | Le passage visé par une speed ramp (avant, après, autour de la coupe), avec sa marge de média. |
| `rampApply` | La rampe est posee sur une copie du passage, en morceaux de vitesse constante (Premiere ne laisse pas les scripts piloter le remappage temporel). Le clip d'origine, son son et la coupe ne bougent pas ; chaque morceau s'appelle " RR FX . Rampe " et l'annulation du panneau les retire. |

## Sequences : volume, extraits, verification, plans de coupe, modeles (`11-sequences.jsx`)

| Fonction | Rôle |
|---|---|
| `gainKeys` | Volume d'un son anime par images cles o.keys [[temps sequence (s), dB par rapport au niveau actuel]] : respirations et clics baisses, bruitages... Annulable (niveau d'avant remis). |
| `listSequences` | Toutes les sequences du projet (pour les traiter en lot). |
| `openSequence` | Ouvre une séquence du projet par son id (plusieurs séquences, versions). |
| `extractCopy` | Extrait [o.a, o.b] (s) dans une copie de la sequence, recolle au debut : toutes les pistes. |
| `preflight` | Verification avant export : medias hors ligne, images noires, clips desactives, pistes coupees, volume pousse, textes RR FX hors zone sure. -> { issues: [{ level, t, where, text }] } |
| `placeStills` | Images fixes posees les unes apres les autres sur une meme piste libre : o.items [{ path, t (s), dur (s) }], o.minTrack. Compte a rebours, barre de progression... |
| `newFromTemplate` | Nouvelle sequence pour un modele de projet : depuis les rushs selectionnes dans le panneau Projet (sinon vide, aux reglages de la sequence active), au format o.width x o.height, avec un calque de reglage sur toute la duree si o.adj. -> { name, id, clips, adjPlaced } |

## Projet : chutiers, rangement, versions, musique a la duree, proxies (`12-projet.jsx`)

| Fonction | Rôle |
|---|---|
| `importToBin` | Fichiers d'un dossier surveille importes dans un chutier (ceux deja dans le projet sont passes). |
| `tidyProject` | Rangement : elements en vrac a la racine ranges par type ; o.unused : medias jamais poses ranges a part (rien n'est supprime). o.dry : le plan seulement. o.names : noms des chutiers. |
| `renameItems` | Renommage en serie des elements selectionnes dans le panneau Projet (o.names : nouveaux noms, dans l'ordre de o.ids) ; o.dry : renvoie la selection. Les anciens noms servent a annuler. |
| `versionSequence` | Version de la sequence active : copie figee rangee dans le chutier Versions ; on continue sur la sequence d'origine. |
| `fitMusic` | Musique raccourcie : o.plan -> infos ; sinon retire [o.a, o.b] (s) de la musique, recolle la suite, et coupe ce qui depasse o.trim. Seuls les morceaux de la musique bougent. |
| `activityPing` | Activite dans Premiere (temps passe) : projet ouvert et signature de ce qui bouge. |
| `proxyPresets` | Preglages de proxy fournis avec Premiere (Settings/IngestPresets/Proxy). |
| `makeProxies` | Proxies des rushs selectionnes (o.all : tous les rushs video du projet) dans o.dir avec le preglage o.preset ; Media Encoder les fabrique, RR FX les attache a la fin de chaque job. |
| `proxyStatus` | Avancement : jobs termines et proxies attaches. |
| `setProxies` | Proxies actives ou non dans les moniteurs (comme le bouton " Activer les proxies "). |
| `deleteSequence` | Version d'une sequence supprimee (jamais la sequence ouverte). |

## Raccords J/L-cut, coupes, credits, export en lot, archive (`13-raccords-livraison.jsx`)

| Fonction | Rôle |
|---|---|
| `splitEdits` | J-cut (le son du plan suivant arrive avant son image) ou L-cut (le son du plan precedent continue sur le suivant), de o.frames images, sur chaque coupe de la selection. |
| `cutList` | Coupes de la selection, avec ce qu'il faut pour ecouter les deux cotes. |
| `rollEdits` | Déplace des coupes (image et son ensemble) : coupes recalées sur les blancs. |
| `audioCredits` | Musiques et sons de la sequence, regroupes par fichier (credits, droits). |
| `exportPresets` | Preglages d'export (Media Encoder) fournis avec Premiere. |
| `exportQueue` | Sequences cochees envoyees a Media Encoder, un fichier chacune (o.items : [{ id, file }]). |
| `usedMedia` | Medias poses dans au moins une sequence (archive) : chemins uniques et projet. |

## Outils de Premiere : transitions, changements de plan, sous-titres (`14-natifs.jsx`)

| Fonction | Rôle |
|---|---|
| `nativeTransitions` | Transitions de Premiere sur les coupes : o.video (cle de VIDEO_TRANSITIONS ou ''), o.audio (cle de AUDIO_TRANSITIONS ou ''), o.frames, o.scope ('sequence' ou 'selection'), o.align (0 : apres la coupe, 0.5 : centree, 1 : avant). |
| `sceneEdits` | Detection des changements de plan de Premiere sur la selection : des coupes ou des marqueurs a chaque changement de plan (un rendu, une video telechargee, un ancien montage). |
| `nativeCaptions` | Sous-titres de Premiere : le .srt (deja corrige, traduit, recale par RR FX) devient une piste de sous-titres native, modifiable dans le panneau Texte de Premiere. |

