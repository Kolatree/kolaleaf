import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from '../password'

describe('password service', () => {
  it('produces a bcrypt hash string', async () => {
    const hash = await hashPassword('securePass123')
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
  })

  it('verifies a correct password', async () => {
    const hash = await hashPassword('myPassword')
    const result = await verifyPassword('myPassword', hash)
    expect(result).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct')
    const result = await verifyPassword('wrong', hash)
    expect(result).toBe(false)
  })

  it('handles empty string password', async () => {
    const hash = await hashPassword('')
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
    const result = await verifyPassword('', hash)
    expect(result).toBe(true)
  })

  it('produces different hashes for the same input (salt)', async () => {
    const hash1 = await hashPassword('same')
    const hash2 = await hashPassword('same')
    expect(hash1).not.toBe(hash2)
  })
})
