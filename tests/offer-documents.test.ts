import { describe, expect, it } from "vitest";
import {
  DOCUMENT_COUNT, defaultDueDate, defaultMessage, isDocumentOverdue, matchDocumentType, requestEmail, requestProblem, requestSummary,
} from "@/lib/offer-documents";

describe("matching an Application Document to the seven types", () => {
  it("matches what the Job Posting asked for, and falls back to the file name", () => {
    expect(matchDocumentType("Resume or CV")).toBe("resume");
    expect(matchDocumentType("Valid government ID")).toBe("valid-id");
    expect(matchDocumentType("Health certificate")).toBe("health");
    expect(matchDocumentType("NBI clearance")).toBe("nbi");
    expect(matchDocumentType("Pag-IBIG MID and TIN")).toBe("pagibig");
    expect(matchDocumentType(undefined, "Juan_Resume.pdf")).toBe("resume");
    expect(matchDocumentType("Other", "nbi-clearance.pdf")).toBe("nbi");
  });

  it("tells PhilHealth from the health certificate and SSS from a general ID", () => {
    expect(matchDocumentType("PhilHealth ID")).toBe("philhealth");
    expect(matchDocumentType("Phil Health MDR")).toBe("philhealth");
    expect(matchDocumentType("SSS ID")).toBe("sss");
    expect(matchDocumentType("Medical certificate")).toBe("health");
  });

  it("leaves a document that is none of the seven unmatched", () => {
    expect(matchDocumentType("Birth certificate")).toBeNull();
    expect(matchDocumentType("", null, undefined)).toBeNull();
  });
});

describe("requesting documents", () => {
  const ok = { types: ["nbi", "health"], dueDate: "2026-11-20", message: "Please hurry" };
  const today = "2026-11-11";

  it("accepts a valid request, with or without a message", () => {
    expect(requestProblem(ok, today)).toBeUndefined();
    expect(requestProblem({ types: ["nbi"], dueDate: today }, today)).toBeUndefined();
  });

  it("refuses an empty, unknown or repeated choice", () => {
    for (const types of [[], ["passport"], ["nbi", "nbi"], "nbi", undefined]) expect(requestProblem({ ...ok, types }, today)).toMatch(/at least one document/);
  });

  it("refuses a missing, impossible or past due date, and an over-long message", () => {
    expect(requestProblem({ ...ok, dueDate: "" }, today)).toMatch(/date they should submit by/);
    expect(requestProblem({ ...ok, dueDate: "2026-02-30" }, today)).toMatch(/date they should submit by/);
    expect(requestProblem({ ...ok, dueDate: "2026-11-10" }, today)).toMatch(/past/);
    expect(requestProblem({ ...ok, message: "x".repeat(501) }, today)).toMatch(/500/);
  });

  it("flags only a Requested document past its due date", () => {
    expect(isDocumentOverdue("Requested", "2026-11-10", today)).toBe(true);
    expect(isDocumentOverdue("Requested", today, today)).toBe(false);
    expect(isDocumentOverdue("Requested", null, today)).toBe(false);
    expect(isDocumentOverdue("Submitted", "2026-11-10", today)).toBe(false);
    expect(isDocumentOverdue("Not requested", "2026-11-10", today)).toBe(false);
  });

  it("suggests five days before the start date, never in the past", () => {
    expect(defaultDueDate("2026-11-10", "2026-11-01")).toBe("2026-11-05");
    expect(defaultDueDate("2026-11-10", "2026-11-08")).toBe("2026-11-08");
    expect(defaultMessage("Ellaine Torres", "2026-11-05")).toBe("Hi Ellaine, please upload these before 5 Nov so we can prepare your first day. Thank you!");
  });

  it("words the email with the documents, the due date and the message", () => {
    const email = requestEmail({ applicantName: "Ellaine Torres", role: "Branch Cashier", types: ["nbi", "pagibig"], dueDate: "2026-11-05", message: " Thank you! " });
    expect(email.title).toBe("Documents we need for your Branch Cashier job offer");
    for (const text of ["Dear Ellaine Torres", "5 Nov 2026", "- NBI clearance", "- Pag-IBIG MID and TIN", "Thank you!"]) expect(email.body).toContain(text);
    expect(requestEmail({ applicantName: "A B", role: "R", types: ["nbi"], dueDate: "2026-11-05" }).body).not.toContain("undefined");
    expect(requestSummary(["nbi", "health"], "2026-11-05")).toBe("NBI clearance, Health certificate · due 5 Nov 2026");
    expect(DOCUMENT_COUNT).toBe(7);
  });
});
