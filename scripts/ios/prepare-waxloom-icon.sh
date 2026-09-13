#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ICON_DIR="$ROOT_DIR/apps/apple/Shared/Assets.xcassets/AppIcon.appiconset"
PPM_PATH="$ICON_DIR/WaxloomAppIcon.ppm"
PNG_PATH="$ICON_DIR/WaxloomAppIcon.png"

python3 "$ROOT_DIR/scripts/ios/generate-waxloom-icon.py" "$PPM_PATH"
sips --setProperty format png "$PPM_PATH" --out "$PNG_PATH" >/dev/null
rm -f "$PPM_PATH"

WIDTH="$(sips -g pixelWidth "$PNG_PATH" | awk '/pixelWidth/ {print $2}')"
HEIGHT="$(sips -g pixelHeight "$PNG_PATH" | awk '/pixelHeight/ {print $2}')"
if [[ "$WIDTH" != "1024" || "$HEIGHT" != "1024" ]]; then
  echo "Waxloom icon has invalid dimensions: ${WIDTH}x${HEIGHT}" >&2
  exit 1
fi

echo "Waxloom app icon ready: ${WIDTH}x${HEIGHT}"
