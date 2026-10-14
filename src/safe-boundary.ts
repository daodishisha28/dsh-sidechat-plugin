export interface SafeBoundaryAgent {
  readonly status: 'idle' | 'running'
  whenIdle(): Promise<void>
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/**
 * Claim a true idle maintenance boundary without starting or steering a turn.
 * A wake racing the claim is allowed to finish, then the operation retries.
 *
 * The agent may be given directly or as a resolver awaited fresh at the top of
 * EVERY loop iteration: the target Session can be recreated (disposed and
 * re-resolved) between iterations, so each claim revalidates against the
 * currently live agent instead of a handle captured once up front. A resolver
 * that throws (target gone, identity changed) propagates to the caller.
 */
export async function atSafeBoundary<T>(
  agent: SafeBoundaryAgent | (() => Promise<SafeBoundaryAgent>),
  task: (signal: AbortSignal) => Promise<T>,
  accepting: () => boolean = () => true,
): Promise<T> {
  for (;;) {
    const resolved = typeof agent === 'function' ? await agent() : agent
    await resolved.whenIdle()
    try {
      return await resolved.runMaintenance(task)
    } catch (error) {
      if (!accepting() || resolved.status === 'idle') throw error
    }
  }
}
