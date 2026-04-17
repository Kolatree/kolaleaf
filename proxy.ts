import { NextResponse, type NextRequest } from 'next/server'
import crypto from 'node:crypto'

// Request correlation middleware. Every request picks up an
// x-request-id header — either the caller's (if they set one, useful
// for distributed tracing across services) or a freshly generated
// UUID. The header echoes back on the response so clients can log
// the same ID and ops can join logs across layers.
//
// We echo the header here. The downstream AsyncLocalStorage wrapping
// happens inside route handlers via the `withRequestContext` helper —
// Next.js middleware can't safely span the handler via ALS because
// the middleware runs in a different V8 context in prod deploys.
// Handlers that want auto-enriched log lines call
// `runWithRequestContext(req.headers.get('x-request-id'), () => ...)`
// at their entry.
export function proxy(request: NextRequest) {
  const incoming = request.headers.get('x-request-id')
  const requestId = incoming && incoming.length > 0 ? incoming : crypto.randomUUID()

  const response = NextResponse.next({
    request: {
      headers: new Headers({
        ...Object.fromEntries(request.headers),
        'x-request-id': requestId,
      }),
    },
  })
  response.headers.set('x-request-id', requestId)
  return response
}

// Apply to all routes by default; static assets short-circuit
// upstream so the overhead is only on dynamic paths.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
