import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import type {
  IAsyncRunHandle,
  IConversationSession,
  IMessagePart,
  IOpenCodeRunRecord,
  ISyncRunResult,
} from '../types/opencode.types.js'

const truncate = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit)}...` : text)

const formatRole = (role: string): string => {
  if (role === 'assistant') {
    return '**Assistant**'
  }
  if (role === 'user') {
    return '**User**'
  }
  return `**${role}**`
}

export class OpenCodeFormattingService {
  // --- Sessions ---

  public formatSessionList = (sessions: IConversationSession[]): string => {
    if (sessions.length === 0) {
      return 'No sessions found.'
    }

    const md = MarkdownBuilder.create()
      .heading('Sessions', 1)
      .italic(`${String(sessions.length)} session(s)`)
      .blank()

    md.table(
      ['ID', 'Title', 'Directory', 'Updated'],
      sessions.map((session) => [
        session.id,
        truncate(session.title, 60),
        truncate(session.directory, 60),
        new Date(session.updatedAt).toISOString(),
      ])
    )

    return md.build()
  }

  public formatMessages = (sessionId: string, messages: IMessagePart[], totalParts: number): string => {
    const md = MarkdownBuilder.create()
      .heading('Session', 1)
      .field('Session ID', sessionId)
      .field('Total parts', String(totalParts))
      .field('Returned parts', String(messages.length))
      .blank()

    if (messages.length === 0) {
      md.italic('No matching parts.')
      return md.build()
    }

    for (const msg of messages) {
      this.appendMessagePart(md, msg)
    }

    return md.build()
  }

  // --- Sync run result ---

  public formatSyncRunResult = (result: ISyncRunResult): string => {
    const md = MarkdownBuilder.create()
      .heading('Run', 1)
      .field('Status', result.status)
      .field('Exit code', String(result.exitCode))
      .field('Session ID', result.sessionId ?? '(unknown)')

    if (result.error !== null) {
      md.field('Error', result.error)
    }
    if (result.stderr.trim().length > 0) {
      md.blank().heading('Stderr', 2).codeBlock(result.stderr.trim())
    }

    if (result.reply !== null && result.reply.length > 0) {
      md.blank().heading('Assistant reply', 2).text(result.reply)
    }

    return md.build()
  }

  // --- Async run handle and status ---

  public formatAsyncRunHandle = (handle: IAsyncRunHandle): string => {
    const md = MarkdownBuilder.create()
      .heading('Async run dispatched', 1)
      .field('Run ID', handle.runId)
      .field('PID', handle.pid === null ? '(unknown)' : String(handle.pid))
      .field('Log', handle.logPath)
      .field('Session ID', handle.sessionId ?? '(pending - check status to extract from log)')
    return md.build()
  }

  public formatAsyncRunStatus = (
    record: IOpenCodeRunRecord,
    isProcessAlive: boolean,
    logTail: string,
    reply: string | null
  ): string => {
    const md = MarkdownBuilder.create()
      .heading('Async run status', 1)
      .field('Run ID', record.runId)
      .field('Runner', record.runner ?? 'opencode')
      .field('Status', record.status)
      .field('Process alive', isProcessAlive ? 'yes' : 'no')
      .field('PID', record.pid === null ? '(unknown)' : String(record.pid))
      .field('Session ID', record.sessionId ?? '(none extracted yet)')
      .field('Started', new Date(record.startedAt).toISOString())

    if (record.endedAt !== null) {
      md.field('Ended', new Date(record.endedAt).toISOString())
    }
    if (record.exitCode !== null) {
      md.field('Exit code', String(record.exitCode))
    }
    md.field('Log', record.logPath)

    if (reply !== null && reply.length > 0) {
      md.blank().heading('Assistant reply', 2).text(reply)
    }
    if (logTail.length > 0) {
      md.blank().heading('Log tail', 2).codeBlock(logTail)
    }

    return md.build()
  }

  // --- Private helpers ---

  private readonly appendMessagePart = (md: MarkdownBuilder, msg: IMessagePart): void => {
    const partLabel = msg.partType === 'text' ? '' : ` [${msg.partType}]`
    md.text(`${formatRole(msg.role)}${partLabel}:`)

    if (msg.content) {
      const isToolPart = msg.partType === 'tool'
      if (isToolPart) {
        md.codeBlock(msg.content)
      } else {
        md.text(msg.content)
      }
    }

    md.blank()
  }
}
