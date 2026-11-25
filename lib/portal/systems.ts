import { cookies } from "next/headers";
import { devBypassEnabled } from "./dev-bypass";
import { SESSION_COOKIE, portalConfig } from "./config";

const ALL_SYSTEMS = ["CRMS", "HRMS", "POS", "IMS"];

/**
 * The Systems the signed-in person holds an Admin-granted access in, asked of the Portal now.
 * Null when it cannot be known (no session, Portal unreachable or refusing); callers then show
 * only the Enterprise Portal and the System that is already open.
 */
export async function accessibleSystems(): Promise<string[] | null> {
  if (devBypassEnabled()) return ALL_SYSTEMS;

  const handle = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!handle) return null;

  try {
    const { portalUrl, systemSecret } = portalConfig();
    const response = await fetch(`${portalUrl}/api/integrations/systems`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${portalConfig().systemName}:${systemSecret}`).toString("base64")}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ handle }),
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as { systems?: unknown } | null;

    return Array.isArray(body?.systems) ? body.systems.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}
