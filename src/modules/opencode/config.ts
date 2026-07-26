// Default `opencode` executable. Override with OPENCODE_BIN if installed at a
// non-standard path (e.g. nvm-managed Node, custom prefix).
export const DEFAULT_OPENCODE_BIN = 'opencode'

// Default `claude` executable used when oc_run routes a claude model.
// Override with CLAUDE_BIN.
export const DEFAULT_CLAUDE_BIN = 'claude'

// Directory for async run stdout/stderr logs. The `~` is expanded at runtime.
// Override with OPENCODE_ASYNC_LOG_DIR.
export const ASYNC_LOG_DIR = '~/.local/share/opencode/oc-async-runs'

// Default tail size when reading async run logs.
export const DEFAULT_LOG_TAIL_BYTES = 8 * 1024

// Default cap for session listing and search.
export const DEFAULT_SESSION_LIMIT = 50
export const MAX_SESSION_LIMIT = 200

// Default cap for message parts returned by oc_get_session.
export const DEFAULT_PART_LIMIT = 500
export const MAX_PART_LIMIT = 50_000
