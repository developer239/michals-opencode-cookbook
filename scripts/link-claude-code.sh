#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SERVER_PATH="$PROJECT_ROOT/dist/mcp/server.js"

if [ ! -f "$SERVER_PATH" ]; then
  echo "dist/mcp/server.js not found - run 'pnpm run symlink:claude-code' (which builds first) or 'pnpm run build'" >&2
  exit 1
fi

echo "Installing skills and commands from $PROJECT_ROOT into $CLAUDE_HOME"

python3 - "$PROJECT_ROOT" "$CLAUDE_HOME" <<'PY'
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

project_root = Path(sys.argv[1])
claude_home = Path(sys.argv[2])

skills_src = project_root / 'src' / 'skills'
commands_src = project_root / 'src' / 'commands'
agents_src = project_root / 'AGENTS.md'
skills_dest = claude_home / 'skills'
commands_dest = claude_home / 'commands'
claude_md_dest = claude_home / 'CLAUDE.md'
manifest_path = claude_home / '.opencode-cookbook-manifest.json'

# Claude Code command frontmatter accepts these keys; the rest of the OpenCode
# header (agent selection, opencode model ids, user-invocable) must not leak
# into the installed copy.
KEPT_COMMAND_KEYS = {'description', 'argument-hint', 'allowed-tools', 'disable-model-invocation'}

# Remove exactly what the previous run installed so renames and deletions in
# the source tree do not leave stale entries. Only manifest-listed paths are
# touched: ~/.claude also holds skills and commands from other sources.
if manifest_path.exists():
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    for name in manifest.get('skills', []):
        shutil.rmtree(skills_dest / name, ignore_errors=True)
    for name in manifest.get('commands', []):
        (commands_dest / name).unlink(missing_ok=True)
    if manifest.get('claudeMd'):
        claude_md_dest.unlink(missing_ok=True)

skills_dest.mkdir(parents=True, exist_ok=True)
commands_dest.mkdir(parents=True, exist_ok=True)

installed_skills = []
for skill_dir in sorted(path for path in skills_src.iterdir() if path.is_dir()):
    shutil.copytree(skill_dir, skills_dest / skill_dir.name, dirs_exist_ok=True)
    installed_skills.append(skill_dir.name)
    print(f'  skill    {skill_dir.name}')

# OpenCode command headers are fence-less "key: value" lines at the top of the
# file; Claude Code requires real YAML frontmatter. Wrap the kept keys in ---
# fences and drop the OpenCode-only ones.
installed_commands = []
for command_file in sorted(commands_src.glob('*.md')):
    lines = command_file.read_text(encoding='utf-8').splitlines()

    header = []
    body_start = 0
    for line in lines:
        key, sep, _ = line.partition(':')
        if not sep or not key or not all(c.isalpha() or c == '-' for c in key):
            break
        if key in KEPT_COMMAND_KEYS:
            header.append(line)
        body_start += 1

    body = '\n'.join(lines[body_start:]).lstrip('\n')
    content = '---\n' + '\n'.join(header) + '\n---\n\n' + body + '\n'

    (commands_dest / command_file.name).write_text(content, encoding='utf-8')
    installed_commands.append(command_file.name)
    print(f'  command  /{command_file.stem}')

# Global instructions: Claude Code reads ~/.claude/CLAUDE.md in every session,
# the same role AGENTS.md plays for OpenCode. Exact copy, no transformation.
# A CLAUDE.md not created by this installer (the manifest cleanup above already
# removed a managed one) is backed up with a timestamp, mirroring how the
# OpenCode installer treats an existing global opencode.json - the install
# must succeed on every machine, and nothing is lost.
if not agents_src.exists():
    sys.exit(f'AGENTS.md not found at {agents_src}')
if claude_md_dest.exists():
    backup_path = claude_md_dest.with_name(f'CLAUDE.md.backup.{datetime.now().strftime("%Y%m%d%H%M%S")}')
    shutil.move(claude_md_dest, backup_path)
    print(f'  backed up existing unmanaged CLAUDE.md to {backup_path}')
shutil.copyfile(agents_src, claude_md_dest)
print('  memory   CLAUDE.md (exact copy of AGENTS.md)')

manifest = {'skills': installed_skills, 'commands': installed_commands, 'claudeMd': True}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'Wrote manifest: {manifest_path}')
PY

# Auto-compaction follows the shared compaction policy's anthropic entry:
# autoCompactWindow is its token count, which Claude Code caps at each model's
# context so a smaller model compacts as late as its own window allows (max
# leaves autoCompactWindow unset, so every model does), and autoCompactEnabled
# mirrors compaction.auto in the OpenCode config the OpenCode installer wrote.
# The same pass also merges the two handoff-compaction hooks (PreCompact,
# SessionStart) into settings.json.
# shellcheck source=compaction-policy.sh
source "$SCRIPT_DIR/compaction-policy.sh"
COMPACTION_CLI_PATH="$PROJECT_ROOT/dist/modules/compaction/cli.js"
WRITER_TIMEOUT_SECONDS=$((PRE_COMPACT_TIMEOUT_SECONDS - WRITER_TIMEOUT_MARGIN_SECONDS))
python3 - "$HOME/.config/opencode/opencode.json" "$CLAUDE_HOME/settings.json" \
  "$COMPACTION_CLI_PATH" "$COMPACTION_WRITER_MODEL" "$COMPACTION_WRITER_CONTEXT_TOKENS" \
  "$PRE_COMPACT_TIMEOUT_SECONDS" "$WRITER_TIMEOUT_SECONDS" "${COMPACT_AT_TOKENS_BY_PROVIDER[@]}" <<'PY'
import json
import shlex
import sys
from pathlib import Path

opencode_config_path = Path(sys.argv[1])
settings_path = Path(sys.argv[2])
compaction_cli_path = sys.argv[3]
writer_model = sys.argv[4]
writer_context_tokens = int(sys.argv[5])
pre_compact_timeout = int(sys.argv[6])
writer_timeout = int(sys.argv[7])

compact_at_by_provider = {}
for entry in sys.argv[8:]:
    provider, _, value = entry.partition('=')
    if provider == '' or not (value == 'max' or value.isdigit()):
        sys.exit(f'compaction policy entry must be <provider>=<tokens|max>, got: {entry}')
    compact_at_by_provider[provider] = value if value == 'max' else int(value)
if 'anthropic' not in compact_at_by_provider:
    sys.exit('the compaction policy must list anthropic, the provider Claude Code runs')
compact_at = compact_at_by_provider['anthropic']

if not opencode_config_path.exists():
    sys.exit(f'{opencode_config_path} not found - run pnpm run symlink:opencode first; auto-compaction follows it')
auto = json.loads(opencode_config_path.read_text(encoding='utf-8')).get('compaction', {}).get('auto')
if not isinstance(auto, bool):
    sys.exit(f'{opencode_config_path} must set compaction.auto')

settings = json.loads(settings_path.read_text(encoding='utf-8')) if settings_path.exists() else {}
settings['autoCompactEnabled'] = auto
if compact_at == 'max':
    settings.pop('autoCompactWindow', None)
else:
    settings['autoCompactWindow'] = compact_at

# The two handoff-compaction hooks: PreCompact writes a handoff just before
# compaction runs, SessionStart (matcher "compact") tells the resumed session
# to read it. Only a hook group whose command names this cli.js is replaced;
# every other hook the owner configured, on these events or others, is kept.
def is_ours(group):
    return any(compaction_cli_path in hook.get('command', '') for hook in group.get('hooks', []))

hooks = settings.setdefault('hooks', {})

pre_compact = [group for group in hooks.get('PreCompact', []) if not is_ours(group)]
pre_compact.append({
    'matcher': '',
    'hooks': [{
        'type': 'command',
        'command': f'node {compaction_cli_path} pre-compact --writer-model {shlex.quote(writer_model)} '
                   f'--writer-context-tokens {writer_context_tokens} --writer-timeout-seconds {writer_timeout}',
        'timeout': pre_compact_timeout,
    }],
})
hooks['PreCompact'] = pre_compact

session_start = [group for group in hooks.get('SessionStart', []) if not is_ours(group)]
session_start.append({
    'matcher': 'compact',
    'hooks': [{'type': 'command', 'command': f'node {compaction_cli_path} session-start'}],
})
hooks['SessionStart'] = session_start

settings_path.write_text(json.dumps(settings, indent=2) + '\n', encoding='utf-8')
print(f"  settings autoCompactEnabled {settings['autoCompactEnabled']}, "
      f"autoCompactWindow {settings.get('autoCompactWindow', 'unset (each model compacts at its own window)')}")
print(f'  hooks    PreCompact -> {compaction_cli_path} pre-compact --writer-model {shlex.quote(writer_model)} '
      f'--writer-context-tokens {writer_context_tokens} --writer-timeout-seconds {writer_timeout} '
      f'(hook timeout {pre_compact_timeout}s)')
print(f'  hooks    SessionStart (compact) -> {compaction_cli_path} session-start')
PY

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found on PATH - register the MCP server manually:" >&2
  echo "  claude mcp add --scope user opencode -- node $SERVER_PATH" >&2
  exit 1
fi

claude mcp remove --scope user opencode >/dev/null 2>&1 || true
claude mcp add --scope user opencode -- node "$SERVER_PATH"

echo ""
echo "Done. The 'opencode' MCP server, skills, commands, and global CLAUDE.md are now available globally in Claude Code."
echo "Per-project additions go in a project's own .claude/skills, .claude/commands, .mcp.json, and CLAUDE.md."
