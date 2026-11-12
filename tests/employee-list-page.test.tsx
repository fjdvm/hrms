import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ list: vi.fn(), fail: false }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => {} }));
vi.mock("@/lib/portal/employees", () => ({ employeesForRequest: async () => ({ list: async (...args: unknown[]) => { if (state.fail) throw new (await import("@/lib/employees")).EmployeeError("unavailable"); return state.list(...args); } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import Page from "@/app/(hrms)/employee-information/page";

const row = (over: Record<string, unknown>) => ({ id: 1, employeeNumber: "BR-EMP-0001", name: "Maria Santos", initials: "MS", email: "maria@example.test",
  position: "Cashier", department: "Retail", branch: "Cainta branch", startDate: "2026-11-10", documentsSubmitted: 7, documentsTotal: 7,
  documentsMissing: 0, documentsLabel: "7/7 complete", status: "Onboarding", ...over });
const listing = (rows: unknown[]) => ({ rows, counts: { all: 3, active: 1, onboarding: 2 }, summary: { employees: 3, onboarding: 2, missingDocuments: 1 }, branches: ["Cainta branch", "Main kitchen"] });

async function html(params: Record<string, string> = {}) {
  const stream = await renderToReadableStream(await Page({ searchParams: Promise.resolve(params) } as never), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}
beforeEach(() => { state.list.mockReset(); state.fail = false; });

it("shows the title, summary, tabs with counts, rows linking to the detail page, document colours, badges and the real-rule footnote", async () => {
  state.list.mockResolvedValue(listing([row({}), row({ id: 2, employeeNumber: "BR-EMP-0002", name: "Jose Reyes", documentsMissing: 1, documentsSubmitted: 6, documentsLabel: "6/7 · 1 missing", status: "Active" })]));
  const page = await html();
  expect(page).toContain("Employee information");
  expect(page).toContain("3 employees · 2 still onboarding · 1 with missing documents");
  expect(page).toContain(">All 3<");
  expect(page).toContain(">Active 1<");
  expect(page).toContain(">Onboarding 2<");
  expect(page).toContain("/employee-information?status=Active");
  expect(page).toContain('href="/employee-information/1"');
  expect(page).toContain("BR-EMP-0002");
  expect(page).toContain("7/7 complete");
  expect(page).toContain("6/7 · 1 missing");
  expect(page).toContain("text-[#15803d]");
  expect(page).toContain("text-[#8a5a00]");
  expect(page).toContain("bg-badge-info");
  expect(page).toContain("bg-badge-success");
  expect(page).toContain("their account exists");
  expect(page).toContain("start date has arrived");
  expect(page).not.toContain("checklist");
  expect(page).toContain("All branches");
  expect(page).toContain("Search name or ID");
  expect(state.list).toHaveBeenCalledWith({ status: undefined, branch: undefined, search: undefined });
});

it("passes the tab, Branch and search from the URL, and says when nothing matches", async () => {
  state.list.mockResolvedValue(listing([]));
  const page = await html({ status: "Onboarding", branch: "Main kitchen", q: "zzz" });
  expect(state.list).toHaveBeenCalledWith({ status: "Onboarding", branch: "Main kitchen", search: "zzz" });
  expect(page).toContain("No employees match these filters.");
  expect(page).toContain("Clear filters");
  expect(page).toContain("Branch:");
  expect(page).toContain("Main kitchen");
});

it("shows a friendly empty state when no one has been hired", async () => {
  state.list.mockResolvedValue(listing([]));
  const page = await html();
  expect(page).toContain("No one has been hired yet.");
  expect(page).not.toContain("Clear filters");
});

it("shows an alert, not a crash, when the list cannot load", async () => {
  state.fail = true;
  const page = await html();
  expect(page).toContain("The employee list could not be loaded");
  expect(page).toContain('role="alert"');
});
