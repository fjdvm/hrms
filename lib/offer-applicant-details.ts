import type { Database } from "./database";
import { encryptEmployeeId, decryptEmployeeId } from "./employee-encryption";
import { OfferError } from "./offers";

const ID_FIELDS = ["sss", "philhealth", "pagibigMid", "tin"] as const;
export type ApplicantDetails = {
  birthday: string | null; sex: string | null; civilStatus: string | null;
  governmentIds: Record<typeof ID_FIELDS[number], string | null>;
  emergencyContact: { name: string | null; relationship: string | null; mobile: string | null };
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OfferError("validation");
  return value as Record<string, unknown>;
};
function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new OfferError("validation");
  return value.trim() || null;
}
/** Full replacement: omitted and blank answers clear earlier answers. */
export function validateApplicantDetails(input: unknown): ApplicantDetails {
  const body = object(input);
  const birthday = optionalText(body.birthday, 10);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  if (birthday && (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(birthday) || !Number.isFinite(Date.parse(birthday))
    || new Date(birthday).toISOString().slice(0, 10) !== birthday || birthday > today)) throw new OfferError("validation");
  const ids = body.governmentIds == null ? {} : object(body.governmentIds);
  const contact = body.emergencyContact == null ? {} : object(body.emergencyContact);
  return {
    birthday, sex: optionalText(body.sex, 100), civilStatus: optionalText(body.civilStatus, 100),
    governmentIds: { sss: optionalText(ids.sss, 100), philhealth: optionalText(ids.philhealth, 100),
      pagibigMid: optionalText(ids.pagibigMid, 100), tin: optionalText(ids.tin, 100) },
    emergencyContact: { name: optionalText(contact.name, 200), relationship: optionalText(contact.relationship, 100), mobile: optionalText(contact.mobile, 100) },
  };
}
/** Negative Offer ids form a separate encryption context from positive Employee ids. */
export function encryptApplicantDetails(details: ApplicantDetails, offerId: number): ApplicantDetails {
  return { ...details, governmentIds: { ...details.governmentIds,
    ...Object.fromEntries(ID_FIELDS.map(field => [field, details.governmentIds[field] ? encryptEmployeeId(details.governmentIds[field], -offerId, field) : null])) } };
}
/** The stored answers, complete with nulls for anything unanswered, and the IDs decrypted for their owner. */
export function decryptApplicantDetails(stored: Partial<ApplicantDetails> | null, offerId: number): ApplicantDetails {
  const ids = stored?.governmentIds, contact = stored?.emergencyContact;
  return {
    birthday: stored?.birthday ?? null, sex: stored?.sex ?? null, civilStatus: stored?.civilStatus ?? null,
    governmentIds: Object.fromEntries(ID_FIELDS.map(field => [field, ids?.[field] ? decryptEmployeeId(ids[field], -offerId, field) : null])) as ApplicantDetails["governmentIds"],
    emergencyContact: { name: contact?.name ?? null, relationship: contact?.relationship ?? null, mobile: contact?.mobile ?? null },
  };
}
export async function readApplicantDetails(db: Database, offerId: number) {
  const { rows } = await db.query<{ details: Partial<ApplicantDetails>; revision: number }>(
    `SELECT applicant_details AS details, details_revision AS revision FROM public.hrms_offers WHERE id=$1`, [offerId]);
  return rows[0];
}
/** Rebind the encrypted IDs to the newly allocated Employee record; plaintext never enters SQL. */
export function employeeIdsFromDetails(details: Partial<ApplicantDetails>, offerId: number, employeeId: number) {
  return ID_FIELDS.map(field => {
    const envelope = details.governmentIds?.[field];
    return envelope ? encryptEmployeeId(decryptEmployeeId(envelope, -offerId, field), employeeId, field) : null;
  });
}
