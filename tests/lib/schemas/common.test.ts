import { describe, it, expect } from 'vitest'
import {
  Email,
  Password,
  AU_STATE,
  Postcode,
  Phone,
  CurrencyCode,
  DecimalString,
  SuccessEnvelope,
  ErrorEnvelope,
  IdentifierInput,
  IDENTIFIER_TYPE_TO_PRISMA,
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

  it('DecimalString rejects negative, empty, and non-numeric input', () => {
    expect(() => DecimalString.parse('-1')).toThrow()
    expect(() => DecimalString.parse('-0.5')).toThrow()
    expect(() => DecimalString.parse('')).toThrow()
    expect(() => DecimalString.parse('abc')).toThrow()
    expect(DecimalString.parse('100')).toBe('100')
    expect(DecimalString.parse('0.5')).toBe('0.5')
    expect(DecimalString.parse(42)).toBe('42')
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

  it('IdentifierInput accepts email + phone, rejects invalid discriminator', () => {
    expect(IdentifierInput.parse({ type: 'email', value: 'a@b.com' })).toMatchObject({
      type: 'email',
      value: 'a@b.com',
    })
    expect(IdentifierInput.parse({ type: 'phone', value: '+61412345678' })).toMatchObject({
      type: 'phone',
    })
    expect(() => IdentifierInput.parse({ type: 'bogus', value: 'x' })).toThrow()
  })

  it('IdentifierInput validates value against its type', () => {
    expect(() => IdentifierInput.parse({ type: 'email', value: 'not-email' })).toThrow()
    expect(() => IdentifierInput.parse({ type: 'phone', value: '0412345678' })).toThrow()
  })

  it('IDENTIFIER_TYPE_TO_PRISMA maps wire-format to Prisma enum', () => {
    expect(IDENTIFIER_TYPE_TO_PRISMA.email).toBe('EMAIL')
    expect(IDENTIFIER_TYPE_TO_PRISMA.phone).toBe('PHONE')
    expect(IDENTIFIER_TYPE_TO_PRISMA.apple).toBe('APPLE')
    expect(IDENTIFIER_TYPE_TO_PRISMA.google).toBe('GOOGLE')
  })
})
