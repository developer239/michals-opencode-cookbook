import type { PluginInput, ToolContext } from '@opencode-ai/plugin'
import { PluginError } from '../types/errors.js'

type OpencodeClient = PluginInput['client']

type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export abstract class BaseTool<TArgs extends object = Record<string, unknown>> {
  public abstract execute: (args: TArgs, context?: ToolContext) => Promise<string>

  // Fire-and-forget TUI toast for attention-worthy lifecycle events (a detached
  // job started, finished, or failed). Unlike client.app.log (which lands in the
  // on-disk server log), a toast appears on the user's screen. Swallows any
  // rejection: a failed toast must never break the tool. No client (module not
  // wired for toasts) is a silent no-op. Use context.metadata for step-by-step
  // progress; reserve toasts for start/finish/failure of background work.
  protected readonly showToast = (
    client: OpencodeClient | undefined,
    title: string,
    message: string,
    variant: ToastVariant = 'info'
  ): void => {
    if (client === undefined) {
      return
    }
    client.tui.showToast({ body: { title, message, variant } }).catch(this.ignoreToastError)
  }

  private readonly ignoreToastError = (): void => {
    // A failed toast is intentionally silent - it is UI sugar, never load-bearing.
  }

  protected readonly askMutationPermission = async (
    context: ToolContext | undefined,
    permissionKey: string,
    description: string
  ): Promise<void> => {
    await this.askPermission(
      context,
      permissionKey,
      description,
      'Mutation operations require interactive tool context for explicit approval'
    )
  }

  private readonly askPermission = async (
    context: ToolContext | undefined,
    permissionKey: string,
    description: string,
    missingContextMessage: string
  ): Promise<void> => {
    if (!context) {
      throw new PluginError(missingContextMessage, 'INTERNAL_ERROR')
    }

    await context.ask({
      permission: permissionKey,
      patterns: [description],
      always: [description],
      metadata: {},
    })
  }

  protected readonly handleErrors = async (
    operation: () => Promise<string> | string,
    errorPrefix: string
  ): Promise<string> => {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof PluginError) {
        throw error
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new PluginError(`${errorPrefix}: ${message}`, 'INTERNAL_ERROR', error)
    }
  }
}
