export interface SafeBoundaryAgent {
  readonly status: 'idle' | 'running'
  whenIdle(): Promise<void>
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>
}

/**
 * Claim a true idle maintenance boundary without starting or steering a turn.
 * A wake racing the claim is allowed to finish, then the operation retries.
 */
export async function atSafeBoundary<T>(
  agent: SafeBoundaryAgent,
  task: (signal: AbortSignal) => Promise<T>,
  accepting: () => boolean = () => true,
): Promise<T> {
  for (;;) {
    await agent.whenIdle()
    try {
      return await agent.runMaintenance(task)
    } catch (error) {
      if (!accepting() || agent.status === 'idle') throw error
    }
  }
}
