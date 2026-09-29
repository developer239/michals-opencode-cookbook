import { spawnSync } from 'node:child_process'
import { DEFAULT_CLAUDE_BIN } from '../../opencode/config.js'
import { DEFAULT_WRITER_TIMEOUT_MS } from '../config.js'

export interface IHandoffWriterResult {
  isOk: boolean
  text: string
}

export class HandoffWriterService {
  private readonly binary: string

  constructor(binary?: string) {
    this.binary = binary ?? process.env.CLAUDE_BIN ?? DEFAULT_CLAUDE_BIN
  }

  // A one-shot, tool-less, session-less writer call. The prompt goes on stdin,
  // not argv, because a session record can be large enough to overrun an
  // argv length limit; --tools "" and --strict-mcp-config keep the writer
  // from acting on the repo when its only job is to summarize a transcript;
  // --no-session-persistence keeps this call out of the session store the
  // real work happens in. `timeoutMs` bounds the call itself, below the
  // PreCompact hook's own deadline, so a hanging writer fails here with a
  // failure handoff instead of the hook being killed with nothing written.
  public readonly write = (
    model: string,
    prompt: string,
    timeoutMs: number = DEFAULT_WRITER_TIMEOUT_MS
  ): IHandoffWriterResult => {
    const result = spawnSync(
      this.binary,
      ['-p', '--model', model, '--tools', '', '--strict-mcp-config', '--no-session-persistence'],
      { input: prompt, encoding: 'utf-8', timeout: timeoutMs }
    )
    if (result.error !== undefined) {
      const isTimeout = 'code' in result.error && result.error.code === 'ETIMEDOUT'
      return isTimeout
        ? { isOk: false, text: `${this.binary} timed out after ${String(timeoutMs)}ms` }
        : { isOk: false, text: `Failed to spawn ${this.binary}: ${result.error.message}` }
    }
    if (result.status !== 0) {
      return { isOk: false, text: `${this.binary} exited ${String(result.status)}: ${result.stderr.trim()}` }
    }
    const text = result.stdout.trim()
    if (text.length === 0) {
      return { isOk: false, text: `${this.binary} produced no output. stderr: ${result.stderr.trim()}` }
    }
    return { isOk: true, text }
  }
}
