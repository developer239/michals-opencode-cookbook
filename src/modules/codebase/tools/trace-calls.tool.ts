import { tool } from '@opencode-ai/plugin'
import { groupByKey } from '../../_core/services/format.utils.js'
import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { BaseTool } from '../../_core/tools/base-tool.js'
import type { LspService } from '../services/lsp.service.js'
import type { ITraceCallsInput } from '../types/codebase.types.js'

const schema = {
  projectPath: tool.schema.string().describe('The absolute path to the project directory to analyze'),
  searchTerms: tool.schema
    .array(tool.schema.string())
    .describe('Terms to trace usage for (e.g., ["AuthService", "validateToken"])'),
  shouldIncludeNonSourceFiles: tool.schema
    .boolean()
    .optional()
    .describe('Include .md, .json, .yaml files in search (default: false)'),
}

export class TraceCallsTool extends BaseTool<ITraceCallsInput> {
  constructor(private readonly lspService: LspService) {
    super()
  }

  public static readonly create = (lspService: LspService): ReturnType<typeof tool> => {
    const handler = new TraceCallsTool(lspService)
    return tool({
      description:
        'Find all usages of functions, classes, or types across a codebase. Returns results grouped by file with verified line numbers. Use this for refactoring - to find all call sites before renaming or modifying something.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: ITraceCallsInput): Promise<string> =>
    this.handleErrors(async () => {
      const { projectPath, searchTerms } = args

      const usages = await this.lspService.traceCalls(projectPath, searchTerms)
      if (usages.length === 0) {
        return `No files found containing usages of: ${searchTerms.join(', ')}`
      }

      const grouped = groupByKey(usages, (usage) => usage.filePath)

      const md = MarkdownBuilder.create()

      for (const [filePath, fileUsages] of grouped.entries()) {
        md.heading(`File: ${filePath}`, 3)

        for (const usage of fileUsages) {
          md.text(`**Line ${usage.line}** - [${usage.usageType}] (${usage.term})`)
          md.blank()
          md.codeBlock(usage.code, 'typescript')
          md.blank()
        }
      }

      md.heading('Summary', 2)
      md.bullet(`Total files: ${grouped.size}`)
      md.bullet(`Total usages: ${usages.length}`)

      return md.build().trim()
    }, 'Error tracing calls')
}
