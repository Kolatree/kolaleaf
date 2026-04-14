import Decimal from 'decimal.js'

/**
 * Applies spread to a wholesale rate.
 * customerRate = wholesaleRate * (1 - spreadPercentage)
 *
 * @param wholesaleRate - The raw FX rate from the provider
 * @param spreadPercentage - Decimal fraction (e.g. 0.007 = 0.7%)
 * @returns Customer-facing rate
 */
export function calculateCustomerRate(wholesaleRate: Decimal, spreadPercentage: Decimal): Decimal {
  return wholesaleRate.mul(new Decimal(1).minus(spreadPercentage))
}

/**
 * Calculates the receive amount for a given send amount and customer rate.
 * receiveAmount = sendAmount * customerRate
 *
 * @param sendAmount - Amount the customer is sending
 * @param customerRate - Customer-facing exchange rate
 * @returns Amount the recipient will receive
 */
export function calculateReceiveAmount(sendAmount: Decimal, customerRate: Decimal): Decimal {
  return sendAmount.mul(customerRate)
}
