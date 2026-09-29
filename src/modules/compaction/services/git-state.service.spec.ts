import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { GitStateService } from './git-state.service.js'

const git = (cwd: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  assert.equal(result.status, 0, result.stderr)
}

describe('[compaction] GitStateService', () => {
  const service = new GitStateService()
  let workDir = ''
  let repoDir = ''

  beforeEach(() => {
    workDir = realpathSync(mkdtempSync(join(tmpdir(), 'compaction-git-')))
    repoDir = join(workDir, 'repo')
    mkdirSync(join(repoDir, 'src'), { recursive: true })
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
    rmSync(workDir, { recursive: true, force: true })
  })

  it('should report the branch, the changed and untracked files, and the diff stat of a repository once', () => {
    // Arrange
    writeFileSync(join(repoDir, 'tracked.txt'), 'first\nsecond\n')
    writeFileSync(join(repoDir, 'new.txt'), 'untracked\n')

    // Act
    const state = service.describe([repoDir, join(repoDir, 'src')])

    // Assert
    assert.ok(state.startsWith('## Git state'))
    assert.equal(state.split(`### ${repoDir}`).length - 1, 1)
    assert.match(state, /## main/u)
    assert.match(state, / M tracked\.txt/u)
    assert.match(state, /\?\? new\.txt/u)
    assert.match(state, /tracked\.txt \| 1 \+/u)
  })

  it('should say a clean repository has no changes against HEAD', () => {
    // Act
    const state = service.describe([repoDir])

    // Assert
    assert.match(state, /No changes against HEAD\./u)
  })

  it('should say no repository contains the directories when none is inside one', () => {
    // Arrange
    const outside = join(workDir, 'outside')
    mkdirSync(outside)

    // Act
    const state = service.describe([outside, join(workDir, 'deleted')])

    // Assert
    assert.equal(state, `## Git state\n\nNo git repository contains any of: ${outside}, ${join(workDir, 'deleted')}`)
  })
})
