import pino from 'pino'
import { currentRequestId } from './request-context'

// Single pino instance. Base fields land on every line so SaaS
// ingestion can filter by service + env without per-call-site code.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'kolaleaf',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

export type LogLevel = 'info' | 'warn' | 'error'

// Structured emit. `event` is a stable dotted-namespace string
// (e.g. 'email.job.failed', 'alert.float.low') — clients switch on
// event, not on message copy. Auto-injects requestId from the
// AsyncLocalStorage context when present.
export function log(
  level: LogLevel,
  event: string,
  data?: Record<string, unknown>,
): void {
  const requestId = currentRequestId()
  const payload = requestId ? { event, requestId, ...data } : { event, ...data }
  logger[level](payload)
}
