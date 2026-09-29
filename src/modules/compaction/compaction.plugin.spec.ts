import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import type { PluginInput } from '@opencode-ai/plugin'
import { CompactionPlugin } from './compaction.plugin.js'

const git = (cwd: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  assert.equal(result.status, 0, result.stderr)
}

interface IOutput {
  prompt?: string
  context: string[]
}

describe('[compaction] Plugin - OpenCode compaction hook', () => {
  let repoDir = ''

  beforeEach(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), 'compaction-plugin-')))
    writeFileSync(join(repoDir, 'tracked.txt'), 'first\n')
    git(repoDir, ['init', '--quiet', '--initial-branch=main'])
    git(repoDir, ['add', 'tracked.txt'])
    git(repoDir, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'init',
    ])
  })

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  const buildInput = (): PluginInput =>
    ({
      client: { session: { messages: () => Promise.resolve({ data: [] }) } },
      directory: repoDir,
    }) as unknown as PluginInput

  it("should include the project directory's real git state in the compaction prompt", async () => {
    // Arrange
    writeFileSync(join(repoDir, 'tracked.txt'), 'first\nsecond\n')
    const hooks = await CompactionPlugin(buildInput())
    const output: IOutput = { context: [] }

    // Act
    await hooks['experimental.session.compacting']?.({ sessionID: 'ses_1' }, output)

    // Assert
    assert.ok(output.prompt !== undefined)
    assert.match(output.prompt, /## Git state/u)
    assert.match(output.prompt, /## main/u)
    assert.match(output.prompt, / M tracked\.txt/u)
  })
})
