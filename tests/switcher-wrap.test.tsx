// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { SidebarEnterpriseHeader } from "@/components/layout/sidebar-enterprise-header";

// Show every System, so the CREOMS entry is in the menu whatever the Portal answers.
vi.mock("@/components/layout/use-visible-systems", async () => {
  const { systems } = await import("@/components/layout/sidebar-nav");
  return { useVisibleSystems: () => systems };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => "/" }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Inter: font, Fraunces: font, Geist_Mono: font };
});


beforeAll(() => {
  // Radix and the sidebar read browser APIs jsdom leaves out.
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null, dispatchEvent: () => false,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  })) as typeof window.matchMedia;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(cleanup);

const renderSwitcher = () => render(<SidebarEnterpriseHeader isMobile={false} />);

it("shows each System's full name and description without cutting them off", async () => {
  renderSwitcher();
  await userEvent.click(screen.getAllByText("Bren Raphael's")[0]);
  const menu = await screen.findByRole("menu");

  const name = within(menu).getByText("Customer Relation and Ecommerce Ordering Management System");
  const desc = within(menu).getByText("Customers, orders, tickets & feedback");
  for (const text of [name, desc]) {
    expect(text.className).not.toMatch(/\btruncate\b|line-clamp/);
    expect(text.className).toMatch(/\bwhitespace-normal\b/);
  }
});

