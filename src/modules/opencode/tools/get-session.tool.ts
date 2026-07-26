import { tool } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import { PluginError } from '../../_core/types/errors.js'
import { DEFAULT_PART_LIMIT, MAX_PART_LIMIT } from '../config.js'
import { isClaudeSessionId } from '../services/claude-runner.js'
import type { OpenCodeDbService } from '../services/opencode-db.service.js'
import type { OpenCodeFormattingService } from '../services/opencode-formatting.service.js'

interface IGetSessionArgs {
  sessionId: string
  limit?: number
  isFromEnd?: boolean
}

const schema = {
  sessionId: tool.schema.string().describe('Session ID to read.'),
  limit: tool.schema
    .number()
    .optional()
    .describe(
      `Max parts to return (default ${String(DEFAULT_PART_LIMIT)}, max ${String(MAX_PART_LIMIT)}). ` +
        'For a quick read of the latest reply, a small limit like 15-30 is usually enough.'
    ),
  isFromEnd: tool.schema
    .boolean()
    .optional()
    .describe(
      'When true (default), return the MOST RECENT N parts in chronological order so the assistant reply at the ' +
        'tail is always included. Set to false for session archaeology (reading the opening turns).'
    ),
}

export class GetSessionTool extends BaseTool<IGetSessionArgs> {
  constructor(
    private readonly db: OpenCodeDbService,
    private readonly formatting: OpenCodeFormattingService
  ) {
    super()
  }

  public static readonly create = (
    db: OpenCodeDbService,
    formatting: OpenCodeFormattingService
  ): ReturnType<typeof tool> => {
    const handler = new GetSessionTool(db, formatting)
    return tool({
      description:
        'Read message parts for a session from the local OpenCode SQLite database. Replaces the prior ' +
        'oc_get_run_output / oc_get_session_messages split: pass fromEnd=true to get the assistant reply at the ' +
        'tail (e.g. after a short consultation), or fromEnd=false to walk the conversation from the start. ' +
        'Opencode sessions (ses_*) only - claude sessions (UUID ids) are not readable here.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IGetSessionArgs): Promise<string> =>
    this.handleErrors(async () => {
      if (isClaudeSessionId(args.sessionId)) {
        throw new PluginError(
          `Session \`${args.sessionId}\` is a claude session (UUID id). The oc_* session tools read only ` +
            "opencode's SQLite store; claude transcripts live as JSONL under ~/.claude/projects/. Continue it " +
            'via oc_run with a claude model and this sessionId instead.',
          'VALIDATION_ERROR'
        )
      }

      const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_PART_LIMIT, MAX_PART_LIMIT))
      const isFromEnd = args.isFromEnd ?? true
      const total = await this.db.getSessionPartCount(args.sessionId)
      const messages = await this.db.getSessionMessages(args.sessionId, limit, isFromEnd)
      return this.formatting.formatMessages(args.sessionId, messages, total)
    }, 'Error reading session')
}
