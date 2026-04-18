import { NextResponse } from 'next/server'
import { generateOpenApiDocument } from '@/lib/openapi/registry'

// Side-effect imports: each `_schemas.ts` registers its route with
// the central OpenAPIRegistry on first import. Listing every route
// here guarantees the registry is populated before we serialise the
// document, regardless of which route a given client has hit first
// in this worker. Keep this list in sync with `src/app/api/v1/**`.

// auth
import '@/app/api/v1/auth/send-code/_schemas'
import '@/app/api/v1/auth/complete-registration/_schemas'
import '@/app/api/v1/auth/login/_schemas'
import '@/app/api/v1/auth/logout/_schemas'
import '@/app/api/v1/auth/verify-code/_schemas'
import '@/app/api/v1/auth/verify-email/_schemas'
import '@/app/api/v1/auth/verify-2fa/_schemas'
import '@/app/api/v1/auth/request-password-reset/_schemas'
import '@/app/api/v1/auth/reset-password/_schemas'
import '@/app/api/v1/auth/resend-verification/_schemas'

// account
import '@/app/api/v1/account/me/_schemas'
import '@/app/api/v1/account/change-email/_schemas'
import '@/app/api/v1/account/change-password/_schemas'
import '@/app/api/v1/account/email/[id]/_schemas'
import '@/app/api/v1/account/phone/add/_schemas'
import '@/app/api/v1/account/phone/remove/_schemas'
import '@/app/api/v1/account/phone/verify/_schemas'
import '@/app/api/v1/account/2fa/setup/_schemas'
import '@/app/api/v1/account/2fa/enable/_schemas'
import '@/app/api/v1/account/2fa/disable/_schemas'
import '@/app/api/v1/account/2fa/regenerate-backup-codes/_schemas'

// admin
import '@/app/api/v1/admin/rates/_schemas'
import '@/app/api/v1/admin/compliance/_schemas'
import '@/app/api/v1/admin/float/_schemas'
import '@/app/api/v1/admin/stats/_schemas'
import '@/app/api/v1/admin/referrals/[id]/pay/_schemas'
import '@/app/api/v1/admin/transfers/_schemas'
import '@/app/api/v1/admin/transfers/[id]/_schemas'
import '@/app/api/v1/admin/transfers/[id]/refund/_schemas'
import '@/app/api/v1/admin/transfers/[id]/retry/_schemas'
import '@/app/api/v1/admin/failed-emails/_schemas'
import '@/app/api/v1/admin/failed-emails/[id]/resolve/_schemas'
import '@/app/api/v1/admin/compliance/[id]/mark-reported/_schemas'

// transfers / recipients / rates / banks / kyc
import '@/app/api/v1/transfers/_schemas'
import '@/app/api/v1/transfers/[id]/_schemas'
import '@/app/api/v1/transfers/[id]/cancel/_schemas'
import '@/app/api/v1/recipients/_schemas'
import '@/app/api/v1/recipients/[id]/_schemas'
import '@/app/api/v1/recipients/resolve/_schemas'
import '@/app/api/v1/rates/[corridorId]/_schemas'
import '@/app/api/v1/rates/public/_schemas'
import '@/app/api/v1/banks/_schemas'
import '@/app/api/v1/kyc/initiate/_schemas'
import '@/app/api/v1/kyc/status/_schemas'
import '@/app/api/v1/kyc/retry/_schemas'

// GET /api/v1/openapi
//
// Publicly fetchable OpenAPI 3.1 document generated from the same Zod
// schemas that validate request bodies at runtime. No auth gate — the
// document describes the public contract, not any sensitive data.
// Cache briefly so burst fetches from the Wave 2 codegen pipeline
// don't re-run the generator every call.
export async function GET() {
  const doc = generateOpenApiDocument()
  return NextResponse.json(doc, {
    headers: {
      'Cache-Control': 'public, max-age=60',
      'X-Robots-Tag': 'noindex',
    },
  })
}
