import { NextResponse } from 'next/server'

// POST /api/auth/register — REMOVED (Step 18). Returns 410 Gone with a
// migration hint; RFC 7231 §6.5.9. Keep this stub in place until we're
// confident no clients hit it, then remove entirely.
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

// Any other method on this URL is also gone.
export { POST as GET }
