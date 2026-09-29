import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SessionEvent } from '../types/compaction.types.js'
import { SessionRecordService } from './session-record.service.js'

const UNLIMITED = Number.MAX_SAFE_INTEGER

describe('[compaction] SessionRecordService', () => {
  const service = new SessionRecordService()

  it('should keep user messages, assistant text, tool calls and tool results whole when the record fits', () => {
    // Arrange
    const userText = `IMPORTANT INSTRUCTION: ${'u'.repeat(10_000)}`
    const assistantText = 'a'.repeat(10_000)
    const editInput = { file_path: '/repo/plan.config.ts', new_string: 'b'.repeat(100) }
    const resultText = 'c'.repeat(10_000)
    const events: SessionEvent[] = [
      { kind: 'user', text: userText },
      { kind: 'assistant', text: assistantText },
      { kind: 'tool_call', tool: 'Edit', input: editInput },
      { kind: 'tool_result', tool: 'Edit', text: resultText },
    ]

    // Act
    const record = service.build(events, UNLIMITED)

    // Assert
    assert.ok(record.includes(userText))
    assert.ok(record.includes(assistantText))
    assert.ok(record.includes(JSON.stringify(editInput)))
    assert.ok(record.includes('### Tool result: Edit'))
    assert.ok(record.includes(resultText))
  })

  it('should list every file the writing tools touched once, in first-write order', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'tool_call', tool: 'Write', input: { file_path: '/tmp/scratch/questions.md' } },
      { kind: 'tool_call', tool: 'Edit', input: { file_path: '/repo/config.ts' } },
      { kind: 'tool_call', tool: 'Read', input: { file_path: '/repo/read-only.ts' } },
      { kind: 'tool_call', tool: 'Edit', input: { file_path: '/tmp/scratch/questions.md' } },
      { kind: 'tool_call', tool: 'NotebookEdit', input: { notebook_path: '/repo/analysis.ipynb' } },
    ]

    // Act
    const files = service.listWrittenFiles(events)
    const record = service.build(events, UNLIMITED)

    // Assert
    assert.deepStrictEqual(files, ['/tmp/scratch/questions.md', '/repo/config.ts', '/repo/analysis.ipynb'])
    assert.ok(
      record.startsWith('## Files written\n\n- /tmp/scratch/questions.md\n- /repo/config.ts\n- /repo/analysis.ipynb')
    )
  })

  it('should say no file was written when no writing tool ran', () => {
    // Arrange
    const events: SessionEvent[] = [{ kind: 'user', text: 'Hello' }]

    // Act
    const record = service.build(events, UNLIMITED)

    // Assert
    assert.ok(record.startsWith('## Files written\n\nNone.'))
  })

  it('should drop tool results cheapest to recover first, oldest first, only until the record fits', () => {
    // Arrange
    const chunk = 'x'.repeat(1_000)
    const events: SessionEvent[] = [
      { kind: 'tool_result', tool: 'mcp__opencode__db_run_query', text: `dev counts ${chunk}` },
      { kind: 'tool_result', tool: 'Bash', text: `old shell ${chunk}` },
      { kind: 'tool_result', tool: 'Read', text: `old read ${chunk}` },
      { kind: 'tool_result', tool: 'mcp__opencode__codebase_trace_calls', text: `new trace ${chunk}` },
      { kind: 'tool_result', tool: 'Bash', text: `new shell ${chunk}` },
      { kind: 'user', text: 'the owner said: ship it' },
    ]
    const fullLength = service.build(events, UNLIMITED).length

    // Act: a budget that forces out the two tree reads and one shell result
    const record = service.build(events, fullLength - 3_000)

    // Assert
    assert.ok(!record.includes('old read'))
    assert.ok(!record.includes('new trace'))
    assert.ok(!record.includes('old shell'))
    assert.ok(record.includes('new shell'))
    assert.ok(record.includes('dev counts'))
    assert.ok(record.includes('the owner said: ship it'))
    assert.ok(record.length <= fullLength - 3_000)
  })

  it('should elide the middle of a tool call input past the character limit, keeping the head and tail', () => {
    // Arrange
    const filePath = '/repo/generated/large-fixture.json'
    const content = `START-MARKER${'x'.repeat(20_000)}END-MARKER`
    const events: SessionEvent[] = [{ kind: 'tool_call', tool: 'Write', input: { file_path: filePath, content } }]

    // Act
    const record = service.build(events, UNLIMITED)

    // Assert
    assert.ok(record.includes(filePath))
    assert.ok(record.includes('START-MARKER'))
    assert.ok(record.includes('END-MARKER'))
    assert.ok(record.includes('characters omitted'))
    assert.ok(!record.includes(content))
  })

  it('should never drop a user message, assistant text or tool call, even when the record stays over budget', () => {
    // Arrange
    const events: SessionEvent[] = [
      { kind: 'user', text: 'the owner said: ship it' },
      { kind: 'assistant', text: 'Shipping.' },
      { kind: 'tool_call', tool: 'Read', input: { file_path: '/repo/a.ts' } },
      { kind: 'tool_result', tool: 'Read', text: 'file content' },
    ]

    // Act
    const record = service.build(events, 0)

    // Assert
    assert.ok(record.includes('the owner said: ship it'))
    assert.ok(record.includes('Shipping.'))
    assert.ok(record.includes('/repo/a.ts'))
    assert.ok(!record.includes('file content'))
  })
})
