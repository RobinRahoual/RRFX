#!/bin/sh
# Installe le panneau RR FX pour Premiere Pro : copie le dossier RRFX dans les
# extensions Adobe et autorise les extensions non signées.

cd "$(dirname "$0")" || exit 1
SRC="$PWD/RRFX"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/RRFX"

if [ ! -f "$SRC/CSXS/manifest.xml" ]; then
  echo "Le dossier RRFX est introuvable à côté de ce script."
  echo "Décompresse tout le pack avant de lancer l'installation."
  exit 1
fi

echo "Installation de RR FX dans :"
echo "  $DEST"
echo

for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null || true

if rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$SRC/." "$DEST/"; then
  xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
  echo "RR FX est installé. Redémarre Premiere Pro, puis : Fenêtre > Extensions > RR FX"
else
  echo
  echo "La copie a échoué. Ferme Premiere Pro puis relance ce script."
  echo "Si ça persiste, fais une capture de cette fenêtre et envoie-la à @robin.rahoual."
  exit 1
fi
