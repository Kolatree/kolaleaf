import { z } from 'zod'
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi'

// Enable the `.openapi({...})` helper on every Zod schema so the
// `_schemas.ts` files can attach descriptions / examples / ref IDs
// that flow into the generated document.
extendZodWithOpenApi(z)

// One registry shared by every `_schemas.ts` file. Each route's schema
// module imports this singleton and calls `registry.registerPath(...)`
// at module-load time. Routes are keyed on method+path; registering
// the same key twice is tolerated (useful under Vitest + HMR where a
// module can be re-evaluated in the same process).
class IdempotentOpenAPIRegistry extends OpenAPIRegistry {
  private seen = new Set<string>()

  override registerPath(route: RouteConfig): void {
    const key = `${route.method} ${route.path}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    super.registerPath(route)
  }
}

export const registry = new IdempotentOpenAPIRegistry()

// Top-level OpenAPI document fields. Version is intentionally '1' —
// it tracks the /api/v1 URL segment, not semver; Wave 2 corridor /
// provider additions never bump this string.
export function generateOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions)
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Kolaleaf API',
      version: '1',
      description:
        'Kolaleaf AUD-NGN remittance API. Machine-readable contract ' +
        'generated from runtime Zod schemas — the same schemas used by ' +
        'every route handler for validation.',
    },
    servers: [{ url: '/api/v1' }],
  })
}
