import { cookies } from 'next/headers'
import { getSessionTokenFromCookie } from '@/lib/auth/middleware'

async function fetchAdminJson(path: string, cookieHeader: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${base}${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  })
  if (!res.ok) return null
  return res.json()
}

export default async function AdminDashboard() {
  const cookieStore = await cookies()
  const cookieHeader = cookieStore.getAll().map((c) => `${c.name}=${c.value}`).join('; ')

  const [statsData, floatData, ratesData] = await Promise.all([
    fetchAdminJson('/api/admin/stats', cookieHeader),
    fetchAdminJson('/api/admin/float', cookieHeader),
    fetchAdminJson('/api/admin/rates', cookieHeader),
  ])

  const stats = statsData?.stats
  const float = floatData?.float
  const rates = ratesData?.rates ?? []

  const staleRates = rates.filter((r: { stale: boolean }) => r.stale)

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Transfers Today" value={stats?.transfersToday ?? '-'} />
        <StatCard label="Volume (AUD)" value={stats ? `$${Number(stats.volumeTodayAud).toLocaleString()}` : '-'} />
        <StatCard label="Active Users (30d)" value={stats?.activeUsers ?? '-'} />
        <StatCard label="Pending KYC" value={stats?.pendingKyc ?? '-'} />
      </div>

      {/* Float status */}
      <div className="mb-8">
        <h2 className="text-lg font-medium text-gray-900 mb-3">Float Status</h2>
        {float ? (
          <div
            className={`p-4 rounded border ${
              float.sufficient
                ? 'bg-green-50 border-green-200'
                : 'bg-red-50 border-red-200'
            }`}
          >
            <p className="text-sm font-medium">
              {float.provider.toUpperCase()} — NGN{' '}
              {Number(float.balance).toLocaleString()}
            </p>
            <p className="text-xs text-gray-600 mt-1">
              Threshold: NGN {Number(float.threshold).toLocaleString()}
              {!float.sufficient && (
                <span className="text-red-600 font-medium ml-2">
                  LOW FLOAT — Top up required
                </span>
              )}
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Unable to fetch float status</p>
        )}
      </div>

      {/* Stale rate warning */}
      {staleRates.length > 0 && (
        <div className="mb-8 p-4 rounded border bg-yellow-50 border-yellow-200">
          <h2 className="text-sm font-medium text-yellow-800">Stale Rates Warning</h2>
          {staleRates.map((r: { corridor: { baseCurrency: string; targetCurrency: string }; hoursStale?: number }) => (
            <p key={`${r.corridor.baseCurrency}-${r.corridor.targetCurrency}`} className="text-xs text-yellow-700 mt-1">
              {r.corridor.baseCurrency}/{r.corridor.targetCurrency} — {r.hoursStale ?? '?'}h since last update
            </p>
          ))}
        </div>
      )}

      {/* Transfer status breakdown */}
      {stats?.transfersByStatus && (
        <div>
          <h2 className="text-lg font-medium text-gray-900 mb-3">Transfers by Status</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(stats.transfersByStatus as Record<string, number>).map(([status, count]) => (
              <div key={status} className="p-3 bg-white rounded border border-gray-200">
                <p className="text-xs text-gray-500 uppercase">{status.replace(/_/g, ' ')}</p>
                <p className="text-xl font-semibold text-gray-900">{count}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4 bg-white rounded border border-gray-200">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  )
}
