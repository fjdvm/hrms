import { NextResponse, type NextRequest } from "next/server";
import { devBypassEnabled } from "@/lib/portal/dev-bypass";
import { LOGIN_PATH, SESSION_COOKIE } from "@/lib/portal/config";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  // Maintenance routes authenticate their own scheduler bearer token.
  if (pathname === "/api/cron/job-postings" || pathname === "/api/cron/employee-activation") return NextResponse.next();
  // Careers calls these as a service (ADR-0002); each route checks the Careers caller key itself.
  if (pathname.startsWith("/api/careers/")) return NextResponse.next();
  const returnTo = `${pathname}${search}`;

  if (!devBypassEnabled() && !request.cookies.get(SESSION_COOKIE)?.value) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set("returnTo", returnTo);

    return NextResponse.redirect(login);
  }

  const headers = new Headers(request.headers);
  headers.set("x-return-to", returnTo);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/|api/portal/|api/notifications(?:/|$)|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
