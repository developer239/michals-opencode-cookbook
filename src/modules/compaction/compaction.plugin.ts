import type { Plugin } from '@opencode-ai/plugin'
import { PromptLoaderService } from '../_core/services/prompt-loader.service.js'
import { GitStateService } from './services/git-state.service.js'
import { OpencodeSessionParserService } from './services/opencode-session-parser.service.js'
import { ProfileChoiceService } from './services/profile-choice.service.js'

const NO_TASK_DIR_TEXT = 'unknown - no orch tool call in this session named one'

const loadPrompt = (name: string): string => PromptLoaderService.load(new URL(`./prompts/${name}.txt`, import.meta.url))

// Hooks-only: no tools, so this plugin is exported from src/index.ts and not
// registered in the MCP bridge (src/mcp/server.ts only bridges tools; Claude
// Code gets the equivalent behavior from its own PreCompact/SessionStart
// hooks, wired up by scripts/link-claude-code.sh).
export const CompactionPlugin: Plugin = async ({ client, directory }) => {
  const parser = new OpencodeSessionParserService()
  const chooser = new ProfileChoiceService()

  return {
    // OpenCode has one hook point, not Claude Code's PreCompact/SessionStart
    // pair: this prompt drives the same LLM call that produces the compaction
    // summary, and that summary is what the session resumes from - there is
    // no separate handoff file and no later injection step.
    'experimental.session.compacting': async ({ sessionID }, output) => {
      const { data } = await client.session.messages({ path: { id: sessionID } })
      const { profile, taskDir } = chooser.choose(parser.parse(data ?? []))
      const instructions = PromptLoaderService.build(loadPrompt(`${profile}-handoff`), {
        taskDir: taskDir ?? NO_TASK_DIR_TEXT,
      })
      // Only the project root is scoped here, unlike Claude Code's cwd plus
      // every written file's directory - OpenCode's own tool names for a
      // file write are not the Claude Code names config.ts's
      // FILE_WRITING_TOOLS matches, so that expansion does not apply as is.
      const gitState = new GitStateService().describe([directory])
      const resumeSteps = loadPrompt(`${profile}-resume`).trim()
      output.prompt =
        `${instructions}\n\n${gitState}\n\nWrite the handoff above as your compaction summary - it is what this ` +
        `session resumes from. This session's id is ${sessionID}; if anything needs the exact original wording, ` +
        `it is still readable with oc_get_session or oc_search_sessions. After the handoff, add: ${resumeSteps}`
    },
  }
}
