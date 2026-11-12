import { renderToReadableStream } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ onboarding: vi.fn(), fail: false }));
vi.mock("@/lib/portal/staff", () => ({ requireModule: async () => {} }));
vi.mock("@/lib/portal/employees", () => ({ employeesForRequest: async () => ({ onboarding: async (...args: unknown[]) => { if (state.fail) throw new (await import("@/lib/employees")).EmployeeError("unavailable"); return state.onboarding(...args); } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import Page from "@/app/(hrms)/employee-onboarding/page";

const row = (over: Record<string, unknown>) => ({ id: 1, employeeNumber: "BR-EMP-0058", name: "Ellaine Torres", initials: "ET", position: "Branch Cashier", branch: "Cainta branch",
  startDate: "2026-11-10", workEmail: "ellaine.torres@brenraphaels.ph", accountState: "Not requested", requestReference: null, requestStatus: null, overdue: false,
  becomesActiveOn: null, actions: ["request", "no-account-needed"], requestedAt: null, accountCreatedAt: null, accountCreatedBy: null, ...over });
const rows = [
  row({}),
  row({ id: 3, employeeNumber: "BR-EMP-0057", name: "Rafael Santiago", accountState: "Requested", requestedAt: "2026-11-12T03:00:00Z", workEmail: "rafael.santiago@brenraphaels.ph", actions: ["remind", "cancel"] }),
  row({ id: 4, employeeNumber: "BR-EMP-0056", name: "Angelica Ramos", accountState: "Account created", accountCreatedAt: "2026-11-05T03:00:00Z", accountCreatedBy: "Admin", actions: [] }),
  row({ id: 5, employeeNumber: "BR-EMP-0055", name: "Paolo Garcia", accountState: "Account created", becomesActiveOn: "2026-12-01", actions: [] }),
];
const listing = (list: unknown[], canAct = true) => ({ rows: list, counts: { all: 4, needsAccount: 2, requested: 1, accountCreated: 1, noAccountNeeded: 0 },
  summary: { needsAccount: 2, requested: 1, accountCreated: 1 }, canAct });

async function html(params: Record<string, string> = {}) {
  const stream = await renderToReadableStream(await Page({ searchParams: Promise.resolve(params) } as never), { onError: () => {} });
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}
beforeEach(() => { state.onboarding.mockReset(); state.fail = false; });

it("shows the title, summary line, three cards, tabs with counts, search, table and footnote", async () => {
  state.onboarding.mockResolvedValue(listing(rows));
  const page = await html();
  expect(page).toContain("Onboarding");
  expect(page).toContain("4 new hires · 2 need a user account");
  expect(page).toContain("Needs account");
  expect(page).toContain("Requested, waiting for admin");
  for (const tab of [">All 4<", ">Needs account 2<", ">Requested 1<", ">Account created 1<", ">No account needed 0<"]) expect(page).toContain(tab);
  expect(page).toContain("/employee-onboarding?status=needs-account");
  expect(page).toContain("Search new hires");
  expect(page).toContain("BR-EMP-0058");
  expect(page).toContain("10 Nov 2026");
  expect(page).toContain("ellaine.torres@brenraphaels.ph");
  expect(page).toContain("Request user account");
  expect(page).toContain("sends the new hire’s details to the admin portal");
  expect(page).not.toContain("Set as Active");
  expect(state.onboarding).toHaveBeenCalledWith({ state: undefined, search: undefined });
});

it("describes each account state: not requested, requested with sent date, created with date and who, and becomes Active", async () => {
  state.onboarding.mockResolvedValue(listing(rows));
  const page = await html();
  expect(page).toContain("No account yet");
  expect(page).toContain("Sent 12 Nov · waiting for admin");
  expect(page).toContain("View request");
  expect(page).toContain("Created 5 Nov by Admin");
  expect(page).toContain("Becomes Active on 1 Dec 2026");
});

it("is read-only for holders without an acting role: no action buttons", async () => {
  state.onboarding.mockResolvedValue(listing(rows.map((r) => ({ ...r, actions: [] })), false));
  const page = await html();
  expect(page).toContain("Ellaine Torres");
  expect(page).not.toContain("Request user account</button>");
  expect(page).not.toContain("View request");
  expect(page).not.toContain(">Action<");
});

it("passes the tab and search from the URL and says when nothing matches", async () => {
  state.onboarding.mockResolvedValue(listing([]));
  const page = await html({ status: "requested", q: "zzz" });
  expect(state.onboarding).toHaveBeenCalledWith({ state: "Requested", search: "zzz" });
  expect(page).toContain("No new hires match these filters.");
  expect(page).toContain("Clear filters");
  await html({ status: "bogus" });
  expect(state.onboarding).toHaveBeenLastCalledWith({ state: undefined, search: undefined });
});

it("shows a friendly empty state when nobody is onboarding", async () => {
  state.onboarding.mockResolvedValue(listing([]));
  const page = await html();
  expect(page).toContain("No one is onboarding right now.");
  expect(page).not.toContain("Clear filters");
});

it("shows an alert, not a crash, when the new hires cannot load", async () => {
  state.fail = true;
  const page = await html();
  expect(page).toContain("The new hires could not be loaded");
  expect(page).toContain('role="alert"');
});
