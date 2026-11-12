import type { EmployeeListFilters, EmployeeStatus } from "./employees";

export const EMPLOYEE_TABS = ["All", "Active", "Onboarding"] as const;
export type EmployeeTab = (typeof EMPLOYEE_TABS)[number];

/** An unknown or missing tab in the URL means All. */
export const tabFromParam = (value: string | undefined): EmployeeTab => EMPLOYEE_TABS.find((tab) => tab === value) ?? "All";
export const statusOfTab = (tab: EmployeeTab): EmployeeStatus | undefined => (tab === "All" ? undefined : tab);
/** Blank search or Branch in the URL means none. Over-long values are cut so a hand-edited URL never errors the page. */
export const searchFromParam = (value: string | undefined) => value?.trim().slice(0, 100) || undefined;
export const branchFromParam = (value: string | undefined) => value?.trim().slice(0, 100) || undefined;

type View = { tab?: EmployeeTab; branch?: string; search?: string };
const query = ({ tab, branch, search }: View) => {
  const params = new URLSearchParams();
  if (tab && tab !== "All") params.set("status", tab);
  if (branch) params.set("branch", branch);
  if (search) params.set("q", search);
  return params.toString();
};
/** The list URL for a view; defaults are left out so the plain list keeps its plain link. */
export const employeesHref = (view: View) => (query(view) ? `/employee-information?${query(view)}` : "/employee-information");
/** The CSV download for a view: the same filters as the list. */
export const employeeExportHref = (view: View) => (query(view) ? `/api/employees/export?${query(view)}` : "/api/employees/export");
export const employeeExportFileName = (now: Date) => `employees-${now.toLocaleDateString("en-CA", { timeZone: "Asia/Manila" })}.csv`;
export const filtersOf = ({ tab, branch, search }: View): EmployeeListFilters => ({ status: statusOfTab(tab ?? "All"), branch, search });

/** "42 employees · 3 still onboarding · 2 with missing documents". */
export function formatEmployeeSubtitle({ employees, onboarding, missingDocuments }: { employees: number; onboarding: number; missingDocuments: number }) {
  return `${employees} ${employees === 1 ? "employee" : "employees"} · ${onboarding} still onboarding · ${missingDocuments} with missing documents`;
}
