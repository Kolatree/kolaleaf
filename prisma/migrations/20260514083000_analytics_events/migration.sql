-- Privacy-first first-party KPI events. Stores a keyed hash of the
-- authenticated user id, never raw PII or recipient/amount fields.
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userHash" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsEvent_event_occurredAt_idx" ON "AnalyticsEvent"("event", "occurredAt");
CREATE INDEX "AnalyticsEvent_userHash_occurredAt_idx" ON "AnalyticsEvent"("userHash", "occurredAt");
