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
