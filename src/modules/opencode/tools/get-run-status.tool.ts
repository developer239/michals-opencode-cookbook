import { tool, type PluginInput } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import { PluginError } from '../../_core/types/errors.js'
import { DEFAULT_LOG_TAIL_BYTES } from '../config.js'
import type { OpenCodeCliService } from '../services/opencode-cli.service.js'
import type { OpenCodeFormattingService } from '../services/opencode-formatting.service.js'
import type { IOpenCodeRunRecord } from '../types/opencode.types.js'

interface IGetRunStatusArgs {
  runId: string
  logTailBytes?: number
}

const schema = {
  runId: tool.schema.string().describe('Async run id returned by oc_run mode=async.'),
  logTailBytes: tool.schema
    .number()
    .optional()
    .describe(
      `Bytes of raw log tail to include when there is no extracted reply (default ${String(DEFAULT_LOG_TAIL_BYTES)}). ` +
        'Set to 0 to omit. Once a completed run has its reply extracted, the reply is returned in full instead of ' +
        'the raw tail.'
    ),
}

export class GetRunStatusTool extends BaseTool<IGetRunStatusArgs> {
  constructor(
    private readonly cli: OpenCodeCliService,
    private readonly formatting: OpenCodeFormattingService,
    private readonly client?: PluginInput['client']
  ) {
    super()
  }

  public static readonly create = (
    cli: OpenCodeCliService,
    formatting: OpenCodeFormattingService,
    client?: PluginInput['client']
  ): ReturnType<typeof tool> => {
    const handler = new GetRunStatusTool(cli, formatting, client)
    return tool({
      description:
        'Check the status of an async run dispatched via oc_run with mode=async (opencode or claude). Returns ' +
        'running/completed/failed, exit code, sessionId, and - once the run is finished - the full assistant reply ' +
        'parsed from the run log (no truncation). The raw log tail is included only while there is no reply to ' +
        'show (still running, or failed). Use this to poll fanout runs and to recover after a web-terminal ' +
        'reconnect when you only have the runId.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IGetRunStatusArgs): Promise<string> =>
    this.handleErrors(async () => {
      const record = this.cli.getRegistry().get(args.runId)
      if (record === null) {
        throw new PluginError(`Unknown async run id: ${args.runId}`, 'NOT_FOUND')
      }

      const reconciled = await this.cli.reconcileRecord(record)
      const isAlive = this.cli.isProcessAlive(reconciled.pid)

      this.toastOnTerminalTransition(reconciled)

      // A finished run's reply is returned in full, parsed from the log - the
      // raw tail (init/thinking/assistant event noise, byte-truncated) is only
      // useful as a diagnostic while running or after a failure.
      const reply = reconciled.status === 'running' ? null : this.cli.extractReplyForRecord(reconciled)
      const tailBytes = args.logTailBytes ?? DEFAULT_LOG_TAIL_BYTES
      const shouldShowTail = reply === null && tailBytes > 0
      const logTail = shouldShowTail ? this.cli.readLogTail(reconciled.logPath, tailBytes) : ''

      return this.formatting.formatAsyncRunStatus(reconciled, isAlive, logTail, reply)
    }, 'Error reading async run status')

  // Surface a completed/failed background run on screen exactly once. Polling a
  // finished run repeatedly must not re-toast, so we gate on the persisted
  // terminalToastSent flag and set it the first time we observe the terminal
  // state (which correctly fires even if the run was already terminal on the
  // very first poll).
  private readonly toastOnTerminalTransition = (record: IOpenCodeRunRecord): void => {
    if (record.status === 'running' || record.terminalToastSent === true) {
      return
    }

    if (record.status === 'completed') {
      this.showToast(this.client, 'opencode run', `Background run ${record.runId} completed`, 'success')
    } else {
      this.showToast(
        this.client,
        'opencode run',
        `Background run ${record.runId} failed (exit ${record.exitCode ?? 'unknown'})`,
        'error'
      )
    }

    this.cli.getRegistry().update(record.runId, { terminalToastSent: true })
  }
}
