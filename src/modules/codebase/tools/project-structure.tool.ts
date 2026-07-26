import { tool } from '@opencode-ai/plugin'
import { BaseTool } from '../../_core/tools/base-tool.js'
import type { CodebaseService } from '../services/codebase.service.js'
import type { IProjectStructureInput } from '../types/codebase.types.js'

const schema = {
  projectPath: tool.schema.string().describe('The absolute path to the project directory to analyze'),
  maxDepth: tool.schema.number().optional().describe('Maximum depth to traverse (default: 5)'),
  relativePath: tool.schema
    .string()
    .optional()
    .describe('Relative path within project to focus on (e.g., "src/services")'),
  showFileExtensions: tool.schema.boolean().optional().describe('Whether to show file type statistics'),
}

export class ProjectStructureTool extends BaseTool<IProjectStructureInput> {
  constructor(private readonly codebaseService: CodebaseService) {
    super()
  }

  public static readonly create = (codebaseService: CodebaseService): ReturnType<typeof tool> => {
    const handler = new ProjectStructureTool(codebaseService)
    return tool({
      description:
        'Get a tree-like view of the project structure to understand the codebase organization. This tool helps you explore unfamiliar projects by showing the directory hierarchy, file counts, and basic statistics. Use this as a starting point when working with a new codebase.',
      args: schema,
      execute: (args) => handler.execute(args),
    })
  }

  public execute = (args: IProjectStructureInput): Promise<string> =>
    this.handleErrors(
      () =>
        this.codebaseService.getProjectStructure(args.projectPath, {
          maxDepth: args.maxDepth,
          relativePath: args.relativePath,
          showFileExtensions: args.showFileExtensions,
        }),
      'Error getting project structure'
    )
}
