export interface IConversationSession {
  id: string
  title: string
  directory: string
  createdAt: number
  updatedAt: number
}

export interface IMessagePart {
  messageId: string
  role: string
  partType: string
  content: string | null
  timestamp: number
  modelId: string | null
  providerId: string | null
  agent: string | null
}

export type RunnerId = 'opencode' | 'claude'

export type RunMode = 'sync' | 'async'

export interface IRunRequest {
  prompt: string
  model: string
  agent?: string
  command?: string
  sessionId?: string
  cwd?: string
  // Optional cancellation for a SYNC run. On abort the child opencode process
  // is killed and runSync rejects with an ABORTED error. Ignored by runAsync,
  // which is detached and intentionally outlives the caller.
  signal?: AbortSignal
}

export interface ISyncRunResult {
  exitCode: number
  status: TerminalRunStatus
  error: string | null
  sessionId: string | null
  reply: string | null
  stdout: string
  stderr: string
}

export interface IAsyncRunHandle {
  runId: string
  pid: number | null
  logPath: string
  sessionId: string | null
}

export type AsyncRunStatus = 'running' | 'completed' | 'failed'

export type TerminalRunStatus = Exclude<AsyncRunStatus, 'running'>

export interface ICompletionClassification {
  status: TerminalRunStatus
  error: string | null
}

// The per-runner seam: everything that differs between dispatching the
// `opencode` CLI and the `claude` CLI. Binary resolution, argv shape, output
// parsing, completion classification, and orphaned-run outcome inference are
// runner-owned; the shared spawn/abort/log-fd/registry machinery in
// OpenCodeCliService is not.
export interface IRunner {
  readonly id: RunnerId
  readonly binary: string
  buildArgs: (request: IRunRequest, mode: RunMode) => string[]
  extractSessionId: (text: string) => string | null
  extractReply: (text: string) => string | null
  // Decide the terminal outcome from the exit code AND the run's own output
  // (sync stdout or the full async log). Exit codes alone are not trusted:
  // claude reports failures in the terminal result event (is_error, errors),
  // which is authoritative over the process exit code.
  classifyCompletion: (exitCode: number | null, output: string) => ICompletionClassification
  inferOrphanOutcome: (record: IOpenCodeRunRecord) => Promise<TerminalRunStatus>
}

export interface IOpenCodeRunRecord {
  runId: string
  pid: number | null
  logPath: string
  startedAt: number
  endedAt: number | null
  cwd: string
  // Absent on records written before runner routing existed; treated as
  // 'opencode' when read back (the only runner that could have written them).
  runner?: RunnerId
  model: string | null
  agent: string | null
  command: string | null
  prompt: string
  sessionId: string | null
  status: AsyncRunStatus
  exitCode: number | null
  // Set once oc_get_run_status has surfaced the terminal (completed/failed)
  // toast for this run, so polling a finished run does not re-toast on every
  // tick. Persisted with the record so a restart cannot re-toast an old run.
  terminalToastSent?: boolean
}
