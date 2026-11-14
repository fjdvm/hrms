// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssignDialog } from "@/components/training/assign-dialog";
import { AssignedEmployees } from "@/components/training/assigned-employees";
import { noEmailWarning, type AssignableEmployee, type AssignedEmployee } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ loadAssignable: vi.fn(), assignEmployees: vi.fn(), removeAssignedEmployee: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const person = (id: number, name: string, extra: Partial<AssignableEmployee> = {}): AssignableEmployee => ({
  employeeId: id, name, position: "Branch Cashier", branch: "Cainta branch", department: "Retail", email: `${name.split(" ")[0].toLowerCase()}@example.test`, alreadyAssigned: false, ...extra,
});
const PEOPLE = [person(1, "Ellaine Torres", { alreadyAssigned: true }), person(2, "Ana Dizon"), person(3, "Rhea Bautista", { email: null, branch: "Taytay branch" }), person(4, "Liza Manalo", { department: "Production" })];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.loadAssignable.mockResolvedValue({ people: PEOPLE });
  actions.assignEmployees.mockResolvedValue({ result: { added: 2, alreadyAssigned: 0, needPrintedSchedule: 1 } });
  actions.removeAssignedEmployee.mockResolvedValue({});
});
afterEach(() => { cleanup(); Object.values(actions).forEach((fn) => fn.mockReset()); vi.unstubAllGlobals(); });

const open = async () => {
  render(<AssignDialog trainingId={7} title="POS and cash handling" subtitle="Fri, 20 Nov 2026 · 2:00 – 4:00 PM" />);
  await userEvent.click(screen.getByRole("button", { name: "Assign employees" }));
  await screen.findByRole("checkbox", { name: "Ana Dizon" });
};

it("lists Employees, marks those already assigned and flags no-email Employees", async () => {
  await open();
  expect((screen.getByRole("checkbox", { name: "Ellaine Torres" }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Already assigned")).toBeTruthy();
  expect(screen.getByText("Needs printed schedule")).toBeTruthy();
  expect(screen.getByText("ana@example.test")).toBeTruthy();
});

it("counts the selection, warns about no-email Employees and assigns the chosen people", async () => {
  await open();
  await userEvent.click(screen.getByRole("checkbox", { name: "Ana Dizon" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Rhea Bautista" }));
  expect(screen.getByText("2 selected · 1 needs a printed schedule")).toBeTruthy();
  expect(screen.getByText(/Rhea Bautista has no email/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Assign 2 employees" }));
  expect(actions.assignEmployees).toHaveBeenCalledWith(7, { employeeIds: [2, 3] });
});

it("filters by name and branch", async () => {
  await open();
  await userEvent.type(screen.getByLabelText("Search employees"), "liza");
  expect(screen.queryByRole("checkbox", { name: "Ana Dizon" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Liza Manalo" })).toBeTruthy();
});

it("assigns a whole department", async () => {
  await open();
  await userEvent.click(screen.getByRole("tab", { name: "Whole department" }));
  await userEvent.click(screen.getByRole("radio", { name: /Production/ }));
  await userEvent.click(screen.getByRole("button", { name: "Assign 1 employee" }));
  expect(actions.assignEmployees).toHaveBeenCalledWith(7, { department: "Production" });
});

it("keeps Assign off until someone is chosen and shows a server error", async () => {
  actions.assignEmployees.mockResolvedValue({ error: "This training was cancelled, so no one can be assigned to it." });
  await open();
  const submit = screen.getAllByRole("button").find((b) => /^Assign\s*employees$/.test(b.textContent ?? "") && (b as HTMLButtonElement).disabled);
  expect(submit).toBeTruthy();
  await userEvent.click(screen.getByRole("checkbox", { name: "Ana Dizon" }));
  await userEvent.click(screen.getByRole("button", { name: "Assign 1 employee" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/cancelled/);
});

const assigned = (id: number, name: string, email: string | null): AssignedEmployee => ({
  employeeId: id, name, position: "Branch Cashier", branch: "Cainta branch", email, needsPrintedSchedule: !email, status: "Assigned", completedOn: null, reprintNeeded: false,
});

it("shows each assigned Employee with email or Needs printed schedule and a status badge", () => {
  render(<AssignedEmployees trainingId={7} title="POS" date="Fri, 20 Nov 2026" people={[assigned(1, "Carla Mendoza", "carla@example.test"), assigned(2, "Mylene Santos", null)]} />);
  expect(screen.getByText("carla@example.test")).toBeTruthy();
  expect(screen.getByText("Needs printed schedule")).toBeTruthy();
  expect(screen.getAllByText("Assigned")).toHaveLength(2);
});

it("says no one is assigned when the list is empty", () => {
  render(<AssignedEmployees trainingId={7} title="POS" date="d" people={[]} />);
  expect(screen.getByText(/No one is assigned yet/)).toBeTruthy();
});

it("asks to confirm before removing, and keeps the Employee when Staff back out", async () => {
  render(<AssignedEmployees trainingId={7} title="POS" date="Fri, 20 Nov 2026" people={[assigned(1, "Grace Villar", "g@example.test")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove Grace Villar" }));
  expect(screen.getByText("Remove Grace Villar?")).toBeTruthy();
  expect(actions.removeAssignedEmployee).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(actions.removeAssignedEmployee).not.toHaveBeenCalled();
});

it("removes the Employee once confirmed", async () => {
  render(<AssignedEmployees trainingId={7} title="POS" date="Fri, 20 Nov 2026" people={[assigned(1, "Grace Villar", "g@example.test")]} />);
  await userEvent.click(screen.getByRole("button", { name: "Remove Grace Villar" }));
  await userEvent.click(screen.getByRole("button", { name: "Remove employee" }));
  await waitFor(() => expect(actions.removeAssignedEmployee).toHaveBeenCalledWith(7, 1));
});

it("words the no-email warning for one or several people", () => {
  expect(noEmailWarning([{ name: "Ana", email: "a@x.test" }])).toBeNull();
  expect(noEmailWarning([{ name: "Rhea", email: null }])).toMatch(/^Rhea has no email, so they won’t/);
  expect(noEmailWarning([{ name: "Rhea", email: null }, { name: "Joel", email: null }])).toMatch(/^Rhea and Joel have no email/);
});
