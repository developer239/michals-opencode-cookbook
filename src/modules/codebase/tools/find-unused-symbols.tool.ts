import { tool } from '@opencode-ai/plugin'
import { groupByKey } from '../../_core/services/format.utils.js'
import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { BaseTool } from '../../_core/tools/base-tool.js'
import type { LspService } from '../services/lsp.service.js'
import type { IFindUnusedSymbolsInput } from '../types/codebase.types.js'

const schema = {
  projectPath: tool.schema.string().describe('The absolute path to the project directory to analyze'),
  relativePath: tool.schema
    .string()
    .optional()
    .describe(
      'Optional subdirectory to scope the scan to (e.g., "src/modules/auth"). Only declarations inside this' +
        'path are checked; references are still resolved project-wide.'
    ),
  includeExported: tool.schema
    .boolean()
    .optional()
    .describe(
      'Include exported symbols in the results (default: true). Exported symbols are flagged with a warning' +
        'since they may be consumed externally.'
    ),
  maxResults: tool.schema.number().optional().describe('Maximum number of unused symbols to return (default: 200)'),
}

export class FindUnusedSymbolsTool extends BaseTool<IFindUnusedSymbolsInput> {
  constructor(private readonly lspService: LspService) {
    super()
  }

  public static readonly create = (lspService: LspService): ReturnType<typeof tool> => {
    const handler = new FindUnusedSymbolsTool(lspService)
    return tool({
      description:
        'Find unused symbols (functions, classes, types, interfaces, enums, variables, methods) in a TypeScript/JavaScript codebase. Returns declarations with zero references elsewhere in the project. Exported symbols are included by default with a warning - they may be consumed externally (e.g., by other repos, Dockerfiles, or runtime entry points). Use this as a starting point for dead-code cleanup and refactoring.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IFindUnusedSymbolsInput): Promise<string> =>
    this.handleErrors(async () => {
      const results = await this.lspService.findUnusedSymbols(args.projectPath, {
        relativePath: args.relativePath,
        includeExported: args.includeExported,
        maxResults: args.maxResults,
      })

      if (results.length === 0) {
        return 'No unused symbols found.'
      }

      const grouped = groupByKey(results, (result) => result.filePath)

      const md = MarkdownBuilder.create()
        .heading('Unused Symbols', 1)
        .blank()
        .italic(
          'Warning: exported symbols may be consumed externally (other repos, Dockerfiles, runtime entry points, CLI commands). Review before removing.'
        )
        .blank()

      let exportedCount = 0
      let unexportedCount = 0

      for (const [filePath, fileResults] of grouped.entries()) {
        md.heading(`File: ${filePath}`, 3)

        for (const result of fileResults) {
          const exportTag = result.isExported ? ' **(exported)**' : ''
          md.text(`**Line ${result.line}** - [${result.type}] \`${result.name}\`${exportTag}`)
          md.blank()
          md.codeBlock(result.code, 'typescript')
          md.blank()

          if (result.isExported) {
            exportedCount += 1
          } else {
            unexportedCount += 1
          }
        }
      }

      md.heading('Summary', 2)
      md.bullet(`Total unused symbols: ${results.length}`)
      md.bullet(`Unexported (safe to remove): ${unexportedCount}`)
      md.bullet(`Exported (review before removing): ${exportedCount}`)
      md.bullet(`Files affected: ${grouped.size}`)

      return md.build().trim()
    }, 'Error finding unused symbols')
}
