---
name: develop-opencode-plugins
description: OpenCode plugin development patterns, architecture, and conventions for implementing or extending plugins in this repo. Covers the native @opencode-ai/plugin surface (Plugin/PluginInput, tool(), hooks, auth, permissions) and this repo's house library layered on top.
last_verified: '2026-07-02'
---

# OpenCode Plugin Development

## Purpose

Conventions and patterns for creating new OpenCode plugins or extending existing ones in this repo. Covers module architecture, tool creation, service layering, authentication, the permission model, formatting, error handling, and the house utility library.

This skill draws a hard line between two things that are easy to conflate:

- **The OpenCode-native surface** - types and APIs that ship with `@opencode-ai/plugin` and `@opencode-ai/sdk`. These are the contract with the runtime.
- **This repo's house library** - everything under `src/modules/_core/` (BaseTool, MarkdownBuilder, PluginError, Logger, PromptLoaderService, etc.). These are our conventions layered on top of the native surface for consistency across the plugins and tools. They are NOT part of OpenCode and are not importable from `@opencode-ai/plugin`.

When you read an example below, the "Native" vs "House library" labels tell you which side of that line it sits on.

## Version and Naming Facts

- The plugin package is pinned in `package.json` to **`@opencode-ai/plugin@1.17.13`** (SDK `@opencode-ai/sdk@1.17.13` comes with it). Write against the types installed in `node_modules/@opencode-ai/plugin/dist/*.d.ts` - those are the source of truth for the pinned version, ahead of any docs. The two files that matter: `index.d.ts` (Plugin, PluginInput, Hooks, AuthHook) and `tool.d.ts` (tool(), ToolContext).
- Upstream repo, Docker namespace, and brew tap moved from `sst/opencode` to **`anomalyco/opencode`** (SST rebranded to Anomaly). Docker image is `ghcr.io/anomalyco/opencode`; brew tap is `anomalyco/tap/opencode`. Use `anomalyco/opencode` for any source links.
- Bumping the plugin dep: `pnpm add -E @opencode-ai/plugin@<version>`. After bumping, run `pnpm typecheck` before anything else.

## Official Documentation

Point to these rather than reproducing them; they track upstream and move faster than this skill:

- Plugins: https://opencode.ai/docs/plugins/
- Custom (file-based) tools: https://opencode.ai/docs/custom-tools/
- Permissions: https://opencode.ai/docs/permissions/
- Config: https://opencode.ai/docs/config/
- Agent Skills: https://opencode.ai/docs/skills/
- Commands: https://opencode.ai/docs/commands/ | Agents: https://opencode.ai/docs/agents/
- SDK: https://opencode.ai/docs/sdk/ | Ecosystem: https://opencode.ai/docs/ecosystem/
- Providers/auth: https://opencode.ai/docs/providers/ | CLI: https://opencode.ai/docs/cli/
- Type source of truth upstream: `packages/plugin/src/index.ts` and `packages/plugin/src/tool.ts` in `anomalyco/opencode`.

## Plugin vs Skill vs Agent vs Command

Four extension mechanisms, often confused:

| Mechanism   | What it is                                                                         | Lives in                                              |
| ----------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Plugin**  | JS/TS module adding tools, hooks, auth, and providers; can change runtime behavior | npm package or `file://` in the `plugin` config array |
| **Tool**    | A single callable the LLM invokes; registered by a plugin, or file-based           | plugin `tool` hook, or `.opencode/tools/*.ts`         |
| **Skill**   | On-demand instructions (a `SKILL.md`) the agent loads via the `skill` tool         | `skills/<name>/SKILL.md`                              |
| **Command** | A user-invoked saved prompt (`/name`)                                              | `commands/*.md`                                       |
| **Agent**   | A configured assistant (model + prompt + permissions)                              | `agents/*.md` or `opencode.json` `agent`              |

This skill is about the first two. This repo's plugins live in `src/modules/`; each is registered by absolute `file://` path via the built `dist/index.js`.

## Native Surface vs House Library (read this first)

### Native (ships with @opencode-ai/plugin / @opencode-ai/sdk)

- `Plugin`, `PluginInput`, `PluginOptions`, `Hooks` (the full hook object)
- `tool()`, `tool.schema` (this is Zod), `ToolContext`, `ToolResult`, `ToolDefinition`
- `AuthHook` (the `auth` block: `provider`, `loader`, `methods`), `AuthOAuthResult`
- `ProviderHook` (register/augment model providers)
- The `client` SDK (`client.app.log`, `client.tui.showToast`, session APIs, etc.)
- The permission system: declarative `permission` config in `opencode.json` plus the runtime `context.ask()` call on `ToolContext`

### House library (this repo only - `src/modules/_core/`)

- `BaseTool` (`_core/tools/base-tool.ts`) - error-wrapping + permission-prompt convenience base class
- `MarkdownBuilder` (`_core/services/markdown-builder.service.ts`)
- `PluginError` + `ErrorCode` (`_core/types/errors.ts`)
- `Logger` (`_core/services/logger.service.ts`)
- `PromptLoaderService` (`_core/services/prompt-loader.service.ts`)
- `loadJsonConfig` (`_core/services/config-loader.service.ts`)
- `format.utils` helpers (`_core/services/format.utils.ts`)
- The AWS client factory (`aws/services/aws-credentials.service.ts`)

None of the house-library items are OpenCode APIs. They exist to make 140+ tools look and behave identically. Keep using them for tools in this repo; never imply they are importable from `@opencode-ai/plugin`.

Important nuance: some house helpers are thin wrappers over native primitives, not replacements. `BaseTool.askMutationPermission` wraps the native `context.ask()` (see the Permission Model section). `Logger` should wrap the native `client.app.log()` (see Logging). The wrapper existing does not mean we bypass native - it means we standardize the call site.

## Plugin Architecture

### Module Structure

Every plugin module follows this layout:

```
src/modules/<name>/
├── services/          # Business logic (API clients, orchestration, formatting)
├── tools/             # Tool definitions (one file per tool)
├── types/             # TypeScript interfaces and types
├── prompts/           # LLM prompt templates (optional, .txt files)
├── config.ts          # Module constants and config
└── <name>.plugin.ts   # Plugin entry point
```

Shared infrastructure lives in `src/modules/_core/` (note the leading underscore - it is `_core/`, not `core/`).

### PluginInput - the context every plugin receives

Native. A plugin is an async function `(input: PluginInput, options?: PluginOptions) => Promise<Hooks>`. The `input` object (verified against `index.d.ts` for 1.17.13):

```typescript
type PluginInput = {
  client: ReturnType<typeof createOpencodeClient> // in-process OpenCode SDK client (no network hop)
  project: Project // { id, worktree, vcs, ... }; id is a git hash or "global"
  directory: string // the directory opencode was invoked in
  worktree: string // the project worktree root
  experimental_workspace: { register(type, adapter): void }
  serverUrl: URL // in-process server URL (defaults to http://localhost:4096)
  $: BunShell // Bun shell API for running commands
}
```

Most plugins in this repo currently ignore `input` entirely and are written `Plugin = () => ...`. That is fine when the plugin needs nothing from the runtime. **Destructure what you need** the moment you want native runtime features - the two that matter most here are `client` (structured logging, toasts, session visibility) and `$`/`project`/`worktree` for context-aware behavior.

### Plugin Entry Point

The plugin export initializes services, wires dependencies, and returns a `Hooks` object.

House library + native, minimal shape (no runtime features needed):

```typescript
import type { Plugin } from '@opencode-ai/plugin'

export const MyPlugin: Plugin = async () => {
  const api = new MyApiService(/* deps */)
  const formatting = new MyFormattingService()
  const orchestrator = new MyService(api, formatting)

  return {
    auth: {/* provider auth block */},
    tool: {
      my_tool_name: MyTool.create(orchestrator),
    },
  }
}
```

Native, when the plugin needs runtime features (capture `client` at init and pass it into tools/services that need it):

```typescript
import type { Plugin } from '@opencode-ai/plugin'

export const MyPlugin: Plugin = async ({ client, project, $ }) => {
  const api = new MyApiService(/* deps */)
  const orchestrator = new MyService(api, client) // client injected for logging/toasts

  return {
    tool: {
      my_tool_name: MyTool.create(orchestrator),
    },
  }
}
```

Holding the `client` reference for the life of the plugin is fine - it is plugin-scoped, not session-bound, and does not go stale. Do NOT try to reach `client` through `ToolContext`; it is not there. Thread it explicitly through constructors.

Key rules:

- Plugin must not fail during initialization - if credentials are missing, log a warning and continue. Tools fail at call time with descriptive errors.
- Services are constructed with explicit dependency injection - no singletons, no global state.
- Tool names in this repo use `snake_case` (e.g. `aws_create_iam_user`). This is a repo convention for readable, namespaced tool ids, and it matches the file-based-tools naming rule upstream. It is not a hard requirement of the plugin `tool` hook - those tools are keyed by whatever object key you supply - but keep the convention for consistency. Add the `/* eslint-disable camelcase */` guard around the tool map as the existing plugins do.

### Service Layer Pattern

House library convention. Modules typically have 3 service layers:

| Layer                     | Responsibility                              | Example                                                      |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| **API service**           | HTTP/SDK calls, auth headers, error mapping | `GitHubApiService`, `JiraApiService`, `SlackApiService`      |
| **Formatting service**    | Data to markdown output                     | `GitHubFormattingService`, `DatabaseFormattingService`       |
| **Orchestration service** | Combines API + formatting, business logic   | `GitHubPrService`, `JiraIssueService`, `SlackMessageService` |

Tools delegate to the orchestration service. The orchestration service calls the API service and formats results via the formatting service. Tools never call API services directly.

## Tool Implementation

### The native tool() helper

Native. From `tool.d.ts`, `tool()` takes `{ description, args, execute }`. `args` is a Zod raw shape and `tool.schema` **is Zod** (`var schema: typeof z`), so `tool.schema.string()` and `import { z } from 'zod'` are interchangeable. `execute` receives the parsed args and a `ToolContext`, and returns a `ToolResult`:

```typescript
type ToolResult =
  | string
  | {
      title?: string
      output: string
      metadata?: Record<string, any>
      attachments?: ToolAttachment[]
    }
```

Returning a bare string is the common case. Return the object form when you want a title, structured metadata, or file attachments on the result.

### ToolContext - what execute receives

Native. Verified fields for 1.17.13:

```typescript
type ToolContext = {
  sessionID: string
  messageID: string
  agent: string
  directory: string // prefer over process.cwd() for resolving relative paths
  worktree: string // use for stable relative paths: path.relative(worktree, absPath)
  abort: AbortSignal
  metadata(input: { title?: string; metadata?: Record<string, any> }): void
  ask(input: {
    permission: string
    patterns: string[]
    always: string[]
    metadata: Record<string, any>
  }): Promise<void>
}
```

`directory` and `worktree` are the correct way to resolve paths for the active session - do not reach for `process.cwd()`. `abort` is the cancellation signal; long-running tools should pass it into `fetch`/SDK calls. `metadata()` is the always-available inline progress channel (see Progress Visibility). `ask()` is the native permission prompt (see Permission Model).

### BaseTool Pattern (house library)

House library. Every tool extends `BaseTool<TArgs>` from `_core/tools/base-tool`:

```typescript
import { tool, type ToolContext } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool'

interface IMyToolArgs {
  requiredParam: string
  optionalParam?: number
}

const schema = {
  requiredParam: tool.schema.string().describe('What this parameter does'),
  optionalParam: tool.schema.number().optional().describe('Optional with default behavior'),
}

export class MyTool extends BaseTool<IMyToolArgs> {
  constructor(private readonly service: MyService) {
    super()
  }

  public static readonly create = (service: MyService): ReturnType<typeof tool> => {
    const handler = new MyTool(service)
    return tool({
      description: 'Clear description of what this tool does and when to use it.',
      args: schema,
      execute: (args, context) => handler.execute(args, context),
    })
  }

  public execute = (args: IMyToolArgs, context?: ToolContext): Promise<string> =>
    this.handleErrors(async () => {
      // For mutation tools, prompt for confirmation first:
      await this.askMutationPermission(context, 'my_tool_name', `Description of what will happen`)

      return this.service.doSomething(args)
    }, 'Error doing something')
}
```

### What BaseTool provides

House library, wrapping native primitives:

- `handleErrors(operation, errorPrefix)` - wraps operation, re-throws `PluginError` as-is, wraps unknown errors in `PluginError('INTERNAL_ERROR')`. Native OpenCode has no equivalent; this is our uniform error boundary.
- `askMutationPermission(context, permissionKey, description)` - a thin wrapper over the native `context.ask()` for write operations. It guards against missing context, then calls `context.ask({ permission, patterns: [description], always: [description], metadata: {} })`. It does not replace the native permission system; it standardizes the call.
- `askSensitiveReadPermission(context, permissionKey, description)` - same wrapper, for sensitive reads (SSM parameters, secrets).

### Tool Description Quality

Tool descriptions are critical - the LLM uses them to decide when to call tools. Include:

- What the tool does
- When to use it (and what prerequisite tools to call first)
- Default values for optional parameters

### Schema Reuse

When multiple tools share common parameters, define the schema once and spread:

```typescript
// In helpers service
public static readonly REPOSITORY_SCHEMA = {
  repository: tool.schema.string().describe('Repository in "owner/repo" format'),
  owner: tool.schema.string().optional().describe('Repository owner'),
  repo: tool.schema.string().optional().describe('Repository name'),
}

// In tool
const schema = {
  ...GitHubHelpers.REPOSITORY_SCHEMA,
  prNumber: tool.schema.number().describe('Pull request number'),
}
```

### File-based tools (native) - and why this repo does not use them

Native. OpenCode supports standalone tools dropped in `.opencode/tools/*.ts` (or `~/.config/opencode/tools/`), separate from plugin-registered tools:

- The **filename becomes the tool name** (`database.ts` to a `database` tool).
- Multiple named exports become `<filename>_<exportname>` (`math.ts` exporting `add` to `math_add`).
- A custom tool with the same name as a built-in takes precedence.

This repo deliberately does NOT use file-based tools. Every tool is plugin-registered so it can take injected services (API/formatting/orchestration), extend `BaseTool` for uniform errors and permissions, and be unit-tested with mocked dependencies. File-based tools are the right choice for a quick, dependency-free one-off in a single project's `.opencode/`; they are the wrong choice for this repo's DI-and-testability model. Know they exist so you can recognize them; don't migrate our tools to them.

## The Hooks Surface

Native. A plugin returns a `Hooks` object. Only `tool` and `auth` are used widely in this repo today, but the full surface is available and worth knowing. Verified against `index.d.ts` for 1.17.13.

### Stable hooks

| Hook                     | Signature (input to output)                                      | Use for                                                          |
| ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `tool`                   | `{ [name]: ToolDefinition }`                                     | Register callable tools (the primary mechanism in this repo)     |
| `auth`                   | `AuthHook`                                                       | Register a credential provider (see Authentication)              |
| `provider`               | `ProviderHook` (`{ id, models(provider, ctx) }`)                 | Register or augment model providers                              |
| `config`                 | `(config) => void`                                               | Mutate resolved config at load (e.g. register a custom provider) |
| `event`                  | `({ event }) => void`                                            | Subscribe to lifecycle events (see below)                        |
| `chat.message`           | `(input, { message, parts }) => void`                            | Inspect/modify an incoming user message                          |
| `chat.params`            | `(input, { temperature, topP, topK, maxOutputTokens, options })` | Tune sampling per model/agent before the LLM call                |
| `chat.headers`           | `(input, { headers }) => void`                                   | Inject provider-specific request headers                         |
| `permission.ask`         | `(Permission, { status }) => void`                               | **Do not use.** See Permission Model - broken and unsafe here.   |
| `command.execute.before` | `(input, { parts }) => void`                                     | Rewrite a slash-command invocation before it runs                |
| `tool.execute.before`    | `({ tool, sessionID, callID }, { args }) => void`                | Cross-cutting pre-tool logic (mutate args, block calls)          |
| `tool.execute.after`     | `(input, { title, output, metadata }) => void`                   | Cross-cutting post-tool logic (auto-format, audit)               |
| `tool.definition`        | `({ toolID }, { description, parameters }) => void`              | Rewrite a tool's description/params sent to the LLM              |
| `shell.env`              | `({ cwd, sessionID?, callID? }, { env }) => void`                | Inject env vars into all shell execution                         |
| `dispose`                | `() => Promise<void>`                                            | Cleanup on plugin teardown                                       |

### Experimental hooks (unstable - treat as opt-in and verify against your version)

`experimental.chat.messages.transform`, `experimental.chat.system.transform`, `experimental.provider.small_model`, `experimental.session.compacting` (customize the compaction prompt), `experimental.compaction.autocontinue`, `experimental.text.complete`.

These change across minor versions and some have been reported to silently no-op (e.g. `experimental.chat.system.transform` mutations discarded in some builds). Only reach for them with a specific need, and verify the effect against the pinned version before relying on it.

### The event hook's event list

`event` fires for runtime lifecycle events. Documented families: `command.executed`; `file.edited`, `file.watcher.updated`; `installation.updated`; `lsp.client.diagnostics`, `lsp.updated`; `message.part.removed/updated`, `message.removed/updated`; `permission.asked`, `permission.replied`; `server.connected`; `session.created/compacted/deleted/diff/error/idle/status/updated`; `todo.updated`; `shell.env`; `tool.execute.before/after`; `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`. Filter on `event.type` inside the handler.

## Permission Model

This is the highest-value section. There are two native mechanisms and one house wrapper; know how they fit.

### 1. Declarative permission config (native) - the primary gate

Configured in `opencode.json` (or per-agent under `agent.<name>.permission`), resolving each key to `"allow" | "ask" | "deny"`. This repo relies on it heavily - agents start from `"*": "deny"` and allow-list tool families by wildcard:

```json
"permission": {
  "*": "deny",
  "read": "allow",
  "edit": "allow",
  "bash": "allow",
  "aws_*": "allow",
  "github_*": "allow",
  "external_directory": { "~/projects/**": "allow", "*": "ask" }
}
```

Rules are matched with **last-matching-rule-wins**; a common pattern is a catch-all `"*"` first, then narrower overrides. Object/glob values give per-path or per-argument granularity (e.g. `"bash": { "git *": "allow", "rm *": "deny" }`, `"read": { "*.env": "deny" }`). MCP/custom tools are gated by tool-name wildcard patterns (`"mymcp_*": "deny"`).

Permission keys include: `read`, `edit` (covers edit/write/patch), `glob`, `grep`, `bash`, `task`, `skill`, `lsp`, `question`, `webfetch`, `websearch`, `external_directory`, `doom_loop`, plus every registered tool name. Defaults: most keys default to `"allow"`; `doom_loop` and `external_directory` default to `"ask"`; `read` is `"allow"` except `.env` files are denied by default. As of v1.1.1 the legacy `tools` boolean config is deprecated and merged into `permission` (old form still tolerated for back-compat).

This declarative layer is policy: it decides whether a given tool (or bash command, or file path) is allowed, prompted, or denied when invoked. It cannot express "confirm this specific destructive action with a human-readable description" from inside the tool's own logic - that is the next layer.

### 2. Runtime confirmation via context.ask() (native) - the per-call gate

Native, on `ToolContext`. Once execution is already inside a tool, mutation and sensitive-read tools call `context.ask({ permission, patterns, always, metadata })` before the sensitive operation to request interactive approval with a specific description ("Create IAM user X in prod"). This is what surfaces the call-time confirmation from within the tool's own logic. In this repo you reach it through the `BaseTool` wrappers (`askMutationPermission` / `askSensitiveReadPermission`), which add a missing-context guard and standardize the arguments. This is the correct, supported path and every mutating tool in this repo uses it.

### 3. The permission.ask hook (native) - BANNED in this repo

Do not implement the `permission.ask` hook. It is defined in the plugin types but was reported non-firing in 1.1.x (anomalyco/opencode Issue #7006: the hook is never actually triggered by the permission system). Wiring it up creates a **false sense of security** - a plugin that looks like it centralizes permission decisions but silently does nothing. Until upstream confirms it fires on the pinned version, the repo's model is: declarative config for structural gating + per-tool `context.ask()` for runtime confirmation. Both of those work and are visible. Never add `permission.ask`.

## Authentication Patterns

Native `auth` block. Plugins do not prompt for credentials directly - OpenCode's auth system does. The plugin registers an `auth` block; the user triggers authentication via `opencode auth login` (or `/connect` in the TUI). Credentials are stored by OpenCode at `~/.local/share/opencode/auth.json` (XDG, mode `0o600`). The `loader` runs on plugin startup to restore saved credentials.

### Simple API Key Auth (GitHub, Slack)

Used when the provider needs a single token/key:

```typescript
auth: {
  provider: 'github',   // unique provider name stored in auth.json

  async loader(auth) {
    const stored = await auth()
    if (stored.type !== 'api') {
      throw new PluginError('Expected API key authentication', 'AUTH_INVALID')
    }
    token = stored.key   // capture in closure
    logger.log('Authenticated')
    return { token }
  },

  methods: [{
    type: 'api' as const,
    label: 'GitHub Personal Access Token',
    prompts: [{
      type: 'text' as const,
      key: 'token',
      message: 'GitHub Token (ghp_...)',
      placeholder: 'Enter your fine-grained PAT',
    }],
    authorize(inputs?: Record<string, string>) {
      const inputToken = inputs?.token ?? ''
      if (!inputToken) return Promise.resolve({ type: 'failed' as const })
      return Promise.resolve({ type: 'success' as const, key: inputToken, provider: 'github' })
    },
  }],
}
```

Prompt entries also support a `type: 'select'` prompt (options list) and a `when` rule for conditional prompts (the older `condition` callback is deprecated in favor of `when`).

### Multi-field API Key Auth

When credentials have multiple fields, serialize to JSON in the `key` field:

```typescript
authorize(inputs?: Record<string, string>) {
  const key = JSON.stringify({ host: inputs.host, port, email: inputs.email, password: inputs.password })
  return Promise.resolve({ type: 'success', key, provider: 'my-provider' })
}
// In loader: config = JSON.parse(stored.key)
```

### Custom fetch in the loader

The `loader` can return a `fetch` function instead of (or alongside) static credentials, letting the plugin refresh tokens per request: return `{ apiKey, async fetch(input, init) { ...inject fresh token... } }` and pair it with a `config` hook that registers the provider and a `chat.headers` hook that sets provider-specific headers. This is the pattern to copy for token-refreshing providers.

### OAuth Auth (JIRA/Atlassian)

For OAuth providers, the method returns a URL plus a callback. The result type distinguishes two flows via `method`:

- `method: 'code'` - user pastes a code back; `callback(code)` exchanges it.
- `method: 'auto'` - device/loopback poll; `callback()` takes no argument.

```typescript
methods: [
  {
    type: 'oauth' as const,
    label: 'Atlassian OAuth',
    authorize(inputs?: Record<string, string>): Promise<AuthOAuthResult> {
      // Build OAuth URL, return { url, instructions, method: 'code', callback }
      // callback(code) exchanges code for tokens
      // Returns { type: 'success', access, refresh, expires }
    },
    prompts: [
      { type: 'text', key: 'clientId', message: 'OAuth Client ID', placeholder: '...' },
      { type: 'text', key: 'clientSecret', message: 'OAuth Client Secret', placeholder: '...' },
    ],
  },
]
```

OAuth tokens auto-refresh in the `getAccessToken()` call when expired. Client credentials for refresh are stored separately (e.g. `~/.config/opencode/atlassian-credentials.json`).

### Auth Error Messages

When auth is missing, throw `PluginError` with actionable instructions:

```typescript
throw new PluginError(
  'GitHub token not configured. STOP - do not attempt alternative approaches.\n\n' +
    'Report this to the user:\n1. Run /connect and select "GitHub"\n2. Read the Authentication section in README.md',
  'AUTH_MISSING'
)
```

The "STOP" phrasing prevents the LLM from inventing workarounds.

## Logging

Native. Use the in-process SDK client's structured logger, `client.app.log`, instead of `console.log`. Verified signature (SDK 1.17.13):

```typescript
await client.app.log({
  body: {
    service: 'my-plugin',
    level: 'info', // 'debug' | 'info' | 'warn' | 'error'
    message: 'Plugin initialized',
    extra: { foo: 'bar' }, // optional structured metadata
  },
})
```

`client` comes from `PluginInput`, so a plugin must destructure it at init and thread it into whatever needs to log. The house `Logger` (`_core/services/logger.service.ts`) is the standard call site for this - a `Logger` constructed with the plugin's `client` and a service name emits through `client.app.log`; constructed without a client it falls back to `console.*`. The convention is no raw `console.log`/`warn`/`error` in plugin code; route everything through the structured logger.

### Where the logs go (and why you stopped seeing them)

This is the load-bearing operational fact that surprises people. `client.app.log` does **not** print to the terminal/TUI - it writes to OpenCode's structured server log file on disk:

```
~/.local/share/opencode/log/opencode.log
```

Lines look like `timestamp=2026-07-02T23:36:26.447Z level=INFO run=369bdc52 message="RevenueCat plugin initialized"`. So once a module is migrated from `console.*` to the `client`-backed `Logger`, its output leaves the visible session and lands in that file. That is intentional (structured, level-tagged, greppable), but it means "I see no logs anymore" after a logging migration is expected, not a bug - the logs moved, they were not lost. To watch them live:

```bash
tail -f ~/.local/share/opencode/log/opencode.log
tail -f ~/.local/share/opencode/log/opencode.log | grep -iE "plugin initialized|<YourService>"
```

If you need something to appear on the user's screen (not just the log file), that is a different channel - use progress metadata or a toast, not `app.log` (see the next section).

### Mirroring auth/connection status back to the console

There is one narrow exception where console output still matters: **CLI startup**. The console is human-visible while OpenCode boots, and that is exactly when a user wants to see whether credentials and connections came up (did the SSH DB tunnel connect, are the JIRA credentials valid, which AWS environments loaded). Routing those lines through `client.app.log` alone hides them in the log file.

For that case, construct the logger with `{ shouldMirrorToConsole: true }`:

```typescript
const logger = new Logger('DatabasePlugin', client, { shouldMirrorToConsole: true })
```

When a client is present and this flag is set, the line is emitted to **both** sinks: the structured server log (kept for greppable diagnostics) and the console (restored startup visibility). With no client it is console-only as before; without the flag it is client-only as before. Reserve the flag for auth, credential, and connection loggers whose output is startup status - do NOT set it on hot-path loggers that fire per tool call, or you will spam the console. It is a per-instance setting, so give a mixed-use service a narrowly scoped logger rather than mirroring its every line. Console lines are level-tagged and column-aligned (`INFO  [Context] message`, `WARN  [Context] message`) so startup output scans cleanly.

## Progress Visibility for Long-Running Tools

Native. Tools that take a while (for example `oc_run`, which spawns a detached `opencode run` child) should surface progress. Two mechanisms, with a clear default:

### Default: context.metadata() (always available, no client needed)

`ToolContext.metadata({ title, metadata })` sets the title/metadata on the running tool call - inline status shown where the UI renders it, on the tool call the user is already watching. (The type guarantees the metadata is attached and updated; how prominently a given client surfaces it is up to that client.) It needs no `client` plumbing and is scoped to the tool invocation. Use it as the primary progress channel:

```typescript
context.metadata({ title: 'Dispatching opencode run...' })
// ... later ...
context.metadata({ title: 'Run started (pid 12345), waiting for completion' })
```

### Attention events: client.tui.showToast (needs client)

For cross-cutting or attention-worthy lifecycle events (a detached/background job started, finished, or failed), a transient toast is appropriate. It requires the SDK `client` threaded from `PluginInput`. Verified signature (SDK 1.17.13):

```typescript
await client.tui.showToast({
  body: {
    title: 'opencode run',
    message: 'Background run completed',
    variant: 'success', // 'info' | 'success' | 'warning' | 'error'
    duration: 4000, // optional ms
  },
})
```

Do not make toast the primary progress channel - it is transient and easy to miss. Lean on `context.metadata()` for step-by-step progress; use `showToast` for start/finish/failure of detached work.

## Core Utilities (house library)

All of the following live under `src/modules/_core/` and are this repo's code, not OpenCode APIs.

### Error Handling (`_core/types/errors.ts`)

All plugin errors use `PluginError(message, code, cause?)` with typed error codes:

```typescript
type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_EXPIRED'
  | 'AUTH_INVALID'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'EXTERNAL_API_ERROR'
  | 'INTERNAL_ERROR'
```

### Formatting Utilities (`_core/services/format.utils.ts`)

Shared data-mapping helpers:

- `formatBytes(bytes)` - human-readable byte sizes
- `toIsoOrNull(date)` - `Date | undefined` to `string | null`
- `toNullableString(value)` - `string | undefined` to `string | null`
- `withFallback(value, fallback)` - `string | undefined` to `string`
- `toNumberOrZero(value)` - `number | undefined` to `number`
- `groupByKey(items, keyFn)` - groups items into `Map<string, TItem[]>`
- `sleep(ms)` - async wait

### MarkdownBuilder (`_core/services/markdown-builder.service.ts`)

Fluent builder for LLM-readable markdown output. Every formatting service uses it:

```typescript
const md = MarkdownBuilder.create()
  .heading('Title', 1)
  .field('Label', 'value')
  .bullet('Item 1')
  .table(['Col A', 'Col B'], [['val1', 'val2']])
  .codeBlock(code, 'typescript')
  .build()
```

Methods: `heading`, `field`, `text`, `blank`, `separator`, `bullet` (with indent), `table`, `codeBlock`, `italic`, `build`.

### Config Loading (`_core/services/config-loader.service.ts`)

For modules that load JSON config from `.opencode/config/`:

```typescript
const config = await loadJsonConfig<MyConfig>(configPath, logger)
// Returns MyConfig | null (null if file missing or parse error)
```

### Logger (`_core/services/logger.service.ts`)

```typescript
const logger = new Logger('MyModule')
logger.log('info message')
logger.warn('warning')
logger.error('error', traceObject)
```

See Logging above: the target state is for this to emit through native `client.app.log`, not `console`.

### Prompt Templates (`_core/services/prompt-loader.service.ts`)

For tools that load a static prompt/instruction template from a `.txt` file and fill placeholders (e.g. the database plugin's large-result guidance):

```typescript
const PROMPT = PromptLoaderService.load(new URL('./prompts/my-prompt.txt', import.meta.url))
const filled = PromptLoaderService.build(PROMPT, { rowCount: '1200', threshold: '500' })
```

Templates use `{{variableName}}` placeholders.

## API Service Patterns (house library)

### HTTP Request Pipeline

API services follow a consistent pattern: private `request` method handles auth headers, URL building, error mapping:

```typescript
private readonly request = async <TResponse>(
  method: string, path: string, options?: { params?; body? }
): Promise<TResponse> => {
  const url = this.buildUrl(path, options?.params)
  const headers = this.getHeaders()       // includes auth token
  const response = await fetch(url, { method, headers, body: JSON.stringify(options?.body) })
  if (!response.ok) return this.handleErrorResponse(response)
  return this.parseResponse<TResponse>(response)
}
```

Each API service implements its own `handleErrorResponse` with service-specific error mapping (HTTP status to `PluginError` code). These are intentionally not shared - each API has different error formats.

### AWS Client Factory Pattern

House library. For AWS SDK services, use `AwsCredentialsService.createClient`:

```typescript
const client = this.credentialsService.createClient(environment, CloudWatchLogsClient)
```

AWS-specific errors use `rethrowAwsError(error, context, errorMap)` with a declarative error map.

### Config-Based Credentials

For modules that load credentials from JSON files:

- AWS: `.opencode/config/aws-credentials.json` (per-environment credentials)
- Database: `.opencode/config/databases.json` (array of connection configs)

Both use `loadJsonConfig` from `_core`.

## Formatting Service Patterns (house library)

### Confirmation Messages

For mutation tools that need a success response:

```typescript
private readonly formatSuccessMessage = (
  message: string, fields?: { label: string; value: string }[]
): string => {
  const md = MarkdownBuilder.create().text(`[PASS] ${message}`)
  if (fields?.length) {
    md.blank()
    for (const { label, value } of fields) md.field(label, value)
  }
  return md.build()
}
```

### Table Output

Use `MarkdownBuilder.table()` - never build tables with manual string concatenation.

### Empty State

Always handle empty results with a readable message:

```typescript
if (items.length === 0) {
  return `No items found in ${context}.`
}
```

## Config File Format and Discovery

Native. Understanding config resolution helps when a plugin's behavior depends on where it is loaded.

- Config is `opencode.json` **or `opencode.jsonc`** - JSONC (JSON with comments) is officially supported.
- Precedence (merged, later overrides earlier): remote (`.well-known/opencode`) to global (`~/.config/opencode/opencode.json`) to custom (`OPENCODE_CONFIG`) to project (`opencode.json`, walking up to the git root).
- The `plugin` field is an **array** of npm package names (regular or scoped) and/or `file://` paths (an entry may also be a `[name, options]` tuple). npm plugins are auto-installed with Bun at startup and cached in `~/.cache/opencode/node_modules/`. Local plugins that need external packages require a `package.json` in the config dir (`bun install` runs at startup).
- Config subdirectories use **plural** names: `agents/`, `commands/`, `modes/`, `plugins/`, `skills/`, `tools/`, `themes/`. Singular names are tolerated for back-compat but prefer plural.
- TUI settings moved to a dedicated `tui.json`/`tui.jsonc`; legacy `theme`/`keybinds`/`tui` keys in `opencode.json` are deprecated and auto-migrated.

This repo builds to `dist/index.js` and is registered by absolute `file://` path (the symlink script rewrites the `plugin` array to point at the built path).

## Build and Deploy Scripts

### `scripts/copy-assets.js`

Run as part of `pnpm build`. After TypeScript compilation, copies non-TS assets (`*.md`, `*.txt`, `*.sh`) from `src/` to `dist/` so prompt templates, skill files, and other assets are available at runtime alongside compiled JS. Also copies root `AGENTS.md` into `dist/` and generates a minimal `dist/package.json` with runtime dependencies.

### `scripts/link-global.sh`

Run via `pnpm symlink`. After building, installs project artifacts into the global OpenCode config so they are available across all projects:

- Copies `src/skills/*/` to `~/.config/opencode/skills/`
- Copies `src/commands/*.md` to `~/.config/opencode/commands/`
- Copies `opencode.json` to `~/.config/opencode/opencode.json` with the `plugin` path rewritten to `file:///absolute/path/to/dist/index.js` and the dist prompt path substituted

It copies real files (not symlinks) so containers bind-mounting `~/.config/opencode/` see real files. Run `pnpm symlink` after any change to skills, commands, or `opencode.json`. Note the destination subdirectories are plural (`skills/`, `commands/`, `agents/`), matching OpenCode's convention.

### Development Workflow

```bash
pnpm build           # compile + copy assets
pnpm symlink         # build + link globally (use after skill/command/config changes)
pnpm typecheck       # tsc --noEmit
pnpm lint            # oxlint
pnpm test            # vitest run
```

## Deliberately Not Adopted

Native capabilities the repo has consciously chosen to skip, so this does not get re-litigated:

- **`permission.ask` hook** - banned. Reported non-firing (Issue #7006) and creates a false sense of security. Use declarative `permission` config + `context.ask()` instead. See Permission Model.
- **File-based tools (`.opencode/tools/`)** - skipped in favor of plugin-registered tools for DI, shared services, and testability. See Tool Implementation.
- **`tool.execute.before/after` as tool wrappers** - not used; `BaseTool.handleErrors` already gives a uniform per-tool boundary, and these hooks fire for built-in tools too (broader blast radius than intended). Reach for them only for a genuinely global concern (e.g. blocking `.env` reads everywhere).
- **In-process SDK client for general tool logic** - the tools are outward integrations and do not need to drive OpenCode session state. The client is adopted narrowly for structured logging (`app.log`) and progress/lifecycle visibility (`tui.showToast`), not as a general dependency.

## Anti-Patterns

- Implying house-library utilities (`BaseTool`, `MarkdownBuilder`, `PluginError`, `Logger`, `PromptLoaderService`, etc.) are part of `@opencode-ai/plugin` - they are this repo's code under `_core/`
- Implementing the `permission.ask` hook (banned - non-firing, false security)
- Referencing `core/` instead of `_core/` for shared infrastructure
- Reaching for `client` through `ToolContext` - it is not there; capture it from `PluginInput` and inject it
- Using `process.cwd()` instead of `context.directory` / `context.worktree`
- Raw `console.log`/`warn`/`error` in plugin code instead of structured logging via `client.app.log`
- Making `tui.showToast` the primary progress channel instead of `context.metadata()`
- Plugin that throws during initialization instead of logging and continuing
- Tools calling API services directly (bypass orchestration layer)
- Manual string-concat markdown tables instead of `MarkdownBuilder.table()`
- Pass-through methods that just forward to another service with no added logic
- Duplicated utility helpers across services (use `_core` utilities)
- `formatBytes`/`formatSize` reimplemented per module (use `_core` `formatBytes`)
- Auth error messages without actionable instructions for the user
- Linking to `sst/opencode` instead of `anomalyco/opencode`
- Using `any` - use `unknown` and narrow
- `function` declarations - use arrow functions
