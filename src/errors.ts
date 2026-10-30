export type ShengsuanyunReason =
  | 'authorization-cancelled'
  | 'authorization-timeout'
  | 'router-validation-failed'
  | 'no-chat-model'
  | 'credential-save-failed'
  | 'invalid-request'

export class ShengsuanyunError extends Error {
  readonly reason: ShengsuanyunReason

  constructor(readonly status: number, message: string, reason: ShengsuanyunReason) {
    super(message)
    this.name = 'ShengsuanyunError'
    this.reason = reason
  }
}

export function reasonOf(cause: unknown): ShengsuanyunReason {
  if (cause instanceof ShengsuanyunError) return cause.reason
  if (cause instanceof Error && /取消/u.test(cause.message)) return 'authorization-cancelled'
  if (cause instanceof Error && /超时/u.test(cause.message)) return 'authorization-timeout'
  return 'credential-save-failed'
}
