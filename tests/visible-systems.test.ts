import { describe, expect, it } from "vitest";
import { systems, visibleSystems } from "@/components/layout/sidebar-nav";

const names = (allowed: string[] | null) => visibleSystems(systems, allowed).map((s) => s.portalName ?? "portal");

describe("module switcher access", () => {
  it("always keeps the Enterprise Portal and the open System", () => {
    const open = systems.find((s) => s.active)!.portalName ?? "";
    expect(names(null)).toEqual(["portal", open]);
    expect(names([])).toEqual(["portal", open]);
  });

  it("shows only the Systems the Admin granted", () => {
    const open = systems.find((s) => s.active)!.portalName ?? "";
    const other = systems.find((s) => s.portalName && !s.active)!.portalName!;
    expect(names([other])).toEqual(expect.arrayContaining(["portal", open, other]));
    expect(names([other])).toHaveLength(3);
  });

  it("ignores a grant for a System that does not exist", () => {
    expect(names(["NOPE"])).toHaveLength(2);
  });
});

describe("module switcher entries a person sees", () => {
  const shown = (allowed: string[] | null) => visibleSystems(systems, allowed).map((s) => s.fullName);

  it("shows the Portal, CREOMS, HRMS and IMS to someone granted those three", () => {
    expect(shown(["CRMS", "HRMS", "IMS"])).toEqual([
      "Enterprise Portal", "Customer Relation and Ecommerce Ordering Management System", "Human Resource Management", "IMS - Inventory Management System",
    ]);
  });

  it("gives CREOMS its full name, without the retired marketing Module", () => {
    const creoms = systems.find((s) => s.portalName === "CRMS")!;
    expect(creoms.fullName).toBe("Customer Relation and Ecommerce Ordering Management System");
    expect(creoms.desc).not.toMatch(/marketing/i);
  });
});
