import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { HandoffStoreService } from './handoff-store.service.js'

describe('[compaction] HandoffStoreService', () => {
  let configDir = ''

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'compaction-handoff-store-'))
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
  })

  it('should report no handoff for a session that never had one written', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)

    // Act
    const latest = store.findLatest('session-a')

    // Assert
    assert.equal(latest, null)
    assert.equal(existsSync(store.directoryFor('session-a')), false)
  })

  it('should write a handoff file under the session directory and read its content back', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)

    // Act
    const path = store.write('session-a', 'default', '# Handoff\n\ncontent\n')

    // Assert
    assert.equal(path, store.findLatest('session-a'))
    assert.equal(readFileSync(path, 'utf-8'), '# Handoff\n\ncontent\n')
  })

  it('should return the most recently written handoff for a session with more than one', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    store.write('session-a', 'default', 'first')

    // Act
    const second = store.write('session-a', 'orchestration', 'second')
    const latest = store.findLatest('session-a')

    // Assert
    assert.equal(latest, second)
    assert.equal(readFileSync(second, 'utf-8'), 'second')
  })
})
