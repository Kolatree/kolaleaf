import { NextResponse } from 'next/server'

// POST /api/auth/register — REMOVED (Step 18)
//
// The old one-shot register endpoint has been replaced by a three-step
// wizard. We intentionally return 410 Gone instead of 404 so:
//   - any client that still points here gets a deterministic JSON body
//     explaining what to call instead, rather than Next's default HTML
//     404 page that reveals nothing about the migration
//   - operational tooling (curl scripts, Postman collections, the early
//     iOS/Android probes) has a clear signal to update
//   - RFC 7231 §6.5.9 endorses 410 for removed resources
//
// The `Deprecation: true` header + `Link` with rel="successor-version"
// also surface in HTTP-hygiene linters like the GitHub REST SDK.
//
// We keep this stub (instead of just deleting the file and serving 404)
// until we are confident no clients hit it — at which point it can be
// removed entirely.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint was removed in Step 18. Use /api/auth/send-code, ' +
        'then /api/auth/verify-code, then /api/auth/complete-registration.',
      reason: 'endpoint_removed',
      migrate_to: '/api/auth/send-code',
    },
    {
      status: 410,
      headers: {
        Deprecation: 'true',
        Link: '</api/auth/send-code>; rel="successor-version"',
      },
    },
  )
}

// GET returns the same body — treat any method on this URL as removed.
export async function GET() {
  return POST()
}
