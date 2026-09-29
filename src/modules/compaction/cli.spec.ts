import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { MAX_PREVIOUS_HANDOFF_CHARS, WRITER_RESERVED_TOKENS } from './config.js'
import { HandoffStoreService } from './services/handoff-store.service.js'
import type { IResolvedHandoffAttempt } from './types/compaction.types.js'

const CLI_PATH = fileURLToPath(new URL('./cli.js', import.meta.url))

const STUB_CLAUDE = `#!/usr/bin/env node
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  process.stdout.write('# Handoff\\n\\nwritten by the stub writer from ' + Buffer.concat(chunks).length + ' chars\\n')
})
`

// Writes the prompt it was given back as the handoff, so a test can read what
// the writer saw.
const ECHO_CLAUDE = `#!/usr/bin/env node
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', () => {
  process.stdout.write(Buffer.concat(chunks).toString())
})
`

const PRE_COMPACT_ARGS = ['pre-compact', '--writer-model', 'claude-opus-4-8', '--writer-context-tokens', '200000']

interface ICliResult {
  status: number | null
  stdout: string
  stderr: string
}

describe('[compaction] CLI - pre-compact and session-start hooks', () => {
  let workDir = ''
  let configDir = ''
  let claudeBin = ''

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'compaction-cli-'))
    configDir = join(workDir, 'claude-home')
    claudeBin = join(workDir, 'stub-claude')
    writeFileSync(claudeBin, STUB_CLAUDE, { mode: 0o755 })
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  const runCli = (args: string[], stdin: string): ICliResult => {
    const { status, stdout, stderr } = spawnSync(process.execPath, [CLI_PATH, ...args], {
      input: stdin,
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, CLAUDE_BIN: claudeBin },
    })
    return { status, stdout, stderr }
  }

  const writeTranscript = (lines: unknown[]): string => {
    const path = join(workDir, 'transcript.jsonl')
    writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'))
    return path
  }

  // Most tests only care about the one attempt a single pre-compact run
  // produces, and it is always resolved (pending is not a state a finished
  // process leaves behind).
  const latestResolved = (store: HandoffStoreService, sessionId: string): IResolvedHandoffAttempt => {
    const latest = store.latestAttempt(sessionId)
    assert.ok(latest !== null && latest.status !== 'pending')
    return latest
  }

  it('should write a default-profile handoff and exit 0', () => {
    // Arrange
    const transcriptPath = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'Hello' } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi, working on it.' }] } },
    ])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-default', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /profile: default/u)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-default')
    assert.equal(attempt.status, 'success')
    assert.equal(attempt.profile, 'default')
    assert.match(store.read('session-default', attempt), /written by the stub writer/u)
  })

  it('should write an orchestration-profile handoff naming the task directory from the last orch tool call', () => {
    // Arrange
    const transcriptPath = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'Continue the run' } },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'mcp__opencode__orch_digest', input: { taskDir: '/tmp/orch-task' } },
          ],
        },
      },
    ])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-orch', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /profile: orchestration/u)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-orch')
    assert.equal(attempt.status, 'success')
    assert.equal(attempt.profile, 'orchestration')
  })

  it('should still exit 0 and write a failure handoff when the writer binary fails', () => {
    // Arrange
    writeFileSync(claudeBin, "#!/usr/bin/env node\nprocess.stderr.write('boom'); process.exit(1)\n", { mode: 0o755 })
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Hello' } }])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-fail', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-fail')
    assert.equal(attempt.status, 'failed')
    assert.match(store.read('session-fail', attempt), /Handoff writer failed/u)
  })

  it('should write a failure handoff and skip the writer call when the transcript has no readable events', () => {
    // Arrange
    const transcriptPath = writeTranscript([])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-empty', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /no readable events/u)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-empty')
    assert.equal(attempt.status, 'failed')
    assert.match(store.read('session-empty', attempt), /no readable events/u)
  })

  it('should keep the last known task directory in a writer-failure handoff for the orchestration profile', () => {
    // Arrange
    writeFileSync(claudeBin, "#!/usr/bin/env node\nprocess.stderr.write('boom'); process.exit(1)\n", { mode: 0o755 })
    const transcriptPath = writeTranscript([
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', id: 't1', name: 'mcp__opencode__orch_digest', input: { taskDir: '/tmp/orch-task' } },
          ],
        },
      },
    ])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({
        session_id: 'session-orch-fail',
        transcript_path: transcriptPath,
        cwd: workDir,
        trigger: 'auto',
      })
    )

    // Assert
    assert.equal(result.status, 0)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-orch-fail')
    assert.equal(attempt.status, 'failed')
    assert.equal(attempt.profile, 'orchestration')
    assert.match(store.read('session-orch-fail', attempt), /\/tmp\/orch-task/u)
  })

  it('should still exit 0 when the hook input is not valid JSON, and write no handoff', () => {
    // Act
    const result = runCli(PRE_COMPACT_ARGS, 'not json')

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /could not read its hook input/u)
  })

  it('should give the writer the git state, the files written and the whole record', () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const scratchFile = join(workDir, 'scratch', 'questions.md')
    const transcriptPath = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'Write the questions down' } },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: scratchFile, content: 'Q20' } }],
        },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'File created' }] } },
    ])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-echo', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-echo')
    const prompt = store.read('session-echo', attempt)
    assert.match(prompt, /## Git state\n\nNo git repository contains any of: /u)
    assert.ok(prompt.includes(`## Files written\n\n- ${scratchFile}`))
    assert.ok(prompt.includes(JSON.stringify({ file_path: scratchFile, content: 'Q20' })))
    assert.ok(prompt.includes('### Tool result: Write\n\nFile created'))
  })

  it('should drop a tool result the writer window cannot hold and keep the owner message', () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const transcriptPath = writeTranscript([
      { type: 'user', message: { role: 'user', content: 'the owner said: ship it' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/big.ts' } }] },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'z'.repeat(20_000) }] } },
    ])
    const tightWindow = String(WRITER_RESERVED_TOKENS + 5_000)

    // Act
    const result = runCli(
      ['pre-compact', '--writer-model', 'claude-opus-4-8', '--writer-context-tokens', tightWindow],
      JSON.stringify({ session_id: 'session-tight', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-tight')
    const prompt = store.read('session-tight', attempt)
    assert.ok(prompt.includes('the owner said: ship it'))
    assert.ok(prompt.includes('/repo/big.ts'))
    assert.ok(!prompt.includes('z'.repeat(20_000)))
  })

  it('should still exit 0 and write no handoff when the hook input has no cwd', () => {
    // Arrange
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Hello' } }])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-no-cwd', transcript_path: transcriptPath, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /could not read its hook input.*missing cwd/u)
    assert.equal(new HandoffStoreService(configDir).latestAttempt('session-no-cwd'), null)
  })

  it('should write a failure handoff and skip the writer call when even the mandatory content cannot fit the budget', () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Hello' } }])
    const tinyWindow = String(WRITER_RESERVED_TOKENS + 10)

    // Act
    const result = runCli(
      ['pre-compact', '--writer-model', 'claude-opus-4-8', '--writer-context-tokens', tinyWindow],
      JSON.stringify({ session_id: 'session-overflow', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /record exceeds writer budget/u)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-overflow')
    assert.equal(attempt.status, 'failed')
    assert.match(store.read('session-overflow', attempt), /needs .* characters but the writer's budget allows only/u)
  })

  it("should tell the writer there is no previous handoff on a session's first compaction", () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Hello' } }])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-first', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    const store = new HandoffStoreService(configDir)
    const attempt = latestResolved(store, 'session-first')
    assert.ok(store.read('session-first', attempt).includes("None. This is the session's first compaction."))
  })

  it('should feed the previous successful handoff to the writer as a carry-forward block', () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const store = new HandoffStoreService(configDir)
    const priorId = store.beginAttempt('session-carry')
    store.completeAttempt({
      sessionId: 'session-carry',
      attemptId: priorId,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: '# Handoff\n\n## Next Steps\n\nFinish the migration.\n',
    })
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Continuing' } }])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({ session_id: 'session-carry', transcript_path: transcriptPath, cwd: workDir, trigger: 'auto' })
    )

    // Assert
    assert.equal(result.status, 0)
    const attempt = latestResolved(store, 'session-carry')
    const prompt = store.read('session-carry', attempt)
    assert.ok(prompt.includes('Finish the migration.'))
    assert.ok(prompt.includes('treat it as durable'))
  })

  it('should elide the middle of an oversized previous handoff instead of sending it whole', () => {
    // Arrange
    writeFileSync(claudeBin, ECHO_CLAUDE, { mode: 0o755 })
    const store = new HandoffStoreService(configDir)
    const priorId = store.beginAttempt('session-huge-prior')
    const hugeContent = `START-MARKER${'p'.repeat(MAX_PREVIOUS_HANDOFF_CHARS)}END-MARKER`
    store.completeAttempt({
      sessionId: 'session-huge-prior',
      attemptId: priorId,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: hugeContent,
    })
    const transcriptPath = writeTranscript([{ type: 'user', message: { role: 'user', content: 'Continuing' } }])

    // Act
    const result = runCli(
      PRE_COMPACT_ARGS,
      JSON.stringify({
        session_id: 'session-huge-prior',
        transcript_path: transcriptPath,
        cwd: workDir,
        trigger: 'auto',
      })
    )

    // Assert
    assert.equal(result.status, 0)
    const attempt = latestResolved(store, 'session-huge-prior')
    const prompt = store.read('session-huge-prior', attempt)
    assert.ok(prompt.includes('START-MARKER'))
    assert.ok(prompt.includes('END-MARKER'))
    assert.ok(prompt.includes('characters omitted'))
    assert.ok(!prompt.includes(hugeContent))
  })

  it('should refuse pre-compact without a --writer-context-tokens above the writer reserve', () => {
    // Act
    const missing = runCli(['pre-compact', '--writer-model', 'claude-opus-4-8'], '{}')
    const tooSmall = runCli(
      ['pre-compact', '--writer-model', 'claude-opus-4-8', '--writer-context-tokens', String(WRITER_RESERVED_TOKENS)],
      '{}'
    )

    // Assert
    assert.equal(missing.status, 1)
    assert.match(missing.stderr, /pre-compact needs --writer-context-tokens <n>.*got: nothing/u)
    assert.equal(tooSmall.status, 1)
    assert.match(tooSmall.stderr, new RegExp(`got: ${String(WRITER_RESERVED_TOKENS)}`, 'u'))
  })

  it('should refuse pre-compact without --writer-model', () => {
    // Act
    const result = runCli(['pre-compact'], '{}')

    // Assert
    assert.equal(result.status, 1)
    assert.match(result.stderr, /pre-compact needs --writer-model/u)
  })

  it('should say plainly that no handoff exists yet for a session', () => {
    // Act
    const result = runCli(
      ['session-start'],
      JSON.stringify({ session_id: 'never-compacted', transcript_path: '/tmp/t.jsonl' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /no handoff file was found/u)
    assert.match(result.stdout, /\/tmp\/t\.jsonl/u)
  })

  it('should print the default resume directive naming the handoff and transcript paths', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const id = store.beginAttempt('session-default')
    const handoffPath = store.completeAttempt({
      sessionId: 'session-default',
      attemptId: id,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: '# Handoff\n\ncontent\n',
    })

    // Act
    const result = runCli(
      ['session-start'],
      JSON.stringify({ session_id: 'session-default', transcript_path: '/tmp/t.jsonl' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, new RegExp(handoffPath.replaceAll('/', '\\/'), 'u'))
    assert.match(result.stdout, /\/tmp\/t\.jsonl/u)
    assert.match(result.stdout, /resume the work exactly where the handoff says it left off/u)
  })

  it('should print the orchestration resume directive when the latest handoff was written under that profile', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const id = store.beginAttempt('session-orch')
    store.completeAttempt({
      sessionId: 'session-orch',
      attemptId: id,
      status: 'success',
      profile: 'orchestration',
      taskDir: null,
      content: '# Handoff\n\ncontent\n',
    })

    // Act
    const result = runCli(
      ['session-start'],
      JSON.stringify({ session_id: 'session-orch', transcript_path: '/tmp/t.jsonl' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /call orch_digest on that task directory/u)
  })

  it('should warn instead of silently resuming from a stale success when the latest attempt failed', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    const firstId = store.beginAttempt('session-stale')
    store.completeAttempt({
      sessionId: 'session-stale',
      attemptId: firstId,
      status: 'success',
      profile: 'default',
      taskDir: null,
      content: '# Handoff\n\nfirst, successful\n',
    })
    const secondId = store.beginAttempt('session-stale')
    store.completeAttempt({
      sessionId: 'session-stale',
      attemptId: secondId,
      status: 'failed',
      profile: 'default',
      taskDir: null,
      content: '# Handoff writer failed\n\nboom\n',
    })

    // Act
    const result = runCli(
      ['session-start'],
      JSON.stringify({ session_id: 'session-stale', transcript_path: '/tmp/t.jsonl' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /did not finish successfully/u)
    assert.match(result.stdout, /boom/u)
    assert.ok(!result.stdout.includes('first, successful'))
    assert.ok(!result.stdout.includes('resume the work exactly where the handoff says it left off'))
  })

  it('should warn without a failure note when the latest attempt is still pending', () => {
    // Arrange
    const store = new HandoffStoreService(configDir)
    store.beginAttempt('session-pending')

    // Act
    const result = runCli(
      ['session-start'],
      JSON.stringify({ session_id: 'session-pending', transcript_path: '/tmp/t.jsonl' })
    )

    // Assert
    assert.equal(result.status, 0)
    assert.match(result.stdout, /did not finish successfully/u)
    assert.match(result.stdout, /never finished/u)
  })
})
