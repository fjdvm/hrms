import type { EmployeeDetail, EmployeeSection, GovernmentIds } from "./employees";

export type FieldSpec = { name: string; label: string; kind?: "text" | "date" | "number" | "textarea"; required?: boolean };
export type EditSection = EmployeeSection | "governmentIds";
export type FormValues = Record<string, string>;
export type FormErrors = Record<string, string>;

export const SECTION_FORMS: Record<EditSection, { title: string; fields: FieldSpec[]; effectiveDate?: boolean }> = {
  personal: { title: "Personal information", fields: [
    { name: "name", label: "Full name", required: true }, { name: "birthday", label: "Birthday", kind: "date" },
    { name: "sex", label: "Sex" }, { name: "civilStatus", label: "Civil status" }, { name: "mobile", label: "Mobile" },
    { name: "email", label: "Email", required: true }, { name: "homeAddress", label: "Home address", kind: "textarea" },
  ] },
  employment: { title: "Employment", effectiveDate: true, fields: [
    { name: "position", label: "Position", required: true }, { name: "department", label: "Department" },
    { name: "branch", label: "Branch", required: true }, { name: "employmentType", label: "Employment type", required: true },
    { name: "startDate", label: "Start date", kind: "date", required: true }, { name: "probationEndDate", label: "Probation ends", kind: "date" },
    { name: "reportsTo", label: "Reports to", required: true }, { name: "schedule", label: "Work schedule", required: true },
  ] },
  emergencyContact: { title: "Emergency contact", fields: [
    { name: "name", label: "Name" }, { name: "relationship", label: "Relationship" }, { name: "mobile", label: "Mobile" },
  ] },
  governmentIds: { title: "Government IDs", fields: [
    { name: "sss", label: "SSS number" }, { name: "philhealth", label: "PhilHealth number" },
    { name: "pagibigMid", label: "Pag-IBIG MID" }, { name: "tin", label: "TIN" },
  ] },
  contract: { title: "Contract", effectiveDate: true, fields: [{ name: "monthlyPay", label: "Monthly pay (₱)", kind: "number", required: true }] },
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (v: string) => DATE.test(v) && new Date(v).toISOString().slice(0, 10) === v;

/** Mirrors the server's rules so errors appear inline before a request is sent; the server still has the final say. */
export function validateSection(section: EditSection, values: FormValues, today: string): FormErrors {
  const errors: FormErrors = {};
  for (const field of SECTION_FORMS[section].fields) {
    const value = (values[field.name] ?? "").trim();
    if (!value) { if (field.required) errors[field.name] = `${field.label.replace(" (₱)", "")} is required.`; continue; }
    if (value.length > (section === "governmentIds" ? 100 : 1000)) errors[field.name] = "Too long.";
    if (field.kind === "date" && !validDate(value)) errors[field.name] = "Enter a valid date.";
    else if (field.name === "birthday" && value > today) errors[field.name] = "Birthday can't be in the future.";
    if (field.name === "mobile" && !/^(09|\+639)\d{9}$/.test(value)) errors[field.name] = "Use 09XXXXXXXXX or +639XXXXXXXXX.";
    if (field.name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors[field.name] = "Enter a valid email address.";
    if (field.kind === "number" && !(/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 2147483647)) errors[field.name] = "Enter a whole peso amount of at least 1.";
  }
  const effective = (values.effectiveDate ?? "").trim();
  if (SECTION_FORMS[section].effectiveDate && effective && !validDate(effective)) errors.effectiveDate = "Enter a valid date.";
  return errors;
}

/** Only fields the user changed are sent, so history and audit record real changes. Empty optional fields become null. */
export function sectionPayload(section: EditSection, values: FormValues, initial: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of SECTION_FORMS[section].fields) {
    const value = (values[field.name] ?? "").trim();
    if (section !== "governmentIds" && value === (initial[field.name] ?? "").trim()) continue;
    payload[field.name] = field.kind === "number" ? Number(value) : value || null;
  }
  return payload;
}

export function initialValues(section: EditSection, employee: EmployeeDetail): FormValues {
  const pick = (source: Record<string, unknown>) => Object.fromEntries(SECTION_FORMS[section].fields.map(f => [f.name, source[f.name] == null ? "" : String(source[f.name])]));
  switch (section) {
    case "personal": return pick(employee.personal);
    case "employment": return pick({ ...employee.employment, employmentType: employee.contract.contractType });
    case "emergencyContact": return pick(typeof employee.emergencyContact === "string" ? {} : employee.emergencyContact);
    case "contract": return pick("monthlyPay" in employee.contract ? { monthlyPay: employee.contract.monthlyPay } : {});
    case "governmentIds": return pick({});
  }
}

export const idsToValues = (ids: Partial<GovernmentIds>): FormValues => Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v ?? ""]));
