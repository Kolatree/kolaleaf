import { NextResponse } from 'next/server'
import { generateOpenApiDocument } from '@/lib/openapi/registry'

// Side-effect imports: each `_schemas.ts` registers its route with
// the central OpenAPIRegistry on first import. Listing every pilot
// here guarantees the registry is populated before we serialise the
// document, regardless of which route a given client has hit first
// in this worker.
import '@/app/api/v1/auth/send-code/_schemas'
import '@/app/api/v1/auth/complete-registration/_schemas'
import '@/app/api/v1/transfers/_schemas'
import '@/app/api/v1/account/me/_schemas'
import '@/app/api/v1/admin/rates/_schemas'

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
