import { tool, type PluginInput, type ToolContext } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import type { OpenCodeCliService } from '../services/opencode-cli.service.js'
import type { OpenCodeFormattingService } from '../services/opencode-formatting.service.js'

interface IRunArgs {
  prompt: string
  mode?: 'sync' | 'async'
  model: string
  agent?: string
  command?: string
  sessionId?: string
  cwd?: string
}

const schema = {
  prompt: tool.schema.string().describe('Prompt text or, when `command` is set, the command arguments.'),
  mode: tool.schema
    .enum(['sync', 'async'])
    .optional()
    .describe(
      'sync (default): block until the run exits and return the reply. async: spawn the run in the background ' +
        'and return a runId + sessionId immediately. Use sync for thinking-partner consultations and async for ' +
        'multi-model fanout where you want to wait on several runs in parallel.'
    ),
  model: tool.schema
    .string()
    .describe(
      'Model id. Provider-prefixed ids (e.g. openai/gpt-5.5, openai/gpt-5.6-sol) dispatch the `opencode` CLI. ' +
        'Bare claude ids (e.g. claude-fable-5, claude-mythos-5, claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5) ' +
        'or the aliases fable/opus/sonnet/haiku dispatch the `claude` CLI. Any other un-prefixed id is a validation error.'
    ),
  agent: tool.schema.string().optional().describe('Agent name passed to the dispatched CLI (e.g. orchestrator).'),
  command: tool.schema
    .string()
    .optional()
    .describe(
      'Slash-command name (e.g. review, implement) with `prompt` as its arguments. Opencode runs execute as ' +
        '`opencode run --command <name>`; claude runs prepend `/name ` to the prompt (commands are installed globally).'
    ),
  sessionId: tool.schema
    .string()
    .optional()
    .describe(
      'Existing session id to continue. Omit to start a new session - the returned sessionId can be passed back ' +
        'on subsequent calls to keep the conversation going. Sessions are runtime-bound: opencode sessions ' +
        '(ses_*) only continue with provider-prefixed models, claude sessions (UUID) only with claude models - a ' +
        'mismatch is a validation error. When resuming a claude session, pass the same `cwd` as the original run.'
    ),
  cwd: tool.schema
    .string()
    .optional()
    .describe(
      'Absolute working directory the spawned process treats as its project root. Defaults to the ' +
        "orchestrator's cwd. For opencode runs this sets where `.opencode/` overrides load from (project-local " +
        'agents, commands, skills, opencode.json), the default project for session storage, the file-watcher root, ' +
        'and the project context shown to the agent. For claude runs it is the spawn cwd, which also decides which ' +
        '~/.claude/projects/ transcript directory the session lives in - resume with the same cwd. It does NOT ' +
        'restrict what the agent can read or edit: the agent has full host filesystem access via bash/read/edit and ' +
        'can still target absolute paths in other repos. Use `cwd` to pick which project the agent is "in"; rely on ' +
        'absolute paths in the prompt when you want it to also touch a sibling repo.'
    ),
}

export class RunTool extends BaseTool<IRunArgs> {
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
    const handler = new RunTool(cli, formatting, client)
    return tool({
      description:
        'Dispatch a local agentic run against a model. The model id picks the CLI: provider-prefixed ids ' +
        '(openai/...) run `opencode`, bare claude ids or aliases (fable/opus/sonnet/haiku) run ' +
        '`claude`. Two modes: sync (block, return final reply + sessionId) and async (background, return runId + ' +
        'sessionId immediately for later polling via oc_get_run_status). Pass sessionId to continue an existing ' +
        'conversation within the same runtime; omit to start a new one. Always pass `model` explicitly - the ' +
        'platform default is not stable across orchestrator restarts.',
      args: schema,
      execute: (args, context) => handler.execute(args, context),
    })
  }

  public execute = (args: IRunArgs, context?: ToolContext): Promise<string> =>
    this.handleErrors(async () => {
      const mode = args.mode ?? 'sync'
      const description = args.command
        ? `Run /${args.command}: ${args.prompt.slice(0, 80)}`
        : `Run prompt: ${args.prompt.slice(0, 80)}`

      await this.askMutationPermission(context, 'oc_run', `${mode}: ${description}`)

      if (mode === 'async') {
        // No signal: async runs are detached and intentionally outlive this call.
        const handle = this.cli.runAsync({
          prompt: args.prompt,
          model: args.model,
          agent: args.agent,
          command: args.command,
          sessionId: args.sessionId,
          cwd: args.cwd,
        })
        // Detached job dispatched: surface it on screen so the user knows a
        // background run is now in flight. Fires only after runAsync returns a
        // handle (a dispatch failure throws and returns the error visibly).
        this.showToast(
          this.client,
          'opencode run',
          `Background run ${handle.runId} dispatched - poll with oc_get_run_status`,
          'info'
        )
        return this.formatting.formatAsyncRunHandle(handle)
      }

      context?.metadata({ title: 'Running dispatched model (sync)...' })
      const result = await this.cli.runSync({
        prompt: args.prompt,
        model: args.model,
        agent: args.agent,
        command: args.command,
        sessionId: args.sessionId,
        cwd: args.cwd,
        signal: context?.abort,
      })

      return this.formatting.formatSyncRunResult(result)
    }, 'Error dispatching run')
}
