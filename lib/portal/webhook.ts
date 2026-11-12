import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * True when the request carries the system secret (`PORTAL_SYSTEM_SECRET`) as a bearer token: how the Portal authenticates
 * its webhooks to HRMS (issue #315, Portal ↔ HRMS contract). Never true when the secret is unset.
 */
export function isPortalCaller(request: Request): boolean {
  const secret = process.env.PORTAL_SYSTEM_SECRET;
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  return Boolean(secret && given && timingSafeEqual(digest(given), digest(secret)));
}
