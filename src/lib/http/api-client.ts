import { fetchWithTimeout } from './fetch-with-timeout'

// Single-source API prefix. Every in-repo caller goes through apiFetch
// so bumping to /api/v2 in the future is a one-line change here, not a
// code-wide rewrite. Webhooks and cron routes bypass this client — their
// URLs are registered on external systems and stay on the legacy /api/*.
export const API_V1 = '/api/v1'

export interface ApiFetchInit extends RequestInit {
  timeoutMs?: number
}

// Fetch a v1 API endpoint. `path` is the tail of the URL (e.g. 'auth/login'
// or '/auth/login'); a leading slash is stripped defensively so both work.
// The underlying transport is fetchWithTimeout so AbortError semantics and
// default timeout behaviour stay identical to the existing wizard callers.
export async function apiFetch(
  path: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const tail = path.startsWith('/') ? path.slice(1) : path
  return fetchWithTimeout(`${API_V1}/${tail}`, init)
}
