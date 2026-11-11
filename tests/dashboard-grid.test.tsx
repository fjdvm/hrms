// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { dashboardLayoutFor, dashboardRange } from "@/lib/dashboard";

afterEach(cleanup);

const NOW = new Date("2026-10-28T12:05:00Z");
const ALL = ["/dashboard", "/attendance", "/employee-information", "/job-postings"];

/** What the Dashboard draws, top to bottom, with each card and widget reduced to its label or id. */
function drawnOrder(pages: string[]): string[] {
  const layout = dashboardLayoutFor(pages, {}, dashboardRange(undefined, NOW), NOW);
  const { container } = render(
    <DashboardGrid
      layout={layout}
      card={(card) => <div key={card.label} data-drawn={card.label} />}
      widget={(widget) => <div key={widget.id} data-drawn={widget.id} />}
    />,
  );
  return [...container.querySelectorAll("[data-drawn]")].map((el) => el.getAttribute("data-drawn")!);
}

it("draws the hiring cards, then the People block, then the hiring rows, then the rest, for Staff holding every Module", () => {
  expect(drawnOrder(ALL)).toEqual([
    "Open jobs", "Applicants", "Interviews this week", "Offer acceptance", "Average time to hire",
    "Total Employee", "Attendance Rate", "recent-activity", "headcount-trend",
    "hiring-pipeline", "needs-attention",
    "applicants-by-job", "applicant-sources", "upcoming-interviews",
    "department-distribution", "upcoming-events",
  ]);
});

it("keeps the People block above the hiring rows when Staff hold only Employee Information and Recruitment and Hiring", () => {
  const order = drawnOrder(["/dashboard", "/employee-information", "/job-postings"]);
  expect(order.indexOf("headcount-trend")).toBeLessThan(order.indexOf("hiring-pipeline"));
  expect(order.indexOf("Total Employee")).toBeLessThan(order.indexOf("hiring-pipeline"));
});
