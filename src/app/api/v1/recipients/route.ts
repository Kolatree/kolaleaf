import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'

export async function POST(request: Request) {
  let body: {
    fullName?: string
    bankName?: string
    bankCode?: string
    accountNumber?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { fullName, bankName, bankCode, accountNumber } = body

  if (!fullName || typeof fullName !== 'string') {
    return NextResponse.json({ error: 'fullName is required' }, { status: 400 })
  }
  if (!bankName || typeof bankName !== 'string') {
    return NextResponse.json({ error: 'bankName is required' }, { status: 400 })
  }
  if (!bankCode || typeof bankCode !== 'string') {
    return NextResponse.json({ error: 'bankCode is required' }, { status: 400 })
  }
  if (!accountNumber || typeof accountNumber !== 'string') {
    return NextResponse.json({ error: 'accountNumber is required' }, { status: 400 })
  }

  try {
    const { userId } = await requireAuth(request)

    const recipient = await prisma.recipient.create({
      data: {
        userId,
        fullName: fullName.trim(),
        bankName: bankName.trim(),
        bankCode: bankCode.trim(),
        accountNumber: accountNumber.trim(),
      },
    })

    return NextResponse.json({ recipient }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to create recipient' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { userId } = await requireAuth(request)

    const recipients = await prisma.recipient.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ recipients })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    return NextResponse.json({ error: 'Failed to list recipients' }, { status: 500 })
  }
}
