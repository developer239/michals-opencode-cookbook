import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { HANDOFF_DIR_NAME } from '../config.js'

// Handoffs are written under the Claude Code config directory (CLAUDE_CONFIG_DIR
// overrides it, the same env var the installer honors), one directory per
// session, newest file last in name order because the filename leads with an
// ISO timestamp.
export class HandoffStoreService {
  private readonly root: string

  constructor(configDir: string = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')) {
    this.root = join(configDir, HANDOFF_DIR_NAME)
  }

  public readonly directoryFor = (sessionId: string): string => join(this.root, sessionId)

  public readonly write = (sessionId: string, profile: string, content: string): string => {
    const dir = this.directoryFor(sessionId)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, `${new Date().toISOString().replaceAll(':', '-')}-${profile}.md`)
    writeFileSync(path, content)
    return path
  }

  // The most recently written handoff file for a session, or null when the
  // session has none yet.
  public readonly findLatest = (sessionId: string): string | null => {
    const dir = this.directoryFor(sessionId)
    if (!existsSync(dir)) {
      return null
    }
    const files = readdirSync(dir)
      .filter((name) => name.endsWith('.md'))
      .sort()
    const latest = files.at(-1)
    return latest === undefined ? null : join(dir, latest)
  }
}
