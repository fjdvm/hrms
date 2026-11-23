import { describe, expect, it } from "vitest";
import type { LinkedAccount, LinkedEmployee } from "@/lib/performance-links";
import { accountName, employeeLine, linkMessage, linkedLine, linkedOn, unlinkReady, unlinkSubtitle } from "@/lib/performance-pos-links-terms";

const account = (extra: Partial<LinkedAccount> = {}): LinkedAccount => ({ linkId: 1, portalUserId: "u-1", name: "Carla Mendoza", branch: "Cainta branch", linkedByName: "Ada Okafor", linkedAt: "2026-11-20 10:15:00.123+00", linkReason: null, current: true, ...extra });
const person = (accounts: LinkedAccount[]): LinkedEmployee => ({ employeeId: 17, employeeNumber: "BR-EMP-0017", name: "Carla Mendoza", position: "Branch Cashier", accounts });

describe("the POS cashier links words", () => {
  it("writes dates on the Manila day, from the database's text or ISO", () => {
    expect(linkedOn("2026-11-20 10:15:00.123+00")).toBe("20 Nov 2026");
    expect(linkedOn("2026-11-20T18:30:00Z")).toBe("21 Nov 2026");
    expect(linkedOn("2026-11-12 03:00:00")).toBe("12 Nov 2026");
    expect(linkedOn("2026-12-31T16:00:00+00:00")).toBe("1 Jan 2027");
  });

  it("words each line of the Linked list as the frame does", () => {
    expect(linkedLine(account())).toBe("linked 20 Nov 2026 by Ada Okafor");
    expect(employeeLine(person([account(), account({ linkId: 2, current: false })]))).toBe("BR-EMP-0017 · Branch Cashier · 2 POS accounts");
    expect(employeeLine(person([account()]))).toBe("BR-EMP-0017 · Branch Cashier · 1 POS account");
    expect(unlinkSubtitle(person([]), account({ linkedAt: "2026-11-12 03:00:00+00" }))).toBe("Carla Mendoza (Cainta branch, linked 12 Nov 2026) from BR-EMP-0017");
    expect(unlinkSubtitle(person([]), account({ branch: null, name: null }))).toBe("Unnamed POS account (linked 20 Nov 2026) from BR-EMP-0017");
    expect(accountName(account({ name: null }))).toBe("Unnamed POS account");
  });

  it("is ready to unlink only with a reason, and a note for Other", () => {
    expect(unlinkReady("", "")).toBe(false);
    expect(unlinkReady("Made up", "")).toBe(false);
    expect(unlinkReady("Wrong person linked", "")).toBe(true);
    expect(unlinkReady("Linked to the wrong POS account", "  ")).toBe(true);
    expect(unlinkReady("Other", "")).toBe(false);
    expect(unlinkReady("Other", "   ")).toBe(false);
    expect(unlinkReady("Other", "Left the company")).toBe(true);
    expect(unlinkReady("Wrong person linked", "x".repeat(301))).toBe(false);
    expect(unlinkReady("Other", "x".repeat(300))).toBe(true);
  });

  it("has words for a refused unlink", () => {
    expect(linkMessage("note-required")).toBe("Add a note for Other.");
    expect(linkMessage("already-unlinked")).toMatch(/already unlinked/);
    expect(linkMessage("something-new")).toBe("The link could not be changed.");
  });
});
