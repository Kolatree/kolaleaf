import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import { ErrorEnvelope, ValidationErrorEnvelope } from '@/lib/schemas/common'

export const CreateRecipientBody = z.object({
  fullName: z.string().trim().min(1, 'fullName is required'),
  bankName: z.string().trim().min(1, 'bankName is required'),
  bankCode: z.string().trim().min(1, 'bankCode is required'),
  accountNumber: z.string().trim().min(1, 'accountNumber is required'),
})

const RecipientShape = z
  .object({
    id: z.string(),
    fullName: z.string(),
    bankName: z.string(),
    bankCode: z.string(),
    accountNumber: z.string(),
  })
  .passthrough()

export const CreateRecipientResponse = z.object({ recipient: RecipientShape })

export const ListRecipientsResponse = z.object({
  recipients: z.array(RecipientShape),
})

registry.registerPath({
  method: 'post',
  path: '/recipients',
  tags: ['recipients'],
  summary: 'Create a recipient owned by the current user',
  request: {
    body: { required: true, content: { 'application/json': { schema: CreateRecipientBody } } },
  },
  responses: {
    201: {
      description: 'Recipient created',
      content: { 'application/json': { schema: CreateRecipientResponse } },
    },
    400: { description: 'Malformed JSON', content: { 'application/json': { schema: ErrorEnvelope } } },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
    422: { description: 'Schema validation failed', content: { 'application/json': { schema: ValidationErrorEnvelope } } },
  },
})

registry.registerPath({
  method: 'get',
  path: '/recipients',
  tags: ['recipients'],
  summary: 'List recipients for the current user',
  responses: {
    200: {
      description: 'Recipients list',
      content: { 'application/json': { schema: ListRecipientsResponse } },
    },
    401: { description: 'Unauthenticated', content: { 'application/json': { schema: ErrorEnvelope } } },
  },
})
