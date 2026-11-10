import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// No app polls: a repeating data timer or focus refetch in shipped source is a regression (ADR-0005 in the Portal repo).
// Allowed: timers that never touch the network (clocks, countdowns) and the WebSocket heartbeat, listed with the reason.
const root = path.resolve(import.meta.dirname, "..");
const roots = ["app","components","hooks","lib"];
const allowed: Record<string, string> = {};
const forbidden = /setInterval|refetchInterval|refetchOnWindowFocus|revalidateOnFocus/;

function sources(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === "node_modules" ? [] : sources(file);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : [];
  });
}

describe("no polling", () => {
  it("ships no repeating data timer or focus refetch", () => {
    const hits = roots
      .flatMap((r) => sources(path.join(root, r)))
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
      .filter((file) => forbidden.test(readFileSync(path.join(root, file), "utf8")) && !(file in allowed));
    expect(hits).toEqual([]);
  });
});
