import { NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth/middleware'
import { registerDeviceAttestation } from '@/lib/auth/device-attestation'
import { extractRequestContext } from '@/lib/security/request-context'
import { parseBody } from '@/lib/http/validate'
import { jsonError } from '@/lib/http/json-error'
import { log } from '@/lib/obs/logger'
import { DeviceAttestationBody } from './_schemas'

export async function POST(request: Request) {
  try {
    const { userId } = await requireAuth(request)
    const parsed = await parseBody(request, DeviceAttestationBody)
    if (!parsed.ok) return parsed.response

    const result = await registerDeviceAttestation({
      userId,
      input: parsed.data,
      requestContext: extractRequestContext(request),
    })

    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      const reason = error.statusCode === 401 ? 'unauthenticated' : 'forbidden'
      return jsonError(reason, error.message, error.statusCode)
    }
    log('error', 'auth.device-attestation.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return jsonError(
      'device_attestation_failed',
      'Device security check failed. Please try again.',
      500,
    )
  }
}
