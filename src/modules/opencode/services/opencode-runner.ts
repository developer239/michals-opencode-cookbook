import { DEFAULT_OPENCODE_BIN } from '../config.js'
import type { IOpenCodeRunRecord, IRunner, TerminalRunStatus } from '../types/opencode.types.js'
import type { OpenCodeDbService } from './opencode-db.service.js'

interface IParsedJsonEvent {
  type?: string
  sessionID?: string
  part?: { type?: string; text?: string; sessionID?: string }
}

// Opencode session ids are prefixed (e.g. ses_abc...). Claude session ids are
// UUIDs - see claude-runner.ts.
export const isOpencodeSessionId = (sessionId: string): boolean => sessionId.startsWith('ses_')

export class OpencodeRunner implements IRunner {
  public readonly id = 'opencode' as const
  public readonly binary: string

  constructor(
    private readonly db: OpenCodeDbService,
    binary?: string
  ) {
    this.binary = binary ?? process.env.OPENCODE_BIN ?? DEFAULT_OPENCODE_BIN
  }

  // Same argv for sync and async: the JSON event stream serves both the
  // blocking reader and the detached log file, so the mode is ignored.
  public buildArgs: IRunner['buildArgs'] = (request) => {
    const args: string[] = ['run', '--format', 'json']
    if (request.model) {
      args.push('--model', request.model)
    }
    if (request.agent) {
      args.push('--agent', request.agent)
    }
    if (request.sessionId) {
      args.push('--session', request.sessionId)
    }
    if (request.command) {
      args.push('--command', request.command)
    }
    // `cwd` is also passed to spawn() so the child's `pwd` reflects it, but
    // opencode itself picks its project root from `--dir`, not process.cwd().
    // Without this flag, the child finds the orchestrator's project root
    // (whatever opencode-the-orchestrator was launched in), which then sets
    // the project context, file-watcher root, and codebase tool scope to the
    // wrong tree - even though `pwd` inside the child looks correct.
    if (request.cwd) {
      args.push('--dir', request.cwd)
    }
    args.push(request.prompt)
    return args
  }

  public extractSessionId = (text: string): string | null => {
    // Per-line JSON; the first event line includes `sessionID` either at the
    // top level or nested under `part`. `text` here is the accumulated output,
    // not a single `data` chunk, so line boundaries are reliable.
    for (const parsed of this.parseJsonLines(text)) {
      const candidate = parsed.sessionID ?? parsed.part?.sessionID
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate
      }
    }
    return null
  }

  // The assistant's reply is the concatenation of every `text` event in the
  // final assistant message (typically just one). Tool-call events and step
  // boundaries are ignored.
  public extractReply = (stdout: string): string | null => {
    const chunks: string[] = []
    for (const parsed of this.parseJsonLines(stdout)) {
      if (parsed.type === 'text' && typeof parsed.part?.text === 'string') {
        chunks.push(parsed.part.text)
      }
    }
    const reply = chunks.join('')
    return reply.length > 0 ? reply : null
  }

  // Opencode has no in-band error event; the process exit code is the only
  // completion signal for a run whose parent observed the exit, so the output
  // text is ignored.
  public classifyCompletion: IRunner['classifyCompletion'] = (exitCode) => ({
    status: exitCode === 0 ? 'completed' : 'failed',
    error: null,
  })

  // Opencode writes every session to the local SQLite, so a step-finish part
  // after the run started is the completion marker.
  public inferOrphanOutcome = async (record: IOpenCodeRunRecord): Promise<TerminalRunStatus> => {
    if (record.sessionId !== null && (await this.db.hasStepFinish(record.sessionId, record.startedAt))) {
      return 'completed'
    }
    return 'failed'
  }

  private readonly parseJsonLines = (text: string): IParsedJsonEvent[] => {
    const events: IParsedJsonEvent[] = []
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0 || !trimmed.startsWith('{')) {
        continue
      }
      try {
        events.push(JSON.parse(trimmed) as IParsedJsonEvent)
      } catch {
        continue
      }
    }
    return events
  }
}
