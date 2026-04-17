// Barrel re-export of every Zod request/response schema colocated
// under src/app/api/v1/**. Consumers (the Next.js client, future
// Wave 2 native clients, internal scripts) import TYPES from this
// file via `z.infer<typeof X>`; no runtime logic is bundled because
// the bundler can tree-shake unused schema values and drop the
// register-path side effects from callers that never touch the
// openapi endpoint.
//
// Kept in one place so the full API surface is discoverable from
// a single import path. Matches the "one prefix, one source" habit
// from the /api/v1 client wrapper.

// common primitives
export * from './common'

// auth
export * from '@/app/api/v1/auth/send-code/_schemas'
export * from '@/app/api/v1/auth/complete-registration/_schemas'
export * from '@/app/api/v1/auth/login/_schemas'
export * from '@/app/api/v1/auth/logout/_schemas'
export * from '@/app/api/v1/auth/verify-code/_schemas'
export * from '@/app/api/v1/auth/verify-email/_schemas'
export * from '@/app/api/v1/auth/verify-2fa/_schemas'
export * from '@/app/api/v1/auth/request-password-reset/_schemas'
export * from '@/app/api/v1/auth/reset-password/_schemas'
export * from '@/app/api/v1/auth/resend-verification/_schemas'

// account
export * from '@/app/api/v1/account/me/_schemas'
export * from '@/app/api/v1/account/change-email/_schemas'
export * from '@/app/api/v1/account/change-password/_schemas'
export * from '@/app/api/v1/account/email/[id]/_schemas'
export * from '@/app/api/v1/account/phone/add/_schemas'
export * from '@/app/api/v1/account/phone/remove/_schemas'
export * from '@/app/api/v1/account/phone/verify/_schemas'
export * from '@/app/api/v1/account/2fa/setup/_schemas'
export * from '@/app/api/v1/account/2fa/enable/_schemas'
export * from '@/app/api/v1/account/2fa/disable/_schemas'
export * from '@/app/api/v1/account/2fa/regenerate-backup-codes/_schemas'

// admin
export * from '@/app/api/v1/admin/rates/_schemas'
export * from '@/app/api/v1/admin/compliance/_schemas'
export * from '@/app/api/v1/admin/float/_schemas'
export * from '@/app/api/v1/admin/stats/_schemas'
export * from '@/app/api/v1/admin/referrals/[id]/pay/_schemas'
export * from '@/app/api/v1/admin/transfers/_schemas'
export * from '@/app/api/v1/admin/transfers/[id]/_schemas'
export * from '@/app/api/v1/admin/transfers/[id]/refund/_schemas'
export * from '@/app/api/v1/admin/transfers/[id]/retry/_schemas'

// transfers / recipients / rates / banks / kyc
export * from '@/app/api/v1/transfers/_schemas'
export * from '@/app/api/v1/transfers/[id]/_schemas'
export * from '@/app/api/v1/transfers/[id]/cancel/_schemas'
export * from '@/app/api/v1/recipients/_schemas'
export * from '@/app/api/v1/recipients/[id]/_schemas'
export * from '@/app/api/v1/recipients/resolve/_schemas'
export * from '@/app/api/v1/rates/[corridorId]/_schemas'
export * from '@/app/api/v1/rates/public/_schemas'
export * from '@/app/api/v1/banks/_schemas'
export * from '@/app/api/v1/kyc/initiate/_schemas'
export * from '@/app/api/v1/kyc/status/_schemas'
