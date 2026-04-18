import Decimal from 'decimal.js'
import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'

// AUSTRAC threshold reporting.
//
// TTR (Threshold Transaction Report) — required when an AUD transfer
// crosses the statutory threshold. AUSTRAC sets it at AUD 10,000; we
// trigger at AUD 9,500 so a transfer that becomes reportable after
// a slight FX recalibration isn't missed. The ~5% buffer costs us
// nothing but a slightly larger review queue.
//
// IFTI (International Funds Transfer Instruction) — required for
// every cross-border transfer. Kolaleaf runs AUD -> NGN exclusively,
// so every transfer is cross-border by construction and every
// transfer gets an IFTI report (no amount threshold).
//
// Both produce ComplianceReport rows for admin review (Step 28).
// Auto-filing with AUSTRAC's Entity Management System is DEFERRED —
// this step produces the durable signal, a later step wires the EMS
// API integration on top.

export const AUSTRAC_TTR_THRESHOLD_AUD = new Decimal('9500')

// Documented: every cross-border transfer is IFTI-reportable because
// the corridor is international by definition.
export const AUSTRAC_IFTI_APPLIES_TO_ALL = true

interface AustracReportContext {
  userId: string
  transferId: string
  sendAmountAud: Decimal
  baseCurrency: string
  targetCurrency: string
}

async function recordThresholdReport(ctx: AustracReportContext): Promise<void> {
  await prisma.complianceReport.create({
    data: {
      type: 'THRESHOLD',
      userId: ctx.userId,
      transferId: ctx.transferId,
      details: {
        source: 'austrac_ttr_trigger',
        sendAmountAud: ctx.sendAmountAud.toString(),
        thresholdAud: AUSTRAC_TTR_THRESHOLD_AUD.toString(),
        baseCurrency: ctx.baseCurrency,
        targetCurrency: ctx.targetCurrency,
        checkedAt: new Date().toISOString(),
      },
    },
  })
  log('warn', 'compliance.ttr.triggered', {
    userId: ctx.userId,
    transferId: ctx.transferId,
    sendAmountAud: ctx.sendAmountAud.toString(),
  })
}

async function recordIftiReport(ctx: AustracReportContext): Promise<void> {
  await prisma.complianceReport.create({
    data: {
      type: 'IFTI',
      userId: ctx.userId,
      transferId: ctx.transferId,
      details: {
        source: 'austrac_ifti_trigger',
        sendAmountAud: ctx.sendAmountAud.toString(),
        baseCurrency: ctx.baseCurrency,
        targetCurrency: ctx.targetCurrency,
        direction: 'outbound',
        checkedAt: new Date().toISOString(),
      },
    },
  })
  log('info', 'compliance.ifti.recorded', {
    userId: ctx.userId,
    transferId: ctx.transferId,
    corridor: `${ctx.baseCurrency}->${ctx.targetCurrency}`,
  })
}

// Evaluate a newly-created transfer for AUSTRAC report triggers and
// record each applicable ComplianceReport. Called AFTER the transfer
// transaction commits (parallel to recordVelocityCheck).
//
// Error handling: each report is independent; a failure on one does
// not prevent the other. Both log-only on failure — a broken
// compliance pipe cannot roll back a legitimate customer transfer.
export async function recordAustracReports(
  ctx: AustracReportContext,
): Promise<{ ttrRecorded: boolean; iftiRecorded: boolean }> {
  const out = { ttrRecorded: false, iftiRecorded: false }

  // TTR only if threshold met. Buffered at AUD 9,500 per Q1 signoff.
  if (ctx.sendAmountAud.gte(AUSTRAC_TTR_THRESHOLD_AUD)) {
    try {
      await recordThresholdReport(ctx)
      out.ttrRecorded = true
    } catch (err) {
      log('error', 'compliance.ttr.record_failed', {
        userId: ctx.userId,
        transferId: ctx.transferId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // IFTI always (all corridors are cross-border by construction).
  try {
    await recordIftiReport(ctx)
    out.iftiRecorded = true
  } catch (err) {
    log('error', 'compliance.ifti.record_failed', {
      userId: ctx.userId,
      transferId: ctx.transferId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  return out
}
