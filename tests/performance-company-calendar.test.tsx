// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CompanyCalendar, inTab, matchesSearch } from "@/components/performance/company-calendar";
import { NonWorkingDateDialog, nameError, notesError } from "@/components/performance/non-working-date-dialog";
import type { CalendarEntry, Period } from "@/lib/performance-periods";

const actions = vi.hoisted(() => ({ addNonWorkingDate: vi.fn(), editNonWorkingDate: vi.fn(), removeNonWorkingDate: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  for (const action of Object.values(actions)) action.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const entry = (id: number, date: string, name: string, type: CalendarEntry["type"], notes: string | null = null, addedOn = "2026-11-03"): CalendarEntry => ({ id, date, name, type, notes, addedByName: "Ada Okafor", addedOn });
const ENTRIES = [
  entry(1, "2026-11-30", "Bonifacio Day", "Holiday"),
  entry(2, "2026-12-08", "Immaculate Conception", "Holiday"),
  entry(3, "2026-12-25", "Christmas Day", "Holiday", "Public holiday"),
  entry(4, "2026-12-31", "Year-end inventory", "Closure", "Stock count", "2026-11-10"),
  entry(5, "2026-10-12", "Company outing", "Other"),
];
const period = (id: number, name: string, start: string, end: string): Period => ({ id, type: "Month", kind: "Company", employeeId: null, start, end, graceMinutes: 10, name, createdByName: "Ada" });
const PERIODS = [period(1, "November 2026", "2026-11-01", "2026-11-30"), period(2, "December 2026", "2026-12-01", "2026-12-31")];
const renderCalendar = (entries = ENTRIES) => render(<CompanyCalendar entries={entries} periods={PERIODS} today="2026-11-16" />);
const rows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const names = () => rows().map((row) => within(row).getAllByRole("cell")[1].textContent);

describe("the company calendar list", () => {
  it("lists each date with its name, type, who it applies to, the periods it falls in and its status", () => {
    renderCalendar();

    expect(rows()).toHaveLength(5);
    const first = within(rows()[0]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(first.slice(0, 6)).toEqual(["Mon 30 Nov 2026Added 3 Nov by Ada Okafor", "Bonifacio Day", "Holiday", "Everyone", "November 2026", "Upcoming"]);
    const outing = within(rows()[4]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(outing.slice(3, 6)).toEqual(["Everyone", "No period yet", "Past"]);
    expect(screen.getByTestId("year-count").textContent).toBe("5");
    expect(screen.getByText("Non-working dates · 2026")).toBeTruthy();
  });

  it("has the tabs All, Holidays and Closures with counts, and Other dates only under All", async () => {
    renderCalendar();
    expect(screen.getByRole("button", { name: "All 5" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Holidays 3" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Closures 1" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Closures 1" }));
    expect(names()).toEqual(["Year-end inventoryStock count"]);
    await userEvent.click(screen.getByRole("button", { name: "Holidays 3" }));
    expect(names()).toHaveLength(3);
    expect(inTab({ type: "Other" }, "All")).toBe(true);
    expect(inTab({ type: "Other" }, "Holidays")).toBe(false);
  });

  it("searches by name, notes, type or the date as written", async () => {
    renderCalendar();

    await userEvent.type(screen.getByRole("searchbox", { name: "Search dates" }), "christmas");
    expect(names()).toEqual(["Christmas DayPublic holiday"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search dates" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search dates" }), "tue 8 dec");
    expect(names()).toEqual(["Immaculate Conception"]);
    await userEvent.clear(screen.getByRole("searchbox", { name: "Search dates" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search dates" }), "zzz");
    expect(screen.getByText("No dates match your search.")).toBeTruthy();
    expect(matchesSearch(ENTRIES[3], "stock")).toBe(true);
    expect(matchesSearch(ENTRIES[3], "  ")).toBe(true);
  });

  it("says so when there are no dates yet", () => {
    renderCalendar([]);

    expect(screen.getByText("No non-working dates yet. Add a holiday or closure.")).toBeTruthy();
    expect(screen.getByTestId("year-count").textContent).toBe("0");
  });

  it("removes a date after confirming, and keeps it when cancelled", async () => {
    renderCalendar();

    await userEvent.click(screen.getByRole("button", { name: "Remove Christmas Day" }));
    expect(screen.getByText("Remove Christmas Day?")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Keep date" }));
    expect(actions.removeNonWorkingDate).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Remove Christmas Day" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove date" }));
    expect(actions.removeNonWorkingDate).toHaveBeenCalledWith(3);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Christmas Day removed"));
  });

  it("shows a refusal when removing fails", async () => {
    actions.removeNonWorkingDate.mockResolvedValue({ ok: false, error: "That date is no longer on the calendar. Reload the page." });
    renderCalendar();

    await userEvent.click(screen.getByRole("button", { name: "Remove Bonifacio Day" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove date" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That date is no longer on the calendar. Reload the page."));
  });

  it("edits a date with its details filled in", async () => {
    renderCalendar();

    await userEvent.click(screen.getByRole("button", { name: "Edit Christmas Day" }));
    expect(screen.getByRole("heading", { name: "Edit non-working date" })).toBeTruthy();
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Christmas Day");
    expect((screen.getByLabelText(/Notes/) as HTMLInputElement).value).toBe("Public holiday");
    expect(screen.getByRole("button", { name: "Holiday" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), "Christmas  Eve");
    await userEvent.click(screen.getByRole("button", { name: "Closure" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(actions.editNonWorkingDate).toHaveBeenCalledWith(3, { date: "2026-12-25", name: "Christmas  Eve", type: "Closure", notes: "Public holiday" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Edit non-working date" })).toBeNull());
  });
});

describe("Add non-working date", () => {
  const renderAdd = () => render(<NonWorkingDateDialog defaultOpen entries={ENTRIES} periods={PERIODS} />);
  const add = () => screen.getByRole("button", { name: "Add date" });

  async function chooseDate(day: RegExp) {
    await userEvent.click(screen.getByRole("button", { name: /^Date/ }));
    await userEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: day }));
  }

  it("needs a date and a name before Add date is enabled", async () => {
    renderAdd();
    expect(screen.getByRole("heading", { name: "Add non-working date" })).toBeTruthy();
    expect((add() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/^Name/), "Founders Day");
    expect((add() as HTMLButtonElement).disabled).toBe(true);
    await chooseDate(/November 20th/);
    expect((add() as HTMLButtonElement).disabled).toBe(false);
  });

  it("takes a date, a name, a type and optional notes, and says what it does to the periods", async () => {
    renderAdd();

    await userEvent.click(screen.getByRole("button", { name: "Closure" }));
    expect(screen.getByText("A closure is a day the company is shut that is not a public holiday.")).toBeTruthy();
    await chooseDate(/November 20th/);
    expect(screen.getByText("Scheduled days drop by one")).toBeTruthy();
    expect(screen.getByText(/Employees whose Working days include Fri 20 Nov have 1 fewer scheduled day in November 2026\./)).toBeTruthy();
    await userEvent.type(screen.getByLabelText(/^Name/), "  Founders   Day ");
    await userEvent.type(screen.getByLabelText(/Notes/), "Office closed");
    await userEvent.click(add());

    expect(actions.addNonWorkingDate).toHaveBeenCalledWith({ date: "2026-11-20", name: "  Founders   Day ", type: "Closure", notes: "Office closed" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Founders Day added to the company calendar"));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add non-working date" })).toBeNull());
  });

  it("sends no notes as null", async () => {
    renderAdd();
    await chooseDate(/November 20th/);
    await userEvent.type(screen.getByLabelText(/^Name/), "Founders Day");

    await userEvent.click(add());

    expect(actions.addNonWorkingDate).toHaveBeenCalledWith({ date: "2026-11-20", name: "Founders Day", type: "Holiday", notes: null });
  });

  it("refuses a date already on the calendar, naming it, before anything is sent", async () => {
    renderAdd();
    await userEvent.type(screen.getByLabelText(/^Name/), "Again");

    await chooseDate(/November 30th/);

    expect(screen.getByRole("alert").textContent).toBe("That date is already on the calendar as Bonifacio Day.");
    expect((add() as HTMLButtonElement).disabled).toBe(true);
    expect(actions.addNonWorkingDate).not.toHaveBeenCalled();
  });

  it("refuses a name with characters that do not belong, and shows the server's refusal", async () => {
    actions.addNonWorkingDate.mockResolvedValue({ ok: false, error: "Something went wrong. Reload the page and try again." });
    renderAdd();
    await chooseDate(/November 20th/);

    await userEvent.type(screen.getByLabelText(/^Name/), "Day<b>");
    expect(screen.getByRole("alert").textContent).toBe("Name can only contain letters, numbers, spaces and . , ' & ( ) / + -");
    expect((add() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(screen.getByLabelText(/^Name/));
    await userEvent.type(screen.getByLabelText(/^Name/), "Founders Day");
    await userEvent.click(add());
    expect((await screen.findByRole("alert")).textContent).toBe("Something went wrong. Reload the page and try again.");
    expect(screen.getByRole("heading", { name: "Add non-working date" })).toBeTruthy();
  });
});

describe("the field rules", () => {
  it("accepts names the server accepts and refuses the rest with a message", () => {
    expect(nameError("Bonifacio Day")).toBeNull();
    expect(nameError("St. Peter's (Antipolo) & Co")).toBeNull();
    expect(nameError("   ")).toBe("Enter a name.");
    expect(nameError("x".repeat(101))).toBe("Name is too long (100 characters at most).");
    expect(nameError("Day<b>")).toMatch(/can only contain/);
    expect(nameError("Day\u0000")).toMatch(/can only contain/);
  });

  it("accepts empty or short notes and refuses long ones or control characters", () => {
    expect(notesError("")).toBeNull();
    expect(notesError("Public holiday")).toBeNull();
    expect(notesError("x".repeat(501))).toMatch(/500 characters/);
    expect(notesError("a\u0007b")).toMatch(/control characters/);
  });
});
