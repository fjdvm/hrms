"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { confirmNoAttendance, resolveAttendanceDay } from "@/app/(hrms)/performance/actions";
import { checkReason, REASON_MAX_LENGTH } from "@/lib/performance-attendance-terms";
import { dateLabel } from "@/lib/performance-period-form";
import { cn } from "@/lib/utils";
import { Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help, InfoBox } from "./dialog-frame";

/** What HR is resolving: a day marked Excused, a day marked Absent, or the whole period with no attendance records. */
export type ResolveTarget = { kind: "excused"; date: string } | { kind: "absent"; date: string } | { kind: "none" };

type Props = {
  employeeId: number;
  periodId: number;
  employeeName: string;
  periodName: string;
  /** Scheduled days after the excused ones, so the Excused effect can say what they become. */
  countedDays: number;
  target: ResolveTarget | null;
  onClose: () => void;
};

const words = (target: ResolveTarget, countedDays: number) => {
  if (target.kind === "excused") {
    const day = dateLabel(target.date, false);
    return {
      title: `Mark ${day} as excused?`, submit: "Mark excused", required: false, subtitle: "time-in recorded, no time-out",
      effectTitle: "The day is left out of scheduled days",
      effect: `${day} no longer counts against the Attendance rate. Scheduled days become ${Math.max(countedDays - 1, 0)} and the score is recalculated. The attendance record is not edited.`,
    };
  }
  if (target.kind === "absent") {
    const day = dateLabel(target.date, false);
    return {
      title: `Mark ${day} as absent?`, submit: "Mark absent", required: true, subtitle: "time-in recorded, no time-out",
      effectTitle: "The day counts as absent",
      effect: `${day} stays a scheduled day with no attendance. Attendance rate and Punctuality are recalculated. The attendance record is not edited.`,
    };
  }
  return {
    title: "Confirm no attendance for this period?", submit: "Confirm no attendance", required: true, subtitle: "no attendance records",
    effectTitle: "The whole period counts as absent",
    effect: "Every scheduled day counts as absent, so the Attendance rate is 0. Punctuality and Full shift have no present days and are left out. Importing records for this employee later clears this.",
  };
};

function Form({ employeeId, periodId, target, countedDays, onClose }: Props & { target: ResolveTarget }) {
  const copy = words(target, countedDays);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const problem = checkReason(reason, copy.required);
  const shown = touched || reason !== "" ? problem : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem !== null || pending) return;
    start(async () => {
      const result = target.kind === "none" ? await confirmNoAttendance(employeeId, periodId, reason)
        : await resolveAttendanceDay(employeeId, periodId, target.date, target.kind === "excused" ? { type: "Excused", reason: reason === "" ? null : reason } : { type: "Absent", reason });
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(target.kind === "excused" ? "Day marked excused" : target.kind === "absent" ? "Day marked absent" : "No attendance confirmed");
      onClose();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="issue-reason" required={copy.required}>{copy.required ? "Reason" : "Reason (optional)"}</FieldLabel>
          <Textarea id="issue-reason" rows={3} value={reason} disabled={pending} aria-invalid={shown ? true : undefined} aria-describedby="issue-reason-help" aria-required={copy.required}
            onChange={(event) => { setReason(event.target.value); setFailure(undefined); }} onBlur={() => setTouched(true)}
            className={cn("rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none", shown && "border-[#9a3412]")} />
          <Help id="issue-reason-help" error={shown}>Shown with the {target.kind === "none" ? "period" : "day"} on the evaluation. Up to {REASON_MAX_LENGTH} characters.</Help>
        </div>
        <InfoBox icon={<Info aria-hidden className="size-[13px]" />} label="What happens" title={copy.effectTitle}>{copy.effect}</InfoBox>
        <Callout>This is recorded with your name and the reason above.</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit={copy.submit} canSubmit={problem === null} pending={pending} note="No email is sent." />
    </form>
  );
}

/** Mark day as excused, Mark day as absent, and Confirm no attendance: one dialog, three outcomes. Times are never edited by hand. */
export function ResolveIssueDialog(props: Props) {
  const { target, onClose, employeeName, periodName } = props;
  const copy = target ? words(target, props.countedDays) : null;
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {target && copy && (
        <DialogFrame title={copy.title} description={`${employeeName} · ${periodName} · ${copy.subtitle}`}>
          <Form key={target.kind === "none" ? "none" : `${target.kind}:${target.date}`} {...props} target={target} />
        </DialogFrame>
      )}
    </Dialog>
  );
}
