#!/usr/bin/env bash
# Build the Copilot Studio package from the skills in skills/.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
echo "== GitHub Copilot harness agent =="; bash "$here/build-github-agent.sh"
