import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { requireAuth, AuthError } from '@/lib/auth/middleware'
import { parseBody } from '@/lib/http/validate'
import { CreateRecipientBody } from './_schemas'

export async function POST(request: Request) {
  const parsed = await parseBody(request, CreateRecipientBody)
  if (!parsed.ok) return parsed.response
  const { fullName, bankName, bankCode, accountNumber } = parsed.data

  try {
    const { userId } = await requireAuth(request)

    const recipient = await prisma.recipient.create({
      data: {
        userId,
        fullName,
        bankName,
        bankCode,
        accountNumber,
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
