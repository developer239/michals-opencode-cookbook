import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { HandoffWriterService } from './handoff-writer.service.js'

// A stub `claude` binary: echoes what it was called with and what it read
// from stdin, or exits non-zero / prints nothing, depending on its own name.
const STUB = `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args.includes('fail-exit')) { process.stderr.write('boom'); process.exit(1) }
if (args.includes('hang')) { setInterval(() => {}, 1000) }
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  const prompt = Buffer.concat(chunks).toString('utf-8')
  if (args.includes('empty-output')) { process.exit(0) }
  process.stdout.write('WRITER REPLY for: ' + prompt + '\\nargs=' + JSON.stringify(args) + '\\n')
})
`

describe('[compaction] HandoffWriterService', () => {
  let bin = ''

  beforeEach(() => {
    bin = mkdtempSync(join(tmpdir(), 'compaction-writer-'))
    writeFileSync(join(bin, 'stub-claude'), STUB, { mode: 0o755 })
  })

  afterEach(() => {
    rmSync(bin, { recursive: true, force: true })
  })

  it('should pass the prompt on stdin and the tool-less, session-less flags on argv', () => {
    // Arrange
    const writer = new HandoffWriterService(join(bin, 'stub-claude'))

    // Act
    const result = writer.write('claude-opus-4-8', 'summarize this session')

    // Assert
    assert.equal(result.isOk, true)
    assert.match(result.text, /^WRITER REPLY for: summarize this session/u)
    const argsLine = result.text.split('\n').find((textLine) => textLine.startsWith('args='))
    assert.deepStrictEqual(JSON.parse(argsLine?.slice('args='.length) ?? '[]'), [
      '-p',
      '--model',
      'claude-opus-4-8',
      '--tools',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
    ])
  })

  it('should report a non-zero exit as a failure without throwing', () => {
    // Arrange
    const writer = new HandoffWriterService(join(bin, 'stub-claude'))

    // Act
    writeFileSync(join(bin, 'stub-claude'), STUB.replace("args.includes('fail-exit')", 'true'), { mode: 0o755 })
    const result = writer.write('claude-opus-4-8', 'prompt')

    // Assert
    assert.equal(result.isOk, false)
    assert.match(result.text, /exited 1: boom/u)
  })

  it('should report empty output as a failure without throwing', () => {
    // Arrange
    const writer = new HandoffWriterService(join(bin, 'stub-claude'))

    // Act
    writeFileSync(join(bin, 'stub-claude'), STUB.replace("args.includes('empty-output')", 'true'), { mode: 0o755 })
    const result = writer.write('claude-opus-4-8', 'prompt')

    // Assert
    assert.equal(result.isOk, false)
    assert.match(result.text, /produced no output/u)
  })

  it('should time out a hanging writer instead of blocking forever, without throwing', () => {
    // Arrange
    const writer = new HandoffWriterService(join(bin, 'stub-claude'))

    // Act
    const result = writer.write('hang', 'prompt', 200)

    // Assert
    assert.equal(result.isOk, false)
    assert.match(result.text, /timed out after 200ms/u)
  })

  it('should report a missing binary as a failure without throwing', () => {
    // Arrange
    const writer = new HandoffWriterService(join(bin, 'does-not-exist'))

    // Act
    const result = writer.write('claude-opus-4-8', 'prompt')

    // Assert
    assert.equal(result.isOk, false)
    assert.match(result.text, /Failed to spawn/u)
  })
})
