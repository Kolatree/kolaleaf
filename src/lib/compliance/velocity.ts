import { prisma } from '@/lib/db/client'
import { log } from '@/lib/obs/logger'

// Velocity-based suspicious-matter detection.
//
// AUSTRAC expects us to flag unusual send-frequency patterns. Two
// independent triggers fire here:
//
//   1. Hard cap — anything above VELOCITY_HARD_CAP_PER_HOUR in the
//      trailing hour is inherently suspicious regardless of history.
//      Matches the fraud-ring / account-takeover pattern where a new
//      user suddenly fires many transfers in minutes.
//
//   2. Spike ratio — trailing-hour count vs. the user's average
//      hourly rate over the prior 30 days. If the short window is
//      >= VELOCITY_SPIKE_RATIO x baseline AND at least VELOCITY_MIN_
//      SPIKE_COUNT transfers, flag. The MIN_SPIKE_COUNT guard avoids
//      a "1 transfer in 1h vs. 0.01 baseline" false positive.
//
// The function DOES NOT block the transfer. It records a SUSPICIOUS
// ComplianceReport row and structured-logs the signal for ops. Block
// vs. flag is a policy decision left to a separate step; for now we
// produce the signal and preserve customer UX.

const HOUR_MS = 60 * 60 * 1000
const BASELINE_DAYS = 30

export const VELOCITY_HARD_CAP_PER_HOUR = 10
export const VELOCITY_SPIKE_RATIO = 5
export const VELOCITY_MIN_SPIKE_COUNT = 3

export type VelocityFlag =
  | { flagged: false }
  | {
      flagged: true
      reason: 'hard_cap' | 'spike_ratio'
      countInWindow: number
      baselineHourlyRate: number | null
    }

// Evaluate a user's trailing-hour velocity. Safe to call on every
// transfer creation — two cheap indexed count queries per call.
export async function evaluateUserVelocity(userId: string): Promise<VelocityFlag> {
  const now = Date.now()
  const windowStart = new Date(now - HOUR_MS)
  const baselineStart = new Date(now - BASELINE_DAYS * 24 * HOUR_MS)

  const [countInWindow, countInBaselineWindow] = await Promise.all([
    prisma.transfer.count({
      where: { userId, createdAt: { gte: windowStart } },
    }),
    prisma.transfer.count({
      where: { userId, createdAt: { gte: baselineStart, lt: windowStart } },
    }),
  ])

  // Baseline rate is per-hour. 30 days * 24 hours = 720 slots.
  const baselineHourlyRate =
    countInBaselineWindow === 0 ? null : countInBaselineWindow / (BASELINE_DAYS * 24 - 1)

  if (countInWindow >= VELOCITY_HARD_CAP_PER_HOUR) {
    return {
      flagged: true,
      reason: 'hard_cap',
      countInWindow,
      baselineHourlyRate,
    }
  }

  if (
    baselineHourlyRate !== null &&
    countInWindow >= VELOCITY_MIN_SPIKE_COUNT &&
    countInWindow >= baselineHourlyRate * VELOCITY_SPIKE_RATIO
  ) {
    return {
      flagged: true,
      reason: 'spike_ratio',
      countInWindow,
      baselineHourlyRate,
    }
  }

  return { flagged: false }
}

// Evaluate + record. Creates a ComplianceReport row and emits a
// structured log when flagged. Returns the flag so callers can also
// branch on it (e.g. to enrich their own logs). Safe to call in a
// hot path; the ComplianceReport write is fire-and-forget-ish in
// that a failure here doesn't re-throw into the caller — we log and
// continue so a broken compliance pipe can't break a transfer.
export async function recordVelocityCheck(
  userId: string,
  transferId?: string,
): Promise<VelocityFlag> {
  const flag = await evaluateUserVelocity(userId)

  if (flag.flagged) {
    try {
      await prisma.complianceReport.create({
        data: {
          type: 'SUSPICIOUS',
          userId,
          transferId,
          details: {
            source: 'velocity_check',
            reason: flag.reason,
            countInWindow: flag.countInWindow,
            windowMs: HOUR_MS,
            baselineHourlyRate: flag.baselineHourlyRate,
            hardCapPerHour: VELOCITY_HARD_CAP_PER_HOUR,
            spikeRatio: VELOCITY_SPIKE_RATIO,
            checkedAt: new Date().toISOString(),
          },
        },
      })
      log('warn', 'compliance.velocity_flag', {
        userId,
        transferId,
        reason: flag.reason,
        countInWindow: flag.countInWindow,
      })
    } catch (err) {
      log('error', 'compliance.velocity_report_failed', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return flag
}
