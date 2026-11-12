import { Card } from "@/components/ui/card";
import { CardTitle } from "@/components/hiring/parts";
import type { EmployeeAudit, EmployeeHistory } from "@/lib/employees";
import { describeActivity, fieldLabel, formatChangeValue, formatEmployeeDate, hiredTerms } from "@/lib/employee-view";

function Entry({ title, children, meta }: { title: string; children?: React.ReactNode; meta: string }) {
  return (
    <li className="relative flex gap-[14px] border-b border-[#efebf4] py-[12px] last:border-b-0">
      <span aria-hidden className="mt-[6px] size-[8px] shrink-0 rounded-full bg-[#5b2a86]" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-sm font-medium text-[#1f1a2e]">{title}</span>
        {children}
        <span className="text-xs text-zinc-500">{meta}</span>
      </div>
    </li>
  );
}

const Empty = ({ children }: { children: string }) => <p className="py-[12px] text-sm text-zinc-500">{children}</p>;

/** Hired first, then each change with old and new values and the date it takes effect. The server lists newest first, so this reads it oldest first. */
export function EmploymentHistory({ history }: { history: EmployeeHistory[] }) {
  const ordered = [...history].reverse();
  return (
    <Card className="flex flex-col gap-[6px] rounded-xl px-[20px] py-[18px] shadow-none" aria-label="Employment history">
      <CardTitle>Employment history</CardTitle>
      {ordered.length === 0 ? <Empty>No history yet.</Empty> : (
        <ol className="flex flex-col">
          {ordered.map(entry => entry.kind === "Hired" ? (
            <Entry key={entry.id} title="Hired" meta={`Effective ${formatEmployeeDate(entry.effectiveDate)} · recorded by ${entry.actorName}`}>
              <p className="text-sm text-zinc-600">{hiredTerms(entry.newValue).join(" · ")}</p>
            </Entry>
          ) : (
            <Entry key={entry.id} title={`${fieldLabel(entry.field)} changed`} meta={`Effective ${formatEmployeeDate(entry.effectiveDate)} · recorded by ${entry.actorName}`}>
              <p className="text-sm text-zinc-600">{formatChangeValue(entry.field, entry.oldValue)} → {formatChangeValue(entry.field, entry.newValue)}</p>
            </Entry>
          ))}
        </ol>
      )}
    </Card>
  );
}

/** Who changed what and when, newest first, including automatic changes by "System". */
export function EmployeeActivity({ activity: audit }: { activity: EmployeeAudit[] }) {
  // Reveals are for the audit trail; listing them here would add a row to every page view.
  const activity = audit.filter(entry => entry.kind !== "reveal");
  return (
    <Card className="flex flex-col gap-[6px] rounded-xl px-[20px] py-[18px] shadow-none" aria-label="Activity">
      <CardTitle>Activity</CardTitle>
      {activity.length === 0 ? <Empty>No activity yet.</Empty> : (
        <ol className="flex flex-col">
          {activity.map(entry => (
            <Entry key={entry.id} title={describeActivity(entry)} meta={`${entry.actorName} · ${formatEmployeeDate(entry.occurredAt)} · ${new Date(entry.occurredAt.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}`} />
          ))}
        </ol>
      )}
    </Card>
  );
}
