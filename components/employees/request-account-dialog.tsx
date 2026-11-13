"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Send, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { loadAccountRequestOptions, sendAccountRequest, type FieldProblems } from "@/app/(hrms)/employee-onboarding/actions";
import type { OnboardingRow } from "@/lib/employees";
import type { AccountRequestOptions, PortalId } from "@/lib/portal/account-requests";
import { formatOfferDate } from "@/lib/offer-view";

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const LABEL = "text-[13px] font-medium text-zinc-800";
const FIELD = "h-auto rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none";
const key = (id: PortalId) => String(id);

type Employee = Pick<OnboardingRow, "id" | "name" | "initials" | "employeeNumber" | "position" | "branch" | "startDate" | "workEmail">;

function Required() { return <span className="text-[#dc2626]">*</span>; }
function Problem({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} role="alert" className="text-xs text-destructive">{text}</p> : null;
}

function Form({ employee, options, onDone }: { employee: Employee; options: AccountRequestOptions; onDone: () => void }) {
  const router = useRouter();
  const [workEmail, setWorkEmail] = useState(employee.workEmail);
  const [roleId, setRoleId] = useState("");
  const [moduleIds, setModuleIds] = useState<Set<string>>(new Set());
  const [neededFrom, setNeededFrom] = useState(employee.startDate);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<FieldProblems>({});
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const clear = (field: keyof FieldProblems) => { setProblems(p => ({ ...p, [field]: undefined })); setFailure(undefined); };
  const firstName = employee.name.split(/\s+/u)[0];
  const started = neededFrom !== "" && neededFrom <= manilaToday();

  const chooseRole = (id: string) => {
    setRoleId(id);
    const role = options.roles.find(r => key(r.id) === id);
    setModuleIds(new Set((role?.moduleIds ?? []).map(key)));
    clear("roleId"); clear("moduleIds");
  };
  const toggle = (id: string, on: boolean) => {
    setModuleIds(current => { const next = new Set(current); if (on) next.add(id); else next.delete(id); return next; });
    clear("moduleIds");
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const found: FieldProblems = {};
    if (!workEmail.trim()) found.workEmail = "Enter the work email.";
    if (!roleId) found.roleId = "Choose a Portal Role.";
    if (moduleIds.size === 0) found.moduleIds = "Choose at least one Module.";
    if (!neededFrom) found.neededFrom = "Enter a valid date.";
    setProblems(found);
    if (Object.keys(found).length) return;
    const role = options.roles.find(r => key(r.id) === roleId)!;
    // Send the Portal's own id values back, not their string forms.
    const chosen = options.systems.flatMap(s => s.modules).filter(m => moduleIds.has(key(m.id))).map(m => m.id);
    start(async () => {
      const result = await sendAccountRequest(employee.id, { workEmail: workEmail.trim(), roleId: role.id, moduleIds: chosen, neededFrom, note: note.trim() || undefined });
      if (!result.ok) { setProblems(result.problems); setFailure(result.error); return; }
      toast.success(`Account request for ${employee.name} sent to the admin portal`);
      onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex max-h-[calc(100vh-180px)] flex-col">
      <div className="flex flex-col gap-[16px] overflow-y-auto px-[24px] py-[20px]">
        <div className="flex items-center gap-[12px] rounded-[10px] bg-[#f7f5fa] py-[12px] pl-[12px] pr-[14px]">
          <div aria-hidden className="flex size-[40px] shrink-0 items-center justify-center rounded-full bg-[#efe6f8] text-[11px] font-semibold text-[#5b2a86]">{employee.initials}</div>
          <div className="flex min-w-0 flex-col gap-[2px]">
            <p className="text-[15px] font-semibold text-[#18181b]">{employee.name}</p>
            <p className="text-xs text-zinc-500">{employee.employeeNumber} · {employee.position} · {employee.branch} · starts {formatOfferDate(employee.startDate)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="request-work-email" className={LABEL}>Work email (login) <Required /></label>
          <div className="relative">
            <Mail aria-hidden className="pointer-events-none absolute left-[12px] top-1/2 size-[16px] -translate-y-1/2 text-zinc-500" />
            <Input id="request-work-email" type="email" value={workEmail} disabled={pending} className={`${FIELD} pl-[36px]`}
              aria-invalid={problems.workEmail ? true : undefined} aria-describedby="request-work-email-hint request-work-email-error"
              onChange={e => { setWorkEmail(e.target.value); clear("workEmail"); }} />
          </div>
          <Problem id="request-work-email-error" text={problems.workEmail} />
          <p id="request-work-email-hint" className="text-xs text-zinc-500">The login details will be sent here and to {firstName}’s personal email.</p>
        </div>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="request-role" className={LABEL}>Role <Required /></label>
          <select id="request-role" value={roleId} disabled={pending} onChange={e => chooseRole(e.target.value)}
            aria-invalid={problems.roleId ? true : undefined} aria-describedby="request-role-error"
            className="h-auto rounded-lg border border-[#e4e4e7] bg-white px-[12px] py-[9px] text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50">
            <option value="" disabled>Choose a Role</option>
            {options.roles.map(role => <option key={key(role.id)} value={key(role.id)}>{role.name}</option>)}
          </select>
          <Problem id="request-role-error" text={problems.roleId} />
        </div>

        <fieldset className="flex flex-col gap-[8px]" aria-describedby="request-modules-error" disabled={pending}>
          <legend className={LABEL}>Modules <Required /></legend>
          <p className="text-xs text-zinc-500">Pre-filled from the Role. Tick or untick to give exactly the access {firstName} needs.</p>
          <div className="flex flex-col gap-[12px] rounded-[10px] border border-[#e4e4e7] p-[12px]">
            {options.systems.map(system => (
              <div key={key(system.id)} role="group" aria-label={system.name} className="flex flex-col gap-[6px]">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-zinc-500">{system.name}</p>
                <div className="grid gap-[6px] sm:grid-cols-2">
                  {system.modules.map(module => {
                    const id = `request-module-${key(system.id)}-${key(module.id)}`;
                    return (
                      <div key={key(module.id)} className="flex items-center gap-[8px]">
                        <Checkbox id={id} checked={moduleIds.has(key(module.id))} onCheckedChange={on => toggle(key(module.id), on === true)} />
                        <label htmlFor={id} className="text-sm text-zinc-800">{module.name}</label>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Problem id="request-modules-error" text={problems.moduleIds} />
        </fieldset>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="request-needed-from" className={LABEL}>Needs access from <Required /></label>
          <Input id="request-needed-from" type="date" value={neededFrom} disabled={pending} className={FIELD}
            aria-invalid={problems.neededFrom ? true : undefined} aria-describedby="request-needed-from-error"
            onChange={e => { setNeededFrom(e.target.value); clear("neededFrom"); }} />
          {started && <p className="text-xs text-zinc-500">{formatOfferDate(neededFrom)} · already started</p>}
          <Problem id="request-needed-from-error" text={problems.neededFrom} />
        </div>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="request-note" className={LABEL}>Note to admin <span className="font-normal text-zinc-400">(optional)</span></label>
          <Textarea id="request-note" value={note} disabled={pending} rows={2} className={FIELD}
            aria-invalid={problems.note ? true : undefined} aria-describedby="request-note-error"
            onChange={e => { setNote(e.target.value); clear("note"); }} />
          <Problem id="request-note-error" text={problems.note} />
        </div>

        <div className="rounded-lg bg-[#eef4fd] px-[12px] py-[10px] text-[13px] text-[#1d4f91]">You’ll be notified when the admin creates the account. {firstName} gets their login by email.</div>
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      </div>
      <div className="flex items-center justify-end gap-[8px] border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
        <DialogClose asChild><Button type="button" variant="outline" disabled={pending} className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">Cancel</Button></DialogClose>
        <Button type="submit" disabled={pending} className="h-auto rounded-lg bg-[#5b2a86] px-[14px] py-[9px]">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}Send to admin portal
        </Button>
      </div>
    </form>
  );
}

/** "Request user account" on a Not requested row. The Portal's Roles and Modules are fetched when the dialog opens. */
export function RequestAccountDialog({ employee }: { employee: Employee }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AccountRequestOptions>();
  const [loadError, setLoadError] = useState<string>();

  const change = async (next: boolean) => {
    setOpen(next);
    if (!next) { setOptions(undefined); setLoadError(undefined); return; }
    const result = await loadAccountRequestOptions();
    if (result.ok) setOptions(result.options); else setLoadError(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="h-auto rounded-lg px-[12px] py-[6px] text-[13px]"><UserPlus aria-hidden />Request user account</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex flex-col gap-[3px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Request user account</DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">Sent to the admin portal. The admin creates the login.</DialogDescription>
        </div>
        {options ? <Form employee={employee} options={options} onDone={() => change(false)} />
          : <p role={loadError ? "alert" : "status"} className={`px-[24px] py-[28px] text-sm ${loadError ? "text-destructive" : "text-zinc-500"}`}>{loadError ?? "Loading…"}</p>}
      </DialogContent>
    </Dialog>
  );
}
