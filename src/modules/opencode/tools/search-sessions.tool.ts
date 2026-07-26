import { tool } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import { PluginError } from '../../_core/types/errors.js'
import { DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT } from '../config.js'
import { isClaudeSessionId } from '../services/claude-runner.js'
import type { OpenCodeDbService } from '../services/opencode-db.service.js'
import type { OpenCodeFormattingService } from '../services/opencode-formatting.service.js'

interface ISearchSessionsArgs {
  query: string
  limit?: number
}

const schema = {
  query: tool.schema
    .string()
    .describe('Substring matched against session title and message part content (case-sensitive).'),
  limit: tool.schema
    .number()
    .optional()
    .describe(`Max sessions to return (default ${String(DEFAULT_SESSION_LIMIT)}, max ${String(MAX_SESSION_LIMIT)}).`),
}

export class SearchSessionsTool extends BaseTool<ISearchSessionsArgs> {
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
    const handler = new SearchSessionsTool(db, formatting)
    return tool({
      description:
        'Search local OpenCode sessions by substring match against the title or any message part content. Reads ' +
        'from the host SQLite at ~/.local/share/opencode/opencode.db. Opencode sessions only - claude sessions ' +
        '(UUID ids) never appear here.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: ISearchSessionsArgs): Promise<string> =>
    this.handleErrors(async () => {
      if (isClaudeSessionId(args.query.trim())) {
        throw new PluginError(
          `Query \`${args.query.trim()}\` is a claude session id (UUID). The oc_* session tools read only ` +
            "opencode's SQLite store; claude transcripts live as JSONL under ~/.claude/projects/. Continue it " +
            'via oc_run with a claude model and this sessionId instead.',
          'VALIDATION_ERROR'
        )
      }

      const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_SESSION_LIMIT, MAX_SESSION_LIMIT))
      const sessions = await this.db.searchSessions(args.query, limit)
      return this.formatting.formatSessionList(sessions)
    }, 'Error searching sessions')
}
