import { portalConfig } from "./config";

/**
 * HRMS → Portal side of the Account request contract (issue #315, comment "Portal ↔ HRMS contract").
 * The contract names the calls but not their paths; these follow the Portal's existing `/api/integrations/*` pattern.
 * Change them here, and tell the Portal developer, if the Portal chose differently.
 */
export const ACCOUNT_REQUEST_OPTIONS_PATH = "/api/integrations/account-requests/options";
export const ACCOUNT_REQUESTS_PATH = "/api/integrations/account-requests";
export const accountRequestActionPath = (reference: string, action: "remind" | "cancel") =>
  `${ACCOUNT_REQUESTS_PATH}/${encodeURIComponent(reference)}/${action}`;

export type PortalId = string | number;
export type PortalRole = { id: PortalId; name: string; moduleIds: PortalId[] };
export type PortalSystem = { id: PortalId; name: string; modules: { id: PortalId; name: string }[] };
export type AccountRequestOptions = { roles: PortalRole[]; systems: PortalSystem[] };

export type AccountRequestPayload = {
  reference: string;
  employee: { name: string; workEmail: string; personalEmail: string; mobile: string | null; position: string; branch: string; startDate: string };
  roleId: PortalId;
  moduleIds: PortalId[];
  neededFrom: string;
  note: string | null;
  requestedBy: { name: string };
};

export type SendResult = { ok: true } | { ok: false; reason: "email-taken" | "unavailable" };

async function call(path: string, method: "GET" | "POST", body?: unknown): Promise<Response | null> {
  const { portalUrl, systemName, systemSecret } = portalConfig();
  try {
    return await fetch(`${portalUrl}${path}`, {
      method,
      headers: {
        authorization: `Basic ${Buffer.from(`${systemName}:${systemSecret}`).toString("base64")}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
}

const isId = (value: unknown): value is PortalId => (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
const isName = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

/** The Roles (with their access-template Modules) and the Modules per system. `null` means the Portal could not give a usable answer. */
export async function fetchAccountRequestOptions(): Promise<AccountRequestOptions | null> {
  const response = await call(ACCOUNT_REQUEST_OPTIONS_PATH, "GET");
  if (!response?.ok) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== "object") return null;
  const { roles, systems } = body as { roles?: unknown; systems?: unknown };
  if (!Array.isArray(roles) || !Array.isArray(systems)) return null;
  const parsedRoles: PortalRole[] = [];
  for (const role of roles) {
    if (!role || typeof role !== "object" || !isId(role.id) || !isName(role.name) || !Array.isArray(role.moduleIds) || !role.moduleIds.every(isId)) return null;
    parsedRoles.push({ id: role.id, name: role.name.trim(), moduleIds: role.moduleIds });
  }
  const parsedSystems: PortalSystem[] = [];
  for (const system of systems) {
    if (!system || typeof system !== "object" || !isId(system.id) || !isName(system.name) || !Array.isArray(system.modules)) return null;
    const modules: PortalSystem["modules"] = [];
    for (const entry of system.modules) {
      if (!entry || typeof entry !== "object" || !isId(entry.id) || !isName(entry.name)) return null;
      modules.push({ id: entry.id, name: entry.name.trim() });
    }
    parsedSystems.push({ id: system.id, name: system.name.trim(), modules });
  }
  return { roles: parsedRoles, systems: parsedSystems };
}

/** Sends a request. The Portal treats `reference` as an idempotency key. Only a 2xx means it was accepted. */
export async function sendAccountRequest(payload: AccountRequestPayload): Promise<SendResult> {
  const response = await call(ACCOUNT_REQUESTS_PATH, "POST", payload);
  if (!response) return { ok: false, reason: "unavailable" };
  if (response.ok) return { ok: true };
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (body?.error === "email-taken") return { ok: false, reason: "email-taken" };
  }
  return { ok: false, reason: "unavailable" };
}

/** The Portal's answer to a remind or cancel. `conflict` means the account already exists (or the request is closed): `status` is the Portal's own status, and it wins. */
export type ActionResult = { ok: true } | { ok: false; reason: "unavailable" } | { ok: false; reason: "conflict"; status: string };

async function act(reference: string, action: "remind" | "cancel"): Promise<ActionResult> {
  const response = await call(accountRequestActionPath(reference, action), "POST", {});
  if (!response) return { ok: false, reason: "unavailable" };
  if (response.ok) return { ok: true };
  if (response.status === 409) {
    const body = (await response.json().catch(() => null)) as { status?: unknown } | null;
    if (typeof body?.status === "string" && body.status.trim() !== "") return { ok: false, reason: "conflict", status: body.status };
  }
  return { ok: false, reason: "unavailable" };
}

/** Nudges the Portal's administrators about an open request. */
export const remindAccountRequest = (reference: string) => act(reference, "remind");
/** Withdraws an open request. */
export const cancelAccountRequest = (reference: string) => act(reference, "cancel");
