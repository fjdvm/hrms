import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@/lib/portal/access";
import { MODULES } from "@/lib/modules";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const ada = {
  name: "Ada Okafor",
  username: "ada.okafor",
  email: "ada@brenraphaels.test",
  role: "HR Officer",
};
const ALL = MODULES.map((m) => m.name);

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const access = (handle: string | undefined) => accessFor(handle, { bypass: false });

describe("access to a Module", () => {
  it("is allowed with the Module, and says who the Staff member is", async () => {
    const handle = portal.signIn(ada, ["Training"]);

    expect(await access(handle).check("Training")).toEqual({ decision: "allowed", staff: ada });
  });

  it("carries the Portal user id through Module access and the permitted-page overview", async () => {
    const staff = { ...ada, id: "portal-user-105" };
    const handle = portal.signIn(staff, ["Training"]);
    const load = access(handle);

    expect(await load.check("Training")).toEqual({ decision: "allowed", staff });
    expect(await load.overview()).toEqual({ decision: "allowed", staff, pages: ["/training"] });
  });

  it("keeps the username identity when an older Portal omits the user id", async () => {
    const handle = portal.signIn(ada, ["Training"]);
    const result = await access(handle).check("Training");

    expect(result).toEqual({ decision: "allowed", staff: ada });
    if (result.decision === "allowed") {
      expect(result.staff.id ?? result.staff.username).toBe("ada.okafor");
    }
  });

  it("does not grant access based on the presence of a Portal user id", async () => {
    const handle = portal.signIn({ ...ada, id: "portal-user-105" }, ["Training"]);

    expect(await access(handle).check("Performance")).toEqual({ decision: "denied" });
    portal.unavailable = true;
    expect(await access(handle).check("Training")).toEqual({ decision: "unavailable" });
    portal.unavailable = false;
    portal.endSession(handle);
    expect(await access(handle).check("Training")).toEqual({ decision: "invalid" });
  });

  it("is denied without the Module, even holding a different one", async () => {
    const handle = portal.signIn(ada, ["Training"]);

    expect((await access(handle).check("Performance")).decision).toBe("denied");
  });

  it("is invalid with no session, an unknown handle, or an ended session", async () => {
    const handle = portal.signIn(ada, ALL);
    portal.endSession(handle);

    expect((await access(undefined).check("Dashboard")).decision).toBe("invalid");
    expect((await access("made-up").check("Dashboard")).decision).toBe("invalid");
    expect((await access(handle).check("Dashboard")).decision).toBe("invalid");
  });

  it("is unavailable, never allowed, when the Portal cannot answer", async () => {
    const handle = portal.signIn(ada, ALL);
    portal.unavailable = true;

    expect((await access(handle).check("Dashboard")).decision).toBe("unavailable");
    expect((await access(handle).overview()).decision).toBe("unavailable");
  });

  it("is unavailable when the Portal cannot be reached at all", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("network down")));

    expect((await access("any").check("Dashboard")).decision).toBe("unavailable");
  });

  it("asks the Portal once per Module for the whole page load", async () => {
    const handle = portal.signIn(ada, ALL);
    const fetchSpy = vi.fn(portalFetch(portal));
    vi.stubGlobal("fetch", fetchSpy);
    const load = access(handle);

    await load.overview();
    await load.check("Training");
    await load.check("Dashboard");

    expect(fetchSpy).toHaveBeenCalledTimes(MODULES.length);
  });
});

describe("the overview of permitted pages", () => {
  it("lists only the granted Modules' pages, in Module order", async () => {
    const handle = portal.signIn(ada, ["Performance", "Training"]);

    expect(await access(handle).overview()).toEqual({
      decision: "allowed",
      staff: ada,
      pages: ["/training", "/performance"],
    });
  });

  it("lists every page for Staff granted every Module", async () => {
    const handle = portal.signIn(ada, ALL);

    expect(await access(handle).overview()).toMatchObject({
      pages: MODULES.map((m) => m.href),
    });
  });

  it("is denied for Staff with no Module granted", async () => {
    const handle = portal.signIn(ada, []);

    expect(await access(handle).overview()).toEqual({ decision: "denied" });
  });

  it("is invalid for an ended session", async () => {
    const handle = portal.signIn(ada, ALL);
    portal.endSession(handle);

    expect(await access(handle).overview()).toEqual({ decision: "invalid" });
  });
});
