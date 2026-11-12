import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULES } from "@/lib/modules";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (state.cookie ? { value: state.cookie } : undefined) }),
  headers: async () => ({ get: () => "/" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const ada = { name: "Ada Okafor", username: "ada.okafor", email: "ada@brenraphaels.test", role: "HR Officer" };
const ALL = MODULES.map((m) => m.name as string);

/** Every page and the one Module that opens it. */
const PAGES: [path: string, module: string][] = [
  ["dashboard", "Dashboard"],
  ["job-postings", "Job Postings"],
  ["job-postings/new", "Job Postings"],
  ["job-postings/[id]", "Job Postings"],
  ["job-templates", "Job Postings"],
  ["job-templates/new", "Job Postings"],
  ["job-templates/[id]", "Job Postings"],
  ["applicants", "Applications"],
  ["applicants/[id]", "Applications"],
  ["interviews", "Interviews"],
  ["interviews/[jobPostingId]", "Interviews"],
  ["offers", "Offers"],
  ["offers/new", "Offers"],
  ["offers/[id]", "Offers"],
  ["offers/[id]/edit", "Offers"],
  ["employee-information", "Employee Information"],
  ["employee-information/[id]", "Employee Information"],
  ["employee-onboarding", "Employee Onboarding"],
  ["training", "Training"],
  ["performance", "Performance"],
];

const props = { params: Promise.resolve({ id: "1", jobPostingId: "a" }), searchParams: Promise.resolve({}) };
const pageFiles = import.meta.glob<{ default: (props: unknown) => Promise<unknown> }>("../app/[(]hrms[)]/**/page.tsx");
const run = async (path: string) => {
  const { default: Page } = await pageFiles[`../app/(hrms)/${path}/page.tsx`]();
  return Page(props).then(() => null, (error: Error) => error.message);
};

let portal: FakePortal;

beforeEach(() => {
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Module access to each page", { timeout: 60_000 }, () => {
  it("covers every page that exists", async () => {
    const found = Object.keys(pageFiles).map((file) => file.replace("../app/(hrms)/", "").replace("/page.tsx", ""));
    expect(found.sort()).toEqual(PAGES.map(([path]) => path).sort());
  });

  it.each(PAGES)("%s is closed to Staff holding every Module except %s's", async (path, module) => {
    state.cookie = portal.signIn(ada, ALL.filter((name) => name !== module));
    expect(await run(path)).toBe("REDIRECT /no-access");
  });

  it.each(PAGES)("%s opens for Staff holding only %s's Module", async (path, module) => {
    state.cookie = portal.signIn(ada, [module]);
    expect(await run(path)).not.toBe("REDIRECT /no-access");
  });

  it("no longer knows the dropped Modules", () => {
    expect(ALL).toEqual([
      "Dashboard", "Job Postings", "Applications", "Interviews", "Offers",
      "Employee Information", "Employee Onboarding", "Training", "Performance",
    ]);
  });
});
