import { join, relative } from 'node:path'
import ts from 'typescript-api'
import type { CodebaseService } from './codebase.service.js'

const SOURCE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']

// Node-kind checks are mutually exclusive, so lookup order carries no meaning
// beyond a stable iteration. Property declarations are handled separately in
// getDefinitionType because their label depends on the initializer.
const DEFINITION_TYPE_CHECKS: [(node: ts.Node) => boolean, string][] = [
  [ts.isClassDeclaration, 'class'],
  [ts.isFunctionDeclaration, 'function'],
  [ts.isInterfaceDeclaration, 'interface'],
  [ts.isTypeAliasDeclaration, 'type'],
  [ts.isEnumDeclaration, 'enum'],
  [ts.isVariableDeclaration, 'variable'],
  [ts.isMethodDeclaration, 'method'],
]

interface IDefinitionMatch {
  term: string
  type: string
  filePath: string
  line: number
  code: string
}

interface ITraceMatch {
  term: string
  usageType: string
  filePath: string
  line: number
  code: string
}

interface IProgramContext {
  program: ts.Program
  sourceFiles: ts.SourceFile[]
}

interface IDeclarationRecord {
  name: string
  type: string
  filePath: string
  line: number
  isExported: boolean
  declarationStart: number
  declarationEnd: number
  sourceFile: ts.SourceFile
  symbol: ts.Symbol | null
}

export interface IUnusedSymbolMatch {
  name: string
  type: string
  filePath: string
  line: number
  isExported: boolean
  code: string
}

export class LspService {
  constructor(private readonly codebaseService: CodebaseService) {}

  public findDefinitions = async (projectPath: string, searchTerms: string[]): Promise<IDefinitionMatch[]> => {
    const terms = this.normalizeSearchTerms(searchTerms)

    if (terms.length === 0) {
      return []
    }

    const context = await this.createProgramContext(projectPath)

    if (!context) {
      return []
    }

    const termSet = new Set(terms)
    const found: IDefinitionMatch[] = []

    for (const sourceFile of context.sourceFiles) {
      const content = sourceFile.text

      const visit = (node: ts.Node): void => {
        const nameNode = this.getDeclarationNameNode(node)
        if (!nameNode || !termSet.has(nameNode.text)) {
          ts.forEachChild(node, visit)
          return
        }

        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const snippet = this.buildSnippet(content, node.getStart(sourceFile), node.getEnd(), 180)

        found.push({
          term: nameNode.text,
          type: this.getDefinitionType(node),
          filePath: relative(projectPath, sourceFile.fileName),
          line: start.line + 1,
          code: snippet,
        })

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }

    return found.sort((left, right) => {
      if (left.term !== right.term) {
        return left.term.localeCompare(right.term)
      }
      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath)
      }
      return left.line - right.line
    })
  }

  public traceCalls = async (projectPath: string, searchTerms: string[]): Promise<ITraceMatch[]> => {
    const terms = this.normalizeSearchTerms(searchTerms)

    if (terms.length === 0) {
      return []
    }

    const context = await this.createProgramContext(projectPath)

    if (!context) {
      return []
    }

    const lowerTerms = terms.map((term) => term.toLowerCase())
    const found: ITraceMatch[] = []

    for (const sourceFile of context.sourceFiles) {
      const content = sourceFile.text

      const visit = (node: ts.Node): void => {
        if (!ts.isIdentifier(node)) {
          ts.forEachChild(node, visit)
          return
        }

        const lowerName = node.text.toLowerCase()
        const matchedTerm = terms.find((term, idx) => lowerTerms[idx] === lowerName)
        if (!matchedTerm) {
          ts.forEachChild(node, visit)
          return
        }

        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const snippet = this.buildLineWindowSnippet(content, start.line + 1, 1)

        found.push({
          term: matchedTerm,
          usageType: this.getUsageType(node),
          filePath: relative(projectPath, sourceFile.fileName),
          line: start.line + 1,
          code: snippet,
        })

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }

    return found.sort((left, right) => {
      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath)
      }
      return left.line - right.line
    })
  }

  public findUnusedSymbols = async (
    projectPath: string,
    options: { relativePath?: string; includeExported?: boolean; maxResults?: number } = {}
  ): Promise<IUnusedSymbolMatch[]> => {
    const shouldIncludeExported = options.includeExported ?? true
    const maxResults = options.maxResults ?? 200
    const scopePath = options.relativePath ? join(projectPath, options.relativePath) : null

    const context = await this.createProgramContext(projectPath)

    if (!context) {
      return []
    }

    const scopedSourceFiles = scopePath
      ? context.sourceFiles.filter((sf) => sf.fileName.startsWith(scopePath))
      : context.sourceFiles

    // Pass 1: collect all declarations
    const checker = context.program.getTypeChecker()

    const declarations = this.collectDeclarations(scopedSourceFiles, projectPath, checker)

    if (declarations.length === 0) {
      return []
    }

    // Pass 2: collect all identifier references across the FULL program (not just scoped files)
    const referencedNames = this.collectReferencedNames(context.sourceFiles, declarations, checker, projectPath)

    // Filter to unused declarations
    const unused = declarations
      .filter((decl) => {
        if (!shouldIncludeExported && decl.isExported) {
          return false
        }
        return !referencedNames.has(this.buildDeclarationKey(decl))
      })
      .sort((left, right) => {
        if (left.filePath !== right.filePath) {
          return left.filePath.localeCompare(right.filePath)
        }
        return left.line - right.line
      })
      .slice(0, maxResults)

    return unused.map((decl) => ({
      name: decl.name,
      type: decl.type,
      filePath: decl.filePath,
      line: decl.line,
      isExported: decl.isExported,
      code: this.buildSnippet(decl.sourceFile.text, decl.declarationStart, decl.declarationEnd, 10),
    }))
  }

  private readonly normalizeSearchTerms = (searchTerms: string[]): string[] =>
    searchTerms.map((term) => term.trim()).filter((term) => term.length > 0)

  private readonly collectDeclarations = (
    sourceFiles: ts.SourceFile[],
    projectPath: string,
    checker: ts.TypeChecker
  ): IDeclarationRecord[] => {
    const declarations: IDeclarationRecord[] = []

    for (const sourceFile of sourceFiles) {
      const visit = (node: ts.Node): void => {
        const nameNode = this.getDeclarationNameNode(node)
        if (!nameNode) {
          ts.forEachChild(node, visit)
          return
        }

        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        const isExported = this.hasExportModifier(node)

        declarations.push({
          name: nameNode.text,
          type: this.getDefinitionType(node),
          filePath: relative(projectPath, sourceFile.fileName),
          line: start.line + 1,
          isExported,
          declarationStart: node.getStart(sourceFile),
          declarationEnd: node.getEnd(),
          sourceFile,
          symbol: checker.getSymbolAtLocation(nameNode) ?? null,
        })

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }

    return declarations
  }

  private readonly collectReferencedNames = (
    sourceFiles: ts.SourceFile[],
    declarations: IDeclarationRecord[],
    checker: ts.TypeChecker,
    projectPath: string
  ): Set<string> => {
    // Build lookups:
    // - symbol -> set of declaration keys (preferred; avoids same-name collisions)
    // - name -> set of declaration keys (fallback when checker can't resolve symbol)
    const declarationSymbols = new Map<ts.Symbol, Set<string>>()
    const declarationPositions = new Map<string, Set<string>>()

    for (const decl of declarations) {
      const positionKey = this.buildDeclarationKey(decl)

      if (decl.symbol) {
        this.addDeclarationLookupEntry(declarationSymbols, this.resolveAliasedSymbol(decl.symbol, checker), positionKey)
      }

      const existing = declarationPositions.get(decl.name)
      if (existing) {
        existing.add(positionKey)
      } else {
        declarationPositions.set(decl.name, new Set([positionKey]))
      }
    }

    const referenced = new Set<string>()

    for (const sourceFile of sourceFiles) {
      const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node)) {
          const symbol = checker.getSymbolAtLocation(node) ?? null
          const resolved = symbol ? this.resolveAliasedSymbol(symbol, checker) : null
          const positions =
            (resolved ? declarationSymbols.get(resolved) : undefined) ?? declarationPositions.get(node.text)

          if (positions && !this.isDeclarationSite(node, positions, projectPath)) {
            for (const posKey of positions) {
              referenced.add(posKey)
            }
          }
        }

        ts.forEachChild(node, visit)
      }

      visit(sourceFile)
    }

    return referenced
  }

  private readonly buildDeclarationKey = (decl: IDeclarationRecord): string =>
    `${decl.filePath}:${decl.declarationStart}-${decl.declarationEnd}`

  private readonly isDeclarationSite = (
    node: ts.Identifier,
    declarationPositionKeys: Set<string>,
    projectPath: string
  ): boolean => {
    const { parent } = node as { parent?: ts.Node }

    if (parent === undefined) {
      return false
    }

    const nameNode = this.getDeclarationNameNode(parent)

    if (!nameNode || nameNode !== node) {
      return false
    }

    const sourceFile = node.getSourceFile()
    const relPath = relative(projectPath, sourceFile.fileName)
    const parentStart = parent.getStart(sourceFile)
    const parentEnd = parent.getEnd()
    const posKey = `${relPath}:${parentStart}-${parentEnd}`
    return declarationPositionKeys.has(posKey)
  }

  private readonly hasExportModifier = (node: ts.Node): boolean => {
    // VariableDeclaration nodes don't carry modifiers - the export lives on the parent VariableStatement
    if (ts.isVariableDeclaration(node)) {
      const declarationList = (node as { parent?: ts.Node }).parent

      if (declarationList === undefined) {
        return false
      }

      if (ts.isVariableDeclarationList(declarationList)) {
        const statement = (declarationList as { parent?: ts.Node }).parent

        if (statement === undefined) {
          return false
        }

        if (ts.isVariableStatement(statement)) {
          return this.hasExportModifier(statement)
        }
      }

      return false
    }

    if (!ts.canHaveModifiers(node)) {
      return false
    }

    const modifiers = ts.getModifiers(node)

    if (!modifiers) {
      return false
    }

    for (const mod of modifiers) {
      if (mod.kind === ts.SyntaxKind.ExportKeyword) {
        return true
      }
    }

    return false
  }

  private readonly resolveAliasedSymbol = (symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol => {
    // oxlint-disable-next-line no-bitwise -- ts.SymbolFlags is a bitmask; & is the API's membership test
    if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
      return symbol
    }

    try {
      return checker.getAliasedSymbol(symbol)
    } catch {
      return symbol
    }
  }

  private readonly addDeclarationLookupEntry = (
    map: Map<ts.Symbol, Set<string>>,
    symbol: ts.Symbol,
    declarationKey: string
  ): void => {
    const existing = map.get(symbol)
    if (existing) {
      existing.add(declarationKey)
      return
    }

    map.set(symbol, new Set([declarationKey]))
  }

  private readonly createProgramContext = async (projectPath: string): Promise<IProgramContext | null> => {
    const configured = this.createConfiguredProgram(projectPath)
    if (configured) {
      return {
        ...configured,
        sourceFiles: this.filterProjectSourceFiles(configured.program, projectPath),
      }
    }

    const discoveredFiles = await this.codebaseService.discoverFiles(projectPath, {
      whitelistExtensions: SOURCE_EXTENSIONS,
    })

    if (discoveredFiles.length === 0) {
      return null
    }

    const program = ts.createProgram({
      rootNames: discoveredFiles,
      options: {
        allowJs: true,
        checkJs: false,
        noEmit: true,
        skipLibCheck: true,
        target: ts.ScriptTarget.ES2022,
      },
    })

    return {
      program,
      sourceFiles: this.filterProjectSourceFiles(program, projectPath),
    }
  }

  private readonly createConfiguredProgram = (projectPath: string): { program: ts.Program } | null => {
    const configPath = ts.findConfigFile(projectPath, ts.sys.fileExists, 'tsconfig.json')

    if (!configPath) {
      return null
    }

    const readResult = ts.readConfigFile(configPath, ts.sys.readFile)

    if (readResult.error) {
      return null
    }

    const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, projectPath, { noEmit: true }, configPath)

    if (parsed.errors.length > 0 || parsed.fileNames.length === 0) {
      return null
    }

    const program = ts.createProgram({
      rootNames: parsed.fileNames,
      options: {
        ...parsed.options,
        noEmit: true,
        skipLibCheck: true,
      },
      projectReferences: parsed.projectReferences,
    })

    return { program }
  }

  private readonly filterProjectSourceFiles = (program: ts.Program, projectPath: string): ts.SourceFile[] =>
    program.getSourceFiles().filter((sourceFile) => {
      if (sourceFile.isDeclarationFile) {
        return false
      }
      if (!sourceFile.fileName.startsWith(projectPath)) {
        return false
      }
      const extension = sourceFile.fileName.split('.').pop()?.toLowerCase() ?? ''
      return SOURCE_EXTENSIONS.includes(extension)
    })

  private readonly getDeclarationNameNode = (node: ts.Node): ts.Identifier | null => {
    if (this.isOptionalNamedDeclaration(node)) {
      return node.name ?? null
    }

    if (this.isAlwaysNamedDeclaration(node)) {
      return node.name
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name
    }

    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name
    }

    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
      return node.name
    }

    return null
  }

  private readonly getDefinitionType = (node: ts.Node): string => {
    if (ts.isPropertyDeclaration(node)) {
      const isFunctionProperty =
        node.initializer !== undefined &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      return isFunctionProperty ? 'method' : 'variable'
    }

    const match = DEFINITION_TYPE_CHECKS.find(([predicate]) => predicate(node))
    return match?.[1] ?? 'symbol'
  }

  private readonly getUsageType = (node: ts.Identifier): string => {
    const parent = node.parent as ts.Node | undefined
    if (parent === undefined) {
      return 'reference'
    }

    if (this.isImportParent(parent)) {
      return 'import'
    }
    if (ts.isTypeReferenceNode(parent)) {
      return 'type-reference'
    }
    if (ts.isHeritageClause(parent)) {
      return parent.token === ts.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements'
    }
    if (ts.isCallExpression(parent)) {
      return parent.expression === node ? 'call' : 'reference'
    }
    if (ts.isNewExpression(parent)) {
      return parent.expression === node ? 'instantiation' : 'reference'
    }

    return 'reference'
  }

  private readonly isOptionalNamedDeclaration = (
    node: ts.Node
  ): node is ts.ClassDeclaration | ts.FunctionDeclaration | ts.InterfaceDeclaration =>
    ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isInterfaceDeclaration(node)

  private readonly isAlwaysNamedDeclaration = (node: ts.Node): node is ts.TypeAliasDeclaration | ts.EnumDeclaration =>
    ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)

  private readonly isImportParent = (node: ts.Node): boolean =>
    ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node)

  private readonly buildSnippet = (content: string, startPos: number, endPos: number, maxLines: number): string => {
    const startLine = this.positionToLine(content, startPos)
    const endLine = this.positionToLine(content, endPos)
    const totalLines = endLine - startLine + 1
    const boundedEndLine = totalLines > maxLines ? startLine + maxLines - 1 : endLine
    const snippet = this.extractLinesWithNumbers(content, startLine, boundedEndLine)

    if (totalLines <= maxLines) {
      return snippet
    }

    return `${snippet}\n... (truncated ${totalLines - maxLines} lines)`
  }

  private readonly buildLineWindowSnippet = (content: string, centerLine: number, padding: number): string => {
    const lines = content.split('\n')
    const startLine = Math.max(1, centerLine - padding)
    const endLine = Math.min(lines.length, centerLine + padding)
    return this.extractLinesWithNumbers(content, startLine, endLine)
  }

  private readonly extractLinesWithNumbers = (content: string, startLine: number, endLine: number): string => {
    const lines = content.split('\n')
    const safeStart = Math.max(1, startLine)
    const safeEnd = Math.min(lines.length, endLine)
    const width = String(safeEnd).length
    const result: string[] = []

    for (let idx = safeStart; idx <= safeEnd; idx += 1) {
      const raw = lines[idx - 1] ?? ''
      result.push(`${String(idx).padStart(width, ' ')} | ${raw}`)
    }

    return result.join('\n')
  }

  private readonly positionToLine = (content: string, position: number): number => {
    let line = 1
    for (let idx = 0; idx < Math.min(content.length, position); idx += 1) {
      if (content[idx] === '\n') {
        line += 1
      }
    }
    return line
  }
}
