// Wraps `fetch` with an AbortController timeout so a hanging server
// doesn't leave the UI stuck in a loading state forever.
//
// On timeout, the returned promise rejects with a DOMException with
// name === 'AbortError' — callers should catch it and surface a
// retryable error ("The server is slow to respond. Please try again.")
// rather than the raw error.
//
// Default timeout is generous (30s) because these are user-triggered
// form submissions where a long wait is strictly worse than a false
// abort. Individual call sites can override where relevant (e.g. the
// send-code step can use a shorter window since it's a single DB write
// behind a background email dispatch).
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
