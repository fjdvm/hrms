// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SendReminderDialog } from "@/components/training/reminder-dialog";
import { ReminderCard } from "@/components/training/reminder-card";
import { dayBefore, reminderDueAt, reminderWhen } from "@/lib/training-terms";

const actions = vi.hoisted(() => ({ sendTrainingReminder: vi.fn() }));
vi.mock("@/app/(hrms)/training/actions", () => actions);

const training = { title: "POS and cash handling", trainer: "HR", date: "2099-11-20", startTime: "14:00", endTime: "16:00", mode: "Online" as const, location: "https://meet.example.test/pos" };
const PEOPLE = [
  { name: "Carla Mendoza", email: "carla@example.test" },
  { name: "Ellaine Torres", email: "ellaine@example.test" },
  { name: "Mylene Santos", email: null },
  { name: "Joel Ramirez", email: null },
];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.sendTrainingReminder.mockResolvedValue({ result: { queued: 2, notEmailed: 2 } });
});
afterEach(() => { cleanup(); actions.sendTrainingReminder.mockReset(); vi.unstubAllGlobals(); });

const open = async (people = PEOPLE, terms = training) => {
  render(<SendReminderDialog trainingId={7} training={terms} subtitle="Fri, 20 Nov 2099 · 2:00 – 4:00 PM" people={people} />);
  await userEvent.click(screen.getByRole("button", { name: "Send reminder" }));
  await screen.findByText("POS and cash handling · Fri, 20 Nov 2099 · 2:00 – 4:00 PM");
};
const confirm = () => screen.getAllByRole("button", { name: "Send reminder" }).at(-1)!;

it("shows how many will get an email and who, the email as it will read, and who is left out", async () => {
  await open();
  expect(screen.getByText("2 of 4 assigned employees will get an email")).toBeTruthy();
  expect(screen.getByText("Carla Mendoza, Ellaine Torres")).toBeTruthy();
  expect(screen.getByText("Reminder: POS and cash handling on Fri, 20 Nov")).toBeTruthy();
  expect(screen.getByText(/Hi Carla,/)).toBeTruthy();
  expect(screen.getByText(/Join online: https:\/\/meet\.example\.test\/pos/)).toBeTruthy();
  expect(screen.getByText("Not emailed: Mylene Santos and Joel Ramirez have no email address. Give them a printed schedule instead.")).toBeTruthy();
});

it("says when the automatic reminder also goes out", async () => {
  await open();
  expect(screen.getByText("An automatic reminder also goes out Thu, 19 Nov at 8:00 AM.")).toBeTruthy();
});

it("sends the reminder and closes", async () => {
  await open();
  await userEvent.click(confirm());
  expect(actions.sendTrainingReminder).toHaveBeenCalledWith(7);
  await waitFor(() => expect(screen.queryByText("Email preview")).toBeNull());
});

it("keeps the dialog open and shows the server's message when sending fails", async () => {
  actions.sendTrainingReminder.mockResolvedValueOnce({ error: "Reminders can only be sent for an upcoming training." });
  await open();
  await userEvent.click(confirm());
  expect((await screen.findByRole("alert")).textContent).toBe("Reminders can only be sent for an upcoming training.");
});

it("cannot send when no assigned employee has an email, and says so", async () => {
  await open([{ name: "Mylene Santos", email: null }]);
  expect(screen.getByText("0 of 1 assigned employee will get an email")).toBeTruthy();
  expect(screen.queryByText("Email preview")).toBeNull();
  expect(screen.getByText(/Not emailed: Mylene Santos has no email address/)).toBeTruthy();
  expect((confirm() as HTMLButtonElement).disabled).toBe(true);
});

it("copes with a Training that has no one assigned", async () => {
  await open([]);
  expect(screen.getByText("No one is assigned yet")).toBeTruthy();
  expect((confirm() as HTMLButtonElement).disabled).toBe(true);
});

it("leaves out the automatic-reminder line once its time has passed", async () => {
  await open(PEOPLE, { ...training, date: "2020-01-02" });
  expect(screen.queryByText(/An automatic reminder also goes out/)).toBeNull();
});

it("works out the automatic reminder: 8:00 AM Manila time (00:00 UTC) the day before", () => {
  expect(dayBefore("2026-11-20")).toBe("2026-11-19");
  expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  expect(reminderDueAt("2026-11-20").toISOString()).toBe("2026-11-19T00:00:00.000Z");
  expect(reminderWhen("2026-11-20")).toBe("Thu, 19 Nov at 8:00 AM");
});

it("the Reminder card says when it goes out and to how many, and how many need a printed schedule", () => {
  render(<ReminderCard trainingDate="2026-11-20" emailed={4} withoutEmail={2} now={new Date("2026-11-14T02:00:00Z")} />);
  expect(screen.getByText("Automatic reminder on Thu, 19 Nov at 8:00 AM (Manila time) to 4 employees with an email.")).toBeTruthy();
  expect(screen.getByText("2 without an email need a printed schedule.")).toBeTruthy();
});

it("the Reminder card switches to the past tense once it is due, and handles no emails", () => {
  const { rerender } = render(<ReminderCard trainingDate="2026-11-20" emailed={1} withoutEmail={0} now={new Date("2026-11-19T01:00:00Z")} />);
  expect(screen.getByText("Automatic reminder went out on Thu, 19 Nov at 8:00 AM (Manila time) to 1 employee with an email.")).toBeTruthy();
  rerender(<ReminderCard trainingDate="2026-11-20" emailed={0} withoutEmail={3} now={new Date("2026-11-14T02:00:00Z")} />);
  expect(screen.getByText("No assigned employee has an email, so no reminder will be emailed.")).toBeTruthy();
});
