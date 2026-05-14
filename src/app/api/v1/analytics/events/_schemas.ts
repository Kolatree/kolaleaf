import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const AnalyticsEventName = z.enum([
  'welcome_shown',
  'phone_otp_started',
  'phone_otp_completed',
  'email_otp_started',
  'email_otp_completed',
  'kyc_started',
  'kyc_completed',
  'recipient_added',
  'send_screen_viewed',
  'amount_entered',
  'recipient_selected',
  'slide_initiated',
  'slide_threshold_reached',
  'slide_abandoned',
  'faceid_prompt_presented',
  'faceid_succeeded',
  'transfer_post_succeeded',
  'payid_copied',
  'transfer_completed',
  'receipt_shared',
  'receipt_share_consent_shown',
  'referral_captured',
  'tap_send_chosen',
])

const PropertyValue = z.union([
  z.string().trim().min(1).max(80),
  z.number().finite(),
  z.boolean(),
])

export const AnalyticsEventBody = z
  .object({
    event: AnalyticsEventName,
    occurredAt: z.coerce.date(),
    properties: z.record(z.string().trim().min(1).max(40), PropertyValue).default({}),
  })
  .strict()

export const AnalyticsEventResponse = z.object({
  success: z.literal(true),
})

export type AnalyticsEventBodyInput = z.infer<typeof AnalyticsEventBody>

registry.registerPath({
  method: 'post',
  path: '/analytics/events',
  tags: ['analytics'],
  summary: 'Record a privacy-first mobile KPI event',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: AnalyticsEventBody } },
    },
  },
  responses: {
    200: {
      description: 'Analytics event recorded',
      content: { 'application/json': { schema: AnalyticsEventResponse } },
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
