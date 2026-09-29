#!/usr/bin/env bash
# Build both Copilot Studio packages from the skills in skills/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
echo "== GitHub Copilot harness agent =="; bash "$here/build-github-agent.sh"
echo; echo "== Standard agent =="; bash "$here/build-standard-agent.sh"
