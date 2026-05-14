import * as Sentry from '@sentry/nextjs'

import {
  beforeSend,
  beforeSendSpan,
  beforeSendTransaction,
  getSentryDsn,
  getSentryEnvironment,
  getSentryTracesSampleRate,
} from './sentry.shared'

const dsn = getSentryDsn('client')

if (dsn) {
  Sentry.init({
    dsn,
    environment: getSentryEnvironment(),
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: getSentryTracesSampleRate(),
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend,
    beforeSendTransaction,
    beforeSendSpan,
  })
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
