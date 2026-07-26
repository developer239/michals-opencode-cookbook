import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { PluginInput } from '@opencode-ai/plugin'
import { Logger } from '../../_core/services/logger.service.js'
import { PluginError } from '../../_core/types/errors.js'
import type { IOpenCodeRunRecord } from '../types/opencode.types.js'

const DEFAULT_REGISTRY_PATH = join(homedir(), '.local', 'share', 'opencode', 'oc-async-runs.json')

interface IRegistryFile {
  runs: IOpenCodeRunRecord[]
}

// Tracks asynchronously dispatched `opencode run` processes so the orchestrator can
// poll completion across web-terminal reconnects. The session ID and log path are the
// durable handles; PID is best-effort because PIDs can be reused.
export class OpenCodeRunRegistryService {
  private readonly logger: Logger
  private readonly path: string

  constructor(path?: string, client?: PluginInput['client']) {
    this.path = path ?? process.env.OPENCODE_RUN_REGISTRY_PATH ?? DEFAULT_REGISTRY_PATH
    this.logger = new Logger('OpencodeRunRegistry', client)
  }

  public list = (): IOpenCodeRunRecord[] => this.read().runs

  public get = (runId: string): IOpenCodeRunRecord | null => this.read().runs.find((row) => row.runId === runId) ?? null

  public register = (record: IOpenCodeRunRecord): void => {
    const data = this.read()
    data.runs = [record, ...data.runs.filter((row) => row.runId !== record.runId)]
    this.write(data)
  }

  public update = (runId: string, patch: Partial<IOpenCodeRunRecord>): IOpenCodeRunRecord => {
    const data = this.read()
    const index = data.runs.findIndex((row) => row.runId === runId)
    if (index === -1) {
      throw new PluginError(`Unknown async run id: ${runId}`, 'NOT_FOUND')
    }
    const current = data.runs[index]!
    const updated: IOpenCodeRunRecord = { ...current, ...patch }
    data.runs[index] = updated
    this.write(data)
    return updated
  }

  public prune = (maxAgeMs: number): void => {
    const cutoff = Date.now() - maxAgeMs
    const data = this.read()
    const before = data.runs.length
    data.runs = data.runs.filter((row) => row.startedAt >= cutoff || row.status === 'running')
    if (data.runs.length !== before) {
      this.write(data)
    }
  }

  private readonly read = (): IRegistryFile => {
    if (!existsSync(this.path)) {
      return { runs: [] }
    }
    try {
      const raw = readFileSync(this.path, 'utf-8')
      const parsed = JSON.parse(raw) as IRegistryFile
      if (!Array.isArray(parsed.runs)) {
        return { runs: [] }
      }
      return parsed
    } catch (error) {
      this.logger.warn(
        `Failed to read run registry at ${this.path}: ${error instanceof Error ? error.message : String(error)}`
      )
      return { runs: [] }
    }
  }

  private readonly write = (data: IRegistryFile): void => {
    const dir = dirname(this.path)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    // Atomic write: stage to a sibling tmp file in the same directory, then
    // rename onto the target. Avoids leaving a truncated/corrupted file when
    // the process crashes mid-write. The rename is atomic on POSIX filesystems.
    const tmpPath = `${this.path}.${process.pid}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
    renameSync(tmpPath, this.path)
  }
}
