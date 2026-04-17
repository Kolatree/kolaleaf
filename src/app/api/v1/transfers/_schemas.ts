import { z } from 'zod'
import { registry } from '@/lib/openapi/registry'
import {
  Cuid,
  DecimalString,
  PaginationQuery,
  ErrorEnvelope,
  ValidationErrorEnvelope,
} from '@/lib/schemas/common'

// POST /api/v1/transfers — create a new transfer
// GET  /api/v1/transfers — list transfers for the authenticated user

export const CreateTransferBody = z.object({
  recipientId: Cuid,
  corridorId: Cuid,
  sendAmount: DecimalString,
  exchangeRate: DecimalString,
  // Fee is optional — the default of 0 is preserved by the route.
  fee: DecimalString.optional(),
})

// Runtime transfer payload shape — described loosely here so the
// OpenAPI doc communicates the envelope without committing to every
// Prisma field. Individual fields use `.passthrough()` so downstream
// additions don't break the spec.
const TransferShape = z.object({
  id: z.string(),
  userId: z.string(),
  recipientId: z.string(),
  corridorId: z.string(),
  status: z.string(),
  sendAmount: z.string(),
  receiveAmount: z.string().optional(),
  exchangeRate: z.string(),
  fee: z.string(),
})

export const CreateTransferResponse = z.object({ transfer: TransferShape })

export const ListTransfersQuery = PaginationQuery.extend({
  status: z.string().optional(),
})

export const ListTransfersResponse = z.object({
  transfers: z.array(TransferShape),
  nextCursor: z.string().nullable().optional(),
})

export type CreateTransferInput = z.infer<typeof CreateTransferBody>
export type ListTransfersQueryInput = z.infer<typeof ListTransfersQuery>

registry.registerPath({
  method: 'post',
  path: '/transfers',
  tags: ['transfers'],
  summary: 'Create a new AUD→NGN transfer',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CreateTransferBody } },
    },
  },
  responses: {
    201: {
      description: 'Transfer created in CREATED state',
      content: { 'application/json': { schema: CreateTransferResponse } },
    },
    400: {
      description: 'Malformed JSON or business-logic rejection',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    403: {
      description: 'Email unverified or KYC not approved',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
    422: {
      description: 'Schema validation failed',
      content: { 'application/json': { schema: ValidationErrorEnvelope } },
    },
  },
})

registry.registerPath({
  method: 'get',
  path: '/transfers',
  tags: ['transfers'],
  summary: 'List transfers for the authenticated user',
  request: {
    query: ListTransfersQuery,
  },
  responses: {
    200: {
      description: 'Transfer list (cursor-paginated)',
      content: { 'application/json': { schema: ListTransfersResponse } },
    },
    401: {
      description: 'Unauthenticated',
      content: { 'application/json': { schema: ErrorEnvelope } },
    },
  },
})
