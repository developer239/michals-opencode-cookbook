import { existsSync, readFileSync } from 'node:fs'
import { DEFAULT_CLAUDE_BIN } from '../config.js'
import type {
  ICompletionClassification,
  IOpenCodeRunRecord,
  IRunner,
  IRunRequest,
  RunMode,
  TerminalRunStatus,
} from '../types/opencode.types.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

// Model ids the claude CLI accepts without a provider prefix: full names
// (claude-fable-5, claude-opus-4-8, ...) and the documented aliases. The
// prefix check requires the `claude-` dash so lookalikes (claudette) or the
// bare word `claude` fail detection instead of routing to a CLI that would
// reject them anyway.
const CLAUDE_MODEL_ALIASES = new Set(['fable', 'opus', 'sonnet', 'haiku'])

interface IClaudeResultEvent {
  type?: string
  subtype?: string
  session_id?: string
  result?: string
  is_error?: boolean
  errors?: string[]
}

export const isClaudeModel = (model: string): boolean => model.startsWith('claude-') || CLAUDE_MODEL_ALIASES.has(model)

// Claude session ids are UUIDs (JSONL transcripts under ~/.claude/projects/).
// Opencode session ids are ses_-prefixed and live in opencode's SQLite.
export const isClaudeSessionId = (sessionId: string): boolean => UUID_PATTERN.test(sessionId)

export class ClaudeRunner implements IRunner {
  public readonly id = 'claude' as const
  public readonly binary: string

  constructor(binary?: string) {
    this.binary = binary ?? process.env.CLAUDE_BIN ?? DEFAULT_CLAUDE_BIN
  }

  // Sync runs use `--output-format json`: a single result object whose `result`
  // field is the reply. Async runs use `--output-format stream-json --verbose`:
  // JSONL whose init event carries the session id early in the log and whose
  // final `result` event carries the reply and exit state.
  public buildArgs = (request: IRunRequest, mode: RunMode): string[] => {
    const args: string[] = ['-p', '--output-format', mode === 'async' ? 'stream-json' : 'json']
    if (mode === 'async') {
      args.push('--verbose')
    }
    if (request.model) {
      args.push('--model', request.model)
    }
    if (request.agent) {
      args.push('--agent', request.agent)
    }
    if (request.sessionId) {
      args.push('--resume', request.sessionId)
    }
    // No `--dir` equivalent: spawn cwd alone decides the project. There is no
    // `--command` flag either - slash commands are invoked by prepending the
    // command to the prompt (commands are installed globally by this repo).
    args.push(request.command ? `/${request.command} ${request.prompt}` : request.prompt)
    return args
  }

  public extractSessionId = (text: string): string | null => {
    for (const parsed of this.parseJsonEvents(text)) {
      if (typeof parsed.session_id === 'string' && parsed.session_id.length > 0) {
        return parsed.session_id
      }
    }
    return null
  }

  public extractReply = (stdout: string): string | null => {
    for (const parsed of this.parseJsonEvents(stdout)) {
      if (typeof parsed.result === 'string' && parsed.result.length > 0) {
        return parsed.result
      }
    }
    return null
  }

  // The terminal `result` event is authoritative: is_error marks a failure
  // regardless of the process exit code, and a missing result event means the
  // run never finished cleanly even when the exit code is 0.
  public classifyCompletion = (exitCode: number | null, output: string): ICompletionClassification => {
    for (const parsed of this.parseJsonEvents(output)) {
      if (parsed.type !== 'result') {
        continue
      }
      if (parsed.is_error === true) {
        const detail = parsed.errors?.length ? parsed.errors.join('; ') : 'no error detail'
        return { status: 'failed', error: `${parsed.subtype ?? 'error'}: ${detail}` }
      }
      return { status: 'completed', error: null }
    }
    return {
      status: 'failed',
      error: `claude produced no terminal result event (exit code ${exitCode ?? 'unknown'})`,
    }
  }

  // Claude runs never appear in opencode's SQLite, so orphan outcome is
  // inferred from the log itself via the same terminal-event classification.
  public inferOrphanOutcome = (record: IOpenCodeRunRecord): Promise<TerminalRunStatus> =>
    Promise.resolve(this.classifyCompletion(record.exitCode, this.readLog(record.logPath)).status)

  // Handles both output shapes: one JSON object per line (stream-json, and
  // json when compact) and a single multi-line JSON object (json when pretty).
  private readonly parseJsonEvents = (text: string): IClaudeResultEvent[] => {
    const events: IClaudeResultEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || !trimmed.startsWith('{')) {
        continue
      }
      try {
        events.push(JSON.parse(trimmed) as IClaudeResultEvent)
      } catch {
        continue
      }
    }

    if (events.length === 0) {
      try {
        events.push(JSON.parse(text.trim()) as IClaudeResultEvent)
      } catch {
        // Not JSON at all - no events.
      }
    }
    return events
  }

  // Whole-file read, no byte window: a bounded tail can start mid-JSON-line
  // and silently drop a result event whose line is larger than the window.
  private readonly readLog = (logPath: string): string => {
    if (!existsSync(logPath)) {
      return ''
    }
    try {
      return readFileSync(logPath, 'utf-8')
    } catch {
      return ''
    }
  }
}
