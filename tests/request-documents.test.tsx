// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RequestDocuments } from "@/components/hiring/request-documents";
import { PRE_EMPLOYMENT_DOCUMENTS } from "@/lib/offer-documents";

const requestOfferDocuments = vi.fn();
vi.mock("@/app/(hrms)/offers/actions", () => ({ requestOfferDocuments: (...args: unknown[]) => requestOfferDocuments(...args) }));

beforeEach(() => {
  requestOfferDocuments.mockResolvedValue({});
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); requestOfferDocuments.mockReset(); vi.unstubAllGlobals(); });

const items = PRE_EMPLOYMENT_DOCUMENTS.map(({ type, label, hint }) => ({ type, label, hint, status: type === "resume" || type === "valid-id" ? "Submitted" as const : "Not requested" as const }));
async function open() {
  render(<RequestDocuments offerId={5} applicantName="Ellaine Torres" role="Branch Cashier" startDate="2099-11-10" today="2099-11-01" items={items} />);
  await userEvent.click(screen.getByRole("button", { name: "Request documents" }));
}
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLButtonElement;

it("offers only missing documents: submitted ones are ticked, disabled and marked", async () => {
  await open();
  for (const name of ["Resume", "Valid government ID"]) {
    expect(box(name).disabled).toBe(true);
    expect(box(name).getAttribute("aria-checked")).toBe("true");
  }
  expect(screen.getAllByText("Already submitted")).toHaveLength(2);
  for (const name of ["NBI clearance", "Health certificate", "SSS number", "PhilHealth number", "Pag-IBIG MID and TIN"]) {
    expect(box(name).disabled).toBe(false);
    expect(box(name).getAttribute("aria-checked")).toBe("true");
  }
  expect(screen.getByText(/5 documents · due 5 Nov/)).toBeTruthy();
});

it("sends the chosen documents with the due date and message", async () => {
  await open();
  await userEvent.click(box("SSS number"));
  await userEvent.click(box("PhilHealth number"));
  await userEvent.click(screen.getByRole("button", { name: "Send request" }));
  expect(requestOfferDocuments).toHaveBeenCalledWith(5, ["nbi", "health", "pagibig"], "2099-11-05",
    "Hi Ellaine, please upload these before 5 Nov so we can prepare your first day. Thank you!");
});

it("cannot send with nothing chosen", async () => {
  await open();
  for (const name of ["NBI clearance", "Health certificate", "SSS number", "PhilHealth number", "Pag-IBIG MID and TIN"]) await userEvent.click(box(name));
  expect((screen.getByRole("button", { name: "Send request" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows the reason and stays open when the request is refused", async () => {
  requestOfferDocuments.mockResolvedValue({ error: "The due date can't be in the past." });
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Send request" }));
  expect((await screen.findByRole("alert")).textContent).toBe("The due date can't be in the past.");
  expect(screen.getByRole("dialog")).toBeTruthy();
});
