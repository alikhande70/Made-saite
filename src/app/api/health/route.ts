/**
 * Liveness: "is this process alive?"
 *
 * Deliberately checks nothing else. A liveness probe that touches the database
 * makes a database blip restart every healthy application container, turning a
 * recoverable dependency failure into an outage. Readiness is where
 * dependencies belong — see `/api/ready`.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok', uptimeSeconds: Math.round(process.uptime()) },
    { headers: { 'cache-control': 'no-store' } },
  );
}
