import { NextResponse } from 'next/server'

// Shared HTTP error envelope for all of /api/*. Every non-2xx response
// carries both a human-facing `error` string and a stable machine-
// readable `reason` enum so clients route by reason, not by string-
// matching copy.
export function jsonError(
  reason: string,
  message: string,
  status: number,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: message, reason }, { status, headers })
}
