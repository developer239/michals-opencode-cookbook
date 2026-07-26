/* oxlint-disable no-await-in-loop -- directory trees and file counts are walked sequentially so output order stays deterministic */
import { type Dirent, promises as fs } from 'node:fs'
import { join, relative } from 'node:path'
import { glob } from 'glob'
import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { DEFAULT_IGNORE_PATTERNS, DEFAULT_WHITELIST_EXTENSIONS, STRUCTURE_VISIBLE_FILES } from '../config.js'

export class CodebaseService {
  public discoverFiles = async (
    projectPath: string,
    options: {
      ignorePatterns?: string[]
      whitelistExtensions?: string[]
    } = {}
  ): Promise<string[]> => {
    const ignorePatterns = options.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS
    const whitelistExtensions = options.whitelistExtensions ?? DEFAULT_WHITELIST_EXTENSIONS

    const gitignorePatterns = await this.parseGitignore(projectPath)
    const allIgnorePatterns = [...ignorePatterns, ...gitignorePatterns]

    const extensionPattern =
      whitelistExtensions.length === 1 ? whitelistExtensions[0] : `{${whitelistExtensions.join(',')}}`

    const globPattern = `**/*.${extensionPattern}`

    const files = await glob(globPattern, {
      cwd: projectPath,
      ignore: allIgnorePatterns,
      absolute: false,
      dot: true,
    })

    return files.map((file) => join(projectPath, file))
  }

  public readFile = (filePath: string): Promise<string> => fs.readFile(filePath, 'utf-8')

  public getProjectStructure = async (
    projectPath: string,
    options: {
      maxDepth?: number
      relativePath?: string
      showFileExtensions?: boolean
    } = {}
  ): Promise<string> => {
    const maxDepth = options.maxDepth ?? 5
    const shouldShowFileExtensions = options.showFileExtensions ?? true
    const startPath = options.relativePath ? join(projectPath, options.relativePath) : projectPath

    const gitignorePatterns = await this.parseGitignore(projectPath)
    const gitignoreNames = await this.parseGitignoreNames(projectPath)
    const derivedGitignoreNames = this.extractIgnoreNamesFromPatterns(gitignorePatterns)

    const simpleDefaultPatterns = DEFAULT_IGNORE_PATTERNS.map((pattern) =>
      pattern.replace(/\*\*/gu, '').replace(/\*/gu, '').replace(/\//gu, '').trim()
    ).filter((pattern) => pattern !== '' && !pattern.includes('*'))

    const allIgnoreNames = [...new Set([...simpleDefaultPatterns, ...gitignoreNames, ...derivedGitignoreNames])]

    const treeStats: Record<string, number> = {}
    const md = MarkdownBuilder.create()

    const buildTree = async (dir: string, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth) {
        return
      }

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const filtered = this.filterEntries(entries, allIgnoreNames)
        this.sortDirectoriesFirst(filtered)

        for (let idx = 0; idx < filtered.length; idx += 1) {
          const entry = filtered[idx]
          if (!entry) {
            continue
          }

          const isLast = idx === filtered.length - 1
          const connector = isLast ? '└── ' : '├── '
          const childPrefix = prefix + (isLast ? '    ' : '│   ')
          const fullPath = join(dir, entry.name)

          if (entry.isDirectory()) {
            const fileCount = await this.countFiles(fullPath, allIgnoreNames)
            md.text(`${prefix}${connector}${entry.name}/ (${fileCount} files)`)
            await buildTree(fullPath, childPrefix, depth + 1)
          } else {
            this.recordFileEntry(entry.name, prefix + connector, md, treeStats)
          }
        }
      } catch {
        // Directory may be unreadable (permissions) or deleted during traversal
      }
    }

    const projectName = options.relativePath ?? relative(join(projectPath, '..'), projectPath)
    md.text(`${projectName}/`)
    await buildTree(startPath, '', 1)

    const fileStats: Record<string, number> = shouldShowFileExtensions
      ? await this.collectFileStats(startPath, allIgnoreNames)
      : treeStats

    if (shouldShowFileExtensions && Object.keys(fileStats).length > 0) {
      md.blank().heading('File Type Statistics:', 2)
      const sortedStats = Object.entries(fileStats).sort((entryA, entryB) => entryB[1] - entryA[1])
      for (const [ext, count] of sortedStats) {
        md.bullet(`.${ext}: ${count} files`)
      }
    }

    return md.build()
  }

  // Extract simple directory/file names from .gitignore for fs.readdir-based filtering
  // (project structure tree traversal). Unlike parseGitignore which returns glob patterns,
  // this returns plain names suitable for exact-match filtering against Dirent.name.
  private readonly parseGitignoreNames = async (projectPath: string): Promise<string[]> => {
    const gitignorePath = join(projectPath, '.gitignore')

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      const rawEntries = content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))

      return this.extractIgnoreNamesFromPatterns(rawEntries)
    } catch {
      // .gitignore not found or unreadable - expected for projects without one
      return []
    }
  }

  private readonly extractIgnoreNamesFromPatterns = (patterns: string[]): string[] => {
    const names: string[] = []

    for (const pattern of patterns) {
      const cleaned = pattern.replace(/^\/+/u, '').replace(/\/+$/u, '')
      if (!cleaned) {
        continue
      }

      if (!cleaned.includes('/')) {
        if (!cleaned.includes('*')) {
          names.push(cleaned)
        }
        continue
      }

      const segments = cleaned.split('/').filter((segment) => segment !== '' && segment !== '*' && segment !== '**')
      const uniqueSegments = Array.from(new Set(segments.filter((segment) => !segment.includes('*'))))

      if (uniqueSegments.length === 1) {
        names.push(uniqueSegments[0]!)
      }
    }

    return names
  }

  private readonly parseGitignore = async (projectPath: string): Promise<string[]> => {
    const gitignorePath = join(projectPath, '.gitignore')
    const patterns: string[] = []

    try {
      const content = await fs.readFile(gitignorePath, 'utf-8')
      const lines = content.split('\n')

      const addPattern = (pattern: string): void => {
        patterns.push(pattern)
        if (pattern.startsWith('**/')) {
          patterns.push(pattern.slice(3))
        }
      }

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) {
          continue
        }

        // Skip negation patterns - glob's ignore option does not support them
        if (trimmed.startsWith('!')) {
          continue
        }

        // Strip leading slash - gitignore uses it to anchor to root, glob patterns are cwd-relative
        const cleaned = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed

        if (cleaned.endsWith('/')) {
          // Directory pattern (e.g. "docs/") - match the directory and everything inside
          addPattern(`${cleaned}**`)
        } else if (cleaned.endsWith('/*')) {
          // Directory contents pattern (e.g. "docs/*", "**/.terraform/*")
          const base = cleaned.slice(0, -2)
          addPattern(cleaned)
          addPattern(`${base}/**`)
        } else if (cleaned.includes('*')) {
          // Glob/file pattern (e.g. "*.log") - use as-is
          addPattern(cleaned)
        } else {
          // Bare directory name (e.g. "plans", "coverage") - match anywhere in tree
          addPattern(cleaned)
          addPattern(`**/${cleaned}/**`)
          addPattern(`${cleaned}/**`)
        }
      }
    } catch {
      // .gitignore not found or unreadable - expected for projects without one
    }

    return patterns
  }

  private readonly countFiles = async (dir: string, ignoreNames: string[]): Promise<number> => {
    let count = 0

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const filtered = this.filterEntries(entries, ignoreNames)

      for (const entry of filtered) {
        if (entry.isDirectory()) {
          count += await this.countFiles(join(dir, entry.name), ignoreNames)
        } else if (this.isVisibleFile(entry.name)) {
          count += 1
        }
      }
    } catch {
      // Directory may be unreadable (permissions) or deleted during traversal
    }

    return count
  }

  private readonly collectFileStats = async (dir: string, ignoreNames: string[]): Promise<Record<string, number>> => {
    const stats: Record<string, number> = {}

    const walk = async (currentPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(currentPath, { withFileTypes: true })
        const filtered = this.filterEntries(entries, ignoreNames)

        for (const entry of filtered) {
          const entryPath = join(currentPath, entry.name)
          if (entry.isDirectory()) {
            await walk(entryPath)
          } else if (this.isVisibleFile(entry.name)) {
            const ext = this.getExtension(entry.name)
            if (ext) {
              stats[ext] = (stats[ext] ?? 0) + 1
            }
          }
        }
      } catch {
        // Directory may be unreadable (permissions) or deleted during traversal
      }
    }

    await walk(dir)
    return stats
  }

  private readonly filterEntries = (entries: Dirent[], ignoreNames: string[]): Dirent[] =>
    entries.filter((entry) => this.shouldIncludeEntry(entry, ignoreNames))

  private readonly shouldIncludeEntry = (entry: Dirent, ignoreNames: string[]): boolean => {
    if (ignoreNames.includes(entry.name)) {
      return false
    }

    return !entry.name.endsWith('.log')
  }

  private readonly sortDirectoriesFirst = (entries: Dirent[]): void => {
    entries.sort((entryA, entryB) => {
      if (entryA.isDirectory() && !entryB.isDirectory()) {
        return -1
      }

      if (!entryA.isDirectory() && entryB.isDirectory()) {
        return 1
      }

      return entryA.name.localeCompare(entryB.name)
    })
  }

  private readonly isVisibleFile = (name: string): boolean => {
    if (STRUCTURE_VISIBLE_FILES.includes(name)) {
      return true
    }

    const ext = this.getExtension(name)
    return DEFAULT_WHITELIST_EXTENSIONS.includes(ext)
  }

  private readonly getExtension = (name: string): string => {
    if (!name.includes('.')) {
      return ''
    }

    return name.split('.').pop() ?? ''
  }

  private readonly recordFileEntry = (
    name: string,
    prefixedConnector: string,
    md: MarkdownBuilder,
    fileStats: Record<string, number>
  ): void => {
    if (this.isVisibleFile(name)) {
      md.text(`${prefixedConnector}${name}`)
      const ext = this.getExtension(name)
      if (ext) {
        fileStats[ext] = (fileStats[ext] ?? 0) + 1
      }
    }
  }
}
