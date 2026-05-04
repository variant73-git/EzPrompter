#!/usr/bin/env bash
# build-editor.sh — sync editor-core source into both shells.
#
# Targets:
#   packages/extension-shell/editor/        (Chrome extension, loaded by background.js)
#   packages/web-shell/public/editor-core/  (web canvas, served as static assets and
#                                            injected into node iframes by CanvasNode)
#
# Idempotent. Excludes transport/ (each shell brings its own transport).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/editor-core/src"
EXT_DST="$ROOT/packages/extension-shell/editor"
WEB_DST="$ROOT/packages/web-shell/public/editor-core"

mkdir -p "$EXT_DST" "$WEB_DST"

rsync -a --delete \
  --exclude 'transport/' \
  --exclude '*.ts' \
  "$SRC/" "$EXT_DST/"

rsync -a --delete \
  --exclude 'transport/' \
  --exclude '*.ts' \
  --exclude 'test-minimal.js' \
  "$SRC/" "$WEB_DST/"

echo "build:editor done"
echo "  ext: $EXT_DST"
echo "  web: $WEB_DST"
