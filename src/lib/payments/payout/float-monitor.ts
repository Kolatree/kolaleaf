import Decimal from 'decimal.js'
import { prisma } from '../../db/client'
import { transitionTransfer } from '../../transfers/state-machine'
import { TransferStatus, ActorType } from '../../../generated/prisma/enums'
import { getOrchestrator } from './orchestrator'

interface FloatBalanceProvider {
  name: string
  getWalletBalance(currency: string): Promise<Decimal>
}

interface FloatCheckResult {
  provider: string
  balance: Decimal
  sufficient: boolean
}

export class FloatMonitor {
  private readonly provider: FloatBalanceProvider
  private readonly threshold: Decimal

  constructor(provider: FloatBalanceProvider, threshold?: Decimal) {
    this.provider = provider
    this.threshold = threshold ?? new Decimal(process.env.MIN_FLOAT_BALANCE_NGN ?? '500000')
  }

  async checkFloatBalance(): Promise<FloatCheckResult> {
    const balance = await this.provider.getWalletBalance('NGN')
    return {
      provider: this.provider.name,
      balance,
      sufficient: balance.gte(this.threshold),
    }
  }

  async pauseTransfersIfLowFloat(): Promise<number> {
    const { sufficient } = await this.checkFloatBalance()
    if (sufficient) return 0

    const transfers = await prisma.transfer.findMany({
      where: { status: TransferStatus.AUD_RECEIVED },
    })

    for (const transfer of transfers) {
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: TransferStatus.FLOAT_INSUFFICIENT,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.AUD_RECEIVED,
        metadata: { reason: 'Float balance below threshold' },
      })
    }

    return transfers.length
  }

  async resumeTransfersIfFloatRestored(): Promise<number> {
    const { sufficient } = await this.checkFloatBalance()
    if (!sufficient) return 0

    const transfers = await prisma.transfer.findMany({
      where: { status: TransferStatus.FLOAT_INSUFFICIENT },
    })
    const orchestrator = getOrchestrator()

    for (const transfer of transfers) {
      // FLOAT_INSUFFICIENT -> AUD_RECEIVED: re-queue for payout pickup
      await transitionTransfer({
        transferId: transfer.id,
        toStatus: TransferStatus.AUD_RECEIVED,
        actor: ActorType.SYSTEM,
        expectedStatus: TransferStatus.FLOAT_INSUFFICIENT,
        metadata: { reason: 'Float balance restored' },
      })

      try {
        await orchestrator.initiatePayout(transfer.id)
      } catch (error) {
        console.error('[float-monitor] failed to resume payout after float restore', {
          transferId: transfer.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    return transfers.length
  }
}
