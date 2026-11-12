import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sidebarFor, sidebarSections } from "@/components/layout/sidebar-nav";
import { MODULES } from "@/lib/modules";

const ALL_PAGES = MODULES.map((m) => m.href);

const layout = (pages: string[]) =>
  sidebarFor(pages).map((section) => ({
    label: section.label,
    items: section.items.map((item) => item.name),
  }));

describe("sidebar", () => {
  it("lists Dashboard, RECRUITMENT, HIRING, then the EMPLOYEE section", () => {
    expect(layout(ALL_PAGES)).toEqual([
      { label: undefined, items: ["Dashboard"] },
      { label: "RECRUITMENT", items: ["Job Postings", "Applicants"] },
      { label: "HIRING", items: ["Interviews", "Offers"] },
      { label: "EMPLOYEE", items: ["Information", "Onboarding"] },
    ]);
  });

  it("gates each tab by the Module for its area", () => {
    expect(layout(["/job-postings"])).toEqual([{ label: "RECRUITMENT", items: ["Job Postings"] }]);
    expect(layout(["/applicants"])).toEqual([{ label: "RECRUITMENT", items: ["Applicants"] }]);
    expect(layout(["/interviews"])).toEqual([{ label: "HIRING", items: ["Interviews"] }]);
    expect(layout(["/offers"])).toEqual([{ label: "HIRING", items: ["Offers"] }]);
    expect(layout(["/employee-information"])).toEqual([{ label: "EMPLOYEE", items: ["Information"] }]);
    expect(layout(["/employee-onboarding"])).toEqual([{ label: "EMPLOYEE", items: ["Onboarding"] }]);
  });

  it("hides the groups whose Modules are not held, and lists no tab for Training or Performance yet", () => {
    const pages = ALL_PAGES.filter((href) => !["/job-postings", "/applicants", "/interviews", "/offers"].includes(href));

    expect(layout(pages).flatMap((s) => s.items)).toEqual(["Dashboard", "Information", "Onboarding"]);
    expect(layout(pages).map((s) => s.label)).not.toContain("RECRUITMENT");
    expect(layout(pages).map((s) => s.label)).not.toContain("HIRING");
    expect(layout(["/training", "/performance"])).toEqual([]);
  });

  it("retires the Hired page and redirects its URL to Employee Information", async () => {
    expect(existsSync(join(process.cwd(), "app/(hrms)/hired"))).toBe(false);
    expect(sidebarSections.flatMap((s) => s.items).map((i) => i.href)).not.toContain("/hired");
    const config = (await import("@/next.config")).default;
    expect(await config.redirects?.()).toContainEqual({ source: "/hired", destination: "/employee-information", permanent: true });
  });

  it("belongs every tab to a Module, with a page and a loading state", () => {
    const moduleNames = MODULES.map((m) => m.name);

    for (const item of sidebarSections.flatMap((s) => s.items)) {
      expect(moduleNames).toContain(item.module);
      const dir = join(process.cwd(), "app/(hrms)", item.href);
      expect(existsSync(join(dir, "page.tsx"))).toBe(true);
      expect(existsSync(join(dir, "loading.tsx"))).toBe(true);
    }
  });
});

describe("System links in the sidebar", () => {
  const load = async (env: Record<string, string | undefined>) => {
    vi.resetModules();
    for (const key of ["NEXT_PUBLIC_HOST_URL", "NEXT_PUBLIC_CRMS_URL", "NEXT_PUBLIC_HRMS_URL"]) {
      vi.stubEnv(key, env[key] as string);
      if (env[key] === undefined) delete process.env[key];
    }
    const mod = await import("@/components/layout/sidebar-nav");
    return Object.fromEntries(mod.systems.map((s) => [s.fullName, s.url]));
  };
  afterEach(() => vi.unstubAllEnvs());

  it("defaults Portal, CRM and HRMS to the Azure addresses, with no vercel.app left", async () => {
    const urls = await load({});
    expect(urls["Enterprise Portal"]).toBe("https://portal.buildwrite.me/");
    expect(urls["Customer Relationship Management"]).toBe("https://creoms.buildwrite.me/");
    expect(urls["Human Resource Management"]).toBe("https://hrms.buildwrite.me/");
  });

  it("uses the environment value when set", async () => {
    const urls = await load({
      NEXT_PUBLIC_HOST_URL: "https://p.test/",
      NEXT_PUBLIC_CRMS_URL: "https://c.test/",
      NEXT_PUBLIC_HRMS_URL: "https://h.test/",
    });
    expect(urls["Enterprise Portal"]).toBe("https://p.test/");
    expect(urls["Customer Relationship Management"]).toBe("https://c.test/");
    expect(urls["Human Resource Management"]).toBe("https://h.test/");
  });

  it("leaves the POS and IMS links unchanged", async () => {
    const urls = await load({});
    expect(urls["Point of Sale"]).toBe("https://web-pos-alpha-vert.vercel.app/");
    expect(urls["IMS - Inventory Management System"]).toBe("https://br-sims.vercel.app/");
  });
});
