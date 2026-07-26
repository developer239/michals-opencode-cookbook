import type { PluginInput } from '@opencode-ai/plugin'

// The in-process OpenCode SDK client, as handed to a plugin via PluginInput.
// Derived from PluginInput so we do not depend on @opencode-ai/sdk directly.
type OpencodeClient = PluginInput['client']

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ILoggerOptions {
  // Also print to the console even when a client is present. Console output is
  // only human-visible at CLI startup, whereas client.app.log goes to the
  // structured server log. Auth, credential, and connection loggers set this so
  // their startup status (e.g. "SSH tunnel established", "JIRA credentials
  // valid") stays visible on the console while ALSO reaching the structured log.
  shouldMirrorToConsole?: boolean
}

// Structured logger. When constructed with the plugin's SDK client it routes
// through client.app.log (structured, level-tagged, visible in the OpenCode
// server logs); without a client it falls back to console. The client is only
// available inside a plugin entry point (PluginInput), so modules are migrated
// one at a time by threading it down from their .plugin.ts - callers that have
// not been migrated yet keep the exact console behavior.
//
// Pass { shouldMirrorToConsole: true } to emit to BOTH sinks when a client is
// present. The default (no options) is unchanged: client-only when a client is
// wired, console-only otherwise.
export class Logger {
  private readonly shouldMirrorToConsole: boolean

  constructor(
    private readonly context: string,
    private readonly client?: OpencodeClient,
    options?: ILoggerOptions
  ) {
    this.shouldMirrorToConsole = options?.shouldMirrorToConsole ?? false
  }

  public log(message: string): void {
    this.emit('info', message)
  }

  public error(message: string, trace?: unknown): void {
    this.emit('error', message, trace)
  }

  public warn(message: string, trace?: unknown): void {
    this.emit('warn', message, trace)
  }

  public debug(message: string): void {
    this.emit('debug', message)
  }

  private readonly emit = (level: LogLevel, message: string, trace?: unknown): void => {
    const { client } = this
    if (client === undefined) {
      this.emitToConsole(level, message, trace)
      return
    }
    this.emitToClient(client, level, message, trace)
    if (this.shouldMirrorToConsole) {
      this.emitToConsole(level, message, trace)
    }
  }

  // Fire-and-forget: app.log is an async in-process HTTP call, but the logging
  // API is synchronous void, so we do not await it and we swallow any rejection
  // (a failed log line must never crash or reject into the caller).
  private readonly emitToClient = (client: OpencodeClient, level: LogLevel, message: string, trace?: unknown): void => {
    const extra = trace === undefined ? undefined : { trace: this.serializeTrace(trace) }
    client.app.log({ body: { service: this.context, level, message, ...(extra ? { extra } : {}) } }).catch(this.ignore)
  }

  private readonly ignore = (): void => {
    // A failed log line is intentionally silent - there is nowhere left to log it.
  }

  // Fixed-width, level-tagged line so startup output reads as an aligned column
  // and is trivially greppable (e.g. `grep 'WARN '`). Example:
  //   INFO  [DatabaseSshTunnel] Tunnel local established on port 54123
  //   WARN  [AwsCredentials] No AWS environments configured
  private readonly emitToConsole = (level: LogLevel, message: string, trace?: unknown): void => {
    const label = level.toUpperCase().padEnd(5, ' ')
    const formatted = `${label} [${this.context}] ${message}`
    /* eslint-disable no-console -- console is the deliberate fallback when no SDK client is wired */
    switch (level) {
      case 'error':
        console.error(formatted, trace ?? '')
        return
      case 'warn':
        console.warn(formatted, trace ?? '')
        return
      case 'debug':
        console.debug(formatted)
        return
      case 'info':
      default:
        console.log(formatted)
    }
    /* eslint-enable no-console */
  }

  // Errors do not JSON-serialize usefully (JSON.stringify(new Error()) is "{}"),
  // so flatten to a readable string for the structured `extra` field.
  private readonly serializeTrace = (trace: unknown): string => {
    if (trace instanceof Error) {
      return trace.stack ?? `${trace.name}: ${trace.message}`
    }
    if (typeof trace === 'string') {
      return trace
    }
    try {
      return JSON.stringify(trace)
    } catch {
      return String(trace)
    }
  }
}
