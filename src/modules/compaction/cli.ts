#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'
import { PromptLoaderService } from '../_core/services/prompt-loader.service.js'
import { PluginError } from '../_core/types/errors.js'
import { PROMPT_CHARS_PER_TOKEN, WRITER_RESERVED_TOKENS } from './config.js'
import { GitStateService } from './services/git-state.service.js'
import { HandoffStoreService } from './services/handoff-store.service.js'
import { HandoffWriterService } from './services/handoff-writer.service.js'
import { ProfileChoiceService } from './services/profile-choice.service.js'
import { SessionRecordService } from './services/session-record.service.js'
import { TranscriptParserService } from './services/transcript-parser.service.js'
import { COMPACTION_PROFILES, type CompactionProfile } from './types/compaction.types.js'

// The two Claude Code hooks the installer wires up. Both read the hook's own
// JSON on stdin and print to stdout; neither takes --task like the orch CLI.
const USAGE = `Usage: node dist/modules/compaction/cli.js <command> [options]

Commands:
  pre-compact --writer-model <model> --writer-context-tokens <n> [--writer-timeout-seconds <n>]
                                       read a PreCompact hook's stdin JSON, write a handoff file, exit 0 always
  session-start                       read a SessionStart hook's stdin JSON and print the resume directive`

const COMMANDS = new Set(['pre-compact', 'session-start'])

const NO_TASK_DIR_TEXT = 'unknown - no orch tool call in this session named one'

interface IHookInput {
  sessionId: string
  transcriptPath: string
}

interface IPreCompactInput extends IHookInput {
  cwd: string
}

const readStdin = (): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf-8')
    process.stdin.on('data', (chunk: string) => {
      data += chunk
    })
    process.stdin.on('end', () => {
      resolve(data)
    })
    process.stdin.on('error', reject)
  })

const readHookFields = (raw: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new PluginError('Hook input is not a JSON object', 'VALIDATION_ERROR')
  }
  return parsed as Record<string, unknown>
}

const readRequiredString = (fields: Record<string, unknown>, key: string): string => {
  const value = fields[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PluginError(`Hook input is missing ${key}`, 'VALIDATION_ERROR')
  }
  return value
}

const parseHookInput = (raw: string): IHookInput => {
  const fields = readHookFields(raw)
  return {
    sessionId: readRequiredString(fields, 'session_id'),
    transcriptPath: readRequiredString(fields, 'transcript_path'),
  }
}

// Claude Code puts the session's working directory in every hook's input;
// only pre-compact reads it, to capture the git state.
const parsePreCompactInput = (raw: string): IPreCompactInput => {
  const fields = readHookFields(raw)
  return {
    sessionId: readRequiredString(fields, 'session_id'),
    transcriptPath: readRequiredString(fields, 'transcript_path'),
    cwd: readRequiredString(fields, 'cwd'),
  }
}

const loadPrompt = (name: string): string => PromptLoaderService.load(new URL(`./prompts/${name}.txt`, import.meta.url))

// The record is filled in last, so nothing in it is read as a placeholder.
const buildWriterPrompt = (
  profile: CompactionProfile,
  taskDir: string | null,
  gitState: string,
  record: string
): string => {
  const instructions = PromptLoaderService.build(loadPrompt(`${profile}-handoff`), {
    taskDir: taskDir ?? NO_TASK_DIR_TEXT,
  })
  return PromptLoaderService.build(loadPrompt('writer-wrapper'), { instructions, gitState, record })
}

const buildFailureHandoff = (message: string, taskDir: string | null): string => {
  const taskDirLine = taskDir === null ? '' : `\nThe last known orchestration task directory was: ${taskDir}\n`
  return `# Handoff writer failed\n\nThe pre-compact writer could not produce a handoff for this compaction:\n\n${message}\n${taskDirLine}`
}

const runPreCompact = async (
  writerModel: string,
  writerContextTokens: number,
  writerTimeoutMs: number | undefined
): Promise<string> => {
  const raw = await readStdin()
  let input: IPreCompactInput
  try {
    input = parsePreCompactInput(raw)
  } catch (error) {
    // No session id, so there is nowhere to write a handoff file. PreCompact
    // never blocks compaction - this is reported in the output, not thrown.
    const message = error instanceof Error ? error.message : String(error)
    return `pre-compact could not read its hook input, so no handoff was written: ${message}`
  }

  const store = new HandoffStoreService()
  try {
    const transcriptText = readFileSync(input.transcriptPath, 'utf-8')
    const events = new TranscriptParserService().parse(transcriptText)
    if (events.length === 0) {
      const path = store.write(
        input.sessionId,
        'default',
        buildFailureHandoff(
          'The transcript had no readable events (every line failed to parse, or it was empty).',
          null
        )
      )
      return `Wrote a failure handoff for session ${input.sessionId} to ${path}: transcript had no readable events`
    }
    const { profile, taskDir } = new ProfileChoiceService().choose(events)
    const recordService = new SessionRecordService()
    const gitState = new GitStateService().describe([
      input.cwd,
      ...recordService.listWrittenFiles(events).map((path) => dirname(path)),
    ])
    const promptBudget = (writerContextTokens - WRITER_RESERVED_TOKENS) * PROMPT_CHARS_PER_TOKEN
    const recordBudget = promptBudget - buildWriterPrompt(profile, taskDir, gitState, '').length
    const record = recordService.build(events, recordBudget)
    const written = new HandoffWriterService().write(
      writerModel,
      buildWriterPrompt(profile, taskDir, gitState, record),
      writerTimeoutMs
    )
    const content = written.isOk ? written.text : buildFailureHandoff(written.text, taskDir)
    const path = store.write(input.sessionId, profile, content)
    return `Wrote handoff for session ${input.sessionId} to ${path} (profile: ${profile})`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const path = store.write(input.sessionId, 'default', buildFailureHandoff(message, null))
    return `Wrote a failure handoff for session ${input.sessionId} to ${path}: ${message}`
  }
}

// The profile a handoff was written under, read back from its filename
// (`<timestamp>-<profile>.md`); an unrecognized suffix falls back to the
// default resume steps rather than failing the session-start hook.
const parseProfileFromFilename = (path: string): CompactionProfile => {
  const candidate = /-(?<profile>[a-z]+)\.md$/u.exec(path)?.groups?.profile
  return (COMPACTION_PROFILES as readonly string[]).includes(candidate ?? '')
    ? (candidate as CompactionProfile)
    : 'default'
}

const runSessionStart = async (): Promise<string> => {
  const raw = await readStdin()
  const input = parseHookInput(raw)
  const store = new HandoffStoreService()
  const handoffPath = store.findLatest(input.sessionId)

  if (handoffPath === null) {
    return PromptLoaderService.build(loadPrompt('no-handoff'), {
      handoffDir: store.directoryFor(input.sessionId),
      transcriptPath: input.transcriptPath,
    })
  }

  const preamble = PromptLoaderService.build(loadPrompt('resume-preamble'), {
    handoffPath,
    transcriptPath: input.transcriptPath,
  })
  const tail = loadPrompt(`${parseProfileFromFilename(handoffPath)}-resume`)
  return `${preamble.trim()} ${tail.trim()}`
}

const parseWriterContextTokens = (writerContextTokens: string | undefined): number => {
  const tokens = Number(writerContextTokens)
  if (!Number.isInteger(tokens) || tokens <= WRITER_RESERVED_TOKENS) {
    throw new PluginError(
      `pre-compact needs --writer-context-tokens <n>, the writer model's context window: an integer above the ${String(WRITER_RESERVED_TOKENS)} tokens reserved for the writer's own use, got: ${writerContextTokens ?? 'nothing'}\n\n${USAGE}`,
      'VALIDATION_ERROR'
    )
  }
  return tokens
}

const parseWriterTimeoutMs = (writerTimeoutSeconds: string | undefined): number | undefined => {
  if (writerTimeoutSeconds === undefined) {
    return undefined
  }
  const ms = Number(writerTimeoutSeconds) * 1000
  if (!Number.isFinite(ms)) {
    throw new PluginError(`--writer-timeout-seconds must be a number, got: ${writerTimeoutSeconds}`, 'VALIDATION_ERROR')
  }
  return ms
}

const main = async (): Promise<string> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'writer-model': { type: 'string' },
      'writer-context-tokens': { type: 'string' },
      'writer-timeout-seconds': { type: 'string' },
      'help': { type: 'boolean' },
    },
  })
  if (values.help === true || positionals.length === 0) {
    return USAGE
  }
  const [command, ...rest] = positionals
  if (rest.length > 0 || command === undefined || !COMMANDS.has(command)) {
    throw new PluginError(`Unknown command: ${command ?? ''}\n\n${USAGE}`, 'VALIDATION_ERROR')
  }
  if (command === 'session-start') {
    return runSessionStart()
  }
  const writerModel = values['writer-model']
  if (writerModel === undefined || writerModel.trim() === '') {
    throw new PluginError(`pre-compact needs --writer-model <model>\n\n${USAGE}`, 'VALIDATION_ERROR')
  }
  return runPreCompact(
    writerModel,
    parseWriterContextTokens(values['writer-context-tokens']),
    parseWriterTimeoutMs(values['writer-timeout-seconds'])
  )
}

main()
  .then((output) => {
    process.stdout.write(`${output}\n`)
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
