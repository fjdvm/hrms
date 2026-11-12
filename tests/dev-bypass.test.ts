import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "@/instrumentation";
import { accessFor } from "@/lib/portal/access";
import { DEV_STAFF, devBypassEnabled } from "@/lib/portal/dev-bypass";
import { MODULES } from "@/lib/modules";

afterEach(() => vi.unstubAllEnvs());

const on = { HRMS_DEV_BYPASS: "true" } as const;

describe("dev bypass", () => {
  it("is off unless explicitly switched on", () => {
    expect(devBypassEnabled({})).toBe(false);
    expect(devBypassEnabled({ HRMS_DEV_BYPASS: "false" })).toBe(false);
  });

  it("is on outside production for a local origin", () => {
    expect(devBypassEnabled({ ...on, NODE_ENV: "development" })).toBe(true);
    expect(
      devBypassEnabled({ ...on, NODE_ENV: "test", HRMS_APP_URL: "http://localhost:3001" }),
    ).toBe(true);
    expect(devBypassEnabled({ ...on, HRMS_APP_URL: "http://127.0.0.1:3001" })).toBe(true);
  });

  it("refuses to start in production", () => {
    expect(() => devBypassEnabled({ ...on, NODE_ENV: "production" })).toThrow(/production/);
  });

  it("refuses to start with a non-localhost address configured", () => {
    expect(() =>
      devBypassEnabled({
        ...on,
        NODE_ENV: "development",
        HRMS_APP_URL: "https://hrms-arae.vercel.app",
      }),
    ).toThrow(/HRMS_APP_URL/);
  });

  it("treats an unset address as localhost, and refuses the deployed one", () => {
    expect(devBypassEnabled({ ...on, NODE_ENV: "development" })).toBe(true);
    expect(() =>
      devBypassEnabled({ ...on, NODE_ENV: "development", HRMS_APP_URL: "https://hrms-arae.vercel.app" }),
    ).toThrow(/HRMS_APP_URL/);
  });

  it("refuses to start on a Vercel deployment", () => {
    expect(() =>
      devBypassEnabled({ ...on, NODE_ENV: "development", VERCEL_ENV: "preview" }),
    ).toThrow(/Vercel/);
  });

  it("stops the server from starting when the environment is unsafe", () => {
    vi.stubEnv("HRMS_DEV_BYPASS", "true");
    vi.stubEnv("NODE_ENV", "production");

    expect(() => register()).toThrow(/production/);
  });

  it("opens every Module as a fully-permitted Staff member, with no session and no Portal", async () => {
    const access = accessFor(undefined, { bypass: true });

    expect(await access.check("Training")).toEqual({ decision: "allowed", staff: DEV_STAFF });
    expect(await access.overview()).toEqual({
      decision: "allowed",
      staff: DEV_STAFF,
      pages: MODULES.map((m) => m.href),
    });
  });

  it("allows nothing without the bypass and without a session", async () => {
    const access = accessFor(undefined, { bypass: false });

    expect(await access.check("Dashboard")).toEqual({ decision: "invalid" });
    expect(await access.overview()).toEqual({ decision: "invalid" });
  });
});
