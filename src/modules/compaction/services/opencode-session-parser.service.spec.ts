import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { OpencodeMessageEntry } from '../types/compaction.types.js'
import { OpencodeSessionParserService } from './opencode-session-parser.service.js'

// Minimal structural fixtures: only the fields the parser reads, matching the
// shape OpencodeMessageEntry/OpencodePart derive from PluginInput's client.
const entry = (info: { role: 'user' | 'assistant' }, parts: unknown[]): OpencodeMessageEntry =>
  ({ info, parts }) as OpencodeMessageEntry

describe('[compaction] OpencodeSessionParserService', () => {
  const parser = new OpencodeSessionParserService()

  it('should read a user text part as a user event', () => {
    // Arrange
    const messages = [entry({ role: 'user' }, [{ type: 'text', text: 'Hello' }])]

    // Act
    const events = parser.parse(messages)

    // Assert
    assert.deepStrictEqual(events, [{ kind: 'user', text: 'Hello' }])
  })

  it('should read an assistant text part as an assistant event', () => {
    // Arrange
    const messages = [entry({ role: 'assistant' }, [{ type: 'text', text: 'Working on it.' }])]

    // Act
    const events = parser.parse(messages)

    // Assert
    assert.deepStrictEqual(events, [{ kind: 'assistant', text: 'Working on it.' }])
  })

  it('should read a completed tool part as a tool_call followed by its tool_result', () => {
    // Arrange
    const messages = [
      entry({ role: 'assistant' }, [
        {
          type: 'tool',
          tool: 'orch_digest',
          state: { status: 'completed', input: { taskDir: '/tmp/t' }, output: 'digest text' },
        },
      ]),
    ]

    // Act
    const events = parser.parse(messages)

    // Assert
    assert.deepStrictEqual(events, [
      { kind: 'tool_call', tool: 'orch_digest', input: { taskDir: '/tmp/t' } },
      { kind: 'tool_result', tool: 'orch_digest', text: 'digest text' },
    ])
  })

  it('should read an errored tool part as a tool_call followed by an error tool_result', () => {
    // Arrange
    const messages = [
      entry({ role: 'assistant' }, [
        { type: 'tool', tool: 'db_run_query', state: { status: 'error', input: {}, error: 'connection refused' } },
      ]),
    ]

    // Act
    const events = parser.parse(messages)

    // Assert
    assert.deepStrictEqual(events, [
      { kind: 'tool_call', tool: 'db_run_query', input: {} },
      { kind: 'tool_result', tool: 'db_run_query', text: 'connection refused' },
    ])
  })

  it('should read a pending or running tool part as only a tool_call, with no result yet', () => {
    // Arrange
    const messages = [
      entry({ role: 'assistant' }, [{ type: 'tool', tool: 'oc_run', state: { status: 'running', input: {} } }]),
    ]

    // Act
    const events = parser.parse(messages)

    // Assert
    assert.deepStrictEqual(events, [{ kind: 'tool_call', tool: 'oc_run', input: {} }])
  })
})
