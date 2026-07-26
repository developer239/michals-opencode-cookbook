#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SKILLS_SRC="$PROJECT_ROOT/src/skills"
COMMANDS_SRC="$PROJECT_ROOT/src/commands"
CONFIG_SRC="$PROJECT_ROOT/opencode.json"
AGENTS_SRC="$PROJECT_ROOT/AGENTS.md"

SKILLS_DEST="$HOME/.config/opencode/skills"
COMMANDS_DEST="$HOME/.config/opencode/commands"
CONFIG_DEST="$HOME/.config/opencode/opencode.json"
AGENTS_DEST="$HOME/.config/opencode/AGENTS.md"

if [ ! -f "$PROJECT_ROOT/dist/index.js" ]; then
  echo "dist/index.js not found - run 'pnpm run symlink:opencode' (which builds first) or 'pnpm run build'" >&2
  exit 1
fi

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

# Global instructions: OpenCode loads ~/.config/opencode/AGENTS.md in every
# session unless the project has its own AGENTS.md, the same role CLAUDE.md
# plays for Claude Code. An existing unmanaged real file is backed up with a
# timestamp, mirroring how this installer treats an existing opencode.json.
if [ -L "$AGENTS_DEST" ]; then
  rm "$AGENTS_DEST"
  echo "Removed stale symlink at $AGENTS_DEST"
elif [ -e "$AGENTS_DEST" ] && ! cmp -s "$AGENTS_SRC" "$AGENTS_DEST"; then
  AGENTS_BACKUP_PATH="$AGENTS_DEST.backup.$(date +%Y%m%d%H%M%S)"
  cp "$AGENTS_DEST" "$AGENTS_BACKUP_PATH"
  echo "Backed up existing global AGENTS.md to $AGENTS_BACKUP_PATH"
fi

cp "$AGENTS_SRC" "$AGENTS_DEST"
echo ""
echo "Copied AGENTS.md -> $AGENTS_DEST"

echo ""
echo "Done. Skills, commands, and global instructions are now available globally in OpenCode."

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
