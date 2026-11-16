// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PerformanceNoAccess } from "@/components/performance/no-access";

afterEach(cleanup);

it("explains the missing Module inside the shell and links back to the Dashboard", () => {
  render(<PerformanceNoAccess />);

  expect(screen.getByRole("heading", { name: "No access to Performance" })).toBeTruthy();
  expect(screen.getByText("You don’t have access to Performance. Ask an administrator to grant it in the Portal.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to Dashboard" }).getAttribute("href")).toBe("/dashboard");
});
