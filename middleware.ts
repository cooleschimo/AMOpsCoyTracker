/**
 * Remember a token that arrives in the URL. Brief §11.
 *
 * The gates read `?token=` or a cookie, but nothing ever wrote the cookie — so
 * arriving with a valid token and then clicking a link lost it on the first
 * hop, and every company, person and item page read as unauthorised to someone
 * who had just been let in.
 *
 * A page render cannot set a cookie in the App Router; middleware can. It runs
 * before the page, stores the token, and strips it from the URL so the address
 * bar stops carrying a shared secret around.
 *
 * This is still a shared link, not authentication (§14). Anyone holding the
 * token has full access, and the cookie only saves them from re-pasting it.
 */
import { NextResponse, type NextRequest } from 'next/server';

const DASHBOARD_COOKIE = 'dashboard_token';
const ADMIN_COOKIE = 'admin_token';

/**
 * Compared here rather than through lib/auth so this stays on the edge runtime,
 * which has no access to node:crypto or the env module's Node APIs.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30,
  secure: process.env.NODE_ENV === 'production',
};

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
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const admin = process.env.ADMIN_TOKEN;
  const dashboard = process.env.DASHBOARD_TOKEN;

  const token = req.nextUrl.searchParams.get('token');
  const isAdminToken = !!token && !!admin && timingSafeEqual(token, admin);
  const isDashboardToken = !!token && !!dashboard && timingSafeEqual(token, dashboard);

  // A token in the URL: store it, then drop it from the address bar. A URL gets
  // pasted into chats and tickets; a cookie does not.
  if (isAdminToken || isDashboardToken) {
    const url = req.nextUrl.clone();
    url.searchParams.delete('token');
    const res = NextResponse.redirect(url);
    if (isAdminToken) res.cookies.set(ADMIN_COOKIE, token!, COOKIE_OPTIONS);
    if (isDashboardToken) res.cookies.set(DASHBOARD_COOKIE, token!, COOKIE_OPTIONS);
    return res;
  }

  const cookieAdmin = req.cookies.get(ADMIN_COOKIE)?.value;
  const cookieDashboard = req.cookies.get(DASHBOARD_COOKIE)?.value;
  const hasAdmin = !!admin && !!cookieAdmin && timingSafeEqual(cookieAdmin, admin);
  // Admin is the strictly wider role, so it opens the dashboard too.
  const hasDashboard =
    hasAdmin || (!!dashboard && !!cookieDashboard && timingSafeEqual(cookieDashboard, dashboard));

  if (pathname.startsWith('/admin')) return hasAdmin ? NextResponse.next() : notAuthorised();
  return hasDashboard ? NextResponse.next() : notAuthorised();
}

export const config = {
  // Every page, but none of the static assets or API routes — an API caller
  // sends its own header and should not be redirected mid-request.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
