import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { registry, generateOpenApiDocument } from '@/lib/openapi/registry'

describe('OpenAPI registry', () => {
  it('tolerates double-registration of the same path+method (idempotent)', () => {
    const Body = z.object({ foo: z.string() })
    const register = () =>
      registry.registerPath({
        method: 'post',
        path: '/test/idempotent',
        request: { body: { content: { 'application/json': { schema: Body } } } },
        responses: {
          200: { description: 'ok', content: { 'application/json': { schema: Body } } },
        },
      })
    register()
    expect(() => register()).not.toThrow()
  })

  it('generateOpenApiDocument() returns a valid OpenAPI 3.1 document shape', () => {
    const doc = generateOpenApiDocument()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info.title).toBe('Kolaleaf API')
    expect(doc.info.version).toBe('1')
    expect(doc.paths).toBeTruthy()
  })

  it('surfaces a registered path under paths', () => {
    registry.registerPath({
      method: 'get',
      path: '/test/visible',
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } },
        },
      },
    })
    const doc = generateOpenApiDocument()
    expect(doc.paths?.['/test/visible']).toBeTruthy()
    expect(doc.paths?.['/test/visible']?.get).toBeTruthy()
  })
})
