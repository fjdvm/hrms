// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmployeeProfile } from "@/components/employees/employee-profile";
import { PRE_EMPLOYMENT_DOCUMENTS } from "@/lib/offer-documents";
import { formatEmployeeDate, headerSubtitle, ONBOARDING_ROW_URL } from "@/lib/employee-view";
import type { EmployeeDetail } from "@/lib/employees";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
afterEach(cleanup);

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
    ...over,
  } as EmployeeDetail;
}

it("shows the header, back link and onboarding link", () => {
  render(<EmployeeProfile employee={employee()} />);
  expect(screen.getByRole("heading", { name: "Ellaine Mae D. Torres" })).toBeTruthy();
  expect(screen.getByText("Onboarding")).toBeTruthy();
  expect(screen.getByText("BR-EMP-0058 · Branch Cashier · Cainta branch · starts 10 Nov 2026")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Employee information/ }).getAttribute("href")).toBe("/employee-information");
  expect(screen.getByRole("link", { name: /View onboarding/ }).getAttribute("href")).toBe(ONBOARDING_ROW_URL(58));
  expect(screen.getByRole("button", { name: /Edit details/ })).toBeTruthy();
});

it("lists the four tabs with the submitted document count", () => {
  render(<EmployeeProfile employee={employee()} />);
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Details", "Documents 6", "Employment history", "Activity"]);
});

it("Details tab: IDs as given, empty sections say so, gaps are spelled out", () => {
  render(<EmployeeProfile employee={employee()} />);
  expect(screen.getByText("Visible to HR only")).toBeTruthy();
  expect(screen.getByText("34-•••••••-8")).toBeTruthy();
  expect(within(screen.getByLabelText("Emergency contact")).getByText("Not provided yet")).toBeTruthy();
  expect(screen.getByText("14 Mar 1999 · 27 years old")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Application #398" }).getAttribute("href")).toBe("/applicants/398");
  expect(screen.getByText("6 of 7")).toBeTruthy();
});

it("hides monthly pay unless the server sent it", () => {
  const { unmount } = render(<EmployeeProfile employee={employee()} />);
  expect(screen.queryByText("Monthly pay")).toBeNull();
  unmount();
  render(<EmployeeProfile employee={employee({ contract: { offerLetterSigned: true, contractType: "Regular", monthlyPay: 15500 } as EmployeeDetail["contract"] })} />);
  expect(screen.getByText("₱15,500")).toBeTruthy();
});

it("Documents tab lists all 7 with a view action only where a file exists", async () => {
  render(<EmployeeProfile employee={employee()} />);
  await userEvent.click(screen.getByRole("tab", { name: /Documents/ }));
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getAllByRole("listitem")).toHaveLength(7);
  expect(within(panel).getAllByRole("link", { name: /^View/ })).toHaveLength(6);
  expect(within(panel).getByRole("link", { name: "View Resume" }).getAttribute("href")).toBe("https://files.test/resume");
  expect(within(panel).getByText("Missing")).toBeTruthy();
  expect(within(panel).getByText("Valid until 29 Oct 2027")).toBeTruthy();
});

it("history and activity are placeholders", async () => {
  render(<EmployeeProfile employee={employee()} />);
  await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
  expect(screen.getByText("Activity is coming soon.")).toBeTruthy();
});

it("formats dates from either date or timestamp", () => {
  expect(formatEmployeeDate("2026-10-12 08:00:00+00")).toBe("12 Oct 2026");
  expect(formatEmployeeDate("2027-04-28")).toBe("28 Apr 2027");
  expect(formatEmployeeDate(null)).toBe("Not provided yet");
  expect(headerSubtitle(employee({ employment: { ...employee().employment, status: "Active" } }))).toContain("started 10 Nov 2026");
});
