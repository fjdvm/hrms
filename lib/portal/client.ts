import { portalConfig } from "./config";

export type Staff = {
  /** Portal user id; older Portal deployments omit it, so username remains available. */
  id?: string;
  name: string;
  username: string;
  email: string;
  role: string;
};

export type Validation =
  | { decision: "allowed"; staff: Staff }
  | { decision: "invalid" }
  | { decision: "denied" }
  | { decision: "unavailable" };

export type ExchangeResult =
  | { ok: true; sessionHandle: string; expiresAt: Date }
  | { ok: false; reason: "rejected" | "denied" | "unavailable" };

async function postJson(path: string, body: unknown): Promise<Response | null> {
  const { portalUrl, systemName, systemSecret } = portalConfig();

  try {
    return await fetch(`${portalUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${systemName}:${systemSecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

/** Server-to-server exchange of the single-use sign-in code for an opaque session handle. */
export async function exchangeCode(input: {
  code: string;
  state: string;
  codeVerifier: string;
}): Promise<ExchangeResult> {
  const response = await postJson("/api/integrations/exchange", {
    code: input.code,
    state: input.state,
    code_verifier: input.codeVerifier,
    redirect_uri: portalConfig().callbackUrl,
  });

  if (!response || response.status >= 500) {
    return { ok: false, reason: "unavailable" };
  }

  if (response.status === 403) {
    return { ok: false, reason: "denied" };
  }

  const body = response.ok
    ? ((await response.json().catch(() => null)) as { handle?: string; expires_in?: number } | null)
    : null;

  if (!body?.handle || typeof body.expires_in !== "number") {
    return { ok: false, reason: "rejected" };
  }

  return {
    ok: true,
    sessionHandle: body.handle,
    expiresAt: new Date(Date.now() + body.expires_in * 1000),
  };
}

/**
 * Asks the Portal whether the handle may use a Module right now. The 200 body also carries
 * the Staff member's profile (`staff`), optionally including their Portal user id.
 * Anything other than a clear answer is `unavailable`, which never allows.
 */
export async function validateSession(sessionHandle: string, module: string): Promise<Validation> {
  const response = await postJson("/api/integrations/validate", {
    handle: sessionHandle,
    module,
  });

  if (!response) {
    return { decision: "unavailable" };
  }

  if (response.status === 401) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    return { decision: body?.error === "invalid_handle" ? "invalid" : "unavailable" };
  }

  if (response.status === 403) {
    return { decision: "denied" };
  }

  const body = response.ok
    ? ((await response.json().catch(() => null)) as { active?: boolean; staff?: Staff } | null)
    : null;

  return body?.active === true && body.staff
    ? { decision: "allowed", staff: body.staff }
    : { decision: "unavailable" };
}

/**
 * Portal user ids of the Staff who currently hold a Module in HRMS (System backend call, no
 * browser session). `null` means the Portal could not answer, so the caller must retry later.
 */
export async function listModuleHolders(module: string): Promise<string[] | null> {
  const response = await postJson("/api/integrations/recipients", {});

  if (!response?.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as { staff?: { id?: unknown; modules?: unknown }[] } | null;

  if (!Array.isArray(body?.staff)) {
    return null;
  }

  return body.staff.flatMap((member) =>
    typeof member.id === "string" && Array.isArray(member.modules) && member.modules.includes(module) ? [member.id] : [],
  );
}

/** Names of the Staff the Portal lists, for the "Reports to" picker. `null` means the Portal could not answer. */
export async function listStaffNames(): Promise<string[] | null> {
  const response = await postJson("/api/integrations/recipients", {});

  if (!response?.ok) {
    return null;
  }

  const body = (await response.json().catch(() => null)) as { staff?: { name?: unknown; username?: unknown }[] } | null;

  if (!Array.isArray(body?.staff)) {
    return null;
  }

  const names = body.staff.flatMap((member) => {
    const name = typeof member.name === "string" && member.name.trim() ? member.name : member.username;
    return typeof name === "string" && name.trim() ? [name.trim()] : [];
  });

  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
