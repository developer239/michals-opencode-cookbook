import { type Plugin } from '@opencode-ai/plugin'
import { Logger } from '../_core/services/logger.service.js'
import { OpenCodeCliService } from './services/opencode-cli.service.js'
import { OpenCodeDbService } from './services/opencode-db.service.js'
import { OpenCodeFormattingService } from './services/opencode-formatting.service.js'
import { OpenCodeRunRegistryService } from './services/opencode-run-registry.service.js'
import { GetRunStatusTool } from './tools/get-run-status.tool.js'
import { GetSessionTool } from './tools/get-session.tool.js'
import { ListSessionsTool } from './tools/list-sessions.tool.js'
import { RunTool } from './tools/run.tool.js'
import { SearchSessionsTool } from './tools/search-sessions.tool.js'

export const OpenCodePlugin: Plugin = ({ client }) => {
  const logger = new Logger('OpenCodePlugin', client)

  const db = new OpenCodeDbService(undefined, client)
  const registry = new OpenCodeRunRegistryService(undefined, client)
  const cli = new OpenCodeCliService(registry, db, { client })
  const formatting = new OpenCodeFormattingService()

  logger.log('OpenCode plugin initialized (local CLI mode)')

  /* eslint-disable camelcase -- OpenCode requires snake_case tool names */
  return Promise.resolve({
    tool: {
      oc_run: RunTool.create(cli, formatting, client),
      oc_get_run_status: GetRunStatusTool.create(cli, formatting, client),
      oc_get_session: GetSessionTool.create(db, formatting),
      oc_list_sessions: ListSessionsTool.create(db, formatting),
      oc_search_sessions: SearchSessionsTool.create(db, formatting),
    },
  })
  /* eslint-enable camelcase */
}
