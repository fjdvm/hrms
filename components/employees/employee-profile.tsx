import Link from "next/link";
import { ClipboardCheck, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, ProfileColumns } from "@/components/hiring/parts";
import { initialsOf } from "@/lib/hiring-mock";
import type { EmployeeDetail } from "@/lib/employees";
import { ONBOARDING_ROW_URL, headerSubtitle, submittedCount } from "@/lib/employee-view";
import { EmployeeTabs } from "./employee-tabs";
import { ComingSoon, Contract, DocumentsCard, DocumentsTable, EmergencyContact, Employment, GovernmentIdsSection, PersonalInformation } from "./employee-sections";

export function EmployeeProfile({ employee }: { employee: EmployeeDetail }) {
  const { personal, employment, documents } = employee;
  return (
    <>
      <BackLink href="/employee-information">Employee information</BackLink>
      <div className="flex flex-wrap items-center gap-[16px]">
        <span aria-hidden className="flex size-[56px] shrink-0 items-center justify-center rounded-full bg-[#efe6f8] text-lg font-semibold text-[#5b2a86]">{initialsOf(personal.name)}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
          <div className="flex flex-wrap items-center gap-[10px]">
            <h1 className="text-2xl font-semibold text-[#1f1a2e]">{personal.name}</h1>
            <Badge variant={employment.status === "Onboarding" ? "info" : "success"}>{employment.status}</Badge>
          </div>
          <p className="text-sm text-[#6e6680]">{headerSubtitle(employee)}</p>
        </div>
        <Button asChild variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">
          <Link href={ONBOARDING_ROW_URL(employee.id)}><ClipboardCheck /> View onboarding</Link>
        </Button>
        {/* Editing arrives in its own slice; the button holds its place from the Figma. */}
        <Button disabled className="h-auto rounded-lg bg-[#5b2a86] px-[14px] py-[9px]"><Pencil /> Edit details</Button>
      </div>
      <EmployeeTabs
        documentCount={submittedCount(documents)}
        details={
          <ProfileColumns
            main={<><PersonalInformation personal={personal} /><Employment employment={employment} employmentType={employee.contract.contractType} /><GovernmentIdsSection ids={employee.governmentIds} /><EmergencyContact contact={employee.emergencyContact} /></>}
            aside={<><DocumentsCard documents={documents} /><Contract contract={employee.contract} /></>}
          />
        }
        documents={<DocumentsTable documents={documents} />}
        history={<ComingSoon title="Employment history" />}
        activity={<ComingSoon title="Activity" />}
      />
    </>
  );
}
