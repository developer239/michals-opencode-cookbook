import type { Plugin } from '@opencode-ai/plugin'
import { CodebaseService } from './services/codebase.service.js'
import { LspService } from './services/lsp.service.js'
import { FindDefinitionTool } from './tools/find-definition.tool.js'
import { FindUnusedSymbolsTool } from './tools/find-unused-symbols.tool.js'
import { ProjectStructureTool } from './tools/project-structure.tool.js'
import { TraceCallsTool } from './tools/trace-calls.tool.js'

export const CodebasePlugin: Plugin = async () => {
  const codebaseService = new CodebaseService()
  const lspService = new LspService(codebaseService)

  return {
    tool: {
      codebase_find_definition: FindDefinitionTool.create(lspService),
      codebase_trace_calls: TraceCallsTool.create(lspService),
      codebase_find_unused_symbols: FindUnusedSymbolsTool.create(lspService),
      codebase_project_structure: ProjectStructureTool.create(codebaseService),
    },
  }
}
