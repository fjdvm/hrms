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
