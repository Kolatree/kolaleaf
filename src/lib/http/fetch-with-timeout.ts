// Standard timeouts. Exported so call sites pick a named constant
// instead of re-deriving magic numbers. Keep these tight enough that a
// wedged server surfaces as a retryable error, loose enough that normal
// p99 latency doesn't false-abort.
export const AUTH_TIMEOUT_MS = 20_000 // single-DB-write auth calls
export const REGISTER_TIMEOUT_MS = 30_000 // 7-write tx (complete-registration)

// Centralised error copy. Lets product change "Something went wrong"
// in one place and have every wizard step follow.
export const GENERIC_ERROR = 'Something went wrong. Please try again.'
export const SERVER_SLOW_ERROR = 'The server is slow to respond. Please try again.'

// Wraps `fetch` with an AbortController timeout so a hanging server
// doesn't leave the UI stuck in a loading state forever.
//
// On timeout, the returned promise rejects with a DOMException with
// name === 'AbortError' — callers should catch it and surface
// SERVER_SLOW_ERROR rather than the raw error.
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...rest, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// Helper for the common case: catch the AbortError specifically so
// callers can distinguish "client timed out" from "server errored".
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'AbortError' || err.name === 'TimeoutError')
  )
}
