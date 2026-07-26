import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { PluginInput } from '@opencode-ai/plugin'
import { Logger } from '../../_core/services/logger.service.js'
import { PluginError } from '../../_core/types/errors.js'
import { ASYNC_LOG_DIR } from '../config.js'
import type {
  IAsyncRunHandle,
  IOpenCodeRunRecord,
  IRunner,
  IRunRequest,
  ISyncRunResult,
  RunnerId,
} from '../types/opencode.types.js'
import { ClaudeRunner, isClaudeModel, isClaudeSessionId } from './claude-runner.js'
import type { OpenCodeDbService } from './opencode-db.service.js'
import type { OpenCodeRunRegistryService } from './opencode-run-registry.service.js'
import { isOpencodeSessionId, OpencodeRunner } from './opencode-runner.js'

const LOG_DIR_DEFAULT = ASYNC_LOG_DIR.replace('~', homedir())

// Runner routing: a `provider/model` id (both parts non-empty) means the
// opencode CLI; a bare claude-* id or alias means the claude CLI. Anything
// else is a hard error - an unrecognized model shape must never silently
// route to a default runner.
export const detectRunnerId = (model: string): RunnerId => {
  const slashIndex = model.indexOf('/')
  if (slashIndex !== -1) {
    if (slashIndex > 0 && slashIndex < model.length - 1) {
      return 'opencode'
    }
    throw new PluginError(
      `oc_run: malformed model \`${model}\`. Provider-prefixed ids need a non-empty provider and model ` +
        '(e.g. openai/gpt-5.5).',
      'VALIDATION_ERROR'
    )
  }
  if (isClaudeModel(model)) {
    return 'claude'
  }
  throw new PluginError(
    `oc_run: unrecognized model \`${model}\`. Opencode models need a provider prefix (e.g. openai/gpt-5.5); ` +
      'claude models are claude-* ids or the aliases fable/opus/sonnet/haiku.',
    'VALIDATION_ERROR'
  )
}

// Sessions are not portable across runtimes: opencode sessions (ses_*) live in
// opencode's SQLite, claude sessions (UUID) are JSONL transcripts under
// ~/.claude/projects/. A model/session mismatch is a hard error, and so is a
// session id that matches neither runtime's shape (e.g. an empty string, which
// would otherwise silently start a fresh session).
export const validateSessionAgreement = (runnerId: RunnerId, sessionId: string | undefined): void => {
  if (sessionId === undefined) {
    return
  }
  if (runnerId === 'claude' && !isClaudeSessionId(sessionId)) {
    const shape = isOpencodeSessionId(sessionId) ? 'an opencode session (ses_*)' : 'not a claude session id (UUID)'
    throw new PluginError(
      `oc_run: session id \`${sessionId}\` is ${shape}, but the model routes to the claude CLI. Sessions are not ` +
        'portable across runtimes - continue an opencode session with a provider/model id, or omit sessionId to ' +
        'start a new claude session.',
      'VALIDATION_ERROR'
    )
  }
  if (runnerId === 'opencode' && !isOpencodeSessionId(sessionId)) {
    if (isClaudeSessionId(sessionId)) {
      throw new PluginError(
        `oc_run: session id \`${sessionId}\` is a claude session (UUID), but the model routes to the opencode CLI. ` +
          'Sessions are not portable across runtimes - continue a claude session with a claude model id, or omit ' +
          'sessionId to start a new opencode session.',
        'VALIDATION_ERROR'
      )
    }
    throw new PluginError(
      `oc_run: session id \`${sessionId}\` is not an opencode session id (ses_*). Omit sessionId to start a new ` +
        'session.',
      'VALIDATION_ERROR'
    )
  }
}

// The prompt is user content, not dispatch metadata: written verbatim into the
// log header it can push the CLI's first JSON event arbitrarily deep into the
// file and bloats every log read. The header keeps the flags; the prompt is
// elided to its length.
export const elidePromptArg = (args: string[]): string[] => [
  ...args.slice(0, -1),
  `<prompt elided (${String(args.at(-1)?.length ?? 0)} chars)>`,
]

export class OpenCodeCliService {
  private readonly logger: Logger
  private readonly logDir: string
  private readonly opencodeRunner: OpencodeRunner
  private readonly claudeRunner: ClaudeRunner

  constructor(
    private readonly registry: OpenCodeRunRegistryService,
    db: OpenCodeDbService,
    options?: { opencodeBinary?: string; claudeBinary?: string; logDir?: string; client?: PluginInput['client'] }
  ) {
    this.logDir = options?.logDir ?? process.env.OPENCODE_ASYNC_LOG_DIR ?? LOG_DIR_DEFAULT
    this.logger = new Logger('OpencodeCli', options?.client)
    this.opencodeRunner = new OpencodeRunner(db, options?.opencodeBinary)
    this.claudeRunner = new ClaudeRunner(options?.claudeBinary)
  }

  public getRegistry = (): OpenCodeRunRegistryService => this.registry

  public runSync = (request: IRunRequest): Promise<ISyncRunResult> => {
    const normalized = this.normalizeRequest(request)
    const runner = this.resolveRunner(normalized)
    const args = runner.buildArgs(normalized, 'sync')
    this.logger.log(`sync: ${runner.binary} ${args.join(' ')}`)

    const { signal } = normalized
    if (signal?.aborted) {
      return Promise.reject(new PluginError(`${runner.id} run was aborted before it started.`, 'ABORTED'))
    }

    const child = spawn(runner.binary, args, {
      cwd: normalized.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return new Promise<ISyncRunResult>((resolve, reject) => {
      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let hasSettled = false

      const abortHandler = (): void => {
        if (hasSettled) {
          return
        }
        hasSettled = true
        // No timeout on sync runs by design; abort is the only forced stop.
        child.kill('SIGKILL')
        reject(new PluginError(`${runner.id} run was aborted.`, 'ABORTED'))
      }

      // Detach the abort listener once the child terminates so a later abort of
      // the same signal cannot fire against an already-finished run.
      const removeAbortListener = (): void => {
        if (signal) {
          signal.removeEventListener('abort', abortHandler)
        }
      }

      if (signal) {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk.toString('utf-8'))
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk.toString('utf-8'))
      })

      child.on('error', (error) => {
        if (hasSettled) {
          return
        }
        hasSettled = true
        removeAbortListener()
        reject(new PluginError(`Failed to spawn ${runner.id}: ${error.message}`, 'INTERNAL_ERROR', error))
      })

      child.on('close', (exitCode) => {
        if (hasSettled) {
          return
        }
        hasSettled = true
        removeAbortListener()
        const stdout = stdoutChunks.join('')
        const stderr = stderrChunks.join('')
        // Parse session id from the ACCUMULATED stdout, not per-chunk. JSON
        // event lines can be split across `data` events, so per-chunk parsing
        // can miss the first event entirely.
        const sessionId = normalized.sessionId ?? runner.extractSessionId(stdout)
        const { status, error } = runner.classifyCompletion(exitCode, stdout)
        resolve({
          exitCode: exitCode ?? -1,
          status,
          error,
          sessionId,
          reply: runner.extractReply(stdout),
          stdout,
          stderr,
        })
      })
    })
  }

  public runAsync = (request: IRunRequest): IAsyncRunHandle => {
    const normalized = this.normalizeRequest(request)
    const runner = this.resolveRunner(normalized)
    this.ensureLogDir()

    const runId = randomUUID()
    const logPath = join(this.logDir, `${runId}.log`)
    const args = runner.buildArgs(normalized, 'async')

    this.logger.log(`async: ${runner.binary} ${args.join(' ')} -> ${logPath}`)

    // Open the log file as a file descriptor and pass it directly to the child
    // as stdout + stderr. This is the central fix that makes "async survives
    // parent death" actually true: the child writes to the file kernel-side,
    // no parent-owned pipes, so the orchestrator can exit at any time without
    // EPIPE-ing the child.
    const logFd = openSync(logPath, 'a')
    try {
      this.writeLogHeader(logFd, runId, runner.binary, args, normalized.cwd)

      const child = spawn(runner.binary, args, {
        cwd: normalized.cwd,
        env: process.env,
        stdio: ['ignore', logFd, logFd],
        detached: true,
      })

      this.attachAsyncLifecycleHandlers(child, runId, logPath, normalized.sessionId ?? null, runner)

      const record = this.buildRunRecord(runId, logPath, child.pid ?? null, normalized, runner.id)
      this.registry.register(record)

      // Detach so the orchestrator can exit. The child holds its own copy of
      // the log fd via inheritance; closing our copy below does not affect it.
      child.unref()

      return { runId, pid: child.pid ?? null, logPath, sessionId: normalized.sessionId ?? null }
    } finally {
      // Parent no longer needs the fd. The child has its own (inherited) fd
      // and will keep writing after we close ours.
      closeSync(logFd)
    }
  }

  // Validate and normalize the request once at the entry point so both spawn.cwd
  // and the `--dir` flag operate on the same absolute path. Without this, a
  // relative `cwd` would be resolved twice (once by spawn against the parent's
  // cwd, once by opencode after spawn has already moved the child) and the two
  // paths could diverge.
  private readonly normalizeRequest = (request: IRunRequest): IRunRequest => {
    if (request.cwd !== undefined && !isAbsolute(request.cwd)) {
      throw new PluginError(`oc_run: \`cwd\` must be an absolute path, got: ${request.cwd}`, 'VALIDATION_ERROR')
    }
    return request
  }

  private readonly ensureLogDir = (): void => {
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true })
    }
  }

  private readonly writeLogHeader = (
    fd: number,
    runId: string,
    binary: string,
    args: string[],
    cwd: string | undefined
  ): void => {
    writeSync(
      fd,
      `# oc_run async dispatch\n# runId=${runId}\n# binary=${binary}\n# args=${JSON.stringify(elidePromptArg(args))}\n# cwd=${cwd ?? process.cwd()}\n# startedAt=${new Date().toISOString()}\n`
    )
  }

  private readonly buildRunRecord = (
    runId: string,
    logPath: string,
    pid: number | null,
    request: IRunRequest,
    runner: RunnerId
  ): IOpenCodeRunRecord => ({
    runId,
    pid,
    logPath,
    startedAt: Date.now(),
    cwd: request.cwd ?? process.cwd(),
    runner,
    model: request.model,
    agent: request.agent ?? null,
    command: request.command ?? null,
    prompt: request.prompt,
    sessionId: request.sessionId ?? null,
    status: 'running',
    exitCode: null,
    endedAt: null,
  })

  private readonly attachAsyncLifecycleHandlers = (
    child: import('node:child_process').ChildProcess,
    runId: string,
    logPath: string,
    requestSessionId: string | null,
    runner: IRunner
  ): void => {
    child.on('close', (exitCode) => {
      // Append a completion footer to the log via a one-shot fd open. This
      // runs only when the parent is still alive at close-time; if the parent
      // died first, the footer is missing but the log still has the child's
      // own output and `reconcileRecord` covers the gap.
      this.appendLogFooter(logPath, exitCode)
      const logText = this.readLogText(logPath)
      const sessionId = runner.extractSessionId(logText) ?? requestSessionId
      const { status, error } = runner.classifyCompletion(exitCode, logText)
      if (error !== null) {
        this.logger.warn(`Async ${runner.id} run ${runId} failed: ${error}`)
      }
      this.safeRegistryUpdate(runId, {
        status,
        exitCode: exitCode ?? -1,
        endedAt: Date.now(),
        sessionId,
      })
    })

    child.on('error', (error) => {
      this.logger.error(`Async ${runner.id} spawn error for ${runId} (pid=${child.pid ?? 'unknown'})`, error)
      this.safeRegistryUpdate(runId, { status: 'failed', endedAt: Date.now(), exitCode: -1 })
    })
  }

  private readonly appendLogFooter = (logPath: string, exitCode: number | null): void => {
    try {
      const fd = openSync(logPath, 'a')
      try {
        writeSync(fd, `\n# exitCode=${exitCode ?? -1}\n# endedAt=${new Date().toISOString()}\n`)
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      this.logger.warn(
        `Failed to append log footer for ${logPath}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private readonly safeRegistryUpdate = (runId: string, patch: Partial<IOpenCodeRunRecord>): void => {
    try {
      this.registry.update(runId, patch)
    } catch (error) {
      this.logger.warn(
        `Failed to update async run registry for ${runId}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  public readLogTail = (logPath: string, maxBytes: number): string => {
    if (!existsSync(logPath)) {
      return ''
    }
    const buf = readFileSync(logPath)
    if (buf.length <= maxBytes) {
      return buf.toString('utf-8')
    }
    return buf.subarray(buf.length - maxBytes).toString('utf-8')
  }

  public isProcessAlive = (pid: number | null): boolean => {
    if (pid === null) {
      return false
    }
    try {
      // Signal 0 tests existence without sending a signal.
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  public extractSessionIdFromFile = (logPath: string, runner: IRunner): string | null =>
    runner.extractSessionId(this.readLogText(logPath))

  // Extract the assistant's full reply from a finished async run's log. Both
  // runners stream their reply into the log (opencode as text events, claude
  // as the terminal result event), so this works without touching SQLite and
  // never truncates - the reply line is always intact in the file.
  public extractReplyForRecord = (record: IOpenCodeRunRecord): string | null =>
    this.runnerFor(record.runner).extractReply(this.readLogText(record.logPath))

  // Whole-file read: byte windows can cut JSON lines in half and silently lose
  // the event they were supposed to find.
  private readonly readLogText = (logPath: string): string => {
    if (!existsSync(logPath)) {
      return ''
    }
    try {
      return readFileSync(logPath, 'utf-8')
    } catch (error) {
      this.logger.warn(`Failed to read log ${logPath}: ${error instanceof Error ? error.message : String(error)}`)
      return ''
    }
  }

  // Cross-check the registry record against the OS and the runner's own
  // completion evidence. Used by `oc_get_run_status` to detect runs whose
  // parent process died without flushing the close handler (the child fd-mode
  // keeps writing its log even when the parent is gone, but the registry
  // update only happens in the parent's `close` listener).
  public reconcileRecord = async (record: IOpenCodeRunRecord): Promise<IOpenCodeRunRecord> => {
    if (record.status !== 'running') {
      return record
    }
    const runner = this.runnerFor(record.runner)
    if (this.isProcessAlive(record.pid)) {
      // Process still running. Best-effort hydrate the sessionId from the log
      // if we haven't captured it yet.
      if (record.sessionId === null) {
        const sessionId = this.extractSessionIdFromFile(record.logPath, runner)
        if (sessionId !== null) {
          return this.safeRegistryUpdateAndReturn(record, { sessionId })
        }
      }
      return record
    }
    // Process is gone but registry still says running. The runner infers the
    // outcome from its own evidence: opencode from a step-finish part in the
    // local SQLite, claude from the terminal result event in the log file.
    const sessionId = record.sessionId ?? this.extractSessionIdFromFile(record.logPath, runner)
    const status = await runner.inferOrphanOutcome({ ...record, sessionId })
    return this.safeRegistryUpdateAndReturn(record, {
      status,
      endedAt: Date.now(),
      exitCode: record.exitCode ?? (status === 'completed' ? 0 : -1),
      sessionId,
    })
  }

  private readonly resolveRunner = (request: IRunRequest): IRunner => {
    const runnerId = detectRunnerId(request.model)
    validateSessionAgreement(runnerId, request.sessionId)
    return this.runnerFor(runnerId)
  }

  // Records written before runner routing existed have no runner field; only
  // the opencode runner could have written them.
  private readonly runnerFor = (runnerId: RunnerId | undefined): IRunner =>
    runnerId === 'claude' ? this.claudeRunner : this.opencodeRunner

  private readonly safeRegistryUpdateAndReturn = (
    record: IOpenCodeRunRecord,
    patch: Partial<IOpenCodeRunRecord>
  ): IOpenCodeRunRecord => {
    try {
      return this.registry.update(record.runId, patch)
    } catch (error) {
      this.logger.warn(
        `Failed to reconcile async run ${record.runId}: ${error instanceof Error ? error.message : String(error)}`
      )
      return record
    }
  }
}
