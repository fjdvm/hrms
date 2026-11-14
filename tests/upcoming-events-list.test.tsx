// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UpcomingEventsList } from "@/components/dashboard/upcoming-events-list";
import type { UpcomingEvent } from "@/lib/dashboard";

afterEach(cleanup);

const training: UpcomingEvent = { id: "training:4", kind: "training", title: "POS and cash handling", date: "2026-11-20", startTime: "14:00", description: "2:00 – 4:00 PM · Online · HR", link: "/training/4" };
const holiday: UpcomingEvent = { id: "h", kind: "holiday", title: "Bonifacio Day", date: "2026-11-30", description: "National holiday" };

it("shows a Training with its date chip, title, time line and a Training tag, linked to the Training", () => {
  render(<UpcomingEventsList items={[training]} />);
  expect(screen.getByText("POS and cash handling")).toBeTruthy();
  expect(screen.getByText(/2:00 – 4:00 PM · Online · HR/)).toBeTruthy();
  expect(screen.getByText("Training")).toBeTruthy();
  expect(screen.getByText("FRI")).toBeTruthy();
  expect(screen.getByText("20")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/training/4");
});

it("shows holidays and leave with their own tag and no link", () => {
  render(<UpcomingEventsList items={[holiday]} />);
  expect(screen.getByText("Holiday")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps the order it is given", () => {
  render(<UpcomingEventsList items={[holiday, training]} />);
  const titles = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(titles[0]).toContain("Bonifacio Day");
  expect(titles[1]).toContain("POS and cash handling");
});
