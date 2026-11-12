import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callback } from "@/app/api/portal/callback/route";
import { GET as login } from "@/app/api/portal/login/route";
import { POST as logout } from "@/app/api/portal/logout/route";
import { validateSession } from "@/lib/portal/client";
import { HANDOFF_COOKIE, SESSION_COOKIE } from "@/lib/portal/config";
import { proxy } from "@/proxy";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const APP = "http://localhost:3001";
const ada = { name: "Ada Okafor", username: "ada.okafor", email: "ada@brenraphaels.test", role: "HR Officer" };

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_APP_URL", APP);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** A browser's cookie jar, filled from Set-Cookie headers. */
class Browser {
  jar = new Map<string, string>();

  request(url: string) {
    const cookie = [...this.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");

    return new NextRequest(url, { headers: cookie ? { cookie } : {} });
  }

  keep(response: Response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const [name, ...rest] = pair.split("=");
      const value = decodeURIComponent(rest.join("="));
      if (value) this.jar.set(name, value);
      else this.jar.delete(name);
    }
  }

  location(response: Response) {
    return new URL(response.headers.get("location")!, APP);
  }
}

/** Opens a page without a session and follows the redirects up to the Portal's authorize step. */
function startHandoff(browser: Browser, page: string) {
  const gated = proxy(browser.request(`${APP}${page}`));
  const toPortal = login(browser.request(browser.location(gated).toString()));
  browser.keep(toPortal);

  return { gated, authorizeUrl: toPortal.headers.get("location")! };
}

/** Signs in at the Portal and returns through the callback. */
async function signInThrough(browser: Browser, page: string) {
  const { authorizeUrl } = startHandoff(browser, page);
  portal.signInAtPortal(ada, ["Training"]);
  const granted = await portal.handle(new Request(authorizeUrl));
  const landed = await callback(browser.request(granted.headers.get("location")!));
  browser.keep(landed);

  return { landed, granted };
}

const sessionSet = (response: Response) => response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`));

describe("a request with no session", () => {
  it("is sent to the Portal with the requested page preserved", () => {
    const browser = new Browser();
    const { gated, authorizeUrl } = startHandoff(browser, "/training?week=2");

    expect(browser.location(gated).pathname).toBe("/api/portal/login");
    expect(browser.location(gated).searchParams.get("returnTo")).toBe("/training?week=2");
    expect(authorizeUrl.startsWith(`${FAKE_PORTAL_URL}/api/integrations/authorize`)).toBe(true);
    expect(new URL(authorizeUrl).searchParams.get("redirect_uri")).toBe(`${APP}/api/portal/callback`);
  });

  it.each(["//evil.test", "https://evil.test", "/\\evil.test", "/\t/evil.test"])("never returns to %j", (value) => {
    const browser = new Browser();
    browser.keep(login(browser.request(`${APP}/api/portal/login?returnTo=${encodeURIComponent(value)}`)));

    expect(JSON.parse(browser.jar.get(HANDOFF_COOKIE)!).returnTo).toBe("/");
  });
});

describe("completing sign-in", () => {
  it("returns to the page asked for, holding only the opaque handle in an HttpOnly cookie", async () => {
    const browser = new Browser();
    const { landed } = await signInThrough(browser, "/training?week=2");

    expect(browser.location(landed).pathname + browser.location(landed).search).toBe("/training?week=2");

    const cookie = landed.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toContain(FAKE_SECRET);
    expect(landed.headers.get("location")).not.toContain(FAKE_SECRET);

    expect(proxy(browser.request(`${APP}/training`)).headers.get("location")).toBeNull();
    expect((await validateSession(browser.jar.get(SESSION_COOKIE)!, "Training")).decision).toBe("allowed");
  });

  it("sends a visitor not yet signed in at the Portal to its login and back to authorize", async () => {
    const browser = new Browser();
    const { authorizeUrl } = startHandoff(browser, "/training");

    const toLogin = await portal.handle(new Request(authorizeUrl));
    const back = new URL(new URL(toLogin.headers.get("location")!).searchParams.get("returnTo")!, FAKE_PORTAL_URL);

    expect(back.pathname).toBe("/api/integrations/authorize");
    expect(back.searchParams.get("state")).toBe(new URL(authorizeUrl).searchParams.get("state"));
  });

  it("rejects a replayed code and creates no session", async () => {
    const browser = new Browser();
    const { granted } = await signInThrough(browser, "/training");
    const target = granted.headers.get("location")!;

    const replayer = new Browser();
    startHandoff(replayer, "/training");
    const replay = await callback(replayer.request(target));

    expect(replay.headers.get("location")).toContain("/sign-in-error");
    expect(sessionSet(replay)).toBe(false);
  });

  it("rejects an expired code", async () => {
    const browser = new Browser();
    const { authorizeUrl } = startHandoff(browser, "/training");
    portal.signInAtPortal(ada, ["Training"]);
    const granted = await portal.handle(new Request(authorizeUrl));
    portal.expireCodes();

    const response = await callback(browser.request(granted.headers.get("location")!));

    expect(browser.location(response).pathname).toBe("/sign-in-error");
    expect(sessionSet(response)).toBe(false);
  });

  it("rejects a code redeemed with the wrong PKCE verifier", async () => {
    const browser = new Browser();
    const { authorizeUrl } = startHandoff(browser, "/training");
    portal.signInAtPortal(ada, ["Training"]);
    const granted = await portal.handle(new Request(authorizeUrl));
    const forged = new Browser();
    forged.jar.set(HANDOFF_COOKIE, JSON.stringify({ ...JSON.parse(browser.jar.get(HANDOFF_COOKIE)!), verifier: "wrong" }));

    const response = await callback(forged.request(granted.headers.get("location")!));

    expect(forged.location(response).pathname).toBe("/sign-in-error");
    expect(sessionSet(response)).toBe(false);
  });

  it("rejects an unknown state", async () => {
    const browser = new Browser();
    startHandoff(browser, "/training");

    const response = await callback(browser.request(`${APP}/api/portal/callback?code=anything&state=forged`));

    expect(browser.location(response).pathname).toBe("/sign-in-error");
    expect(sessionSet(response)).toBe(false);
  });

  it("rejects a callback with no sign-in in progress", async () => {
    const response = await callback(new Browser().request(`${APP}/api/portal/callback?code=c&state=s`));

    expect(new URL(response.headers.get("location")!).pathname).toBe("/sign-in-error");
  });

  it("shows the sign-in error when the Portal refuses", async () => {
    const browser = new Browser();
    startHandoff(browser, "/training");

    const response = await callback(browser.request(`${APP}/api/portal/callback?error=access_denied&state=x`));

    expect(browser.location(response).search).toBe("?reason=denied");
  });

  it("shows the sign-in error when the exchange cannot be made", async () => {
    const browser = new Browser();
    const { authorizeUrl } = startHandoff(browser, "/training");
    portal.signInAtPortal(ada, ["Training"]);
    const granted = await portal.handle(new Request(authorizeUrl));
    portal.unavailable = true;

    const response = await callback(browser.request(granted.headers.get("location")!));

    expect(browser.location(response).search).toBe("?reason=unavailable");
    expect(sessionSet(response)).toBe(false);
  });
});

describe("signing out", () => {
  it("clears the session cookie and ends the Portal session", async () => {
    const browser = new Browser();
    await signInThrough(browser, "/training");
    const handle = browser.jar.get(SESSION_COOKIE)!;

    const response = logout();
    browser.keep(response);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${FAKE_PORTAL_URL}/logout`);
    expect(browser.jar.has(SESSION_COOKIE)).toBe(false);

    // The browser follows the redirect to the Portal's logout.
    await portal.handle(new Request(response.headers.get("location")!));

    expect((await validateSession(handle, "Training")).decision).toBe("invalid");
  });
});
