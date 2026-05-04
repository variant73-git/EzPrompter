#!/usr/bin/env bash
# build-extension.sh — sync editor-core source into extension-shell/editor for Chrome loading.
# Idempotent: safe to run repeatedly. Excludes transport/ (extension uses ChromeTransport from shell).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/packages/editor-core/src"
DST="$ROOT/packages/extension-shell/editor"

mkdir -p "$DST"

rsync -a --delete \
  --exclude 'transport/' \
  --exclude '*.ts' \
  "$SRC/" "$DST/"

echo "build:ext done — $DST"
