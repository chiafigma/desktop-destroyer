#!/usr/bin/env bash
# Normalizes the 9 weapon PNGs into two derived sets.
#
#   assets/icons/    256x256 uniform canvas, content trimmed + centered, longest
#                    edge scaled to ICON_FIT. Drop-in tiles for the 3x3 menu grid.
#   assets/cursors/  tight-trimmed, longest edge scaled to CURSOR_FIT, no padding.
#                    The canvas-following weapon node needs true content bounds so
#                    the per-weapon hotspot offset in weapons.ts stays meaningful.
#
# Source of truth is assets/icons-src/ — never written to. Re-runnable.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC=assets/icons-src
ICON_FIT=224      # content box inside the 256 tile, leaves 16px breathing room
ICON_CANVAS=256
CURSOR_FIT=160

command -v magick >/dev/null || { echo "needs ImageMagick (brew install imagemagick)" >&2; exit 1; }

rm -rf assets/icons assets/cursors
mkdir -p assets/icons assets/cursors

MANIFEST=assets/cursors/metrics.json
echo '{' > "$MANIFEST"
first=1

for f in "$SRC"/*.png; do
  name=$(basename "$f" .png)

  # -trim uses alpha>0 so soft shadows and antialiased edges survive the crop.
  magick "$f" -trim +repage \
    -resize "${ICON_FIT}x${ICON_FIT}" \
    -background none -gravity center -extent "${ICON_CANVAS}x${ICON_CANVAS}" \
    "assets/icons/${name}.png"

  magick "$f" -trim +repage \
    -resize "${CURSOR_FIT}x${CURSOR_FIT}" \
    "assets/cursors/${name}.png"

  # trailing newline matters: read exits non-zero on EOF and set -e would kill us
  read -r w h < <(magick identify -format "%w %h\n" "assets/cursors/${name}.png")
  # Hotspot defaults to the content centre; tune per weapon (hammer head, muzzle)
  # once we can see it tracking on canvas.
  [ $first -eq 0 ] && echo ',' >> "$MANIFEST"
  first=0
  printf '  "%s": { "w": %d, "h": %d, "hotspot": { "x": %d, "y": %d } }' \
    "$name" "$w" "$h" "$((w / 2))" "$((h / 2))" >> "$MANIFEST"
done

printf '\n}\n' >> "$MANIFEST"

echo "icons:"
magick identify -format "  %f %wx%h\n" 'assets/icons/*.png'
echo "cursors:"
magick identify -format "  %f %wx%h\n" 'assets/cursors/*.png'
