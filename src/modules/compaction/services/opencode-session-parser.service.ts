import type { OpencodeMessageEntry, OpencodePart, SessionEvent } from '../types/compaction.types.js'

type ToolPart = Extract<OpencodePart, { type: 'tool' }>

export class OpencodeSessionParserService {
  public readonly parse = (messages: OpencodeMessageEntry[]): SessionEvent[] =>
    messages.flatMap(({ info, parts }) =>
      info.role === 'user' ? this.readUserParts(parts) : this.readAssistantParts(parts)
    )

  private readonly readUserParts = (parts: OpencodePart[]): SessionEvent[] =>
    parts.flatMap((part): SessionEvent[] => (part.type === 'text' ? [{ kind: 'user', text: part.text }] : []))

  private readonly readAssistantParts = (parts: OpencodePart[]): SessionEvent[] =>
    parts.flatMap((part): SessionEvent[] => {
      if (part.type === 'text') {
        return [{ kind: 'assistant', text: part.text }]
      }
      if (part.type === 'tool') {
        return this.readToolPart(part)
      }
      return []
    })

  // A tool part carries its own result once it settles, so one part can yield
  // both the call and its result - the same two SessionEvent kinds a Claude
  // Code transcript spreads across a tool_use block and a later tool_result
  // block.
  private readonly readToolPart = (part: ToolPart): SessionEvent[] => {
    const call: SessionEvent = { kind: 'tool_call', tool: part.tool, input: part.state.input }
    if (part.state.status === 'completed') {
      return [call, { kind: 'tool_result', tool: part.tool, text: part.state.output }]
    }
    if (part.state.status === 'error') {
      return [call, { kind: 'tool_result', tool: part.tool, text: part.state.error }]
    }
    return [call]
  }
}
