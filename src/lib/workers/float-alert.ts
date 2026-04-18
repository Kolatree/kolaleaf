import Decimal from 'decimal.js'
import { FloatMonitor } from '../payments/payout/float-monitor'
import { FlutterwaveProvider } from '../payments/payout/flutterwave'
import { alertOps } from '@/lib/obs/alert'

const DEFAULT_THRESHOLD = new Decimal(process.env.MIN_FLOAT_BALANCE_NGN ?? '500000')

export interface FloatAlertResult {
  balance: Decimal
  threshold: Decimal
  sufficient: boolean
  pausedCount: number
  resumedCount: number
}

export async function checkAndAlertFloat(): Promise<FloatAlertResult> {
  const provider = new FlutterwaveProvider({
    secretKey: process.env.FLUTTERWAVE_SECRET_KEY ?? '',
    apiUrl: process.env.FLUTTERWAVE_API_URL ?? 'https://api.flutterwave.com/v3',
  })
  const monitor = new FloatMonitor(provider, DEFAULT_THRESHOLD)

  const { balance, sufficient } = await monitor.checkFloatBalance()

  let pausedCount = 0
  let resumedCount = 0

  if (sufficient) {
    // Float is healthy — resume any paused transfers
    resumedCount = await monitor.resumeTransfersIfFloatRestored()
  } else {
    // Float is low — pause eligible transfers
    pausedCount = await monitor.pauseTransfersIfLowFloat()

    void alertOps('alert.float.low', {
      balance: balance.toString(),
      threshold: DEFAULT_THRESHOLD.toString(),
      currency: 'NGN',
      pausedCount,
    })
  }

  return {
    balance,
    threshold: DEFAULT_THRESHOLD,
    sufficient,
    pausedCount,
    resumedCount,
  }
}
