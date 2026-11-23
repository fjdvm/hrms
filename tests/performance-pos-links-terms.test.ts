import { describe, expect, it } from "vitest";
import type { LinkedAccount, LinkedEmployee } from "@/lib/performance-links";
import { accountName, accountSource, candidateLine, candidateMatches, candidateTag, linkMessage, linkReady, linkedLine, linkedOn, needsLinkingLabel, needsReason, ordersLine, salesSpan, unlinkReady, unlinkSubtitle, unlinkedSubtitle, employeeLine, NEW_ACCOUNT_REASON } from "@/lib/performance-pos-links-terms";

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

  it("words the Needs linking tab and the Link cashier dialog as the frames do", () => {
    expect(needsLinkingLabel(2)).toBe("Needs linking 2");
    expect(unlinkedSubtitle(1)).toBe("1 POS account has sales but is not linked to an employee");
    expect(unlinkedSubtitle(2)).toBe("2 POS accounts have sales but are not linked to an employee");
    expect(accountSource({ branch: "Cainta branch" })).toBe("Portal account · Cainta branch");
    expect(accountSource({ branch: null })).toBe("Portal account");
    expect(accountSource({ branch: "Cainta branch" }, "1012")).toBe("Portal account · Cainta branch · staff no. 1012");
    expect(salesSpan("2026-11-03", "2026-11-20")).toBe("November 2026");
    expect(salesSpan("2026-10-30", "2026-11-02")).toBe("October – November 2026");
    expect(salesSpan("2026-12-30", "2027-01-02")).toBe("December 2026 – January 2027");
    expect(ordersLine({ orders: 38, from: "2026-11-03", to: "2026-11-20" })).toBe("38 orders · November 2026");
  });

  it("tags and matches picker candidates, and is ready only for a cashier (with the reason when they hold an account)", () => {
    const cashier = { isCashier: true, accountCount: 0 };
    expect(candidateLine({ employeeNumber: "BR-EMP-0017", position: "Branch Cashier", branch: "Cainta branch" })).toBe("BR-EMP-0017 · Branch Cashier · Cainta branch");
    expect(candidateTag({ isCashier: false, accountCount: 0 })).toBe("Not a cashier position");
    expect(candidateTag({ isCashier: false, accountCount: 2 })).toBe("Not a cashier position");
    expect(candidateTag({ isCashier: true, accountCount: 1 })).toBe("Has 1 POS account");
    expect(candidateTag({ isCashier: true, accountCount: 2 })).toBe("Has 2 POS accounts");
    expect(candidateTag(cashier)).toBeNull();
    expect(candidateMatches({ name: "Carla Mendoza", employeeNumber: "BR-EMP-0017" }, "  CARLA   mend ")).toBe(true);
    expect(candidateMatches({ name: "Carla Mendoza", employeeNumber: "BR-EMP-0017" }, "0017")).toBe(true);
    expect(candidateMatches({ name: "Carla Mendoza", employeeNumber: "BR-EMP-0017" }, "reyes")).toBe(false);
    expect(linkReady(null, "")).toBe(false);
    expect(linkReady({ isCashier: false, accountCount: 0 }, "")).toBe(false);
    expect(linkReady(cashier, "")).toBe(true);
    expect(linkReady({ isCashier: true, accountCount: 1 }, "")).toBe(false);
    expect(linkReady({ isCashier: true, accountCount: 1 }, NEW_ACCOUNT_REASON)).toBe(true);
    expect(needsReason({ accountCount: 1 })).toBe(true);
    expect(needsReason({ accountCount: 0 })).toBe(false);
    expect(needsReason(null)).toBe(false);
    expect(linkMessage("not-cashier")).toBe("Not a cashier position");
  });
});
