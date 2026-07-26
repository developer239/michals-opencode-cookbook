import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginInput } from '@opencode-ai/plugin'
import { Logger } from '../../_core/services/logger.service.js'
import { PluginError } from '../../_core/types/errors.js'
import type { IConversationSession, IMessagePart } from '../types/opencode.types.js'

const DEFAULT_DB_PATH = join(homedir(), '.local', 'share', 'opencode', 'opencode.db')

interface ISessionRow {
  id: string
  title: string
  directory: string
  time_created: number
  time_updated: number
}

interface IPartRow {
  id: string
  message_id: string
  session_id: string
  data: string
  time_created: number
}

interface IMessageRow {
  id: string
  data: string
  time_created: number
}

interface IPartJson {
  type?: string
  text?: string
  tool?: string
  state?: { input?: unknown; output?: unknown; status?: string }
}

interface IMessageJson {
  role?: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
}

interface ISqlStatement {
  get: (...args: any[]) => unknown
  all: (...args: any[]) => unknown[]
}

interface ISqliteDb {
  prepare: (sql: string) => ISqlStatement
  close: () => void
}

// Read-only accessor for OpenCode's local SQLite database. OpenCode itself manages
// schema and writes; this service never mutates and never opens the DB write-side.
//
// IMPORTANT: OpenCode loads plugins under Bun. A top-level `node:sqlite` import
// makes the ENTIRE plugin bundle fail to load there, which in turn hides every
// unrelated plugin in the bundle. Keep the runtime-specific SQLite
// choice behind lazy imports so the bundle can load on both Bun and Node.
export class OpenCodeDbService {
  private readonly logger: Logger
  private readonly dbPath: string

  constructor(dbPath?: string, client?: PluginInput['client']) {
    this.dbPath = dbPath ?? process.env.OPENCODE_DB_PATH ?? DEFAULT_DB_PATH
    this.logger = new Logger('OpenCodeDb', client)
  }

  public listSessions = (limit: number): Promise<IConversationSession[]> =>
    this.withDb((db) => {
      const rows = db
        .prepare(
          'SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_updated DESC LIMIT ?'
        )
        .all(limit)
      return rows.map((row) => this.mapSessionRow(this.coerceSessionRow(row)))
    })

  public searchSessions = (query: string, limit: number): Promise<IConversationSession[]> =>
    this.withDb((db) => {
      const pattern = `%${query}%`
      // Match against session title or any part's textual data.
      const rows = db
        .prepare(
          `SELECT DISTINCT s.id, s.title, s.directory, s.time_created, s.time_updated
           FROM session s
           LEFT JOIN part p ON p.session_id = s.id
           WHERE s.title LIKE ? OR p.data LIKE ?
           ORDER BY s.time_updated DESC
           LIMIT ?`
        )
        .all(pattern, pattern, limit)
      return rows.map((row) => this.mapSessionRow(this.coerceSessionRow(row)))
    })

  public getSessionMessages = (sessionId: string, limit: number, fromEnd: boolean): Promise<IMessagePart[]> =>
    this.withDb((db) => {
      const order = fromEnd ? 'DESC' : 'ASC'
      const partRows = db
        .prepare(
          `SELECT p.id, p.message_id, p.session_id, p.data, p.time_created
           FROM part p
           WHERE p.session_id = ?
           ORDER BY p.time_created ${order}
           LIMIT ?`
        )
        .all(sessionId, limit)
        .map((row) => this.coercePartRow(row))

      if (partRows.length === 0) {
        return []
      }

      const messageIds = Array.from(new Set(partRows.map((row) => row.message_id)))
      const placeholders = messageIds.map(() => '?').join(',')
      const messageRows = db
        .prepare(`SELECT id, data, time_created FROM message WHERE id IN (${placeholders})`)
        .all(...messageIds)
        .map((row) => this.coerceMessageRow(row))

      const messageMap = new Map<string, IMessageJson>()
      for (const message of messageRows) {
        messageMap.set(message.id, this.parseJsonSafe<IMessageJson>(message.data))
      }

      const orderedRows = fromEnd ? [...partRows].reverse() : partRows
      return orderedRows.map((row) => this.mapPartRow(row, messageMap.get(row.message_id)))
    })

  public getSessionPartCount = (sessionId: string): Promise<number> =>
    this.withDb((db) => {
      const row = db.prepare('SELECT COUNT(*) as count FROM part WHERE session_id = ?').get(sessionId)
      if (row === undefined) {
        return 0
      }
      const record = row as Record<string, unknown>
      const value = record.count
      return typeof value === 'number' ? value : 0
    })

  // Look for an explicit completion marker (step-finish part) on the session.
  public hasStepFinish = (sessionId: string, sinceTimestamp: number): Promise<boolean> =>
    this.withDb((db) => {
      const rows = db
        .prepare(`SELECT data FROM part WHERE session_id = ? AND time_created >= ? ORDER BY time_created ASC`)
        .all(sessionId, sinceTimestamp)
      for (const row of rows) {
        const record = row as Record<string, unknown>
        const { data } = record
        if (typeof data !== 'string') {
          continue
        }
        const parsed = this.parseJsonSafe<IPartJson>(data)
        if (parsed.type === 'step-finish') {
          return true
        }
      }
      return false
    })

  // FUTURE: every public DB method opens a fresh SQLite handle and closes it
  // after one query. For the current call volume (a handful of reads per
  // orchestrator turn, mostly oc_get_session and oc_get_run_status) this is
  // invisible. If an orchestrator ever loops reads tightly (e.g. polling an
  // async run every second for many minutes) the open/close churn becomes
  // measurable. Two paths if/when that bites: (1) cache an open read-only
  // handle on this service for the process lifetime, or (2) accept an
  // optional handle parameter on the public methods so callers can batch.
  // Either is a 20-30 line change. Not worth doing speculatively - revisit
  // when there is real profile evidence.
  private readonly withDb = async <TResult>(
    operation: (db: ISqliteDb) => TResult | Promise<TResult>
  ): Promise<TResult> => {
    if (!existsSync(this.dbPath)) {
      throw new PluginError(
        `OpenCode database not found at ${this.dbPath}. Run 'opencode' at least once to initialize it.`,
        'NOT_FOUND'
      )
    }

    let db: ISqliteDb | null = null
    try {
      db = await this.openDb()
      return await operation(db)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new PluginError(`OpenCode database read failed: ${message}`, 'INTERNAL_ERROR', error)
    } finally {
      db?.close()
    }
  }

  private readonly openDb = async (): Promise<ISqliteDb> => {
    if ('Bun' in globalThis) {
      const runtimeModuleId = 'bun:sqlite'
      const sqliteModule = (await import(runtimeModuleId)) as {
        Database: new (
          path: string,
          options: { readonly: boolean }
        ) => {
          query: (sql: string) => { get: (...args: any[]) => unknown; all: (...args: any[]) => unknown[] }
          close: () => void
        }
      }
      const db = new sqliteModule.Database(this.dbPath, { readonly: true })
      return {
        prepare: (sql: string): ISqlStatement => {
          const query = db.query(sql)
          return {
            get: (...args: unknown[]) => query.get(...args),
            all: (...args: unknown[]) => query.all(...args),
          }
        },
        close: () => db.close(),
      }
    }

    const sqliteModule = await import('node:sqlite')
    const db = new sqliteModule.DatabaseSync(this.dbPath, { readOnly: true })
    return {
      prepare: (sql: string): ISqlStatement => {
        // Upstream `node:sqlite` types require `SQLInputValue` for parameters.
        // The queries here only bind strings and numbers, which satisfy that
        // constraint at runtime, but we do not want to import the upstream
        // type just for this signature. Re-type locally to the runtime shape
        // we actually use - avoids a wider `any` cast that trips eslint.
        const statement = db.prepare(sql) as unknown as {
          get: (...args: unknown[]) => unknown
          all: (...args: unknown[]) => unknown[]
        }
        return {
          get: (...args: unknown[]) => statement.get(...args),
          all: (...args: unknown[]) => statement.all(...args),
        }
      },
      close: () => db.close(),
    }
  }

  private readonly coerceSessionRow = (row: unknown): ISessionRow => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id ?? ''),
      title: String(record.title ?? ''),
      directory: String(record.directory ?? ''),
      time_created: typeof record.time_created === 'number' ? record.time_created : 0,
      time_updated: typeof record.time_updated === 'number' ? record.time_updated : 0,
    }
  }

  private readonly coercePartRow = (row: unknown): IPartRow => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id ?? ''),
      message_id: String(record.message_id ?? ''),
      session_id: String(record.session_id ?? ''),
      data: typeof record.data === 'string' ? record.data : '{}',
      time_created: typeof record.time_created === 'number' ? record.time_created : 0,
    }
  }

  private readonly coerceMessageRow = (row: unknown): IMessageRow => {
    const record = row as Record<string, unknown>
    return {
      id: String(record.id ?? ''),
      data: typeof record.data === 'string' ? record.data : '{}',
      time_created: typeof record.time_created === 'number' ? record.time_created : 0,
    }
  }

  private readonly mapSessionRow = (row: ISessionRow): IConversationSession => ({
    id: row.id,
    title: row.title,
    directory: row.directory,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
  })

  private readonly mapPartRow = (row: IPartRow, message: IMessageJson | undefined): IMessagePart => {
    const data = this.parseJsonSafe<IPartJson>(row.data)
    const messageMeta = this.extractMessageMeta(message)
    return {
      messageId: row.message_id,
      role: messageMeta.role,
      partType: data.type ?? 'unknown',
      content: this.extractContent(data),
      timestamp: row.time_created,
      modelId: messageMeta.modelId,
      providerId: messageMeta.providerId,
      agent: messageMeta.agent,
    }
  }

  private readonly extractMessageMeta = (
    message: IMessageJson | undefined
  ): { role: string; modelId: string | null; providerId: string | null; agent: string | null } => {
    if (message === undefined) {
      return { role: 'unknown', modelId: null, providerId: null, agent: null }
    }
    const { model } = message
    return {
      role: message.role ?? 'unknown',
      modelId: model ? (model.modelID ?? null) : null,
      providerId: model ? (model.providerID ?? null) : null,
      agent: message.agent ?? null,
    }
  }

  private readonly extractContent = (data: IPartJson): string | null => {
    if (typeof data.text === 'string' && data.text.length > 0) {
      return data.text
    }
    if (data.type === 'tool' && typeof data.tool === 'string') {
      const status = data.state?.status ?? 'unknown'
      return `${data.tool} (${status})`
    }
    return null
  }

  private readonly parseJsonSafe = <TParsed>(raw: string): TParsed => {
    try {
      return JSON.parse(raw) as TParsed
    } catch (error) {
      this.logger.warn(`Failed to parse JSON column: ${error instanceof Error ? error.message : String(error)}`)
      return {} as TParsed
    }
  }
}
