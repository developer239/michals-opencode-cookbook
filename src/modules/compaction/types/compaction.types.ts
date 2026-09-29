import type { PluginInput } from '@opencode-ai/plugin'

// A compaction profile decides what the handoff written at a compaction
// carries and what the session is told to do right after it: the default
// profile for any session, and a profile per flow that needs more.
export const COMPACTION_PROFILES = ['default', 'orchestration'] as const
export type CompactionProfile = (typeof COMPACTION_PROFILES)[number]

// OpenCode's Message and Part types are not a direct dependency of this
// package (only @opencode-ai/plugin is; @opencode-ai/sdk is its transitive
// dependency and not resolvable from here), so they are derived structurally
// from PluginInput's own client type instead of imported by name.
type OpencodeClient = PluginInput['client']
type SessionMessagesResult = Awaited<ReturnType<OpencodeClient['session']['messages']>>
export type OpencodeMessageEntry = NonNullable<SessionMessagesResult['data']>[number]
export type OpencodePart = OpencodeMessageEntry['parts'][number]

// One thing that happened in a session, in the order it happened: what the
// profile is chosen from and what the handoff record is condensed from, the
// same for a Claude Code transcript and an OpenCode session.
export type SessionEvent =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool_call'; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; tool: string; text: string }

export interface IProfileChoice {
  profile: CompactionProfile
  // The orchestration task directory, from the session's last orch tool call
  // that named one; null for the default profile or when no call named one.
  taskDir: string | null
}
