import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackLink, ProfileColumns } from "@/components/hiring/parts";
import { initialsOf } from "@/lib/hiring-mock";
import type { EmployeeAudit, EmployeeDetail, EmployeeHistory } from "@/lib/employees";
import { initialValues } from "@/lib/employee-edit-form";
import { EditSectionButton } from "./edit-section";
import { EmployeeActivity, EmploymentHistory } from "./employee-timeline";
import { ONBOARDING_ROW_URL, headerSubtitle, submittedCount } from "@/lib/employee-view";
import { EmployeeTabs } from "./employee-tabs";
import { Contract, DocumentsCard, DocumentsTable, EmergencyContact, Employment, GovernmentIdsSection, PersonalInformation } from "./employee-sections";

export function EmployeeProfile({ employee, history, activity }: { employee: EmployeeDetail; history: EmployeeHistory[]; activity: EmployeeAudit[] }) {
  const { personal, employment, documents, canEdit } = employee;
  const edit = (section: Parameters<typeof initialValues>[0], allowed = true) => allowed
    ? <EditSectionButton employeeId={employee.id} section={section} initial={initialValues(section, employee)} /> : undefined;
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
        <EditSectionButton primary label="Edit details" employeeId={employee.id} section="personal" initial={initialValues("personal", employee)} />
      </div>
      <EmployeeTabs
        documentCount={submittedCount(documents)}
        details={
          <ProfileColumns
            main={<><PersonalInformation personal={personal} edit={edit("personal")} /><Employment employment={employment} employmentType={employee.contract.contractType} edit={edit("employment")} /><GovernmentIdsSection ids={employee.governmentIds} employeeId={employee.id} canReveal={canEdit.governmentIds} edit={edit("governmentIds", canEdit.governmentIds)} /><EmergencyContact contact={employee.emergencyContact} edit={edit("emergencyContact")} /></>}
            aside={<><DocumentsCard employeeId={employee.id} documents={documents} /><Contract contract={employee.contract} edit={edit("contract", canEdit.contract)} /></>}
          />
        }
        documents={<DocumentsTable employeeId={employee.id} documents={documents} />}
        history={<EmploymentHistory history={history} />}
        activity={<EmployeeActivity activity={activity} />}
      />
    </>
  );
}
