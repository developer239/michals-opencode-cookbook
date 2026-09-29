import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SessionEvent } from '../types/compaction.types.js'
import { ProfileChoiceService } from './profile-choice.service.js'

describe('[compaction] ProfileChoiceService', () => {
  const chooser = new ProfileChoiceService()

  it('should choose the default profile with no taskDir when no orch tool was called', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'Hello' },
      { kind: 'tool_call', tool: 'codebase_project_structure', input: {} },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'default', taskDir: null })
  })

  it('should choose the orchestration profile and its taskDir when an orch tool was called', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'Continue' },
      { kind: 'tool_call', tool: 'mcp__opencode__orch_digest', input: { taskDir: '/tmp/task-a' } },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'orchestration', taskDir: '/tmp/task-a' })
  })

  it("should use the last orch tool call's taskDir, not an earlier one", () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'tool_call', tool: 'orch_digest', input: { taskDir: '/tmp/task-a' } },
      { kind: 'tool_call', tool: 'orch_units', input: { taskDir: '/tmp/task-b' } },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.equal(choice.taskDir, '/tmp/task-b')
  })

  it('should let an explicit compaction profile line override tool-call detection, and the last line win', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'compaction profile: orchestration' },
      { kind: 'tool_call', tool: 'orch_digest', input: { taskDir: '/tmp/task-a' } },
      { kind: 'user', text: 'compaction profile: default' },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'default', taskDir: null })
  })

  it('should ignore an explicit profile line naming an unknown profile', () => {
    // Arrange
    const events: SessionEvent[] = [{ kind: 'user', text: 'compaction profile: turbo' }]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'default', taskDir: null })
  })

  it('should ignore a compaction profile mention that is not on its own line', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'Review this sentence: `compaction profile: orchestration`' },
      { kind: 'tool_call', tool: 'orch_digest', input: { taskDir: '/tmp/task-a' } },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'orchestration', taskDir: '/tmp/task-a' })
  })

  it('should use the last override line within a single message, not the first', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'compaction profile: orchestration\ncompaction profile: default' },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'default', taskDir: null })
  })

  it('should ignore the taskDir of a non-orch tool call even when it happens to name the field', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'tool_call', tool: 'orch_digest', input: {} },
      { kind: 'tool_call', tool: 'some_other_tool', input: { taskDir: '/tmp/unrelated' } },
    ]

    // Act
    const choice = chooser.choose(events)

    // Assert
    assert.deepStrictEqual(choice, { profile: 'orchestration', taskDir: null })
  })
})
