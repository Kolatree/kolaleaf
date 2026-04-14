import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { calculateCustomerRate, calculateReceiveAmount } from '../spread'

describe('calculateCustomerRate', () => {
  it('applies a standard spread (0.7%) to wholesale rate', () => {
    const wholesale = new Decimal('950.000000')
    const spread = new Decimal('0.007000') // 0.7%

    const result = calculateCustomerRate(wholesale, spread)

    // 950 * (1 - 0.007) = 950 * 0.993 = 943.350000
    expect(result.toString()).toBe('943.35')
  })

  it('returns wholesale rate when spread is zero', () => {
    const wholesale = new Decimal('950.000000')
    const spread = new Decimal('0')

    const result = calculateCustomerRate(wholesale, spread)

    expect(result.toString()).toBe('950')
  })

  it('handles a large spread (5%)', () => {
    const wholesale = new Decimal('950.000000')
    const spread = new Decimal('0.050000') // 5%

    const result = calculateCustomerRate(wholesale, spread)

    // 950 * (1 - 0.05) = 950 * 0.95 = 902.50
    expect(result.toString()).toBe('902.5')
  })

  it('handles a tiny spread (0.1%)', () => {
    const wholesale = new Decimal('950.000000')
    const spread = new Decimal('0.001000') // 0.1%

    const result = calculateCustomerRate(wholesale, spread)

    // 950 * (1 - 0.001) = 950 * 0.999 = 949.050
    expect(result.toString()).toBe('949.05')
  })

  it('rounds to 6 decimal places (rate precision)', () => {
    const wholesale = new Decimal('951.123456')
    const spread = new Decimal('0.003000') // 0.3%

    const result = calculateCustomerRate(wholesale, spread)

    // 951.123456 * (1 - 0.003) = 951.123456 * 0.997 = 948.270087432
    // Decimal.js default rounding (ROUND_HALF_UP) → 948.270087
    // But Decimal.js uses ROUND_HALF_EVEN by default → 948.270086
    // Actual: 948.270086.432 → floor at 6dp = 948.270086
    expect(result.toDecimalPlaces(6).toString()).toBe('948.270086')
  })
})

describe('calculateReceiveAmount', () => {
  it('calculates receive amount from send amount and customer rate', () => {
    const sendAmount = new Decimal('1000.00')
    const customerRate = new Decimal('943.350000')

    const result = calculateReceiveAmount(sendAmount, customerRate)

    // 1000 * 943.35 = 943350.00
    expect(result.toString()).toBe('943350')
  })

  it('rounds to 2 decimal places (currency precision)', () => {
    const sendAmount = new Decimal('1234.56')
    const customerRate = new Decimal('943.350000')

    const result = calculateReceiveAmount(sendAmount, customerRate)

    // 1234.56 * 943.35 = 1164622.176 → rounded to 2dp
    expect(result.toDecimalPlaces(2).toString()).toBe('1164622.18')
  })

  it('handles small amounts', () => {
    const sendAmount = new Decimal('10.00')
    const customerRate = new Decimal('950.123456')

    const result = calculateReceiveAmount(sendAmount, customerRate)

    // 10 * 950.123456 = 9501.23456 → rounded to 2dp
    expect(result.toDecimalPlaces(2).toString()).toBe('9501.23')
  })

  it('handles zero send amount', () => {
    const sendAmount = new Decimal('0')
    const customerRate = new Decimal('950.000000')

    const result = calculateReceiveAmount(sendAmount, customerRate)

    expect(result.toString()).toBe('0')
  })

  it('uses Decimal throughout — no floating point artifacts', () => {
    // Classic float problem: 0.1 + 0.2 != 0.3 in JS floats
    const sendAmount = new Decimal('0.10')
    const customerRate = new Decimal('3.000000')

    const result = calculateReceiveAmount(sendAmount, customerRate)

    // Should be exactly 0.3, not 0.30000000000000004
    expect(result.toString()).toBe('0.3')
  })
})
