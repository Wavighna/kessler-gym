#!/usr/bin/env bash
# Optional local preview helper; not part of the website's runtime.
set -euo pipefail

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIRECTORY="$(cd -- "${SCRIPT_DIRECTORY}/.." && pwd)"
PREVIEW_PORT="${1:-8000}"

if [[ ! "${PREVIEW_PORT}" =~ ^[0-9]+$ ]] || (( ${#PREVIEW_PORT} > 5 )); then
  printf 'Usage: bash extras/preview.sh [port between 1 and 65535]\n' >&2
  exit 2
fi
# Explicit base 10 also accepts a port supplied with leading zeroes.
PREVIEW_PORT=$((10#${PREVIEW_PORT}))
if (( PREVIEW_PORT < 1 || PREVIEW_PORT > 65535 )); then
  printf 'Port must be between 1 and 65535.\n' >&2
  exit 2
fi

if command -v python3 >/dev/null 2>&1; then
  PREVIEW_PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  PREVIEW_PYTHON="python"
else
  printf 'Install Python 3 to use this optional preview helper.\n' >&2
  exit 1
fi

cd -- "${PROJECT_DIRECTORY}"
printf 'Kessler preview: http://127.0.0.1:%s\n' "${PREVIEW_PORT}"
exec "${PREVIEW_PYTHON}" -m http.server "${PREVIEW_PORT}" --bind 127.0.0.1
