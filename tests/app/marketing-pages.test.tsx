import { describe, it, expect } from 'vitest'

import PrivacyPage from '@/app/(marketing)/privacy/page'
import TermsPage from '@/app/(marketing)/terms/page'
import CompliancePage from '@/app/(marketing)/compliance-info/page'

// ---------------------------------------------------------------------------
// Render-smoke tests for the three public legal/compliance stubs.
// Confirms each component still exports a renderable tree and that the
// prominent "Pending legal review" banner is present. This guards against
// accidental deletion and broken imports.
// ---------------------------------------------------------------------------

interface NodeLike {
  type?: unknown
  props?: { children?: unknown; [k: string]: unknown }
}

// Walks a React element tree and collects string children. Unlike the
// variant in admin/page.test.tsx, this one also invokes parameterless
// function components (server components with no state) so that child
// elements rendered by helpers like <LegalBanner /> and <Section /> are
// included in the assertion text.
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
  const props = (n.props ?? {}) as { children?: unknown; [k: string]: unknown }

  // If the element's type is a plain function component, invoke it with
  // its props so we can walk its output. Server components in this project
  // are synchronous and side-effect-free.
  if (typeof n.type === 'function') {
    try {
      const rendered = (n.type as (p: unknown) => unknown)(props)
      collectStrings(rendered, out)
      return out
    } catch {
      // Fall through to children-walk if invocation fails.
    }
  }

  if (props.children) collectStrings(props.children, out)
  return out
}

const cases: Array<{ name: string; Component: () => React.ReactElement; mustContain: string }> = [
  { name: 'privacy', Component: PrivacyPage, mustContain: 'Privacy Policy' },
  { name: 'terms', Component: TermsPage, mustContain: 'Terms of Service' },
  { name: 'compliance-info', Component: CompliancePage, mustContain: 'Compliance' },
]

describe('(marketing) legal + compliance stub pages', () => {
  for (const { name, Component, mustContain } of cases) {
    it(`renders /${name} with the legal-review banner`, () => {
      const tree = Component()
      expect(tree).not.toBeNull()
      const text = collectStrings(tree).join(' ')
      expect(text).toContain('Pending legal review')
      expect(text).toContain(mustContain)
    })
  }
})
