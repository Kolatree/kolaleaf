import * as Sentry from '@sentry/nextjs'

import {
  beforeSend,
  beforeSendSpan,
  beforeSendTransaction,
  getSentryDsn,
  getSentryEnvironment,
  getSentryTracesSampleRate,
} from './sentry.shared'

const dsn = getSentryDsn('server')

if (dsn) {
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: getSentryTracesSampleRate(),
    beforeSend,
    beforeSendTransaction,
    beforeSendSpan,
  })
}
