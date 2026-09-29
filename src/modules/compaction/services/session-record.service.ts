import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { PluginError } from '../../_core/types/errors.js'
import { FILE_WRITING_TOOLS, MCP_TOOL_PREFIX, SHELL_TOOLS, TREE_READ_TOOLS } from '../config.js'
import type { SessionEvent } from '../types/compaction.types.js'

const ENTRY_SEPARATOR = '\n\n'

// Tool groups in the order their results are dropped; a tool in none of them
// is dropped last.
const DROP_ORDER = [TREE_READ_TOOLS, SHELL_TOOLS]

const toDropTier = (tool: string): number => {
  const name = tool.startsWith(MCP_TOOL_PREFIX) ? tool.slice(MCP_TOOL_PREFIX.length) : tool
  const tier = DROP_ORDER.findIndex((group) => group.has(name))
  return tier === -1 ? DROP_ORDER.length : tier
}

interface IRenderedEntry {
  text: string
  // null for an entry that is never dropped
  dropTier: number | null
}

export class SessionRecordService {
  // The handoff record: the files the session wrote, then every event in
  // order. User messages, assistant text and tool calls are always whole, so
  // the owner's rulings and the decisions encoded in edits reach the writer.
  // Tool results are dropped only as far as the record needs to fit
  // `charBudget`, cheapest to recover first and oldest first within that.
  public readonly build = (events: SessionEvent[], charBudget: number): string => {
    const files = this.renderWrittenFiles(this.listWrittenFiles(events))
    const entries = this.fitToBudget(events.map(this.renderEntry), charBudget - files.length)
    return [files, ...entries].join(ENTRY_SEPARATOR)
  }

  public readonly listWrittenFiles = (events: SessionEvent[]): string[] => {
    const paths = new Set<string>()
    for (const event of events) {
      if (event.kind !== 'tool_call') {
        continue
      }
      const field = FILE_WRITING_TOOLS.get(event.tool)
      const path = field === undefined ? undefined : event.input[field]
      if (typeof path === 'string') {
        paths.add(path)
      }
    }
    return [...paths]
  }

  private readonly renderWrittenFiles = (paths: string[]): string => {
    const md = MarkdownBuilder.create().heading('Files written', 2)
    if (paths.length === 0) {
      return md.text('None.').build()
    }
    for (const path of paths) {
      md.bullet(path)
    }
    return md.build()
  }

  private readonly renderEntry = (event: SessionEvent): IRenderedEntry => {
    switch (event.kind) {
      case 'user':
        return { text: MarkdownBuilder.create().heading('User', 3).text(event.text).build(), dropTier: null }
      case 'assistant':
        return { text: MarkdownBuilder.create().heading('Assistant', 3).text(event.text).build(), dropTier: null }
      case 'tool_call':
        return {
          text: MarkdownBuilder.create()
            .heading(`Tool call: ${event.tool}`, 3)
            .codeBlock(JSON.stringify(event.input), 'json')
            .build(),
          dropTier: null,
        }
      case 'tool_result':
        return {
          text: MarkdownBuilder.create().heading(`Tool result: ${event.tool}`, 3).text(event.text).build(),
          dropTier: toDropTier(event.tool),
        }
      default: {
        const exhaustive: never = event
        throw new PluginError(`Unhandled session event: ${JSON.stringify(exhaustive)}`, 'INTERNAL_ERROR')
      }
    }
  }

  // Each kept entry costs its text plus the separator before it. The sort is
  // stable, so each tier stays oldest first.
  private readonly fitToBudget = (rendered: IRenderedEntry[], budget: number): string[] => {
    let length = rendered.reduce((sum, entry) => sum + entry.text.length + ENTRY_SEPARATOR.length, 0)
    const droppable = rendered
      .flatMap((entry, index) =>
        entry.dropTier === null
          ? []
          : [{ index, tier: entry.dropTier, cost: entry.text.length + ENTRY_SEPARATOR.length }]
      )
      .sort((first, second) => first.tier - second.tier)

    const dropped = new Set<number>()
    for (const { index, cost } of droppable) {
      if (length <= budget) {
        break
      }
      dropped.add(index)
      length -= cost
    }

    return rendered.filter((_, index) => !dropped.has(index)).map((entry) => entry.text)
  }
}
