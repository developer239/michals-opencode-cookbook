import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HANDOFF_DIR_NAME, MANIFEST_FILE_NAME } from '../config.js'
import type { ICompleteAttemptInput, IHandoffAttempt, IResolvedHandoffAttempt } from '../types/compaction.types.js'

interface IManifest {
  attempts: IHandoffAttempt[]
}

// Handoffs are written under the Claude Code config directory (CLAUDE_CONFIG_DIR
// overrides it, the same env var the installer honors), one directory per
// session. Each compaction is an attempt, tracked in the directory's manifest
// so a later read can tell a successful handoff from one that failed or never
// finished, instead of trusting whichever file happens to sort last by name.
export class HandoffStoreService {
  private readonly root: string

  constructor(configDir: string = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')) {
    this.root = join(configDir, HANDOFF_DIR_NAME)
  }

  public readonly directoryFor = (sessionId: string): string => join(this.root, sessionId)

  public readonly pathOf = (sessionId: string, attempt: IResolvedHandoffAttempt): string =>
    join(this.directoryFor(sessionId), attempt.fileName)

  public readonly read = (sessionId: string, attempt: IResolvedHandoffAttempt): string =>
    readFileSync(this.pathOf(sessionId, attempt), 'utf-8')

  // Marks a new attempt pending before any real work happens, so a crash
  // between here and completeAttempt still leaves a record: the manifest
  // shows this compaction never resolved, rather than staying silent about it.
  // The id leads with a sortable timestamp for readability, and a short
  // random suffix so two attempts begun within the same millisecond (routine
  // in a test, possible in practice) never collide and overwrite each other.
  public readonly beginAttempt = (sessionId: string): string => {
    const dir = this.directoryFor(sessionId)
    mkdirSync(dir, { recursive: true })
    const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomBytes(3).toString('hex')}`
    const attempts = this.readManifest(sessionId)
    attempts.push({ id, status: 'pending' })
    this.writeManifest(sessionId, attempts)
    return id
  }

  // Writes the handoff content and resolves the attempt to its final status.
  // The manifest entry always carries the profile and file actually used, so
  // a later reader never has to guess them back from a filename.
  public readonly completeAttempt = ({
    sessionId,
    attemptId,
    status,
    profile,
    taskDir,
    content,
  }: ICompleteAttemptInput): string => {
    const dir = this.directoryFor(sessionId)
    const fileName = `${attemptId}-${profile}.md`
    writeFileSync(join(dir, fileName), content)
    const resolved: IHandoffAttempt = { id: attemptId, status, profile, taskDir, fileName }
    const attempts = this.readManifest(sessionId)
    const index = attempts.findIndex((attempt) => attempt.id === attemptId)
    if (index === -1) {
      attempts.push(resolved)
    } else {
      attempts[index] = resolved
    }
    this.writeManifest(sessionId, attempts)
    return join(dir, fileName)
  }

  // The most recent attempt recorded for a session, whatever its status; null
  // when the session has never had one begun.
  public readonly latestAttempt = (sessionId: string): IHandoffAttempt | null =>
    this.readManifest(sessionId).at(-1) ?? null

  // The most recent attempt that actually succeeded, regardless of whether a
  // later one failed or never resolved - the carry-forward source for the
  // next compaction.
  public readonly latestSuccess = (sessionId: string): Extract<IHandoffAttempt, { status: 'success' }> | null => {
    const attempts = this.readManifest(sessionId)
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const attempt = attempts[index]
      if (attempt?.status === 'success') {
        return attempt
      }
    }
    return null
  }

  private readonly manifestPath = (sessionId: string): string => join(this.directoryFor(sessionId), MANIFEST_FILE_NAME)

  private readonly readManifest = (sessionId: string): IHandoffAttempt[] => {
    const path = this.manifestPath(sessionId)
    if (!existsSync(path)) {
      return []
    }
    return (JSON.parse(readFileSync(path, 'utf-8')) as IManifest).attempts
  }

  private readonly writeManifest = (sessionId: string, attempts: IHandoffAttempt[]): void => {
    writeFileSync(this.manifestPath(sessionId), `${JSON.stringify({ attempts }, null, 2)}\n`)
  }
}
