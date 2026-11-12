// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeBranchFilter } from "@/components/employees/employee-branch-filter";
import { EmployeeExport } from "@/components/employees/employee-export";
import { EmployeeSearch } from "@/components/employees/employee-search";
import { branchFromParam, employeeExportHref, employeesHref, filtersOf, formatEmployeeSubtitle, searchFromParam, tabFromParam } from "@/lib/employee-list-view";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  push.mockReset();
  replace.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps the view in the URL, leaving defaults out", () => {
  expect(employeesHref({})).toBe("/employee-information");
  expect(employeesHref({ tab: "All" })).toBe("/employee-information");
  expect(employeesHref({ tab: "Onboarding", branch: "Cainta branch", search: "maria" })).toBe("/employee-information?status=Onboarding&branch=Cainta+branch&q=maria");
  expect(employeeExportHref({ tab: "Active" })).toBe("/api/employees/export?status=Active");
  expect(employeeExportHref({})).toBe("/api/employees/export");
  expect(tabFromParam("Active")).toBe("Active");
  expect(tabFromParam("bogus")).toBe("All");
  expect(tabFromParam(undefined)).toBe("All");
  expect(searchFromParam("  ")).toBeUndefined();
  expect(searchFromParam("x".repeat(500))).toHaveLength(100);
  expect(branchFromParam(" Cainta branch ")).toBe("Cainta branch");
  expect(filtersOf({ tab: "All" })).toEqual({ status: undefined, branch: undefined, search: undefined });
  expect(filtersOf({ tab: "Onboarding", branch: "B", search: "s" })).toEqual({ status: "Onboarding", branch: "B", search: "s" });
});

it("words the summary line like the design", () => {
  expect(formatEmployeeSubtitle({ employees: 42, onboarding: 3, missingDocuments: 2 })).toBe("42 employees · 3 still onboarding · 2 with missing documents");
  expect(formatEmployeeSubtitle({ employees: 1, onboarding: 0, missingDocuments: 0 })).toBe("1 employee · 0 still onboarding · 0 with missing documents");
});

it("searches after a pause, keeping the tab and Branch, and never on a timer when nothing changed", () => {
  vi.useFakeTimers();
  render(<EmployeeSearch tab="Active" branch="Cainta branch" search="" />);
  fireEvent.change(screen.getByRole("textbox", { name: /search employees/i }), { target: { value: "BR-EMP-0001 " } });
  act(() => { vi.advanceTimersByTime(299); });
  expect(replace).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(2); });
  expect(replace).toHaveBeenCalledWith("/employee-information?status=Active&branch=Cainta+branch&q=BR-EMP-0001", { scroll: false });
  act(() => { vi.advanceTimersByTime(5000); });
  expect(replace).toHaveBeenCalledTimes(1);
});

it("does not navigate for the search the URL already shows", () => {
  vi.useFakeTimers();
  render(<EmployeeSearch tab="All" search="maria" />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(replace).not.toHaveBeenCalled();
});

it("chooses a Branch, keeping the tab and search, or goes back to All branches", async () => {
  const user = userEvent.setup();
  render(<EmployeeBranchFilter tab="Onboarding" search="maria" branch="Cainta branch" options={["Cainta branch", "Main kitchen"]} />);
  await user.click(screen.getByRole("button", { name: /filter by branch/i }));
  await user.click(await screen.findByRole("menuitem", { name: "Main kitchen" }));
  expect(push).toHaveBeenCalledWith("/employee-information?status=Onboarding&branch=Main+kitchen&q=maria");
  await user.click(screen.getByRole("button", { name: /filter by branch/i }));
  await user.click(await screen.findByRole("menuitem", { name: "All branches" }));
  expect(push).toHaveBeenLastCalledWith("/employee-information?status=Onboarding&q=maria");
});

it("shows All branches by default", () => {
  render(<EmployeeBranchFilter tab="All" options={["Cainta branch"]} />);
  expect(screen.getByRole("button", { name: /filter by branch/i }).textContent).toBe("Branch:All branches");
});

it("exports the current view and says so when the download fails", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  render(<EmployeeExport tab="Onboarding" branch="Cainta branch" search="maria" />);
  await user.click(screen.getByRole("button", { name: /export/i }));
  expect(fetchMock).toHaveBeenCalledWith("/api/employees/export?status=Onboarding&branch=Cainta+branch&q=maria");
  expect((await screen.findByRole("alert")).textContent).toContain("The export could not be downloaded");
  expect((screen.getByRole("button", { name: /export/i }) as HTMLButtonElement).disabled).toBe(false);
});
