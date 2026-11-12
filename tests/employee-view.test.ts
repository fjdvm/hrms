import { expect, it } from "vitest";
import { describeActivity, formatChangeValue, hiredTerms } from "@/lib/employee-view";
import { sectionPayload, validateSection } from "@/lib/employee-edit-form";

it("describes edits, automatic status changes and reveals, keeping redacted values as they are", () => {
  expect(describeActivity({ kind: "edit", field: "position", oldValue: "Cashier", newValue: "Supervisor" })).toBe("Position changed from Cashier to Supervisor");
  expect(describeActivity({ kind: "status", field: "status", oldValue: "Onboarding", newValue: "Active" })).toBe("Status changed from Onboarding to Active");
  expect(describeActivity({ kind: "edit", field: "tin", oldValue: "[redacted]", newValue: "[redacted]" })).toBe("TIN changed from [redacted] to [redacted]");
  expect(describeActivity({ kind: "reveal", field: "sss", oldValue: null, newValue: null })).toBe("Viewed SSS number");
  expect(formatChangeValue("monthlyPay", 15500)).toBe("₱15,500");
  expect(formatChangeValue("department", null)).toBe("—");
});

it("lists a Hired entry's terms and leaves out pay when it is hidden", () => {
  expect(hiredTerms({ position: "Cashier", branch: "Cainta", monthlyPay: 19000 })).toEqual(["Position: Cashier", "Branch: Cainta", "Monthly pay: ₱19,000"]);
  expect(hiredTerms({ position: "Cashier" })).toEqual(["Position: Cashier"]);
});

it("validates a section inline with the server's rules", () => {
  expect(validateSection("personal", { name: "", email: "x", mobile: "123", birthday: "2999-01-01" }, "2026-11-13")).toEqual({
    name: "Full name is required.", email: "Enter a valid email address.", mobile: "Use 09XXXXXXXXX or +639XXXXXXXXX.", birthday: "Birthday can't be in the future." });
  expect(validateSection("contract", { monthlyPay: "0" }, "2026-11-13")).toHaveProperty("monthlyPay");
  expect(validateSection("emergencyContact", {}, "2026-11-13")).toEqual({});
});

it("sends only changed fields, and every ID field when replacing government IDs", () => {
  expect(sectionPayload("employment", { position: "Lead", branch: "Cainta" }, { position: "Cashier", branch: "Cainta" })).toEqual({ position: "Lead" });
  expect(sectionPayload("contract", { monthlyPay: "16000" }, { monthlyPay: "15500" })).toEqual({ monthlyPay: 16000 });
  expect(sectionPayload("governmentIds", { sss: "1", tin: "" }, {})).toEqual({ sss: "1", philhealth: null, pagibigMid: null, tin: null });
});
