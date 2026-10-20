#!/usr/bin/env bash
# Writes MANIFEST.txt (every tracked file) for scripts/fetch-without-zip.*; run before committing.
cd "$(dirname "$0")/.." && git ls-files | grep -v '^MANIFEST.txt$' > MANIFEST.txt && echo "MANIFEST.txt: $(wc -l < MANIFEST.txt) files"
