import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined, returnTo: "/performance" }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => ({ get: () => state.returnTo }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));

import { getShell, homePage, requireModule } from "@/lib/portal/staff";
import { MODULES } from "@/lib/modules";

const ada = { name: "Ada Okafor", username: "ada.okafor", email: "ada@brenraphaels.test", role: "HR Officer" };

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  state.cookie = undefined;
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a Staff member granted only Attendance", () => {
  beforeEach(() => {
    state.cookie = portal.signIn(ada, ["Training"]);
  });

  it("sees only Attendance in the shell, and the root goes to Attendance", async () => {
    expect(await getShell()).toEqual({ staff: ada, permittedPages: ["/training"] });
    expect(await homePage()).toBe("/training");
  });

  it("opens Attendance but is sent to no-access for a denied Module's URL", async () => {
    expect(await requireModule("Training")).toEqual(ada);
    await expect(requireModule("Performance")).rejects.toThrow("REDIRECT /no-access");
  });
});

describe("a Staff member with no Module granted", () => {
  it("sees the no-access page", async () => {
    state.cookie = portal.signIn(ada, []);

    await expect(getShell()).rejects.toThrow("REDIRECT /no-access");
    expect(await homePage()).toBe("/no-access");
  });
});

describe("a Portal outage", () => {
  it("shows the unavailable page with a way back, and never allows", async () => {
    state.cookie = portal.signIn(ada, ["Performance"]);
    portal.unavailable = true;

    await expect(requireModule("Performance")).rejects.toThrow(
      "REDIRECT /unavailable?returnTo=%2Fperformance",
    );
    await expect(getShell()).rejects.toThrow("REDIRECT /unavailable");
  });
});

describe("an invalid or expired session", () => {
  it("restarts sign-in and comes back to the page asked for", async () => {
    state.cookie = portal.signIn(ada, ["Performance"]);
    portal.endSession(state.cookie);

    await expect(requireModule("Performance")).rejects.toThrow(
      "REDIRECT /api/portal/login?returnTo=%2Fperformance",
    );
  });

  it("restarts sign-in when there is no session at all", async () => {
    await expect(getShell()).rejects.toThrow("REDIRECT /api/portal/login");
  });

  it("never returns to an address outside HRMS", async () => {
    state.returnTo = "//evil.example";

    await expect(getShell()).rejects.toThrow("REDIRECT /api/portal/login?returnTo=%2F");
  });
});

describe("the dev-bypass", () => {
  it("allows every Module on localhost", async () => {
    vi.stubEnv("HRMS_DEV_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "development");

    expect(await homePage()).toBe("/dashboard");
    expect((await getShell()).permittedPages).toHaveLength(MODULES.length);
  });
});
