import { tool } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import { DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT } from '../config.js'
import type { OpenCodeDbService } from '../services/opencode-db.service.js'
import type { OpenCodeFormattingService } from '../services/opencode-formatting.service.js'

interface IListSessionsArgs {
  limit?: number
}

const schema = {
  limit: tool.schema
    .number()
    .optional()
    .describe(
      `Max sessions to return (default ${String(DEFAULT_SESSION_LIMIT)}, max ${String(MAX_SESSION_LIMIT)}). Sorted by last-updated descending.`
    ),
}

export class ListSessionsTool extends BaseTool<IListSessionsArgs> {
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
    const handler = new ListSessionsTool(db, formatting)
    return tool({
      description:
        'List local OpenCode sessions ordered by last-updated descending. Reads from the host SQLite at ' +
        '~/.local/share/opencode/opencode.db (or the path under $OPENCODE_DB_PATH).',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IListSessionsArgs): Promise<string> =>
    this.handleErrors(async () => {
      const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT))
      const sessions = await this.db.listSessions(limit)
      return this.formatting.formatSessionList(sessions)
    }, 'Error listing sessions')
}
