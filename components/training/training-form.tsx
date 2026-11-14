"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Bell, Calendar, Clock, MapPin, Printer, UserPlus, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveTraining, type SaveTrainingState } from "@/app/(hrms)/training/actions";
import { TRAINING_MODES, type TrainingMode } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

const BOX = "flex items-center gap-[8px] rounded-lg border bg-white px-[12px] py-[9px] text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";
const SECTION = "flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none";

function Field({ label, htmlFor, required, optional, error, hint, children }: {
  label: string; htmlFor: string; required?: boolean; optional?: boolean; error?: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">
        {label}
        {required && <span className="text-red-600">*</span>}
        {optional && <span className="font-normal text-zinc-400">(optional)</span>}
      </label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

const MODE_COPY: Record<TrainingMode, { icon: typeof Video; hint: string }> = {
  Online: { icon: Video, hint: "Share a meeting link" },
  "In person": { icon: MapPin, hint: "Set a venue" },
};

const REQUIRED = ["title", "trainer", "date", "startTime", "endTime", "location"] as const;

/** The New training form: one dated session, no materials yet. Saving returns to the list. */
export function TrainingForm({ today }: { today: string }) {
  const [state, submit, pending] = useActionState(saveTraining, {} as SaveTrainingState);
  const errors = state.fieldErrors ?? {};
  const [values, setValues] = useState<Record<string, string>>({ mode: "In person" });
  const value = (name: string) => values[name] ?? state.values?.[name] ?? "";
  const set = (name: string) => (event: { target: { value: string } }) => setValues((current) => ({ ...current, [name]: event.target.value }));
  const mode = (value("mode") || "In person") as TrainingMode;
  const ready = REQUIRED.every((name) => value(name).trim() !== "");
  const box = (name: keyof typeof errors) => cn(BOX, errors[name] ? "border-destructive" : "border-zinc-200");

  return (
    <form action={submit} noValidate className="flex flex-col">
      <div className="flex flex-col items-start gap-[16px] px-md py-[16px] sm:px-xl lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[16px]">
          <Card className={SECTION}>
            <h2 className="text-[15px] font-semibold text-zinc-900">Details</h2>
            <Field label="Title" htmlFor="training-title" required error={errors.title}>
              <div className={box("title")}><input id="training-title" name="title" value={value("title")} onChange={set("title")} maxLength={120} placeholder="e.g. Food safety and hygiene refresher" className={INPUT} /></div>
            </Field>
            <Field label="Trainer" htmlFor="training-trainer" required error={errors.trainer}>
              <div className={box("trainer")}><input id="training-trainer" name="trainer" value={value("trainer")} onChange={set("trainer")} maxLength={80} placeholder="Type a trainer" className={INPUT} /></div>
            </Field>
            <Field label="Description" htmlFor="training-description" error={errors.description}>
              <div className={cn(box("description"), "h-[72px] items-start")}><textarea id="training-description" name="description" value={value("description")} onChange={set("description")} maxLength={2000} placeholder="What the training covers" className={cn(INPUT, "h-full resize-none")} /></div>
            </Field>
            <Field label="Objectives" htmlFor="training-objectives" optional error={errors.objectives}>
              <div className={cn(box("objectives"), "h-[84px] items-start")}><textarea id="training-objectives" name="objectives" value={value("objectives")} onChange={set("objectives")} maxLength={2000} placeholder="One objective per line" className={cn(INPUT, "h-full resize-none")} /></div>
            </Field>
          </Card>
          <Card className={SECTION}>
            <h2 className="text-[15px] font-semibold text-zinc-900">Schedule</h2>
            <div className="flex flex-col gap-[16px] sm:flex-row">
              <Field label="Date" htmlFor="training-date" required error={errors.date}>
                <div className={box("date")}><input id="training-date" name="date" type="date" min={today} value={value("date")} onChange={set("date")} className={INPUT} /><Calendar className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
              <Field label="Start time" htmlFor="training-start" required error={errors.startTime}>
                <div className={box("startTime")}><input id="training-start" name="startTime" type="time" value={value("startTime")} onChange={set("startTime")} className={INPUT} /><Clock className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
              <Field label="End time" htmlFor="training-end" required error={errors.endTime}>
                <div className={box("endTime")}><input id="training-end" name="endTime" type="time" value={value("endTime")} onChange={set("endTime")} className={INPUT} /><Clock className="size-4 text-zinc-500" aria-hidden /></div>
              </Field>
            </div>
            <fieldset className="flex flex-col gap-[8px]">
              <legend className="mb-[8px] flex gap-[3px] text-[13px] font-medium text-zinc-800">Mode<span className="text-red-600">*</span></legend>
              <div className="flex flex-col gap-[10px] sm:flex-row">
                {TRAINING_MODES.map((option) => {
                  const { icon: Icon, hint } = MODE_COPY[option];
                  const chosen = option === mode;
                  return (
                    <label key={option} className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] rounded-[10px] border px-[14px] py-[12px]", chosen ? "border-[1.5px] border-[#8b5cf6] bg-[#f5f0ff]" : "border-zinc-200 bg-white")}>
                      <input type="radio" name="mode" value={option} checked={chosen} onChange={set("mode")} className="size-4 accent-[#5b2a86]" />
                      <span className={cn("flex size-8 items-center justify-center rounded-lg", chosen ? "bg-white" : "bg-zinc-100")}><Icon className="size-4 text-zinc-600" aria-hidden /></span>
                      <span className="flex min-w-0 flex-col gap-[2px]"><span className="text-sm font-medium text-zinc-900">{option}</span><span className="text-xs text-zinc-500">{hint}</span></span>
                    </label>
                  );
                })}
              </div>
              {errors.mode && <p role="alert" className="text-xs text-destructive">{errors.mode}</p>}
            </fieldset>
            <Field
              label={mode === "Online" ? "Meeting link" : "Venue"} htmlFor="training-location" required error={errors.location}
              hint={mode === "Online" ? "Choosing In person shows a Venue field instead." : "Choosing Online shows a Meeting link field instead."}
            >
              <div className={box("location")}>
                {mode === "Online" ? <Video className="size-4 text-zinc-500" aria-hidden /> : <MapPin className="size-4 text-zinc-500" aria-hidden />}
                <input id="training-location" name="location" value={value("location")} onChange={set("location")} maxLength={300} placeholder={mode === "Online" ? "https://meet.example.com/…" : "e.g. Main kitchen, Antipolo"} className={INPUT} />
              </div>
            </Field>
          </Card>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-[16px] lg:w-[340px]">
          <Card className={SECTION}>
            <h2 className="text-[15px] font-semibold text-zinc-900">After you save</h2>
            {[
              { icon: UserPlus, text: "Assign employees from the training page. Each gets an Assignment email." },
              { icon: Printer, text: "Employees without an email are flagged “Needs printed schedule”." },
              { icon: Bell, text: "A reminder email goes out automatically 1 day before at 8:00 AM (Manila time)." },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-[10px]"><Icon className="mt-[2px] size-4 shrink-0 text-primary" aria-hidden /><p className="text-[13px] text-foreground">{text}</p></div>
            ))}
          </Card>
          <Card className={SECTION}>
            <h2 className="text-[15px] font-semibold text-zinc-900">Status</h2>
            <p className="text-[13px] text-zinc-500">Set automatically: Upcoming until the date passes, then Completed. Cancel it from the training page if it won’t happen.</p>
          </Card>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-sm border-t border-[#ebebeb] bg-white px-md py-[14px] sm:px-xl">
        {state.error ? <p role="alert" className="flex-1 text-sm text-destructive">{state.error}</p> : <p className="flex-1 text-[13px] text-zinc-500">{ready ? "Ready to save." : "Fill in the required fields to save."}</p>}
        <Button variant="outline" asChild className="h-auto rounded-lg px-[14px] py-[9px] shadow-none"><Link href="/training">Cancel</Link></Button>
        <Button type="submit" disabled={pending || !ready} className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">{pending ? "Saving…" : "Save training"}</Button>
      </div>
    </form>
  );
}
