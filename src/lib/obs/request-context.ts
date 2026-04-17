import { AsyncLocalStorage } from 'node:async_hooks'

// Per-request context carried by AsyncLocalStorage. Next.js route
// handlers, internal services, and downstream awaits all pick up the
// same request ID without threading it through every function signature.
// Outside a request (worker, cron, one-shot scripts) the store returns
// undefined and log lines simply omit `requestId`.

export interface RequestContext {
  requestId: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(
  requestId: string,
  fn: () => T,
): T {
  return storage.run({ requestId }, fn)
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId
}
