import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

const AppAttestEnvironment = z.enum(['development', 'production', 'unsupported'])
const BundleId = z.string().min(3).max(120)
const DeviceDescriptor = z.string().trim().min(1).max(120)

export const DeviceAttestationBody = z.discriminatedUnion('supported', [
  z.object({
    supported: z.literal(true),
    appAttestKeyId: z.string().trim().min(16).max(512),
    environment: AppAttestEnvironment,
    bundleId: BundleId,
    osVersion: DeviceDescriptor.optional(),
    deviceModel: DeviceDescriptor.optional(),
  }),
  z.object({
    supported: z.literal(false),
    environment: AppAttestEnvironment.default('unsupported'),
    bundleId: BundleId,
    osVersion: DeviceDescriptor.optional(),
    deviceModel: DeviceDescriptor.optional(),
  }),
])

export const DeviceAttestationResponse = z.object({
  registered: z.boolean(),
  isNewDevice: z.boolean(),
  shouldAlert: z.boolean(),
  alert: z
    .object({
      title: z.string(),
      message: z.string(),
    })
    .optional(),
})

export type DeviceAttestationBodyInput = z.infer<typeof DeviceAttestationBody>

registry.registerPath({
  method: 'post',
  path: '/auth/device-attestation',
  tags: ['auth'],
  summary: 'Register authenticated iOS device attestation state',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: DeviceAttestationBody } },
    },
  },
  responses: {
    200: {
      description: 'Device attestation state recorded',
      content: { 'application/json': { schema: DeviceAttestationResponse } },
    },
    401: {
      description: 'Authentication required',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
    500: {
      description: 'Internal failure',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
