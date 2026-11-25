import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("sonner", () => ({ Toaster: () => null }));

import { Toaster } from "@/components/ui/sonner";

type SonnerProps = { richColors?: boolean; position?: string };

describe("Toaster", () => {
  it("uses rich colours in the bottom-right corner, like every other System", () => {
    const el = Toaster({}) as ReactElement<SonnerProps>;
    expect(el.props.richColors).toBe(true);
    expect(el.props.position).toBe("bottom-right");
  });
});
