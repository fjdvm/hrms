import { cache } from "react";
import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor } from "./access";
import type { Staff } from "./client";
import { LOGIN_PATH, NO_ACCESS_PATH, SESSION_COOKIE, UNAVAILABLE_PATH } from "./config";
import { safeReturnTo } from "./return-to";

/** One access checker per page load, so the Portal is asked once however many callers there are. */
const requestAccess = cache(async () => {
  // Access is per request, never decided at build time.
  await connection();

  return accessFor((await cookies()).get(SESSION_COOKIE)?.value);
});

/** Stops the request when the Portal can't answer or the session is gone; otherwise hands the answer back. */
async function proceed<T extends { decision: string }>(
  result: T,
): Promise<Exclude<T, { decision: "invalid" | "unavailable" }>> {
  if (result.decision === "unavailable" || result.decision === "invalid") {
    const returnTo = encodeURIComponent(safeReturnTo((await headers()).get("x-return-to")));

    redirect(
      result.decision === "unavailable"
        ? `${UNAVAILABLE_PATH}?returnTo=${returnTo}`
        : `${LOGIN_PATH}?returnTo=${returnTo}`,
    );
  }

  return result as Exclude<T, { decision: "invalid" | "unavailable" }>;
}

/**
 * Call at the top of every page. Layouts do not re-run on client navigation, so the page
 * itself must prove the Staff member holds its Module.
 */
export async function requireModule(module: string): Promise<Staff> {
  const result = await proceed(await (await requestAccess()).check(module));

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return result.staff;
}

/**
 * Like `requireModule`, but a Staff member without the Module gets `null` instead of a redirect, so the page can show
 * its own in-shell "No access" screen. Sign-in and Portal problems still stop the request.
 */
export async function staffWithModule(module: string): Promise<Staff | null> {
  const result = await proceed(await (await requestAccess()).check(module));

  return result.decision === "denied" ? null : result.staff;
}

/** The Staff member and the pages they may open, for the shell. No Module at all means no access. */
export async function getShell(): Promise<{ staff: Staff; permittedPages: string[] }> {
  const result = await proceed(await (await requestAccess()).overview());

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return { staff: result.staff, permittedPages: result.pages };
}

/** Where `/` goes: the first page the Staff member may open, or the "no access" page. */
export async function homePage(): Promise<string> {
  const result = await proceed(await (await requestAccess()).overview());

  return result.decision === "allowed" ? result.pages[0] : NO_ACCESS_PATH;
}
