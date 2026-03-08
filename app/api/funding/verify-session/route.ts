import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  return NextResponse.json({
    error: 'Deprecated endpoint. Balance updates are webhook-driven only.',
  }, { status: 410 });
}
