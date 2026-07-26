export type ErrorCode =
  | 'AUTH_MISSING'
  | 'AUTH_EXPIRED'
  | 'AUTH_INVALID'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'CONNECTION_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'EXTERNAL_API_ERROR'
  | 'INTERNAL_ERROR'

export class PluginError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public override readonly cause?: unknown
  ) {
    super(message)
    this.name = 'PluginError'
  }
}
