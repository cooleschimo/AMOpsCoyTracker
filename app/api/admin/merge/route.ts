import { NextRequest, NextResponse } from 'next/server';
import { checkAdminHeader } from '../../../../lib/auth';
import { recordDecision, type MergeInput } from '../../../../lib/merge-actions';
import { cookies } from 'next/headers';
import { optional } from '../../../../lib/env';

export async function POST(req: NextRequest) {
  const jar = await cookies();
  const cookieTok = jar.get('admin_token')?.value;
  const expected = optional('ADMIN_TOKEN');
  const ok = checkAdminHeader(req.headers.get('authorization'))
    || (!!expected && !!cookieTok && cookieTok === expected);
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: MergeInput;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  if (!body?.entityType || !body?.keptId || !body?.mergedId || !body?.decision) {
    return NextResponse.json({ error: 'entityType, keptId, mergedId, decision required' }, { status: 400 });
  }
  if (body.keptId === body.mergedId) {
    return NextResponse.json({ error: 'cannot merge a row into itself' }, { status: 400 });
  }

  try {
    const r = await recordDecision(body);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
