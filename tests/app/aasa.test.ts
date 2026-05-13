import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('apple-app-site-association', () => {
  it('scopes universal links to transfer and referral paths only', () => {
    const raw = readFileSync(
      join(process.cwd(), 'public/.well-known/apple-app-site-association'),
      'utf8',
    )
    const parsed = JSON.parse(raw) as {
      applinks: {
        details: Array<{
          appIDs: string[]
          components: Array<{ '/': string }>
        }>
      }
    }

    expect(parsed.applinks.details).toHaveLength(1)
    expect(parsed.applinks.details[0].appIDs).toEqual([
      '5VCH6937XM.com.kolaleaf.app',
    ])
    expect(parsed.applinks.details[0].components.map((c) => c['/'])).toEqual([
      '/transfer/*',
      '/refer/*',
    ])
  })
})
