import { spawnSync } from 'node:child_process'
import { MarkdownBuilder } from '../../_core/services/markdown-builder.service.js'
import { PluginError } from '../../_core/types/errors.js'

interface IGitRun {
  isOk: boolean
  output: string
}

export class GitStateService {
  // The git state of every repository that contains one of `directories`
  // (the session's working directory and those of the files it wrote), each
  // reported once, so a session that worked across repositories shows all of
  // them. A directory outside any repository, or one that no longer exists,
  // adds nothing. Git failing to run is reported in the section rather than
  // thrown, so it never costs the rest of the handoff.
  public readonly describe = (directories: string[]): string => {
    const md = MarkdownBuilder.create().heading('Git state', 2)
    try {
      return this.describeRepositories(md, directories)
    } catch (error) {
      return md.text(error instanceof Error ? error.message : String(error)).build()
    }
  }

  private readonly describeRepositories = (md: MarkdownBuilder, directories: string[]): string => {
    const roots = new Set<string>()
    for (const directory of directories) {
      const root = this.run(directory, ['rev-parse', '--show-toplevel'])
      if (root.isOk) {
        roots.add(root.output)
      }
    }
    if (roots.size === 0) {
      return md.text(`No git repository contains any of: ${directories.join(', ')}`).build()
    }

    for (const root of roots) {
      const diff = this.run(root, ['diff', '--stat', 'HEAD'])
      md.heading(root, 3)
        .codeBlock(this.run(root, ['status', '--short', '--branch']).output, 'text')
        .blank()
        .codeBlock(diff.output === '' ? 'No changes against HEAD.' : diff.output, 'text')
        .blank()
    }
    return md.build()
  }

  private readonly run = (directory: string, args: string[]): IGitRun => {
    const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf-8' })
    if (result.error !== undefined) {
      throw new PluginError(`git could not run: ${result.error.message}`, 'INTERNAL_ERROR')
    }
    const isOk = result.status === 0
    return { isOk, output: (isOk ? result.stdout : result.stderr).trim() }
  }
}
