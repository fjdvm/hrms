"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Calendar, Clock, Link2, Mail, MapPin, Pencil, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { updateTraining, type EditTrainingState } from "@/app/(hrms)/training/actions";
import { scheduleChangedEmail, scheduleLine } from "@/lib/training-email";
import { TRAINING_MODES, formatShortDate, manilaToday, scheduleDiffers, type TrainingMode, type TrainingTerms } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

const BOX = "flex items-center gap-[8px] rounded-lg border bg-white px-[12px] py-[9px] text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";

function Field({ label, htmlFor, required, optional, error, children }: { label: string; htmlFor: string; required?: boolean; optional?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">{label}{required && <span className="text-red-600">*</span>}{optional && <span className="font-normal text-zinc-400">(optional)</span>}</label>
      {children}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

type Props = {
  trainingId: number;
  /** What the Training is now. */
  training: TrainingTerms & { rescheduledFrom: string | null };
  /** The assigned Employees, for the Notify line and the email preview. */
  assigned: { name: string; email: string | null }[];
};

/** Edit a Training. A change to the date, time, Mode or venue shows Before and After and offers to notify the assigned Employees. */
export function EditTrainingDialog({ trainingId, training, assigned }: Props) {
  const [open, setOpen] = useState(false);
  // Closes once an edit has been saved; the page behind refreshes from the server action's revalidation.
  const [state, submit, pending] = useActionState(async (previous: EditTrainingState, data: FormData) => {
    const next = await updateTraining(trainingId, previous, data);
    if (next.result) setOpen(false);
    return next;
  }, {} as EditTrainingState);
  const [values, setValues] = useState<TrainingTerms>(training);
  const [notify, setNotify] = useState(true);
  const errors = state.fieldErrors ?? {};
  const set = (name: keyof TrainingTerms) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [name]: event.target.value }) as TrainingTerms);
  const box = (name: keyof typeof errors) => cn(BOX, errors[name] ? "border-destructive" : "border-zinc-200");

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) { setValues(training); setNotify(true); }
  }

  const moved = scheduleDiffers(values, training);
  const withEmail = assigned.filter((person) => person.email);
  const withoutEmail = assigned.length - withEmail.length;
  const sample = withEmail[0]?.name ?? "there";
  const preview = scheduleChangedEmail(sample, values, training);
  const place = values.mode === "Online" ? "Meeting link" : "Venue";
  const completeFor = (mode: TrainingMode) => (mode === values.mode ? "border-[1.5px] border-[#8b5cf6] bg-[#f5f0ff]" : "border-zinc-200 bg-white");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none"><Pencil className="size-4" aria-hidden />Edit</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <form action={submit} noValidate className="flex max-h-[90vh] flex-col">
          <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[14px] pl-[24px] pr-[18px] pt-[18px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Edit training</DialogTitle>
              <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{training.title}</DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
          </div>
          <div className="flex flex-col gap-[16px] overflow-y-auto px-[24px] py-[20px]">
            <Field label="Title" htmlFor="edit-title" required error={errors.title}>
              <div className={box("title")}><input id="edit-title" name="title" value={values.title} onChange={set("title")} maxLength={120} className={INPUT} /></div>
            </Field>
            <Field label="Trainer" htmlFor="edit-trainer" required error={errors.trainer}>
              <div className={box("trainer")}><input id="edit-trainer" name="trainer" value={values.trainer} onChange={set("trainer")} maxLength={80} className={INPUT} /></div>
            </Field>
            <Field label="Description" htmlFor="edit-description" error={errors.description}>
              <div className={cn(box("description"), "h-[72px] items-start")}><textarea id="edit-description" name="description" value={values.description} onChange={set("description")} maxLength={2000} className={cn(INPUT, "h-full resize-none")} /></div>
            </Field>
            <Field label="Objectives" htmlFor="edit-objectives" optional error={errors.objectives}>
              <div className={cn(box("objectives"), "h-[84px] items-start")}><textarea id="edit-objectives" name="objectives" value={values.objectives} onChange={set("objectives")} maxLength={2000} placeholder="One objective per line" className={cn(INPUT, "h-full resize-none")} /></div>
            </Field>
            <div className="flex flex-col gap-[16px] sm:flex-row">
              <Field label="Date" htmlFor="edit-date" required error={errors.date}>
                <div className={box("date")}><input id="edit-date" name="date" type="date" min={values.date < manilaToday() ? values.date : manilaToday()} value={values.date} onChange={set("date")} className={INPUT} /><Calendar className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
              <Field label="Start time" htmlFor="edit-start" required error={errors.startTime}>
                <div className={box("startTime")}><input id="edit-start" name="startTime" type="time" value={values.startTime} onChange={set("startTime")} className={INPUT} /><Clock className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
              <Field label="End time" htmlFor="edit-end" required error={errors.endTime}>
                <div className={box("endTime")}><input id="edit-end" name="endTime" type="time" value={values.endTime} onChange={set("endTime")} className={INPUT} /><Clock className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
            </div>
            <fieldset className="flex flex-col gap-[8px]">
              <legend className="mb-[8px] flex gap-[3px] text-[13px] font-medium text-zinc-800">Mode<span className="text-red-600">*</span></legend>
              <div className="flex gap-[10px]">
                {TRAINING_MODES.map((option) => (
                  <label key={option} className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-[10px] rounded-[10px] border px-[14px] py-[10px] text-sm font-medium text-zinc-900", completeFor(option))}>
                    <input type="radio" name="mode" value={option} checked={values.mode === option} onChange={set("mode")} className="size-4 accent-[#5b2a86]" />
                    {option === "Online" ? <Video className="size-4 text-zinc-600" aria-hidden /> : <MapPin className="size-4 text-zinc-600" aria-hidden />}{option}
                  </label>
                ))}
              </div>
            </fieldset>
            <Field label={place} htmlFor="edit-location" required error={errors.location}>
              <div className={box("location")}>
                {values.mode === "Online" ? <Link2 className="size-4 text-zinc-500" aria-hidden /> : <MapPin className="size-4 text-zinc-500" aria-hidden />}
                <input id="edit-location" name="location" value={values.location} onChange={set("location")} maxLength={300} className={INPUT} />
              </div>
            </Field>

            {moved && (
              <div data-testid="before-after" className="grid items-center gap-[12px] rounded-lg border border-[#e6e1ee] px-[14px] py-[12px] sm:grid-cols-[1fr_auto_1fr]">
                <div className="flex flex-col gap-[2px]"><span className="text-[11px] font-medium text-zinc-500">Before</span><span className="text-[13px] text-zinc-500 line-through">{scheduleLine(training)}</span></div>
                <ArrowRight className="size-4 text-primary" aria-hidden />
                <div className="flex flex-col gap-[2px]"><span className="text-[11px] font-medium text-primary">After</span><span className="text-[13px] font-medium text-zinc-900">{values.date && values.startTime && values.endTime ? scheduleLine(values) : "Choose a date and times"}</span></div>
              </div>
            )}

            {moved && (
              <>
                <div className="flex items-start gap-[12px]">
                  <div className="flex flex-1 flex-col gap-[2px]">
                    <span id="notify-label" className="text-sm font-medium text-zinc-900">Notify assigned employees</span>
                    <span className="text-xs text-zinc-500">
                      {withEmail.length} get a Schedule changed email.{withoutEmail > 0 ? ` ${withoutEmail} without an email need a reprinted schedule.` : ""}
                    </span>
                    {!notify && <span role="alert" className="text-xs text-amber-700">If you turn this off, they won’t know about the new date.</span>}
                  </div>
                  <Switch checked={notify} onCheckedChange={setNotify} aria-labelledby="notify-label" />
                  <input type="hidden" name="notify" value={notify ? "1" : "0"} />
                </div>
                {notify && (
                  <div className="flex flex-col gap-[6px] rounded-lg bg-muted px-[14px] py-[12px]">
                    <span className="flex items-center gap-[6px] text-[11px] font-semibold tracking-wide text-zinc-500"><Mail className="size-3" aria-hidden />EMAIL PREVIEW</span>
                    <span className="text-[13px] font-semibold text-zinc-900">{preview.title}</span>
                    <p className="whitespace-pre-line text-[13px] text-zinc-600">{preview.body}</p>
                  </div>
                )}
              </>
            )}
            {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
          </div>
          <div className="flex items-center gap-sm border-t border-[#ebebeb] px-[24px] py-[14px]">
            <p className="flex-1 text-xs text-zinc-500">
              {moved && values.date !== training.date ? `Status stays Upcoming. The list shows “Rescheduled from ${formatShortDate(training.date)}”.` : "Status is set automatically from the date."}
            </p>
            <DialogClose asChild><Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
            <Button type="submit" disabled={pending} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
