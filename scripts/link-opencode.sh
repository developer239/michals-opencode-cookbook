#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SKILLS_SRC="$PROJECT_ROOT/src/skills"
COMMANDS_SRC="$PROJECT_ROOT/src/commands"
CONFIG_SRC="$PROJECT_ROOT/opencode.json"
ROOT_AGENTS_SRC="$PROJECT_ROOT/AGENTS.md"
ENV_FILE="$PROJECT_ROOT/.env"

SKILLS_DEST="$HOME/.config/opencode/skills"
COMMANDS_DEST="$HOME/.config/opencode/commands"
CONFIG_DEST="$HOME/.config/opencode/opencode.json"

if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "dist/index.js not found - run 'pnpm run symlink:opencode' (which builds first) or 'pnpm run build'" >&2
  exit 1
fi

read_env_value() {
  local key="$1"

  if [ ! -f "$ENV_FILE" ]; then
    return 0
  fi

  python3 - "$ENV_FILE" "$key" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
key = sys.argv[2]

for raw_line in env_path.read_text(encoding='utf-8').splitlines():
    line = raw_line.strip()
    if not line or line.startswith('#') or '=' not in line:
        continue

    env_key, env_value = line.split('=', 1)
    if env_key.strip() != key:
        continue

    value = env_value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]

    print(value)
    break
PY
}

trim_whitespace() {
  local value="$1"

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  printf '%s' "$value"
}

get_agents_symlink_paths() {
  local configured_paths="${AGENTS_SYMLINK_PATHS:-}"

  if [ -n "$configured_paths" ]; then
    printf '%s' "$configured_paths"
    return 0
  fi

  read_env_value 'AGENTS_SYMLINK_PATHS'
}

get_agents_symlink_scan_roots() {
  local scan_roots="${AGENTS_SYMLINK_SCAN_ROOTS:-}"

  if [ -n "$scan_roots" ]; then
    printf '%s' "$scan_roots"
    return 0
  fi

  read_env_value 'AGENTS_SYMLINK_SCAN_ROOTS'
}

cleanup_project_agents() {
  local scan_roots="$1"
  local configured_paths="$2"

  if [ -z "$scan_roots" ]; then
    return 0
  fi

  echo ""
  echo "Cleaning unmanaged AGENTS.md symlinks from configured scan roots"

  python3 - "$scan_roots" "$configured_paths" <<'PY'
from pathlib import Path
import sys

scan_roots = [Path(part.strip()) for part in sys.argv[1].split(':') if part.strip()]
configured_paths = [Path(part.strip()) for part in sys.argv[2].split(':') if part.strip()]
configured_destinations = {path / 'AGENTS.md' for path in configured_paths}

for scan_root in scan_roots:
    if not scan_root.is_dir():
        print(f'  Skipping missing scan root: {scan_root}')
        continue

    for child in sorted(scan_root.iterdir()):
        if not child.is_dir():
            continue

        agents_path = child / 'AGENTS.md'
        if not agents_path.is_symlink():
            continue

        if agents_path in configured_destinations:
            continue

        agents_path.unlink()
        print(f'  Removed {agents_path}')
PY
}

link_project_agents() {
  local configured_paths="$1"

  if [ ! -f "$ROOT_AGENTS_SRC" ]; then
    echo "Root AGENTS.md not found at $ROOT_AGENTS_SRC - skipping project AGENTS.md links"
    return 0
  fi

  if [ -z "$configured_paths" ]; then
    echo "No AGENTS_SYMLINK_PATHS configured - skipping project AGENTS.md links"
    return 0
  fi

  echo ""
  echo "Linking root AGENTS.md into configured repositories"

  IFS=':' read -r -a repo_paths <<< "$configured_paths"
  for raw_repo_path in "${repo_paths[@]}"; do
    local repo_path
    repo_path="$(trim_whitespace "$raw_repo_path")"

    if [ -z "$repo_path" ]; then
      continue
    fi

    if [ ! -d "$repo_path" ]; then
      echo "  Skipping missing repository: $repo_path"
      continue
    fi

    ln -snf "$ROOT_AGENTS_SRC" "$repo_path/AGENTS.md"
    echo "  $repo_path/AGENTS.md"
  done
}

mkdir -p "$SKILLS_DEST" "$COMMANDS_DEST"

echo "Cleaning previous installs (symlinks AND copies) ..."

# Remove every previously installed skill/command, regardless of whether they
# were symlinks (legacy install method) or real files (current install method).
# This avoids stale files surviving across renames/deletions in the source tree.
find "$COMMANDS_DEST" -maxdepth 1 -mindepth 1 \( -type l -o -type f \) -delete
find "$SKILLS_DEST" -maxdepth 1 -mindepth 1 -type l -delete
find "$SKILLS_DEST" -maxdepth 1 -mindepth 1 -type d -exec rm -rf {} +

# Copy (not symlink) so containers bind-mounting ~/.config/opencode/ see real
# files instead of dangling host-path symlinks. Real files cost a few hundred
# KB of duplication; the container experience parity is worth it.

echo "Copying skills from $SKILLS_SRC → $SKILLS_DEST"
for d in "$SKILLS_SRC"/*/; do
  cp -R "$d" "$SKILLS_DEST/$(basename "$d")"
  echo "  $(basename "$d")"
done

echo ""
echo "Copying commands from $COMMANDS_SRC → $COMMANDS_DEST"
for f in "$COMMANDS_SRC"/*.md; do
  [ -f "$f" ] || continue
  cp "$f" "$COMMANDS_DEST/$(basename "$f")"
  echo "  $(basename "$f")"
done

echo ""
echo "Done. Skills and commands are now available globally in OpenCode."

AGENTS_SYMLINK_PATHS_CONFIGURED="$(get_agents_symlink_paths)"
AGENTS_SYMLINK_SCAN_ROOTS_CONFIGURED="$(get_agents_symlink_scan_roots)"
cleanup_project_agents "$AGENTS_SYMLINK_SCAN_ROOTS_CONFIGURED" "$AGENTS_SYMLINK_PATHS_CONFIGURED"
link_project_agents "$AGENTS_SYMLINK_PATHS_CONFIGURED"

if [ -f "$CONFIG_SRC" ]; then
  if [ -L "$CONFIG_DEST" ]; then
    rm "$CONFIG_DEST"
    echo "Removed stale symlink at $CONFIG_DEST"
  elif [ -e "$CONFIG_DEST" ]; then
    BACKUP_PATH="$CONFIG_DEST.backup.$(date +%Y%m%d%H%M%S)"
    cp "$CONFIG_DEST" "$BACKUP_PATH"
    echo "Backed up existing global opencode.json to $BACKUP_PATH"
  fi

  DIST_PLUGIN_PATH="file://$PROJECT_ROOT/dist/index.js"

  python3 - "$CONFIG_SRC" "$CONFIG_DEST" "$DIST_PLUGIN_PATH" <<'PYJSON'
import json
import os
import sys

src_path, dest_path, plugin_path = sys.argv[1:4]

with open(src_path, 'r', encoding='utf-8') as src_file:
  config = json.load(src_file)

config['plugin'] = [plugin_path]

os.makedirs(os.path.dirname(dest_path), exist_ok=True)
with open(dest_path, 'w', encoding='utf-8') as dest_file:
  json.dump(config, dest_file, indent=2)
  dest_file.write('\n')
PYJSON

  echo "Copied opencode.json -> $CONFIG_DEST"
  echo "Configured plugin path: $DIST_PLUGIN_PATH"
fi
