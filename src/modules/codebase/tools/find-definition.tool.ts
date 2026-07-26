import { tool } from '@opencode-ai/plugin'
import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { BaseTool } from '../../_core/tools/base-tool.js'
import type { LspService } from '../services/lsp.service.js'
import type { IFindDefinitionInput } from '../types/codebase.types.js'

const schema = {
  projectPath: tool.schema.string().describe('The absolute path to the project directory to analyze'),
  searchTerms: tool.schema
    .array(tool.schema.string())
    .describe('Terms to find definitions for (e.g., ["AuthService", "handleRequest"])'),
}

export class FindDefinitionTool extends BaseTool<IFindDefinitionInput> {
  constructor(private readonly lspService: LspService) {
    super()
  }

  public static readonly create = (lspService: LspService): ReturnType<typeof tool> => {
    const handler = new FindDefinitionTool(lspService)
    return tool({
      description:
        'Locate definitions of functions, classes, or types in a codebase. Returns verified results with exact line numbers. Use this when you know the name of something and want to see its structure/signature.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IFindDefinitionInput): Promise<string> =>
    this.handleErrors(async () => {
      const { projectPath, searchTerms } = args

      const definitions = await this.lspService.findDefinitions(projectPath, searchTerms)
      if (definitions.length === 0) {
        return `No files found containing definitions for: ${searchTerms.join(', ')}`
      }

      const md = MarkdownBuilder.create()

      for (const term of searchTerms) {
        const termMatches = definitions.filter((definition) => definition.term === term)
        if (termMatches.length === 0) {
          continue
        }

        md.heading(term, 3)

        for (const match of termMatches) {
          md.field('Location', `\`${match.filePath}:${match.line}\``)
          md.field('Type', match.type)
          md.blank()
          md.codeBlock(match.code, 'typescript')
          md.blank()
        }
      }

      return md.build().trim()
    }, 'Error finding definitions')
}
