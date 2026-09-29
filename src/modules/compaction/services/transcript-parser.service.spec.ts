import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TranscriptParserService } from './transcript-parser.service.js'

const line = (entry: unknown): string => JSON.stringify(entry)

describe('[compaction] TranscriptParserService', () => {
  const parser = new TranscriptParserService()

  it('should read a human turn as a user event, verbatim', () => {
    // Arrange
    const transcript = line({ type: 'user', message: { role: 'user', content: 'Hello' } })

    // Act
    const events = parser.parse(transcript)

    // Assert
    assert.deepStrictEqual(events, [{ kind: 'user', text: 'Hello' }])
  })

  it('should read an assistant text block and a tool_use block as separate events', () => {
    // Arrange
    const transcript = line({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'The project path is X.' },
          { type: 'tool_use', id: 'toolu_1', name: 'ToolSearch', input: { query: 'select:foo' } },
        ],
      },
    })

    // Act
    const events = parser.parse(transcript)

    // Assert
    assert.deepStrictEqual(events, [
      { kind: 'assistant', text: 'The project path is X.' },
      { kind: 'tool_call', tool: 'ToolSearch', input: { query: 'select:foo' } },
    ])
  })

  it('should read a tool_result carried under the user role as a tool_result event named after its tool_use', () => {
    // Arrange
    const calls = line({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 't1', name: 'Read', input: {} },
          { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
          { type: 'tool_use', id: 't3', name: 'ToolSearch', input: {} },
        ],
      },
    })
    const stringResult = line({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'plain text result' }] },
    })
    const blockResult = line({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'block result' }] }],
      },
    })
    const referenceResult = line({
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't3', content: [{ type: 'tool_reference', tool_name: 'orch_digest' }] },
        ],
      },
    })

    // Act
    const events = parser.parse([calls, stringResult, blockResult, referenceResult].join('\n'))

    // Assert
    assert.deepStrictEqual(events, [
      { kind: 'tool_call', tool: 'Read', input: {} },
      { kind: 'tool_call', tool: 'Bash', input: {} },
      { kind: 'tool_call', tool: 'ToolSearch', input: {} },
      { kind: 'tool_result', tool: 'Read', text: 'plain text result' },
      { kind: 'tool_result', tool: 'Bash', text: 'block result' },
      { kind: 'tool_result', tool: 'ToolSearch', text: '(tool reference: orch_digest)' },
    ])
  })

  it('should skip a tool_result whose tool_use line failed to parse', () => {
    // Arrange
    const transcript = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1"',
      line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'orphan' }] } }),
    ].join('\n')

    // Act
    const events = parser.parse(transcript)

    // Assert
    assert.deepStrictEqual(events, [])
  })

  it('should skip unparseable lines, blank lines, and non-user/assistant entry types', () => {
    // Arrange
    const transcript = [
      'not json at all',
      '',
      line({ type: 'system', content: 'informational' }),
      line({ type: 'user', message: { role: 'user', content: 'still here' } }),
    ].join('\n')

    // Act
    const events = parser.parse(transcript)

    // Assert
    assert.deepStrictEqual(events, [{ kind: 'user', text: 'still here' }])
  })
})
