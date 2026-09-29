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

  it('should report no attempt for a session that never had one begun', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)

    // Act
    const latest = store.latestAttempt('session-a')

    // Assert
    assert.equal(latest, null)
    assert.equal(store.latestSuccess('session-a'), null)
    assert.equal(existsSync(store.directoryFor('session-a')), false)
  })

  it('should report an attempt pending right after it begins, before it resolves', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)

    // Act
    const id = store.beginAttempt('session-a')
    const latest = store.latestAttempt('session-a')

    // Assert
    assert.deepStrictEqual(latest, { id, status: 'pending' })
    assert.equal(store.latestSuccess('session-a'), null)
  })

  it('should resolve an attempt to success and read its content back', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const id = store.beginAttempt('session-a')

    // Act
    const path = store.completeAttempt({
      sessionId: 'session-a',
      attemptId: id,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: '# Handoff\n\ncontent\n',
    })
    const latest = store.latestAttempt('session-a')

    // Assert
    assert.ok(latest?.status === 'success')
    assert.deepStrictEqual(latest, {
      id,
      status: 'success',
      profile: 'default',
      taskDir: null,
      fileName: `${id}-default.md`,
    })
    assert.equal(store.pathOf('session-a', latest), path)
    assert.equal(store.read('session-a', latest), '# Handoff\n\ncontent\n')
    assert.equal(readFileSync(path, 'utf-8'), '# Handoff\n\ncontent\n')
  })

  it('should track the latest attempt separately from the latest success once a later attempt fails', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const firstId = store.beginAttempt('session-a')
    store.completeAttempt({
      sessionId: 'session-a',
      attemptId: firstId,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: 'first, successful',
    })
    const secondId = store.beginAttempt('session-a')

    // Act
    store.completeAttempt({
      sessionId: 'session-a',
      attemptId: secondId,
      status: 'failed',
      profile: 'default',
      taskDir: null,
      content: 'second, failed',
    })
    const latest = store.latestAttempt('session-a')
    const latestSuccess = store.latestSuccess('session-a')

    // Assert
    assert.ok(latest?.status === 'failed')
    assert.equal(latest.id, secondId)
    assert.ok(latestSuccess !== null)
    assert.equal(latestSuccess.id, firstId)
    assert.equal(store.read('session-a', latestSuccess), 'first, successful')
  })

  it('should keep the orchestration profile and task directory in a resolved attempt', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const id = store.beginAttempt('session-orch')

    // Act
    store.completeAttempt({
      sessionId: 'session-orch',
      attemptId: id,
      status: 'success',
      profile: 'orchestration',
      taskDir: '/tmp/task',
      content: 'content',
    })
    const latest = store.latestAttempt('session-orch')

    // Assert
    assert.deepStrictEqual(latest, {
      id,
      status: 'success',
      profile: 'orchestration',
      taskDir: '/tmp/task',
      fileName: `${id}-orchestration.md`,
    })
  })
})
