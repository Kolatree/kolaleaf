import { describe, it, expect } from 'vitest'
import {
  Email,
  Password,
  AU_STATE,
  Postcode,
  Phone,
  CurrencyCode,
  SuccessEnvelope,
  ErrorEnvelope,
} from '@/lib/schemas/common'
import { z } from 'zod'

describe('common schema primitives', () => {
  it('Email trims and lowercases', () => {
    const parsed = Email.parse('  Hello@B.COM  ')
    expect(parsed).toBe('hello@b.com')
  })

  it('Password rejects anything shorter than 12 chars', () => {
    // 11 chars
    expect(() => Password.parse('abcdef12345')).toThrow()
    // 12 chars
    expect(Password.parse('abcdef123456')).toBe('abcdef123456')
  })

  it('AU_STATE rejects XYZ, accepts NSW', () => {
    expect(() => AU_STATE.parse('XYZ')).toThrow()
    expect(AU_STATE.parse('NSW')).toBe('NSW')
  })

  it('Postcode rejects 3- and 5-digit inputs', () => {
    expect(() => Postcode.parse('123')).toThrow()
    expect(() => Postcode.parse('12345')).toThrow()
    expect(Postcode.parse('2000')).toBe('2000')
  })

  it('Phone rejects a missing +61', () => {
    expect(() => Phone.parse('0412345678')).toThrow()
    expect(Phone.parse('+61412345678')).toBe('+61412345678')
  })

  it('CurrencyCode rejects lowercase `usd`, accepts `USD`', () => {
    expect(() => CurrencyCode.parse('usd')).toThrow()
    expect(CurrencyCode.parse('USD')).toBe('USD')
  })

  it('SuccessEnvelope wraps arbitrary data of a given inner schema', () => {
    const Env = SuccessEnvelope(z.object({ id: z.string() }))
    const v = Env.parse({ data: { id: 'u1' } })
    expect(v.data.id).toBe('u1')
  })

  it('ErrorEnvelope matches the jsonError shape (reason + error)', () => {
    const v = ErrorEnvelope.parse({ error: 'Nope', reason: 'bad_request' })
    expect(v.reason).toBe('bad_request')
    expect(v.error).toBe('Nope')
  })
})
