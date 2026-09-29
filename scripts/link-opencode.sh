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

# shellcheck source=compaction-policy.sh
source "$SCRIPT_DIR/compaction-policy.sh"

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

  if ! command -v opencode >/dev/null 2>&1; then
    echo "opencode CLI not found on PATH - it resolves the model windows the compaction policy needs" >&2
    exit 1
  fi

  # Each model's own window, as OpenCode resolves it for the signed-in
  # providers (a subscription login can narrow the catalogue's window), with
  # no global config loaded so an earlier install's overrides do not count.
  MODELS_FILE="$(mktemp)"
  EMPTY_CONFIG_HOME="$(mktemp -d)"
  trap 'rm -rf "$MODELS_FILE" "$EMPTY_CONFIG_HOME"' EXIT
  (cd "$EMPTY_CONFIG_HOME" && XDG_CONFIG_HOME="$EMPTY_CONFIG_HOME" opencode models --verbose --pure) > "$MODELS_FILE"

  python3 - "$CONFIG_SRC" "$CONFIG_DEST" "$DIST_PLUGIN_PATH" "$MODELS_FILE" "${COMPACT_AT_TOKENS_BY_PROVIDER[@]}" <<'PYJSON'
import json
import os
import re
import sys

src_path, dest_path, plugin_path, models_path = sys.argv[1:5]

compact_at_by_provider = {}
for entry in sys.argv[5:]:
  provider, _, value = entry.partition('=')
  if provider == '' or not (value == 'max' or value.isdigit()):
    sys.exit(f'compaction policy entry must be <provider>=<tokens|max>, got: {entry}')
  compact_at_by_provider[provider] = value if value == 'max' else int(value)

with open(src_path, 'r', encoding='utf-8') as src_file:
  config = json.load(src_file)

config['plugin'] = [plugin_path]

# `opencode models --verbose` prints each model as a "<provider>/<model>" line
# followed by its JSON.
with open(models_path, 'r', encoding='utf-8') as models_file:
  blocks = re.split(r'^(\S+/\S+)\n', models_file.read(), flags=re.M)
models = {blocks[i]: json.loads(blocks[i + 1]) for i in range(1, len(blocks), 2)}
if not models:
  sys.exit('opencode models --verbose listed no models; cannot apply the compaction policy')

reserved = config.get('compaction', {}).get('reserved')
if not isinstance(reserved, int):
  sys.exit('opencode.json must set compaction.reserved; the compaction policy is computed from it')

# A model compacts once its tokens reach limit.input - reserved (limit.context
# minus its output budget when it declares no input limit). A limit set in
# opencode.json is a measured window that replaces the resolved one, for a
# model whose login serves a different window than OpenCode reports. Only a
# window larger than the policy's is lowered to it; a smaller one is never
# raised, since the real window is what the provider enforces. A provider
# listed as max, or not listed at all, is never lowered.
for provider_id in sorted({model_ref.split('/', 1)[0] for model_ref in models}):
  compact_at = compact_at_by_provider.get(provider_id)
  if compact_at is None:
    print(f'  compact  {provider_id}/* at each model\'s own window (provider not in the compaction policy)')
  elif compact_at == 'max':
    print(f'  compact  {provider_id}/* at each model\'s own window (policy: max)')
  else:
    print(f'  compact  {provider_id}/* at {compact_at} tokens, or its own window when smaller (policy)')
for model_ref, model in sorted(models.items()):
  provider_id, model_id = model_ref.split('/', 1)
  model_config = config.get('provider', {}).get(provider_id, {}).get('models', {}).get(model_id, {})
  limit = model_config.get('limit', model['limit'])
  window = limit.get('input', limit['context'])
  compact_at = compact_at_by_provider.get(provider_id, 'max')
  policy_input = window if compact_at == 'max' else compact_at + reserved
  if window <= policy_input:
    if 'limit' in model_config:
      print(f'  compact  {model_ref} at {window - reserved} tokens (measured input limit {window})')
    continue
  overrides = config.setdefault('provider', {}).setdefault(provider_id, {}).setdefault('models', {})
  overrides.setdefault(model_id, {})['limit'] = {'context': limit['context'], 'input': policy_input, 'output': limit['output']}
  print(f'  compact  {model_ref} at {compact_at} tokens (input limit {policy_input})')

os.makedirs(os.path.dirname(dest_path), exist_ok=True)
with open(dest_path, 'w', encoding='utf-8') as dest_file:
  json.dump(config, dest_file, indent=2)
  dest_file.write('\n')
PYJSON

  echo "Copied opencode.json -> $CONFIG_DEST"
  echo "Configured plugin path: $DIST_PLUGIN_PATH"
fi
