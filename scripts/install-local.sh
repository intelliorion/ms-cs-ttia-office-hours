#!/usr/bin/env bash
# Install the skills for local coding agents so the same source of truth runs in
# Claude Code, GitHub Copilot (VS Code agent mode) and GitHub Copilot CLI.
#
#   bash scripts/install-local.sh            # symlink into every agent dir
#   bash scripts/install-local.sh --copy     # copy instead of symlink
#   bash scripts/install-local.sh --claude   # only ~/.claude/skills
#   bash scripts/install-local.sh --copilot  # only ~/.copilot/skills and ~/.agents/skills
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
mode=link; targets=()
for a in "$@"; do
  case "$a" in
    --copy) mode=copy ;;
    --claude) targets+=("$HOME/.claude/skills") ;;
    --copilot) targets+=("$HOME/.copilot/skills" "$HOME/.agents/skills") ;;
    *) echo "unknown option $a"; exit 2 ;;
  esac
done
[[ ${#targets[@]} -eq 0 ]] && targets=("$HOME/.claude/skills" "$HOME/.copilot/skills" "$HOME/.agents/skills")

for t in "${targets[@]}"; do
  mkdir -p "$t"
  for dir in "$root"/skills/*/; do
    name="$(basename "$dir")"
    dest="$t/$name"
    # Replace only a previous install of this same skill (a symlink, or a copy
    # containing SKILL.md); leave anything else alone.
    if [[ -L "$dest" ]]; then rm "$dest"
    elif [[ -d "$dest" && -f "$dest/SKILL.md" ]]; then rm -r "$dest"
    elif [[ -e "$dest" ]]; then echo "skip  $dest exists and is not a skill"; continue
    fi
    if [[ $mode == copy ]]; then cp -R "$dir" "$dest"; else ln -s "${dir%/}" "$dest"; fi
    echo "$mode  $dest"
  done
done
echo
echo "Claude Code: skills are picked up on the next session."
echo "VS Code Copilot agent mode reads ~/.copilot/skills; Copilot CLI also reads ~/.agents/skills."
