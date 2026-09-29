import { MCP_TOOL_PREFIX, ORCH_TOOL_PREFIX } from '../config.js'
import {
  COMPACTION_PROFILES,
  type CompactionProfile,
  type IProfileChoice,
  type SessionEvent,
} from '../types/compaction.types.js'

const KNOWN_PROFILES: readonly string[] = COMPACTION_PROFILES
// Anchored to the start of a line (the `m` flag scopes `^` per line, not just
// per string) so the override only fires for a line meant as one, not a
// passing mention of the phrase inside prose or a quoted example. `g` lets
// findExplicitProfile walk every match in a message to find the true last one.
const EXPLICIT_PROFILE_PATTERN = /^compaction profile:\s*(?<name>\S+)/gimu

export class ProfileChoiceService {
  // Choice order: an explicit `compaction profile: <name>` line (the last one
  // wins; an unknown name does not count), else `orchestration` when the
  // session has called an orch tool, else `default`.
  public readonly choose = (events: SessionEvent[]): IProfileChoice => {
    const explicit = this.findExplicitProfile(events)
    const profile = explicit ?? (this.hasOrchToolCall(events) ? 'orchestration' : 'default')
    return { profile, taskDir: profile === 'orchestration' ? this.findTaskDir(events) : null }
  }

  private readonly hasOrchToolCall = (events: SessionEvent[]): boolean =>
    events.some((event) => event.kind === 'tool_call' && this.isOrchTool(event.tool))

  private readonly isOrchTool = (tool: string): boolean => this.stripMcpPrefix(tool).startsWith(ORCH_TOOL_PREFIX)

  private readonly stripMcpPrefix = (tool: string): string =>
    tool.startsWith(MCP_TOOL_PREFIX) ? tool.slice(MCP_TOOL_PREFIX.length) : tool

  private readonly findExplicitProfile = (events: SessionEvent[]): CompactionProfile | null => {
    let found: CompactionProfile | null = null
    for (const event of events) {
      if (event.kind !== 'user') {
        continue
      }
      for (const match of event.text.matchAll(EXPLICIT_PROFILE_PATTERN)) {
        const candidate = match.groups?.name
        if (candidate !== undefined && KNOWN_PROFILES.includes(candidate)) {
          found = candidate as CompactionProfile
        }
      }
    }
    return found
  }

  // The taskDir input of the session's last orch tool call that has one; null
  // for the default profile or when no such call exists.
  private readonly findTaskDir = (events: SessionEvent[]): string | null => {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.kind !== 'tool_call' || !this.isOrchTool(event.tool)) {
        continue
      }
      const { taskDir } = event.input
      if (typeof taskDir === 'string' && taskDir.length > 0) {
        return taskDir
      }
    }
    return null
  }
}
