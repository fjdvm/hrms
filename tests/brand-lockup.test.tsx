// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata } from "@/app/layout";
import NoAccessPage from "@/app/(auth)/no-access/page";
import SignInErrorPage from "@/app/(auth)/sign-in-error/page";
import UnavailablePage from "@/app/(auth)/unavailable/page";
import { SidebarEnterpriseHeader } from "@/components/layout/sidebar-enterprise-header";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "" });
  return { Inter: font, Fraunces: font, Geist_Mono: font };
});

afterEach(cleanup);

const SYSTEM_NAME = "Human Resource Management System";

describe("the sidebar header", () => {
  it("shows the system name beside Bren Raphael's", () => {
    render(<SidebarEnterpriseHeader isMobile={false} />);

    const brand = screen.getByText("Bren Raphael's", { selector: "p" });
    expect(brand.nextElementSibling?.textContent).toBe(SYSTEM_NAME);
  });

  it("still opens the system switcher", async () => {
    render(<SidebarEnterpriseHeader isMobile={false} />);

    await userEvent.click(screen.getByText("Bren Raphael's", { selector: "p" }));

    expect(await screen.findByText("Select Enterprise Module")).toBeTruthy();
  });
});

describe("the auth and error pages", () => {
  it.each([
    ["no-access", NoAccessPage],
    ["sign-in-error", SignInErrorPage],
    ["unavailable", UnavailablePage],
  ])("%s shows the Enterprise Suite Lockup", async (_name, Page) => {
    render(await Page({ searchParams: Promise.resolve({}) }));

    const brand = screen.getByText("Bren Raphael's", { selector: "p" });
    expect(brand.nextElementSibling?.textContent).toBe("Enterprise Suite");
  });
});

describe("the browser tab", () => {
  it("reads the Bren Raphael's title", () => {
    expect(metadata.title).toBe(`Bren Raphael's | ${SYSTEM_NAME}`);
  });
});
