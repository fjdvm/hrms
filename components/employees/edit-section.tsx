"use client";

import { useState, useTransition } from "react";
import { Eye, Loader2, Pencil, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { revealGovernmentIds, saveSection } from "@/app/(hrms)/employee-information/[id]/actions";
import { SECTION_FORMS, idsToValues, sectionPayload, validateSection, type EditSection, type FormErrors, type FormValues } from "@/lib/employee-edit-form";
import { WEEKDAYS, formatWorkingDays, parseWorkingDays, serializeWorkingDays } from "@/lib/validators/weekdays";

const INPUT_BOX = "h-[40px] w-full rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none";
const ERROR_COLOUR = "text-[#9a3412]";
const ERROR_BORDER = "border-[#9a3412]";

/** Working days: a field that reads "Mon, Tue, Wed" and opens a short list of days to tick. Held as "1,2,3". */
function WorkingDaysField({ id, value, disabled, invalid, describedBy, onChange }: { id: string; value: string; disabled: boolean; invalid: boolean; describedBy?: string; onChange: (value: string) => void }) {
  const days = parseWorkingDays(value) ?? [];
  const toggle = (day: number, on: boolean) => onChange(serializeWorkingDays(on ? [...days, day] : days.filter((d) => d !== day)));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" id={id} disabled={disabled} aria-describedby={describedBy}
          className={`flex ${INPUT_BOX} items-center border bg-white text-left disabled:opacity-50 ${invalid ? ERROR_BORDER : ""}`}>
          {days.length ? formatWorkingDays(days) : <span className="text-zinc-400">Choose days</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-[220px] flex-col gap-[8px] p-[12px]">
        {WEEKDAYS.map(({ day, short }) => (
          <label key={day} className="flex cursor-pointer items-center gap-[8px] text-sm">
            <Checkbox checked={days.includes(day)} onCheckedChange={(on) => toggle(day, on === true)} aria-label={short} />
            {short}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

function Form({ employeeId, section, initial, onDone, effectiveHint }: { employeeId: number; section: EditSection; initial: FormValues; onDone: () => void; effectiveHint?: boolean }) {
  const spec = SECTION_FORMS[section];
  const [values, setValues] = useState<FormValues>({ ...initial, effectiveDate: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const set = (name: string, value: string) => { setValues(v => ({ ...v, [name]: value })); setErrors(e => ({ ...e, [name]: "" })); setFailure(undefined); };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found = validateSection(section, values, manilaToday());
    setErrors(found);
    if (Object.keys(found).length) return;
    const payload = sectionPayload(section, values, initial);
    if (!Object.keys(payload).length) { onDone(); return; }
    start(async () => {
      const result = await saveSection(employeeId, section, payload, values.effectiveDate?.trim() || undefined);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(`${spec.title} updated`);
      onDone();
    });
  };

  const fieldFor = (f: (typeof spec.fields)[number]) => {
    const id = `edit-${section}-${f.name}`;
    const shift = f.kind === "time" || f.kind === "days";
    const hasError = Boolean(errors[f.name]);
    const describedBy = [hasError ? `${id}-error` : "", f.help ? `${id}-help` : ""].filter(Boolean).join(" ") || undefined;
    const common = { id, value: values[f.name] ?? "", disabled: pending, "aria-invalid": hasError || undefined, "aria-describedby": describedBy };
    return (
      <div key={f.name} className={`flex flex-col gap-[6px] ${f.kind === "textarea" || shift || f.help ? "sm:col-span-2" : ""}`}>
        <label htmlFor={id} className="text-[13px] font-medium text-zinc-800">{f.label}{f.required && <span className="text-red-600"> *</span>}</label>
        {f.kind === "textarea"
          ? <Textarea {...common} onChange={e => set(f.name, e.target.value)} />
          : f.kind === "days"
            ? <WorkingDaysField id={id} value={values[f.name] ?? ""} disabled={pending} invalid={hasError} describedBy={describedBy} onChange={(value) => set(f.name, value)} />
            : <Input {...common} type={f.kind === "date" ? "date" : f.kind === "time" ? "time" : f.kind === "number" ? "number" : "text"} inputMode={f.kind === "number" ? "numeric" : undefined}
              className={shift ? `${INPUT_BOX} ${hasError ? ERROR_BORDER : ""}` : undefined} onChange={e => set(f.name, e.target.value)} />}
        {hasError && <p id={`${id}-error`} role="alert" className={`text-xs ${shift ? ERROR_COLOUR : "text-destructive"}`}>{errors[f.name]}</p>}
        {f.help && <p id={`${id}-help`} className="text-xs text-zinc-500">{f.help}</p>}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="grid gap-[14px] px-[24px] py-[20px] sm:grid-cols-2">
        {spec.fields.map(fieldFor)}
        {spec.effectiveDate && (
          <div className="flex flex-col gap-[6px] sm:col-span-2">
            <label htmlFor={`edit-${section}-effective`} className="text-[13px] font-medium text-zinc-800">Effective date</label>
            <Input id={`edit-${section}-effective`} type="date" value={values.effectiveDate} disabled={pending} onChange={e => set("effectiveDate", e.target.value)} />
            {errors.effectiveDate ? <p role="alert" className="text-xs text-destructive">{errors.effectiveDate}</p>
              : <p className="text-xs text-zinc-500">{effectiveHint ?? "When a change to position, department, branch, employment type, reports to or pay takes effect. Defaults to today."}</p>}
          </div>
        )}
        {spec.notice && (
          <div role="note" className="flex items-start gap-[8px] rounded-lg bg-[#fdf1d8] px-[12px] py-[10px] sm:col-span-2">
            <TriangleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-[#8a5a00]" />
            <p className="text-[13px] leading-[19px] text-[#8a5a00]">{spec.notice}</p>
          </div>
        )}
        {failure && <p role="alert" className="text-sm text-destructive sm:col-span-2">{failure}</p>}
      </div>
      <div className="flex items-center justify-end gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
        {spec.footnote && <p className="mr-auto text-xs text-zinc-500">{spec.footnote}</p>}
        <DialogClose asChild><Button type="button" variant="outline" disabled={pending} className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] shadow-none">Cancel</Button></DialogClose>
        <Button type="submit" disabled={pending} className="h-auto rounded-lg bg-[#5b2a86] px-[16px] py-[9px]">{pending && <Loader2 className="animate-spin" />}Save changes</Button>
      </div>
    </form>
  );
}

/** A section's own Edit button and dialog. Government IDs ask the server for the real values when the dialog opens. */
export function EditSectionButton({ employeeId, section, initial, label = "Edit", primary, subject }: { employeeId: number; section: EditSection; initial: FormValues; label?: string; primary?: boolean; subject?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<FormValues>();
  const [loadError, setLoadError] = useState<string>();
  const needsReveal = section === "governmentIds";

  const change = async (next: boolean) => {
    setOpen(next);
    if (!next) { setLoaded(undefined); setLoadError(undefined); return; }
    if (!needsReveal) return;
    const result = await revealGovernmentIds(employeeId);
    if (result.ok) setLoaded(idsToValues(result.values ?? {})); else setLoadError(result.error);
  };
  const ready = !needsReveal || loaded;

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        {primary
          ? <Button className="h-auto rounded-lg bg-[#5b2a86] px-[14px] py-[9px]"><Pencil /> {label}</Button>
          : <Button variant="outline" aria-label={`Edit ${SECTION_FORMS[section].title}`} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[12px] py-[6px] text-[13px] shadow-none"><Pencil className="size-[14px]" />{label}</Button>}
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex flex-col gap-[3px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Edit {SECTION_FORMS[section].title.toLowerCase()}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">
            {needsReveal ? "Opening this shows the full numbers and is recorded in the activity log." : section === "employment" && subject ? subject : "Changes are recorded in the activity log."}
          </DialogDescription>
        </div>
        {ready ? <Form employeeId={employeeId} section={section} initial={loaded ?? initial} onDone={() => change(false)} />
          : <p role={loadError ? "alert" : "status"} className={`px-[24px] py-[28px] text-sm ${loadError ? "text-destructive" : "text-zinc-500"}`}>{loadError ?? "Loading…"}</p>}
      </DialogContent>
    </Dialog>
  );
}

/** Reveals one masked government ID: the real value is requested from the server on click, and lives only in this component. */
export function RevealableId({ employeeId, field, masked }: { employeeId: number; field: "sss" | "philhealth" | "pagibigMid" | "tin"; masked: string }) {
  const [value, setValue] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const label = { sss: "SSS number", philhealth: "PhilHealth number", pagibigMid: "Pag-IBIG MID", tin: "TIN" }[field];
  const toggle = () => {
    if (value) { setValue(undefined); return; }
    start(async () => {
      const result = await revealGovernmentIds(employeeId, [field]);
      if (result.ok) setValue(result.values?.[field] ?? masked); else setError(result.error);
    });
  };
  return (
    <span className="flex items-center gap-[6px]">
      <span>{value ?? masked}</span>
      <button type="button" onClick={toggle} disabled={pending} aria-label={value ? `Hide ${label}` : `Reveal ${label}`}
        className="rounded-md p-1 text-zinc-500 hover:text-zinc-900 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
        {pending ? <Loader2 className="size-[14px] animate-spin" /> : <Eye className="size-[14px]" />}
      </button>
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
