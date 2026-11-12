// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeProfile } from "@/components/employees/employee-profile";
import { PRE_EMPLOYMENT_DOCUMENTS } from "@/lib/offer-documents";
import { formatEmployeeDate, headerSubtitle, ONBOARDING_ROW_URL } from "@/lib/employee-view";
import type { EmployeeDetail } from "@/lib/employees";

const actions = vi.hoisted(() => ({ saveSection: vi.fn(), revealGovernmentIds: vi.fn() }));
vi.mock("@/app/(hrms)/employee-information/[id]/actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const documents = PRE_EMPLOYMENT_DOCUMENTS.map((d, i) => i === 2
  ? { ...d, fileName: null, uploadedAt: null, validUntil: null, viewUrl: null, status: "Not provided yet" }
  : { ...d, fileName: `${d.type}.pdf`, uploadedAt: "2026-10-12 08:00:00+00", validUntil: d.type === "health" ? "2027-10-29" : null, viewUrl: `https://files.test/${d.type}`, status: "Submitted" });

function employee(over: Partial<EmployeeDetail> = {}): EmployeeDetail {
  return {
    id: 58, employeeNumber: "BR-EMP-0058",
    personal: { name: "Ellaine Mae D. Torres", email: "ellaine@example.com", birthday: "1999-03-14", age: 27, sex: "Female", civilStatus: "Single", mobile: "0917 220 6612", homeAddress: "Cainta, Rizal" },
    employment: { position: "Branch Cashier", department: "Branches", branch: "Cainta branch", startDate: "2026-11-10", status: "Onboarding", probationEndDate: null, reportsTo: "Paolo Garcia", schedule: "Mon–Sat",
      hiredFrom: { offerId: 9, applicationId: 398, offerUrl: "/offers/9", applicationUrl: "/applicants/398" } },
    governmentIds: { sss: "34-•••••••-8", philhealth: null, pagibigMid: null, tin: null },
    emergencyContact: "Not provided yet",
    documents,
    contract: { offerLetterSigned: true, contractType: "Full-time · Probationary" },
    canEdit: { personal: true, employment: true, emergencyContact: true, governmentIds: false, contract: false },
    ...over,
  } as EmployeeDetail;
}

it("shows the header, back link and onboarding link", () => {
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.getByRole("heading", { name: "Ellaine Mae D. Torres" })).toBeTruthy();
  expect(screen.getByText("Onboarding")).toBeTruthy();
  expect(screen.getByText("BR-EMP-0058 · Branch Cashier · Cainta branch · starts 10 Nov 2026")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Employee information/ }).getAttribute("href")).toBe("/employee-information");
  expect(screen.getByRole("link", { name: /View onboarding/ }).getAttribute("href")).toBe(ONBOARDING_ROW_URL(58));
  expect(screen.getByRole("button", { name: /Edit details/ })).toBeTruthy();
});

it("lists the four tabs with the submitted document count", () => {
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Details", "Documents 6", "Employment history", "Activity"]);
});

it("Details tab: IDs as given, empty sections say so, gaps are spelled out", () => {
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.getByText("Visible to HR only")).toBeTruthy();
  expect(screen.getByText("34-•••••••-8")).toBeTruthy();
  expect(within(screen.getByLabelText("Emergency contact")).getByText("Not provided yet")).toBeTruthy();
  expect(screen.getByText("14 Mar 1999 · 27 years old")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Application #398" }).getAttribute("href")).toBe("/applicants/398");
  expect(screen.getByText("6 of 7")).toBeTruthy();
});

it("hides monthly pay unless the server sent it", () => {
  const { unmount } = render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.queryByText("Monthly pay")).toBeNull();
  unmount();
  render(<EmployeeProfile employee={employee({ contract: { offerLetterSigned: true, contractType: "Regular", monthlyPay: 15500 } as EmployeeDetail["contract"] })} history={[]} activity={[]} />);
  expect(screen.getByText("₱15,500")).toBeTruthy();
});

it("Documents tab lists all 7 with a view action only where a file exists", async () => {
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  await userEvent.click(screen.getByRole("tab", { name: /Documents/ }));
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getAllByRole("listitem")).toHaveLength(7);
  expect(within(panel).getAllByRole("link", { name: /^View/ })).toHaveLength(6);
  expect(within(panel).getByRole("link", { name: "View Resume" }).getAttribute("href")).toBe("https://files.test/resume");
  expect(within(panel).getByText("Missing")).toBeTruthy();
  expect(within(panel).getByText("Valid until 29 Oct 2027")).toBeTruthy();
});

const manager = () => employee({ canEdit: { personal: true, employment: true, emergencyContact: true, governmentIds: true, contract: true },
  contract: { offerLetterSigned: true, contractType: "Regular", monthlyPay: 15500 } as EmployeeDetail["contract"] });

it("offers Edit only on the sections the user may edit", () => {
  const { unmount } = render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.getAllByRole("button", { name: /^Edit (personal|employment|emergency)/i })).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "Edit Government IDs" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit Contract" })).toBeNull();
  unmount();
  render(<EmployeeProfile employee={manager()} history={[]} activity={[]} />);
  expect(screen.getByRole("button", { name: "Edit Government IDs" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Edit Contract" })).toBeTruthy();
});

it("shows inline errors without calling the server, then saves and closes", async () => {
  actions.saveSection.mockResolvedValue({ ok: true });
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Personal information" }));
  const dialog = screen.getByRole("dialog");
  const mobile = within(dialog).getByLabelText("Mobile");
  await userEvent.clear(mobile);
  await userEvent.type(mobile, "123");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(within(dialog).getByRole("alert").textContent).toContain("09XXXXXXXXX");
  expect(actions.saveSection).not.toHaveBeenCalled();
  await userEvent.clear(mobile);
  await userEvent.type(mobile, "09171234567");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(actions.saveSection).toHaveBeenCalledWith(58, "personal", { mobile: "09171234567" }, undefined);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("keeps the dialog open with the server's complaint when a save is refused", async () => {
  actions.saveSection.mockResolvedValue({ ok: false, error: "Check the highlighted fields and try again." });
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Emergency contact" }));
  await userEvent.type(screen.getByLabelText("Name"), "Marites");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect((await screen.findByRole("alert")).textContent).toContain("try again");
});

it("asks the server for a government ID only when Reveal is clicked", async () => {
  actions.revealGovernmentIds.mockResolvedValue({ ok: true, values: { sss: "34-1234567-8" } });
  render(<EmployeeProfile employee={manager()} history={[]} activity={[]} />);
  expect(actions.revealGovernmentIds).not.toHaveBeenCalled();
  expect(screen.queryByText("34-1234567-8")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Reveal SSS number" }));
  expect(await screen.findByText("34-1234567-8")).toBeTruthy();
  expect(actions.revealGovernmentIds).toHaveBeenCalledWith(58, ["sss"]);
});

it("gives roles without permission no reveal button", () => {
  render(<EmployeeProfile employee={employee()} history={[]} activity={[]} />);
  expect(screen.queryByRole("button", { name: /Reveal/ })).toBeNull();
});

it("Employment history tab starts with Hired, then each change with old and new values", async () => {
  const history = [
    { id: "2", actorName: "Ada", kind: "Changed", field: "position", oldValue: "Cashier", newValue: "Supervisor", effectiveDate: "2027-01-01", occurredAt: "2026-11-13 01:00:00+00" },
    { id: "1", actorName: "Ada", kind: "Hired", field: "terms", oldValue: null, newValue: { position: "Cashier", branch: "Cainta" }, effectiveDate: "2026-11-10", occurredAt: "2026-11-01 01:00:00+00" },
  ];
  render(<EmployeeProfile employee={employee()} history={history} activity={[]} />);
  await userEvent.click(screen.getByRole("tab", { name: "Employment history" }));
  const items = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
  expect(items[0].textContent).toContain("Hired");
  expect(items[0].textContent).toContain("Position: Cashier");
  expect(items[1].textContent).toContain("Cashier → Supervisor");
  expect(items[1].textContent).toContain("Effective 1 Jan 2027");
});

it("Activity tab lists who changed what, including System", async () => {
  const activity = [
    { id: "2", actorId: "system", actorName: "System", kind: "status", field: "status", oldValue: "Onboarding", newValue: "Active", occurredAt: "2026-11-13 01:00:00+00" },
    { id: "3", actorId: "ada", actorName: "Ada", kind: "reveal", field: "monthlyPay", oldValue: null, newValue: null, occurredAt: "2026-11-13 02:00:00+00" },
    { id: "1", actorId: "ada", actorName: "Ada", kind: "edit", field: "mobile", oldValue: null, newValue: "09171234567", occurredAt: "2026-11-12 01:00:00+00" },
  ];
  render(<EmployeeProfile employee={employee()} history={[]} activity={activity} />);
  await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
  const items = within(screen.getByRole("tabpanel")).getAllByRole("listitem");
  expect(items[0].textContent).toContain("Status changed from Onboarding to Active");
  expect(items[0].textContent).toContain("System");
  expect(items[1].textContent).toContain("Mobile changed from — to 09171234567");
  expect(items).toHaveLength(2);
});
