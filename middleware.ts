/**
 * One gate in front of every page: are you signed in?
 *
 * This used to exchange a `?token=` in the URL for a cookie, on the reasoning
 * that a shared secret was enough for a handful of readers. Accounts replaced
 * that. The link is now an ordinary URL — anyone opening it without a session
 * lands on /login, signs in, and reads the week as themselves.
 *
 * Verified against the database rather than trusted from the cookie. Next 16
 * runs this file on the Node runtime, so the lookup is ordinary here, and a
 * gate that cannot tell a real token from a made-up one is not a gate.
 */
import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'session';

/**
 * Is this session token a live row?
 *
 * Read straight from the database rather than trusted from the cookie. Next 16
 * runs this file on the Node runtime, so the lookup that was once impossible
 * here is now ordinary — and a gate that cannot tell a real token from a made-up
 * one is not a gate.
 *
 * A failure is treated as "not admitted" rather than thrown. Failing open
 * would turn a database blip into an open door.
 */
async function liveSession(token: string): Promise<{ role: string | null } | null> {
  try {
    const { getSql } = await import('./lib/db');
    /*
     * LEFT join: a guest session has no user_id, and an inner join read that as
     * no session at all — which turned "Continue as a guest" into a redirect
     * back to the page it came from. The row existing is admission; the role,
     * when there is one, is what /admin needs.
     */
    const rows: any = await getSql()`
      select u.role from sessions s left join users u on u.id = s.user_id
       where s.token = ${token} and s.expires_at > now() limit 1`;
    return rows.length ? { role: rows[0].role ? String(rows[0].role) : null } : null;
  } catch {
    return null;
  }
}

/** The page shown to someone without a token. Deliberately says nothing. */
function notAuthorised() {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8">
     <meta name="robots" content="noindex, nofollow">
     <title>Not authorised</title>
     <style>
       body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1a1a18;
            background:#fafaf9;display:grid;place-items:center;height:100vh;margin:0}
       div{max-width:26rem;padding:0 1.5rem}
       h1{font-size:1.1rem;font-weight:600;margin:0 0 .5rem}
       p{color:#6b6b64;margin:0}
     </style>
     <div>
       <h1>Not authorised</h1>
       <p>This link needs an access token. Ask whoever shared it for the full URL.</p>
     </div>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/**
 * One gate for every page, rather than a check inside each one.
 *
 * A per-page check is a per-page opportunity to forget: the dashboard, the
 * monitoring page and the graph were all reachable without a token because
 * nobody added the call. Here a new page is gated by existing.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  /*
   * Signing in and creating an account come before any gate can pass.
   *
   * These two routes are the only way to obtain a session, so gating them on
   * the thing a session provides would lock out every invited person who does
   * not already hold the shared link. They carry their own protection instead:
   * /join needs a single-use invite token, and /login needs a password.
   */
  if (
    pathname === '/login'
    || pathname === '/forgot'
    || pathname.startsWith('/join/')
    || pathname.startsWith('/reset/')
  ) return NextResponse.next();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await liveSession(token) : null;

  /*
   * Unauthenticated: send them to sign in, carrying where they were going so
   * the trip is not lost. A bare 401 made sense when the answer was "ask
   * whoever shared the link"; now there is something they can actually do.
   */
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Admin is a property of the account now, not a second secret.
  if (pathname.startsWith('/admin') && session.role !== 'admin') return notAuthorised();

  return NextResponse.next();
}

export const config = {
  // Every page, but none of the static assets or API routes — an API caller
  // sends its own header and should not be redirected mid-request.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
