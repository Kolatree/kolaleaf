import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/admin-middleware'
import { AuthError } from '@/lib/auth/middleware'
import { prisma } from '@/lib/db/client'

export async function GET(request: Request) {
  try {
    await requireAdmin(request)

    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)

    const [
      transfersToday,
      volumeToday,
      activeUsers,
      pendingKyc,
      transfersByStatus,
    ] = await Promise.all([
      prisma.transfer.count({
        where: { createdAt: { gte: startOfDay } },
      }),
      prisma.transfer.aggregate({
        where: { createdAt: { gte: startOfDay } },
        _sum: { sendAmount: true },
      }),
      prisma.user.count({
        where: {
          transfers: { some: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        },
      }),
      prisma.user.count({
        where: { kycStatus: 'PENDING' },
      }),
      prisma.transfer.groupBy({
        by: ['status'],
        _count: true,
      }),
    ])

    const statusCounts = Object.fromEntries(
      transfersByStatus.map((g) => [g.status, g._count]),
    )

    return NextResponse.json({
      stats: {
        transfersToday,
        volumeTodayAud: volumeToday._sum.sendAmount?.toString() ?? '0',
        activeUsers,
        pendingKyc,
        transfersByStatus: statusCounts,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
