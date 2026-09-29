import type { SessionEvent } from '../types/compaction.types.js'

interface ITranscriptContentBlock {
  type?: string
  text?: string
  id?: string
  name?: string
  tool_use_id?: string
  input?: Record<string, unknown>
  tool_name?: string
  content?: unknown
}

interface ITranscriptMessage {
  content?: string | ITranscriptContentBlock[]
}

interface ITranscriptEntry {
  type?: string
  message?: ITranscriptMessage
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// A tool_result's content is either a plain string or an array of blocks; a
// deferred-tool load (ToolSearch, the skill tool) reports back as a
// `tool_reference` block with no text of its own.
const readToolResultText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return (content as unknown[])
    .map((block) => {
      if (!isRecord(block)) {
        return ''
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text
      }
      if (block.type === 'tool_reference' && typeof block.tool_name === 'string') {
        return `(tool reference: ${block.tool_name})`
      }
      return ''
    })
    .filter((text) => text.length > 0)
    .join('\n')
}

export class TranscriptParserService {
  // Parses a Claude Code transcript (one JSON object per line). A line that
  // fails to parse is skipped - the transcript may still be mid-write when a
  // PreCompact hook reads it, and one bad line must not lose the rest of the
  // session's record.
  public readonly parse = (transcriptText: string): SessionEvent[] => {
    const events: SessionEvent[] = []
    // A tool_result names only the id of its tool_use block, which an earlier
    // assistant entry carries, so the tool name is looked up by that id.
    const toolNames = new Map<string, string>()
    for (const line of transcriptText.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }
      const entry = this.parseLine(trimmed)
      if (entry !== null) {
        events.push(...this.readEntry(entry, toolNames))
      }
    }
    return events
  }

  private readonly parseLine = (line: string): ITranscriptEntry | null => {
    try {
      const parsed: unknown = JSON.parse(line)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  private readonly readEntry = (entry: ITranscriptEntry, toolNames: Map<string, string>): SessionEvent[] => {
    if (entry.type === 'user' && entry.message !== undefined) {
      return this.readUserMessage(entry.message, toolNames)
    }
    if (entry.type === 'assistant' && entry.message !== undefined) {
      return this.readAssistantMessage(entry.message, toolNames)
    }
    return []
  }

  // A human turn's content is a plain string; a tool-result turn's content is
  // an array of content blocks (the CLI nests tool results under the user
  // role). This is the only reliable discriminator across transcript entries.
  // A result whose tool_use block is not in the transcript (its line failed to
  // parse) is skipped along with that line.
  private readonly readUserMessage = (message: ITranscriptMessage, toolNames: Map<string, string>): SessionEvent[] => {
    if (typeof message.content === 'string') {
      return [{ kind: 'user', text: message.content }]
    }
    if (!Array.isArray(message.content)) {
      return []
    }
    return message.content.flatMap((block): SessionEvent[] => {
      const tool = block.tool_use_id === undefined ? undefined : toolNames.get(block.tool_use_id)
      if (block.type !== 'tool_result' || tool === undefined) {
        return []
      }
      return [{ kind: 'tool_result', tool, text: readToolResultText(block.content) }]
    })
  }

  private readonly readAssistantMessage = (
    message: ITranscriptMessage,
    toolNames: Map<string, string>
  ): SessionEvent[] => {
    if (!Array.isArray(message.content)) {
      return []
    }
    return message.content.flatMap((block): SessionEvent[] => {
      if (block.type === 'text' && typeof block.text === 'string') {
        return [{ kind: 'assistant', text: block.text }]
      }
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        if (block.id !== undefined) {
          toolNames.set(block.id, block.name)
        }
        return [{ kind: 'tool_call', tool: block.name, input: block.input ?? {} }]
      }
      return []
    })
  }
}
