export interface IFindDefinitionInput {
  projectPath: string
  searchTerms: string[]
}

export interface ITraceCallsInput {
  projectPath: string
  searchTerms: string[]
  shouldIncludeNonSourceFiles?: boolean
}

export interface IProjectStructureInput {
  projectPath: string
  maxDepth?: number
  relativePath?: string
  showFileExtensions?: boolean
}

export interface IAskAboutFileInput {
  filePath: string
  question: string
}

export interface IFindUnusedSymbolsInput {
  projectPath: string
  relativePath?: string
  includeExported?: boolean
  maxResults?: number
}
