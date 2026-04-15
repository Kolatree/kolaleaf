import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ReactElement } from 'react'

// next/headers is server-only and unavailable in vitest's node env.
// Mock it before importing the page component.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [{ name: 'session', value: 'tok' }],
  }),
}))

import AdminDashboard from '@/app/admin/page'

interface NodeLike {
  type?: unknown
  props?: { children?: unknown; [k: string]: unknown }
}

// Walk a React element tree and return all string children that appear.
// Light-weight stand-in for React Testing Library — we only need to assert
// presence of the AdminAlert by its text content. We recurse into the tree
// without invoking function components (the AdminAlert appears as an
// element with type === function reference).
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const c of node) collectStrings(c, out)
    return out
  }
  const n = node as NodeLike
  const props = n.props ?? {}
  if (props.children) collectStrings(props.children, out)
  return out
}

describe('admin/page partial-fetch banner', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders <AdminAlert> when /api/admin/stats fetch fails', async () => {
    // First fetch (stats) returns non-OK → fetchAdminJson returns null.
    // The other two return ok with shape the page expects.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.endsWith('/api/admin/stats')) {
          return Promise.resolve({ ok: false, json: async () => ({}) } as Response)
        }
        if (url.endsWith('/api/admin/float')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              float: { provider: 'flutterwave', balance: '1000', threshold: '500', sufficient: true },
            }),
          } as Response)
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ rates: [] }),
        } as Response)
      }),
    )

    const tree = (await AdminDashboard()) as ReactElement
    const text = collectStrings(tree).join(' ')
    expect(text).toContain('Admin data partially unavailable')
  })

  it('does NOT render <AdminAlert> when all three fetches succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            stats: { transfersToday: 0, volumeTodayAud: 0, activeUsers: 0, pendingKyc: 0 },
            float: { provider: 'flutterwave', balance: '1000', threshold: '500', sufficient: true },
            rates: [],
          }),
        } as Response),
      ),
    )

    const tree = (await AdminDashboard()) as ReactElement
    const text = collectStrings(tree).join(' ')
    expect(text).not.toContain('Admin data partially unavailable')
  })
})
