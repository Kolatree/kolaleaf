import { cookies } from 'next/headers'
import { AdminShell, AdminAlert, colors, radius, shadow, spacing, GRADIENT } from '@/components/design/KolaPrimitives'

async function fetchAdminJson(path: string, cookieHeader: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${base}${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

interface Stats {
  transfersToday?: number | string
  volumeTodayAud?: number | string
  activeUsers?: number | string
  pendingKyc?: number | string
  transfersByStatus?: Record<string, number>
}

interface FloatInfo {
  provider: string
  balance: number | string
  threshold: number | string
  sufficient: boolean
}

interface RateRow {
  stale: boolean
  hoursStale?: number
  corridor: { baseCurrency: string; targetCurrency: string }
}

export default async function AdminDashboard() {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  const [statsData, floatData, ratesData] = await Promise.all([
    fetchAdminJson('/api/admin/stats', cookieHeader),
    fetchAdminJson('/api/admin/float', cookieHeader),
    fetchAdminJson('/api/admin/rates', cookieHeader),
  ])

  const stats: Stats | undefined = statsData?.stats
  const float: FloatInfo | undefined = floatData?.float
  const rates: RateRow[] = ratesData?.rates ?? []
  const staleRates = rates.filter((r) => r.stale)

  // Step 15b: surface partial-fetch failures rather than silently rendering
  // dashes. fetchAdminJson returns null on any non-OK response or thrown
  // request. Any null here means at least one upstream is broken.
  const partialFailure =
    statsData === null || floatData === null || ratesData === null

  return (
    <AdminShell active="Dashboard">
      <div className="flex items-baseline justify-between mb-6">
        <div>
          <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Overview
          </div>
          <h1 className="mt-1" style={{ fontSize: '24px', fontWeight: 700, color: colors.ink, letterSpacing: '-0.3px' }}>
            Dashboard
          </h1>
        </div>
      </div>

      {partialFailure && (
        <AdminAlert tone="warn">
          Admin data partially unavailable. Check server logs.
        </AdminAlert>
      )}

      {/* Stat tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 kola-stagger">
        <StatTile label="Transfers today"   value={stats?.transfersToday ?? '—'} accent />
        <StatTile label="Volume (AUD)"      value={stats ? `A$${Number(stats.volumeTodayAud ?? 0).toLocaleString()}` : '—'} />
        <StatTile label="Active users (30d)" value={stats?.activeUsers ?? '—'} />
        <StatTile label="Pending KYC"       value={stats?.pendingKyc ?? '—'} />
      </div>

      {/* Float status */}
      <section className="mb-8" style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}>
        <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Float status</h2>
        {float ? (
          <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div style={{ fontSize: '11px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {float.provider.toUpperCase()} · NGN
              </div>
              <div className="mt-1 tabular-nums" style={{ fontSize: '28px', fontWeight: 700, color: colors.ink }}>
                ₦{Number(float.balance).toLocaleString()}
              </div>
              <div style={{ fontSize: '12px', color: colors.muted, marginTop: '2px' }}>
                Threshold · ₦{Number(float.threshold).toLocaleString()}
              </div>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '999px',
                background: float.sufficient ? 'rgba(26,107,60,0.10)' : 'rgba(176,0,32,0.10)',
                color: float.sufficient ? colors.green : '#b00020',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {float.sufficient ? 'Sufficient' : 'Low — top up required'}
            </span>
          </div>
        ) : (
          <p className="mt-3" style={{ fontSize: '13px', color: colors.muted }}>Unable to fetch float status.</p>
        )}
      </section>

      {/* Stale rates warning */}
      {staleRates.length > 0 && (
        <section
          className="mb-8"
          style={{
            background: 'rgba(255,215,0,0.12)',
            border: `1px solid rgba(255,215,0,0.45)`,
            borderRadius: radius.card,
            padding: spacing.cardPad,
          }}
        >
          <h2 style={{ fontSize: '14px', fontWeight: 700, color: '#8a6d0a' }}>Stale rates warning</h2>
          <ul className="mt-2 space-y-1">
            {staleRates.map((r) => (
              <li key={`${r.corridor.baseCurrency}-${r.corridor.targetCurrency}`} style={{ fontSize: '12px', color: '#8a6d0a' }}>
                {r.corridor.baseCurrency}/{r.corridor.targetCurrency} — {r.hoursStale ?? '?'}h since last update
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Status breakdown */}
      {stats?.transfersByStatus && (
        <section style={{ background: colors.cardBg, borderRadius: radius.card, padding: spacing.cardPad, boxShadow: shadow.card }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: colors.ink }}>Transfers by status</h2>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 kola-stagger">
            {Object.entries(stats.transfersByStatus).map(([status, count]) => (
              <div
                key={status}
                style={{
                  background: colors.pageBg,
                  border: `1px solid ${colors.border}`,
                  borderRadius: '10px',
                  padding: '12px 14px',
                }}
              >
                <div style={{ fontSize: '10px', color: colors.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {status.replace(/_/g, ' ')}
                </div>
                <div className="tabular-nums mt-1" style={{ fontSize: '22px', fontWeight: 700, color: colors.ink }}>
                  {count}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </AdminShell>
  )
}

function StatTile({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div
      style={{
        background: accent ? GRADIENT : colors.cardBg,
        borderRadius: radius.card,
        padding: spacing.cardPad,
        boxShadow: shadow.card,
        color: accent ? '#fff' : colors.ink,
      }}
    >
      <div
        style={{
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          opacity: accent ? 0.85 : 1,
          color: accent ? '#fff' : colors.muted,
        }}
      >
        {label}
      </div>
      <div className="tabular-nums mt-1" style={{ fontSize: '26px', fontWeight: 700 }}>
        {value}
      </div>
    </div>
  )
}
