import { describe, it, expect } from 'vitest'
import { AU_STATES } from '@/lib/auth/constants'
import { $Enums } from '@/generated/prisma/client'

// Belt-and-braces drift check. The compile-time type guard in
// `constants.ts` already breaks tsc if the two sets diverge, but a
// runtime assertion gives a second line of defence in case Prisma
// regenerates to an unexpected shape between `npm test` and a commit.

describe('AU_STATES matches Prisma $Enums.AuState', () => {
  it('enumerates exactly the same 8 values in the same order', () => {
    const prismaValues = Object.values($Enums.AuState).sort()
    const constantValues = [...AU_STATES].sort()
    expect(prismaValues).toEqual(constantValues)
    expect(prismaValues.length).toBe(8)
  })
})
