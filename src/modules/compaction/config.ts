// Claude Code names a tool of the cookbook's MCP server with this prefix;
// OpenCode names it bare, so tool names are compared without it.
export const MCP_TOOL_PREFIX = 'mcp__opencode__'
// A session that has called a tool with this prefix is an orchestration.
export const ORCH_TOOL_PREFIX = 'orch_'

// The writer's prompt must fit its context window, which the installer passes
// as --writer-context-tokens. Part of the window goes to what the writer call
// adds on its own (its system prompt, the memory files `claude -p` loads, and
// the handoff it writes), and the rest is converted to characters, since
// there is no tokenizer here. Both numbers are estimates: English prose runs
// near 4 characters per token and code or JSON near 3, so 3 keeps a
// code-heavy session inside the window.
export const WRITER_RESERVED_TOKENS = 40_000
export const PROMPT_CHARS_PER_TOKEN = 3

// Tool results are the only entries dropped to fit the writer's window, in
// the order they are cheapest to recover: output that is a function of the
// files on disk first, shell output next, and everything else (subagent
// reports, database and web results) last. Tool names are compared without
// MCP_TOOL_PREFIX.
export const TREE_READ_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'codebase_project_structure',
  'codebase_find_definition',
  'codebase_trace_calls',
  'codebase_find_unused_symbols',
])
export const SHELL_TOOLS = new Set(['Bash'])

// The Claude Code tools that write a file, each with the input field that
// names it; the record lists every file they wrote.
export const FILE_WRITING_TOOLS = new Map([
  ['Edit', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
])

// Handoffs are written under the Claude Code config directory, one directory
// per session, newest file last in name order.
export const HANDOFF_DIR_NAME = 'handoffs'

// The writer call's own bound, used when the installer does not pass
// --writer-timeout-seconds. Kept below Claude Code's PreCompact hook default
// (600s) so a hanging writer fails inside this process, guaranteeing a
// handoff (success or failure) is written before the hook's own deadline
// could kill it with nothing written at all.
export const DEFAULT_WRITER_TIMEOUT_MS = 540_000
