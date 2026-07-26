#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'node:util'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  tool,
  type Plugin,
  type PluginInput,
  type ToolAttachment,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from '@opencode-ai/plugin'
import { CodebasePlugin } from '../modules/codebase/codebase.plugin.js'
import { OpenCodePlugin } from '../modules/opencode/opencode.plugin.js'

const PLUGINS = {
  codebase: CodebasePlugin,
  opencode: OpenCodePlugin,
} satisfies Record<string, Plugin>

type TContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

interface ILoadedTool {
  name: string
  definition: ToolDefinition
  schema: { parse: (value: unknown) => unknown }
  inputSchema: Record<string, unknown>
}

// stdout carries the MCP JSON-RPC stream; any stray console output would
// corrupt it. The Logger deliberately mirrors some lines to the console, so
// the stdout-bound console methods are rerouted to stderr before the plugins
// are instantiated. console.warn/error already write to stderr.
const redirectConsoleToStderr = (): void => {
  const write = (...args: unknown[]): void => {
    process.stderr.write(`${format(...args)}\n`)
  }
  console.log = write
  console.info = write
  console.debug = write
}

// The plugins touch exactly two client endpoints: client.app.log (structured
// server log) and client.tui.showToast (TUI toast). Both are fire-and-forget;
// here they land on stderr, the only stream a stdio MCP server may write to
// freely. Everything else the plugins need (session store, subprocesses) is
// plain filesystem access they perform themselves, so the shim covers only
// those two endpoints and crosses the type boundary in one place.
const createShimInput = (): PluginInput => {
  const client = {
    app: {
      log: (input: { body: { service: string; level: string; message: string } }): Promise<void> => {
        const { service, level, message } = input.body
        process.stderr.write(`${level.toUpperCase().padEnd(5)} [${service}] ${message}\n`)
        return Promise.resolve()
      },
    },
    tui: {
      showToast: (input: { body: { title: string; message: string; variant: string } }): Promise<void> => {
        const { title, message, variant } = input.body
        process.stderr.write(`TOAST [${variant}] ${title}: ${message}\n`)
        return Promise.resolve()
      },
    },
  }

  return { client } as unknown as PluginInput
}

// context.ask resolves unconditionally: permission gating belongs to Claude
// Code's own permission layer (mcp__<server>__<tool> rules), which has already
// approved the call by the time it reaches this server. directory/worktree are
// the server's cwd, which Claude Code sets to the active project directory.
const buildContext = (signal: AbortSignal): ToolContext => ({
  sessionID: 'mcp',
  messageID: 'mcp',
  agent: 'claude-code',
  directory: process.cwd(),
  worktree: process.cwd(),
  abort: signal,
  metadata: () => undefined,
  ask: () => Promise.resolve(),
})

const attachmentToBlock = (attachment: ToolAttachment): TContentBlock => {
  if (attachment.mime.startsWith('image/')) {
    if (attachment.url.startsWith('data:')) {
      const data = attachment.url.slice(attachment.url.indexOf(',') + 1)
      return { type: 'image', data, mimeType: attachment.mime }
    }
    if (attachment.url.startsWith('file://') || attachment.url.startsWith('/')) {
      const path = attachment.url.startsWith('file://') ? fileURLToPath(attachment.url) : attachment.url
      return { type: 'image', data: readFileSync(path).toString('base64'), mimeType: attachment.mime }
    }
  }

  const location = attachment.url.startsWith('data:') ? '<data url>' : attachment.url
  return { type: 'text', text: `Attachment: ${attachment.filename ?? 'file'} (${attachment.mime}) at ${location}` }
}

const toContent = (result: ToolResult): TContentBlock[] => {
  if (typeof result === 'string') {
    return [{ type: 'text', text: result }]
  }

  const text = result.title === undefined ? result.output : `${result.title}\n\n${result.output}`
  const attachments = (result.attachments ?? []).map(attachmentToBlock)

  return [{ type: 'text', text }, ...attachments]
}

const loadTools = async (): Promise<ILoadedTool[]> => {
  const input = createShimInput()
  const instantiated = await Promise.all(
    Object.entries(PLUGINS).map(async ([module, plugin]) => ({ module, hooks: await plugin(input) }))
  )

  const tools: ILoadedTool[] = []
  const seen = new Set<string>()
  for (const { module, hooks } of instantiated) {
    for (const [name, definition] of Object.entries(hooks.tool ?? {})) {
      if (seen.has(name)) {
        throw new Error(`Duplicate tool name '${name}' registered by module '${module}'`)
      }
      seen.add(name)

      const schema = tool.schema.object(definition.args)
      const inputSchema = tool.schema.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
      delete inputSchema.$schema
      tools.push({ name, definition, schema, inputSchema })
    }
  }

  return tools
}

const main = async (): Promise<void> => {
  redirectConsoleToStderr()

  const tools = await loadTools()
  const toolsByName = new Map(tools.map((entry) => [entry.name, entry]))

  const projectRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
  const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8')) as { version: string }
  const server = new Server({ name: 'opencode', version }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map((entry) => ({
      name: entry.name,
      description: entry.definition.description,
      inputSchema: entry.inputSchema,
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const entry = toolsByName.get(request.params.name)
    if (entry === undefined) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${request.params.name}`)
    }

    try {
      const args = entry.schema.parse(request.params.arguments ?? {})
      const result = await entry.definition.execute(args as never, buildContext(extra.signal))
      return { content: toContent(result) }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { content: [{ type: 'text', text: `${request.params.name} failed: ${message}` }], isError: true }
    }
  })

  await server.connect(new StdioServerTransport())
  process.stderr.write(`opencode MCP server ready: ${tools.length} tools from ${Object.keys(PLUGINS).join(', ')}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
  process.exit(1)
})
