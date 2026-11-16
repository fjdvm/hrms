// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditSectionButton } from "@/components/employees/edit-section";
import { SHIFT_ORDER_MESSAGE, initialValues, sectionPayload, validateSection, type FormValues } from "@/lib/employee-edit-form";
import { formatClockTime, isAfter, isClockTime } from "@/lib/validators/time";
import { formatWorkingDays, parseWorkingDays } from "@/lib/validators/weekdays";
import type { EmployeeDetail } from "@/lib/employees";

const actions = vi.hoisted(() => ({ saveSection: vi.fn(), revealGovernmentIds: vi.fn() }));
vi.mock("@/app/(hrms)/employee-information/[id]/actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.saveSection.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const EMPLOYMENT: FormValues = {
  position: "Branch Cashier", department: "Branches", branch: "Cainta branch", employmentType: "Full-time", startDate: "2026-11-10",
  probationEndDate: "", reportsTo: "Paolo Garcia", schedule: "Mon-Sat, 6 AM-2 PM", shiftStart: "", shiftEnd: "", workingDays: "",
};
const WITH_SHIFT: FormValues = { ...EMPLOYMENT, shiftStart: "06:00", shiftEnd: "14:00", workingDays: "1,2,3,4,5,6" };

async function open(initial: FormValues) {
  render(<EditSectionButton employeeId={58} section="employment" initial={initial} subject="Ellaine Torres · BR-EMP-0058" />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Employment" }));
  return screen.getByRole("dialog");
}
const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
const setTime = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });

describe("the Edit employment dialog's shift fields", () => {
  it("shows Shift start, Shift end and Working days under Work schedule, with their help text and the no-shift notice", async () => {
    const dialog = await open(EMPLOYMENT);
    const labels = within(dialog).getAllByText(/^(Work schedule|Shift start|Shift end|Working days)( \*)?$/).map((el) => el.textContent);

    expect(labels).toEqual(["Work schedule *", "Shift start", "Shift end", "Working days"]);
    expect(within(dialog).getByText("Ellaine Torres · BR-EMP-0058")).toBeTruthy();
    expect(within(dialog).getByText("Shown on the profile and carried from the offer.")).toBeTruthy();
    expect(within(dialog).getByText("Used by Performance to score Punctuality.")).toBeTruthy();
    expect(within(dialog).getByText("Used by Performance to score Full shift.")).toBeTruthy();
    expect(within(dialog).getByText("Scheduled days in a period are counted from these.")).toBeTruthy();
    expect(within(dialog).getByRole("note").textContent).toBe("An employee with no shift is not scored in Performance until HR sets one.");
    expect(within(dialog).getByText("Saved to the employee history.")).toBeTruthy();
  });

  it("leaves the Work schedule text field as it is", async () => {
    const dialog = await open(WITH_SHIFT);

    expect((within(dialog).getByLabelText(/Work schedule/) as HTMLInputElement).value).toBe("Mon-Sat, 6 AM-2 PM");
    expect(within(dialog).getByLabelText("Shift start")).toHaveProperty("value", "06:00");
    expect(within(dialog).getByLabelText("Shift end")).toHaveProperty("value", "14:00");
    expect(within(dialog).getByLabelText("Working days").textContent).toBe("Mon, Tue, Wed, Thu, Fri, Sat");
  });

  it("refuses a Shift end that is not after the Shift start, shows the error on Shift end and does not save", async () => {
    const dialog = await open(WITH_SHIFT);
    setTime(within(dialog).getByLabelText("Shift end"), "05:30");
    await save(dialog);

    const error = within(dialog).getByRole("alert");
    expect(error.textContent).toBe("Shift end must be after shift start. Overnight shifts are not supported yet.");
    expect(error.textContent).toBe(SHIFT_ORDER_MESSAGE);
    expect(within(dialog).getByLabelText("Shift end").getAttribute("aria-invalid")).toBe("true");
    expect(within(dialog).getByLabelText("Shift end").getAttribute("aria-describedby")).toContain(error.id);
    expect(actions.saveSection).not.toHaveBeenCalled();
  });

  it("refuses a Shift end equal to the Shift start, and clears the error once the end is fixed", async () => {
    const dialog = await open(WITH_SHIFT);
    setTime(within(dialog).getByLabelText("Shift end"), "06:00");
    await save(dialog);
    expect(within(dialog).getByRole("alert").textContent).toBe(SHIFT_ORDER_MESSAGE);

    setTime(within(dialog).getByLabelText("Shift end"), "15:00");
    await save(dialog);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(actions.saveSection).toHaveBeenCalledWith(58, "employment", { shiftStart: "06:00", shiftEnd: "15:00", workingDays: [1, 2, 3, 4, 5, 6] }, undefined);
  });

  it("saves a new shift together with the rest of the employment edit", async () => {
    const dialog = await open(EMPLOYMENT);
    setTime(within(dialog).getByLabelText("Shift start"), "08:00");
    setTime(within(dialog).getByLabelText("Shift end"), "17:00");
    await userEvent.click(within(dialog).getByLabelText("Working days"));
    for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri"]) await userEvent.click(screen.getByRole("checkbox", { name: day }));
    await userEvent.keyboard("{Escape}");
    await userEvent.clear(within(dialog).getByLabelText(/Position/));
    await userEvent.type(within(dialog).getByLabelText(/Position/), "Supervisor");
    await save(dialog);

    expect(actions.saveSection).toHaveBeenCalledWith(58, "employment", { position: "Supervisor", shiftStart: "08:00", shiftEnd: "17:00", workingDays: [1, 2, 3, 4, 5] }, undefined);
  });

  it("lets an Employee with no shift keep it empty when editing something else", async () => {
    const dialog = await open(EMPLOYMENT);
    await userEvent.clear(within(dialog).getByLabelText(/Reports to/));
    await userEvent.type(within(dialog).getByLabelText(/Reports to/), "Ana Cruz");
    await save(dialog);

    expect(actions.saveSection).toHaveBeenCalledWith(58, "employment", { reportsTo: "Ana Cruz" }, undefined);
  });

  it("asks for the missing parts when only part of a shift is entered", async () => {
    const dialog = await open(EMPLOYMENT);
    setTime(within(dialog).getByLabelText("Shift start"), "08:00");
    await save(dialog);

    expect(within(dialog).getAllByRole("alert").map((el) => el.textContent)).toEqual(["Enter a shift end.", "Choose at least one working day."]);
    expect(actions.saveSection).not.toHaveBeenCalled();
  });
});

describe("the shift form rules", () => {
  it("validates the three fields together", () => {
    expect(validateSection("employment", WITH_SHIFT, "2026-11-16")).toEqual({});
    expect(validateSection("employment", EMPLOYMENT, "2026-11-16")).toEqual({});
    expect(validateSection("employment", { ...WITH_SHIFT, shiftEnd: "06:00" }, "2026-11-16")).toEqual({ shiftEnd: SHIFT_ORDER_MESSAGE });
    expect(validateSection("employment", { ...WITH_SHIFT, shiftStart: "6:00" }, "2026-11-16")).toEqual({ shiftStart: "Enter a valid time." });
    expect(validateSection("employment", { ...WITH_SHIFT, workingDays: "" }, "2026-11-16")).toEqual({ workingDays: "Choose at least one working day." });
    expect(validateSection("employment", { ...WITH_SHIFT, workingDays: "0,9" }, "2026-11-16")).toEqual({ workingDays: "Choose at least one working day." });
  });

  it("sends the whole shift when any part changed, and clears it with three empty values", () => {
    expect(sectionPayload("employment", WITH_SHIFT, WITH_SHIFT)).toEqual({});
    expect(sectionPayload("employment", { ...WITH_SHIFT, shiftEnd: "15:00" }, WITH_SHIFT)).toEqual({ shiftStart: "06:00", shiftEnd: "15:00", workingDays: [1, 2, 3, 4, 5, 6] });
    expect(sectionPayload("employment", { ...WITH_SHIFT, workingDays: "6,1,1" }, WITH_SHIFT)).toEqual({ shiftStart: "06:00", shiftEnd: "14:00", workingDays: [1, 6] });
    expect(sectionPayload("employment", { ...WITH_SHIFT, shiftStart: "", shiftEnd: "", workingDays: "" }, WITH_SHIFT)).toEqual({ shiftStart: null, shiftEnd: null, workingDays: null });
  });

  it("fills the form from the Employee's stored shift", () => {
    const employee = { employment: { ...EMPLOYMENT, shiftStart: "06:00", shiftEnd: "14:00", workingDays: [1, 2, 3, 4, 5, 6] }, contract: { contractType: "Full-time" } } as unknown as EmployeeDetail;

    expect(initialValues("employment", employee)).toMatchObject({ shiftStart: "06:00", shiftEnd: "14:00", workingDays: "1,2,3,4,5,6" });
    const none = { employment: { ...EMPLOYMENT, shiftStart: null, shiftEnd: null, workingDays: null }, contract: { contractType: "Full-time" } } as unknown as EmployeeDetail;
    expect(initialValues("employment", none)).toMatchObject({ shiftStart: "", shiftEnd: "", workingDays: "" });
  });
});

describe("the shared time and weekday helpers", () => {
  it("reads and compares clock times", () => {
    expect(["00:00", "06:00", "23:59"].every(isClockTime)).toBe(true);
    expect(["6:00", "24:00", "12:60", "06:00:00", "", null].some(isClockTime)).toBe(false);
    expect(isAfter("14:00", "06:00")).toBe(true);
    expect(isAfter("06:00", "06:00")).toBe(false);
    expect(isAfter("05:30", "06:00")).toBe(false);
    expect([formatClockTime("00:00"), formatClockTime("06:00"), formatClockTime("12:00"), formatClockTime("14:30")]).toEqual(["12:00 AM", "6:00 AM", "12:00 PM", "2:30 PM"]);
  });

  it("reads and writes Working days in week order", () => {
    expect(parseWorkingDays("6, 1,1,3")).toEqual([1, 3, 6]);
    expect(parseWorkingDays("")).toBeNull();
    expect(parseWorkingDays("1,x")).toBeNull();
    expect(parseWorkingDays("8")).toBeNull();
    expect(formatWorkingDays([6, 1, 2])).toBe("Mon, Tue, Sat");
  });
});
