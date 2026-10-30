#!/bin/sh
# Installe (ou met à jour) RR FX sur Mac depuis le Terminal, sans l'alerte de macOS
# « Apple n'a pas pu confirmer… » qui bloque les scripts téléchargés par le navigateur :
#
#   curl -fsSL https://raw.githubusercontent.com/RobinRahoual/RRFX/main/installer-mac.sh | sh
#
# Télécharge le pack de la dernière version publiée sur GitHub, puis lance son script
# d'installation (Installer RR FX (Mac).command), qui fait le reste.

set -e
REPO="RobinRahoual/RRFX"

echo "RR FX : recherche de la dernière version…"
# github.com/…/releases/latest redirige vers …/releases/tag/vX.Y.Z (sans limite d'appels, contrairement à l'API).
TAG=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest" | sed 's#.*/tag/##')
case "$TAG" in
  v[0-9]*) ;;
  *) echo "Impossible de trouver la dernière version (connexion à GitHub ?)."; exit 1 ;;
esac
VERSION=${TAG#v}
ZIP="RRFX-$VERSION-installation.zip"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/rrfx.XXXXXX")
trap 'rm -rf "$TMP"' EXIT INT TERM

echo "Téléchargement de RR FX $VERSION…"
curl -fL --progress-bar -o "$TMP/$ZIP" "https://github.com/$REPO/releases/download/$TAG/$ZIP"

if command -v ditto >/dev/null 2>&1; then
  ditto -x -k "$TMP/$ZIP" "$TMP/pack"
else
  unzip -q "$TMP/$ZIP" -d "$TMP/pack"
fi

SCRIPT=$(find "$TMP/pack" -name 'Installer RR FX (Mac).command' | head -1)
if [ -z "$SCRIPT" ]; then
  echo "Le pack téléchargé est incomplet. Réessaie dans un instant."
  exit 1
fi
echo
sh "$SCRIPT"
