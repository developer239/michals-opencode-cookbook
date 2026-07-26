# Michal's OpenCode Cookbook

A shareable agentic setup for [OpenCode](https://opencode.ai) and Claude Code from a single codebase: the core plugins, skills, commands, and global agent instructions. The plugins are written once against the OpenCode plugin API; Claude Code gets the exact same tools through a thin stdio MCP server that loads them from this repo's build output.

## Quick Start

### 1. Install the CLIs

Both harnesses are installed via Homebrew:

```bash
brew install opencode
brew install --cask claude-code
```

### 2. Install and build

```bash
pnpm install
pnpm run build
```

Requires Node 24 (`mise.toml`; `mise install` gets it) and pnpm 11 (pinned via the `packageManager` field; `corepack enable` gets the right version).

### 3. Link globally into OpenCode

```bash
pnpm run symlink:opencode
```

This rebuilds `dist/` and runs `scripts/link-opencode.sh`, which:

- Copies `src/skills/*/` to `~/.config/opencode/skills/`
- Copies `src/commands/*.md` to `~/.config/opencode/commands/`
- Copies `AGENTS.md` to `~/.config/opencode/AGENTS.md`, so the same global instructions load in every OpenCode session (the same role the CLAUDE.md copy plays for Claude Code). A repo's own `AGENTS.md` takes precedence in that repo; an existing unmanaged global file is backed up with a timestamp first.
- Copies `opencode.json` to `~/.config/opencode/opencode.json` with the `plugin` path rewritten to this repo's `dist/index.js` (an existing global config is backed up first)

Rerun it whenever skills, commands, `opencode.json`, or plugin sources change. Everything is installed as a real copy, not a symlink (containers bind-mounting `~/.config/opencode` would otherwise see dangling host paths), so edits to the installed copies are lost on the next rerun - always edit the sources here.

### 4. Link globally into Claude Code

```bash
pnpm run symlink:claude-code
```

This rebuilds `dist/` and runs `scripts/link-claude-code.sh`, which:

- Registers the `opencode` MCP server in user scope (`claude mcp add --scope user`), so tools are available in every project as `mcp__opencode__<tool>` (e.g. `mcp__opencode__codebase_find_definition`)
- Copies `src/skills/*/` to `~/.claude/skills/`
- Copies `src/commands/*.md` to `~/.claude/commands/`, converting the fence-less OpenCode headers to Claude Code frontmatter and dropping OpenCode-only keys (`agent`, `model`, `user-invocable`)
- Copies `AGENTS.md` to `~/.claude/CLAUDE.md` as an exact copy, so the same global instructions load in every Claude Code session. A `~/.claude/CLAUDE.md` not created by this installer is backed up to `CLAUDE.md.backup.<timestamp>` first - merge anything you want to keep into this repo's `AGENTS.md` and rerun.

Installs are tracked in `~/.claude/.opencode-cookbook-manifest.json`; each rerun removes exactly what the previous run installed before copying, so renames and deletions propagate while skills, commands, and instruction files from other sources in `~/.claude` are never touched.

`pnpm run symlink` runs both installers.

Claude Code asks for confirmation on every MCP tool call by default. To approve the whole server once, add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__opencode"]
  }
}
```

Granular alternative: per-tool rules like `"mcp__opencode__codebase_find_definition"`.

## Plugins

| Module     | Tools | What it covers                                                                            |
| ---------- | ----- | ----------------------------------------------------------------------------------------- |
| `codebase` | 4     | TypeScript-aware code navigation: definitions, call tracing, unused symbols, project tree |
| `opencode` | 5     | Local `opencode run` / `claude -p` dispatch and session store access                      |

**codebase** - `codebase_find_definition`, `codebase_trace_calls`, `codebase_find_unused_symbols` (TypeScript compiler API over the target project's own `tsconfig.json`), and `codebase_project_structure` (works on any directory).

**opencode** - `oc_run` (sync or async dispatch), `oc_get_run_status`, `oc_get_session`, `oc_list_sessions`, `oc_search_sessions`.

## OpenCode Run Dispatch

The opencode plugin dispatches local agentic runs on the host - a thin wrapper around the CLIs you already use interactively, with no control plane, Docker, or environments. The model id on `oc_run` picks the runner: provider-prefixed ids (`openai/gpt-5.5`, `openai/gpt-5.6-sol`) spawn `opencode run`, bare claude ids or aliases (`claude-fable-5`, `haiku`) spawn `claude -p`. Any other un-prefixed model id is rejected - nothing routes to a default runner silently. Dispatch modes (sync vs async), the `oc_*` tool surface, model selection, and the consultation patterns are documented in the `workflow-agentic` skill - this section covers only the operator-facing configuration.

Sessions are runtime-bound. Opencode sessions (`ses_*`) persist in OpenCode's local SQLite store (`~/.local/share/opencode/opencode.db`), the same place interactive sessions live, and are readable via `oc_get_session` / `oc_list_sessions` / `oc_search_sessions`. Claude sessions (UUID ids) are JSONL transcripts under `~/.claude/projects/` - the session tools reject them with an explicit error, and continuing one requires `oc_run` with a claude model (and the same `cwd` as the original run). Claude child processes inherit the user's global `~/.claude/settings.json` permissions.

### Configuration

The plugin resolves each path from an environment variable, falling back to the defaults below.

| Env var                      | Default                                      | Purpose                                                |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| `OPENCODE_BIN`               | `opencode` (resolved from PATH)              | Override path to the opencode binary                   |
| `CLAUDE_BIN`                 | `claude` (resolved from PATH)                | Override path to the claude binary (claude-model runs) |
| `OPENCODE_DB_PATH`           | `~/.local/share/opencode/opencode.db`        | Override SQLite database path                          |
| `OPENCODE_ASYNC_LOG_DIR`     | `~/.local/share/opencode/oc-async-runs`      | Where async run logs are written (both runners)        |
| `OPENCODE_RUN_REGISTRY_PATH` | `~/.local/share/opencode/oc-async-runs.json` | Where the async run registry lives (both runners)      |

## Commands and Skills

One command ships with the setup:

- `/pair-program` - spawn a persistent thinking-partner session via a local opencode run and keep consulting it in the same thread

The skills:

- `workflow-agentic` - conventions for dispatching local opencode runs as agentic workers (sync vs async, model selection, session continuity, multi-model fanout)
- `language-typescript` - TypeScript conventions and architecture guidance
- `workflow-git-cli` - Git CLI workflow conventions (branching, staging, commits, PRs)
- `workflow-git-worktree` - git worktree conventions for parallel multi-agent work
- `write-skill` - conventions for authoring SKILL.md files
- `write-command` - conventions for authoring OpenCode command files
- `develop-opencode-plugins` - patterns for implementing or extending the plugins in this repo

## Authentication

The two plugins in this repo need no credentials. This section explains how auth works so you know where credentials live when you add plugins that talk to external services.

**Where OpenCode stores credentials.** OpenCode persists provider credentials in `~/.local/share/opencode/auth.json` (XDG data dir, file mode 0600), written by `opencode auth login` (CLI) or `/connect` (TUI). Providers that need refreshable OAuth state keep it in separate files under `~/.config/opencode/` (for example, an Atlassian plugin storing OAuth client credentials for token refresh).

**Custom plugins and `opencode auth login`.** The auth CLI only knows about providers that are registered with OpenCode. A custom plugin shows up there only if it implements an auth provider (the `auth` hook on the plugin, with its `methods` and optional `loader`). Without that hook, `opencode auth login` has nothing to store the credential against - the plugin must read its credentials from its own config file or environment variables instead.

**How the Claude Code MCP server authenticates.** It doesn't - the server has no auth logic of its own. The plugins read and refresh their credentials from the same files they use under OpenCode, entirely through the filesystem. Connect a provider once via OpenCode and it works in Claude Code automatically; the MCP server never needs to be configured separately. Project-scoped plugin config also keeps working: Claude Code starts the server in the active project directory, so files under a project's `.opencode/config/` resolve per project exactly as under OpenCode.

## How the MCP Server Works

`src/mcp/server.ts` starts a stdio MCP server. At startup it instantiates the plugin factories from this repo with a shim client (structured logs and toasts land on stderr), converts each tool's zod arg schema to JSON Schema, and registers every tool over MCP: zod-parsed arguments in, markdown text out, image attachments as MCP image content, abort signal wired through to the tool context.

The plugins' interactive permission prompts (`context.ask`) resolve unconditionally in this port - Claude Code's own permission layer (`mcp__opencode__*` rules) is the single gate in front of every tool.

The server spawns per-session over stdio (no persistent background process). Verify the installation with:

```bash
claude mcp get opencode   # Should show: Status ✔ Connected
ls ~/.claude/skills       # Should show skill directories
ls ~/.claude/commands     # Should show command .md files
```

## Development

The toolchain: TypeScript 7 for compilation and typechecking, oxlint with type-aware rules (via `oxlint-tsgolint`), and oxfmt for formatting. Dependencies are pinned to exact versions and managed with pnpm.

```bash
pnpm run build         # compile src/ to dist/
pnpm run typecheck     # type-check without emitting
pnpm run lint          # oxlint (.oxlintrc.json, type-aware)
pnpm run format        # oxfmt write mode (.oxfmtrc.json)
pnpm run format:check  # oxfmt check mode
```

`lint/naming.plugin.mjs` is a custom oxlint plugin enforcing `I`-prefixed interfaces, `T`-prefixed type parameters, camelCase private members, and intent-bearing boolean prefixes (`is`/`has`/`can`/...).

One note on the dual TypeScript dependency: TypeScript 7 (the native compiler) no longer ships the programmatic compiler API, so the codebase plugin's LSP service imports it from `typescript-api`, an alias for `typescript@5.9`. The `typescript` devDependency (7.x) provides `tsc` for building this repo; `typescript-api` is the runtime library the tools analyze other projects with.

## Troubleshooting

**Tools don't appear in Claude Code**

- Restart Claude Code entirely (don't just switch sessions). The MCP server is loaded at session start.
- Verify `claude mcp get opencode` shows status ✔ Connected.

**Skills/commands not updating after source change**

- Edits to the installed copies at `~/.claude/` or `~/.config/opencode/` are lost on the next symlink run.
- Edit the sources in `src/skills/` or `src/commands/`, then rerun `pnpm run symlink`.

**My `~/.claude/CLAUDE.md` was replaced**

- The Claude Code installer backs up a CLAUDE.md it does not manage to `~/.claude/CLAUDE.md.backup.<timestamp>` before installing its own. Merge anything you want to keep into this repo's `AGENTS.md` and rerun.
