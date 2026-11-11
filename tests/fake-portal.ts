import { createHash, randomBytes } from "node:crypto";
import type { Staff } from "@/lib/portal/client";

/**
 * A small stand-in for the Portal's validate contract: one handle per signed-in Staff
 * member, the Modules each holds, and the failure modes HRMS must survive.
 * It knows nothing about HRMS internals.
 */
export const FAKE_PORTAL_URL = "https://portal.test";
export const FAKE_SYSTEM = "HRMS";
export const FAKE_SECRET = "fake-system-secret-fake-system-secret";

export const FAKE_CALLBACK = "http://localhost:3001/api/portal/callback";

type Code = { callback: string; state: string; challenge: string; staff: Staff; modules: string[] };

export class FakePortal {
  private handles = new Map<string, { staff: Staff; modules: Set<string> }>();
  private central: { staff: Staff; modules: string[]; handles: Set<string> } | null = null;
  private codes = new Map<string, Code>();
  private nextHandle = 1;

  /** Staff the recipients directory lists, with the Modules each holds. */
  directory: { id: string; username: string; name?: string; modules: string[] }[] = [];

  /** The Portal cannot decide: it answers 503 until restored. */
  unavailable = false;

  /** Signs a Staff member in and returns their opaque session handle. */
  signIn(staff: Staff, modules: string[]): string {
    const handle = `handle-${this.nextHandle++}`;
    this.handles.set(handle, { staff, modules: new Set(modules) });

    return handle;
  }

  /** The browser signs in at the Portal itself; systems can then be entered through authorize. */
  signInAtPortal(staff: Staff, modules: string[]) {
    this.central = { staff, modules, handles: new Set() };
  }

  /** Every issued code is past its short life. */
  expireCodes() {
    this.codes.clear();
  }

  /** The session ends (central logout or expiry); the handle stops validating. */
  endSession(handle: string) {
    this.handles.delete(handle);
  }

  private async validate(request: Request): Promise<Response> {
    const expected = `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}`;

    if (request.headers.get("authorization") !== expected) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }

    const body = await request.json();

    if (this.unavailable) {
      return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    }

    const session = this.handles.get(body.handle);

    if (!session) {
      return Response.json({ error: "invalid_handle" }, { status: 401 });
    }

    if (!session.modules.has(body.module)) {
      return Response.json({ error: "module_not_granted" }, { status: 403 });
    }

    return Response.json({ active: true, system: FAKE_SYSTEM, module: body.module, staff: session.staff });
  }

  private async recipients(request: Request): Promise<Response> {
    const expected = `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}`;
    if (request.headers.get("authorization") !== expected) return Response.json({ error: "invalid_client" }, { status: 401 });
    if (this.unavailable) return Response.json({ error: "temporarily_unavailable" }, { status: 503 });

    return Response.json({ staff: this.directory });
  }

  private authorize(url: URL): Response {
    const p = url.searchParams;
    const callback = p.get("redirect_uri");
    const state = p.get("state");
    const challenge = p.get("code_challenge");

    if (
      p.get("system") !== FAKE_SYSTEM ||
      callback !== FAKE_CALLBACK ||
      !state ||
      !challenge ||
      p.get("code_challenge_method") !== "S256"
    ) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }

    if (!this.central) {
      const returnTo = encodeURIComponent(`${url.pathname}${url.search}`);

      return Response.redirect(`${FAKE_PORTAL_URL}/login?returnTo=${returnTo}`, 302);
    }

    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, { callback, state, challenge, staff: this.central.staff, modules: this.central.modules });

    const granted = new URL(callback);
    granted.searchParams.set("code", code);
    granted.searchParams.set("state", state);

    return Response.redirect(granted, 302);
  }

  private async exchange(request: Request): Promise<Response> {
    const expected = `Basic ${Buffer.from(`${FAKE_SYSTEM}:${FAKE_SECRET}`).toString("base64")}`;

    if (request.headers.get("authorization") !== expected) {
      return Response.json({ error: "invalid_client" }, { status: 401 });
    }

    const body = await request.json();

    if (this.unavailable) {
      return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    }

    const stored = this.codes.get(body.code);
    this.codes.delete(body.code); // single use, spent even when the proof is wrong

    const verified =
      stored &&
      stored.callback === body.redirect_uri &&
      stored.state === body.state &&
      stored.challenge === createHash("sha256").update(String(body.code_verifier)).digest("base64url");

    if (!stored || !verified || !this.central) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }

    const handle = this.signIn(stored.staff, stored.modules);
    this.central.handles.add(handle);

    return Response.json({ handle, token_type: "opaque", expires_in: 28800 });
  }

  /** Central logout: the one session ends, and with it every handle issued from it. */
  private logout(): Response {
    this.central?.handles.forEach((handle) => this.endSession(handle));
    this.central = null;

    return Response.redirect(`${FAKE_PORTAL_URL}/login`, 302);
  }

  handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    if (url.pathname === "/logout") return this.logout();
    if (url.pathname === "/api/integrations/authorize") return this.authorize(url);
    if (url.pathname === "/api/integrations/exchange") return this.exchange(request);
    if (url.pathname === "/api/integrations/recipients") return this.recipients(request);
    if (url.pathname === "/api/integrations/validate") return this.validate(request);

    return new Response("not found", { status: 404 });
  };
}

/** Routes fetches aimed at the fake Portal to it; everything else is refused. */
export function portalFetch(portal: FakePortal): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);

    if (!request.url.startsWith(FAKE_PORTAL_URL)) {
      throw new Error(`Unexpected outbound request to ${request.url}`);
    }

    return portal.handle(request);
  }) as typeof fetch;
}
