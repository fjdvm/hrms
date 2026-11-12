import Link from "next/link";
import { Eye, File, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CardTitle } from "@/components/hiring/parts";
import { EMPTY_EMPLOYEE_SECTION, type EmployeeDetail, type GovernmentIds } from "@/lib/employees";
import { RevealableId } from "./edit-section";
import { DownloadDocumentsButton } from "./download-documents-button";
import {
  NOT_PROVIDED, documentSummary, validUntilLabel, formatBirthday, formatEmployeeDate, formatMonthlyPay, isSubmitted, orNotProvided, submittedCount,
  type EmployeeDocument,
} from "@/lib/employee-view";

const MISSING = "text-zinc-500";

function Field({ label, children, missing }: { label: string; children: React.ReactNode; missing?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className={`break-words text-sm ${missing ? MISSING : "text-[#1f1a2e]"}`}>{children}</dd>
    </div>
  );
}
const text = (label: string, value: string | null | undefined) => (
  <Field key={label} label={label} missing={!value?.trim()}>{orNotProvided(value)}</Field>
);

function Section({ title, aside, cols = "sm:grid-cols-3", children }: { title: string; aside?: React.ReactNode; cols?: string; children: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none" aria-label={title}>
      <CardTitle aside={aside}>{title}</CardTitle>
      <dl className={`grid gap-x-[16px] gap-y-[14px] ${cols}`}>{children}</dl>
    </Card>
  );
}

const Empty = () => <p className={`text-sm ${MISSING} sm:col-span-full`}>{EMPTY_EMPLOYEE_SECTION}</p>;

export function PersonalInformation({ personal, edit }: { personal: EmployeeDetail["personal"]; edit?: React.ReactNode }) {
  return (
    <Section title="Personal information" aside={edit}>
      {text("Full name", personal.name)}
      <Field label="Birthday" missing={!personal.birthday}>{formatBirthday(personal.birthday, personal.age)}</Field>
      {text("Sex", personal.sex)}
      {text("Civil status", personal.civilStatus)}
      {text("Mobile", personal.mobile)}
      {text("Email", personal.email)}
      {text("Home address", personal.homeAddress)}
    </Section>
  );
}

export function Employment({ employment, employmentType, edit }: { employment: EmployeeDetail["employment"]; employmentType: string; edit?: React.ReactNode }) {
  const { hiredFrom } = employment;
  return (
    <Section title="Employment" aside={edit}>
      {text("Position", employment.position)}
      {text("Department", employment.department)}
      {text("Branch", employment.branch)}
      {text("Employment type", employmentType)}
      {text("Start date", formatEmployeeDate(employment.startDate))}
      <Field label="Probation ends" missing={!employment.probationEndDate}>{formatEmployeeDate(employment.probationEndDate)}</Field>
      {text("Reports to", employment.reportsTo)}
      {text("Work schedule", employment.schedule)}
      <Field label="Hired from">
        <Link href={hiredFrom.offerUrl} className="text-primary hover:underline">Offer #{hiredFrom.offerId}</Link>
        {" · "}
        <Link href={hiredFrom.applicationUrl} className="text-primary hover:underline">Application #{hiredFrom.applicationId}</Link>
      </Field>
    </Section>
  );
}

const ID_LABELS: [keyof GovernmentIds, string][] = [["sss", "SSS number"], ["philhealth", "PhilHealth number"], ["pagibigMid", "Pag-IBIG MID"], ["tin", "TIN"]];

/** Values arrive masked for everyone; a role that may see them gets a reveal button that asks the server on click. */
export function GovernmentIdsSection({ ids, employeeId, canReveal, edit }: { ids: EmployeeDetail["governmentIds"]; employeeId: number; canReveal: boolean; edit?: React.ReactNode }) {
  return (
    <Section title="Government IDs" cols="sm:grid-cols-2 lg:grid-cols-4" aside={
      <>
        <span className="flex items-center gap-[6px] text-xs font-medium text-zinc-500"><Lock aria-hidden className="size-[14px]" />Visible to HR only</span>
        {edit}
      </>
    }>
      {typeof ids === "string" ? <Empty /> : ID_LABELS.map(([key, label]) => ids[key] && canReveal
        ? <Field key={key} label={label}><RevealableId employeeId={employeeId} field={key} masked={ids[key]!} /></Field>
        : text(label, ids[key]))}
    </Section>
  );
}

export function EmergencyContact({ contact, edit }: { contact: EmployeeDetail["emergencyContact"]; edit?: React.ReactNode }) {
  return (
    <Section title="Emergency contact" aside={edit}>
      {typeof contact === "string" ? <Empty /> : <>{text("Name", contact.name)}{text("Relationship", contact.relationship)}{text("Mobile", contact.mobile)}</>}
    </Section>
  );
}

function ViewLink({ document }: { document: EmployeeDocument }) {
  if (!document.viewUrl) return null;
  return (
    <a href={document.viewUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${document.label}`}
      className="shrink-0 rounded-md p-1 text-zinc-500 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring">
      <Eye className="size-4" />
    </a>
  );
}

/** The Details tab's compact Documents card. */
export function DocumentsCard({ employeeId, documents }: { employeeId: number; documents: EmployeeDocument[] }) {
  const count = submittedCount(documents);
  return (
    <Card className="flex flex-col gap-[6px] rounded-xl px-[20px] py-[18px] shadow-none" aria-label="Documents">
      <CardTitle aside={<span className={`text-[13px] font-semibold ${count === documents.length ? "text-[#15803d]" : "text-amber-700"}`}>{count} of {documents.length}</span>}>Documents</CardTitle>
      <ul className="flex flex-col">
        {documents.map((document) => (
          <li key={document.type} className="flex items-center gap-[10px] border-b border-[#efebf4] py-[8px]">
            <File aria-hidden className="size-4 shrink-0 text-zinc-500" />
            <div className="flex min-w-0 flex-1 flex-col gap-px">
              <span className="truncate text-[13px] font-medium text-zinc-900">{document.label}</span>
              <span className="truncate text-[11px] text-zinc-500">{documentSummary(document)}</span>
            </div>
            <ViewLink document={document} />
          </li>
        ))}
      </ul>
      <div className="mt-[8px]"><DownloadDocumentsButton employeeId={employeeId} hasSubmitted={count > 0} /></div>
    </Card>
  );
}

/** The Documents tab: the same seven, with upload date and validity spelled out. */
export function DocumentsTable({ employeeId, documents }: { employeeId: number; documents: EmployeeDocument[] }) {
  return (
    <Card className="flex flex-col gap-[6px] rounded-xl px-[20px] py-[18px] shadow-none" aria-label="Pre-employment documents">
      <CardTitle aside={<span className="text-[13px] font-semibold text-zinc-500">{submittedCount(documents)} of {documents.length}</span>}>Pre-employment documents</CardTitle>
      <ul className="flex flex-col">
        {documents.map((document) => (
          <li key={document.type} className="flex flex-wrap items-center gap-x-[16px] gap-y-[4px] border-b border-[#efebf4] py-[10px] last:border-b-0">
            <File aria-hidden className="size-4 shrink-0 text-zinc-500" />
            <div className="flex min-w-[180px] flex-1 flex-col gap-px">
              <span className="text-sm font-medium text-zinc-900">{document.label}</span>
              <span className="truncate text-xs text-zinc-500">{document.fileName ?? document.hint}</span>
            </div>
            <span className="w-[140px] text-sm text-[#1f1a2e]">{isSubmitted(document) ? `Uploaded ${formatEmployeeDate(document.uploadedAt)}` : NOT_PROVIDED}</span>
            <span className="w-[170px] text-sm text-zinc-500">{document.validUntil ? validUntilLabel(document.validUntil) : ""}</span>
            {isSubmitted(document) ? <Badge variant="success">Submitted</Badge> : <Badge variant="warning">Missing</Badge>}
            {document.viewUrl ? (
              <a href={document.viewUrl} target="_blank" rel="noopener noreferrer" aria-label={`View ${document.label}`}
                className="flex items-center gap-[6px] rounded-lg border border-[#e6e1ee] px-[12px] py-[6px] text-[13px] font-medium text-[#1f1a2e] hover:bg-zinc-50">
                <Eye className="size-[14px]" />View
              </a>
            ) : <span className="w-[72px]" />}
          </li>
        ))}
      </ul>
      <div className="mt-[8px]"><DownloadDocumentsButton employeeId={employeeId} hasSubmitted={submittedCount(documents) > 0} /></div>
    </Card>
  );
}

export function Contract({ contract, edit }: { contract: EmployeeDetail["contract"]; edit?: React.ReactNode }) {
  return (
    <Section title="Contract" cols="grid-cols-1" aside={edit}>
      <Field label="Offer letter">{contract.offerLetterSigned ? "Signed" : "Not signed"}</Field>
      {text("Contract type", contract.contractType)}
      {"monthlyPay" in contract && typeof contract.monthlyPay === "number" && <Field label="Monthly pay">{formatMonthlyPay(contract.monthlyPay)}</Field>}
    </Section>
  );
}
