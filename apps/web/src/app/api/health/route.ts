import { NextResponse } from 'next/server'
import { prisma } from '@savvyedge/database'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString() })
  } catch (e) {
    return NextResponse.json({ status: 'error', error: 'Database unreachable' }, { status: 503 })
  }
}
