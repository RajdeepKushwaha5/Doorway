import { isModeId, MODE_IDS } from '@/lib/modes';
import { getCurrentMode, isAuthorized, setCurrentMode } from '@/lib/state';

export const dynamic = 'force-dynamic';

/** Report the current mode. Unauthenticated: it reveals nothing sensitive. */
export async function GET(): Promise<Response> {
  return Response.json({ mode: await getCurrentMode(), available: MODE_IDS });
}

/**
 * Switch the mode the live product page serves.
 *
 * Requires `Authorization: Bearer <DRIFTMART_ADMIN_TOKEN>`. The endpoint is
 * public because Bright Data has to reach this host, so without the token an
 * unrelated visitor could flip the page mid-run and NOTICE would open an
 * incident nobody triggered.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 });
  }

  const mode = (body as Record<string, unknown> | null)?.['mode'];
  if (typeof mode !== 'string' || !isModeId(mode)) {
    return Response.json(
      { error: 'unknown mode', available: MODE_IDS },
      { status: 400 },
    );
  }

  await setCurrentMode(mode);
  return Response.json({ mode, switchedAt: new Date().toISOString() });
}
