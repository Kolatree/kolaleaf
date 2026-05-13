import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/client'
import { logAuthEvent } from '@/lib/auth/audit'
import type { RequestContext } from '@/lib/security/request-context'

const DEVICE_ATTESTED_EVENT = 'DEVICE_ATTESTED'
const DEVICE_ATTESTATION_UNSUPPORTED_EVENT = 'DEVICE_ATTESTATION_UNSUPPORTED'
const NEW_DEVICE_EVENT = 'NEW_DEVICE_LOGIN_ALERTED'

export type DeviceAttestationEnvironment = 'development' | 'production' | 'unsupported'

export interface DeviceAttestationInput {
  supported: boolean
  appAttestKeyId?: string
  environment: DeviceAttestationEnvironment
  bundleId: string
  osVersion?: string
  deviceModel?: string
}

export interface DeviceAttestationResult {
  registered: boolean
  isNewDevice: boolean
  shouldAlert: boolean
  alert?: {
    title: string
    message: string
  }
}

interface DeviceAttestationMetadata {
  appAttestKeyHash?: unknown
}

export function hashAppAttestKeyId(keyId: string): string {
  return createHash('sha256').update(keyId).digest('hex')
}

function appAttestKeyHashes(events: Array<{ metadata: unknown }>): Set<string> {
  const hashes = new Set<string>()
  for (const event of events) {
    const metadata = event.metadata as DeviceAttestationMetadata | null | undefined
    if (typeof metadata?.appAttestKeyHash === 'string') {
      hashes.add(metadata.appAttestKeyHash)
    }
  }
  return hashes
}

export async function registerDeviceAttestation(params: {
  userId: string
  input: DeviceAttestationInput
  requestContext: RequestContext
}): Promise<DeviceAttestationResult> {
  const { userId, input, requestContext } = params
  const { ip } = requestContext

  if (!input.supported || !input.appAttestKeyId) {
    await logAuthEvent({
      userId,
      event: DEVICE_ATTESTATION_UNSUPPORTED_EVENT,
      ip,
      metadata: {
        supported: false,
        environment: input.environment,
        bundleId: input.bundleId,
        ...(input.osVersion ? { osVersion: input.osVersion } : {}),
        ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
        ...(requestContext.country ? { country: requestContext.country } : {}),
        ...(requestContext.deviceFingerprintHash
          ? { deviceFingerprintHash: requestContext.deviceFingerprintHash }
          : {}),
      },
    })
    return { registered: false, isNewDevice: false, shouldAlert: false }
  }

  const keyHash = hashAppAttestKeyId(input.appAttestKeyId)
  const priorEvents = await prisma.authEvent.findMany({
    where: { userId, event: DEVICE_ATTESTED_EVENT },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { metadata: true },
  })
  const priorHashes = appAttestKeyHashes(priorEvents)
  const isNewDevice = !priorHashes.has(keyHash)
  const shouldAlert = isNewDevice && priorHashes.size > 0

  await logAuthEvent({
    userId,
    event: DEVICE_ATTESTED_EVENT,
    ip,
    metadata: {
      supported: true,
      appAttestKeyHash: keyHash,
      environment: input.environment,
      bundleId: input.bundleId,
      ...(input.osVersion ? { osVersion: input.osVersion } : {}),
      ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
      ...(requestContext.country ? { country: requestContext.country } : {}),
      ...(requestContext.deviceFingerprintHash
        ? { deviceFingerprintHash: requestContext.deviceFingerprintHash }
        : {}),
    },
  })

  if (shouldAlert) {
    await logAuthEvent({
      userId,
      event: NEW_DEVICE_EVENT,
      ip,
      metadata: {
        appAttestKeyHash: keyHash,
        environment: input.environment,
        bundleId: input.bundleId,
        ...(input.osVersion ? { osVersion: input.osVersion } : {}),
        ...(input.deviceModel ? { deviceModel: input.deviceModel } : {}),
      },
    })
  }

  return {
    registered: true,
    isNewDevice,
    shouldAlert,
    ...(shouldAlert
      ? {
          alert: {
            title: 'New device signed in',
            message:
              'We noticed your Kolaleaf account was opened on a device we have not seen before.',
          },
        }
      : {}),
  }
}
