#!/usr/bin/env bash
# Validate each skill against the Copilot Studio / Agent Skills rules and zip it
# for upload (Build > Skills > Upload a skill).
# Output: copilot-studio-github-agent/upload/<skill>.zip
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dist="$root/copilot-studio-github-agent/upload"
mkdir -p "$dist" && rm -f "$dist"/*.zip
fail=0

err() { echo "  ✗ $*"; fail=1; }

# The value-report skill ships its own copy of the chat layout (each zip is
# standalone). One source: the intake skill's references/.
mkdir -p "$root/skills/ms-cs-ttia-value-report/references"
cp "$root/skills/ms-cs-ttia-office-hours/references/value-story-chat.md" \
   "$root/skills/ms-cs-ttia-value-report/references/value-story-chat.md"

for dir in "$root"/skills/*/; do
  skill="$(basename "$dir")"
  file="$dir/SKILL.md"
  echo "$skill"

  [[ -f "$file" ]] || { err "missing SKILL.md"; continue; }
  [[ "$(head -1 "$file")" == "---" ]] || err "SKILL.md must start with YAML front matter"

  front="$(awk 'NR==1{next} /^---$/{exit} {print}' "$file")"
  name="$(printf '%s\n' "$front" | sed -n 's/^name:[[:space:]]*//p')"
  desc="$(printf '%s\n' "$front" | awk '/^description:/{f=1;next} /^[a-z_-]+:/{f=0} f' | sed 's/^[[:space:]]*//' | tr '\n' ' ' | sed 's/[[:space:]]*$//')"

  [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || err "name '$name': lowercase letters, numbers, hyphens; no leading/trailing hyphen"
  (( ${#name} <= 64 )) || err "name longer than 64 characters"
  [[ "$name" == "$skill" ]] || err "name '$name' does not match folder '$skill'"
  [[ -n "$desc" ]] || err "description is empty"
  (( ${#desc} <= 1024 )) || err "description is ${#desc} characters (max 1024)"

  # Every references/... path mentioned in the instructions must ship in the bundle.
  while read -r ref; do
    [[ -f "$dir/$ref" ]] || err "mentions $ref but the file is missing"
  done < <(grep -o 'references/[A-Za-z0-9_.-]*\.md' "$file" | sort -u)

  # Leftovers from the Claude Code version that mean nothing in Copilot Studio.
  if grep -nE 'MODE-B-value-report\.md|\.html\b|no CDN|Proactively invoke' "$file"; then
    err "Claude Code-specific wording left in SKILL.md"
  fi

  echo "  name ${#name} chars · description ${#desc} chars · SKILL.md $(wc -c < "$file" | tr -d ' ') bytes"
  (cd "$dir" && zip -qrX "$dist/$skill.zip" . -x '*.DS_Store')  # SKILL.md at the archive root
  echo "  → copilot-studio-github-agent/upload/$skill.zip"
done

instr="$root/copilot-studio-github-agent/agent-instructions.md"
n=$(wc -m < "$instr" | tr -d ' ')
echo "github agent instructions: $n characters (Copilot Studio limit 8000)"
(( n <= 8000 )) || { echo "  ✗ over the 8000-character Instructions limit"; fail=1; }

exit $fail
