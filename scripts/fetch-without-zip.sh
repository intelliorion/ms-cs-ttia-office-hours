#!/usr/bin/env bash
# Fetches every file of this repository one by one over raw.githubusercontent.com,
# for machines where "Download ZIP" is blocked but single files open in the browser.
# Usage: bash fetch-without-zip.sh [branch] [dest]
set -euo pipefail
branch="${1:-main}"; dest="${2:-ms-cs-ttia-office-hours}"
base="https://raw.githubusercontent.com/intelliorion/ms-cs-ttia-office-hours/$branch"
curl -fsSL "$base/MANIFEST.txt" | while IFS= read -r path; do
  [ -z "$path" ] && continue
  mkdir -p "$dest/$(dirname "$path")"
  echo "$path"
  curl -fsSL "$base/$path" -o "$dest/$path"
done
echo "Done. Next: cd $dest/cafe-app && npm install && npm run cafe -- start --workspace ~/cafe-workspace"
