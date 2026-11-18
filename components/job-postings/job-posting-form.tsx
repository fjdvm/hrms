"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { hasTypedText, mergeDraft, templateChoiceFrom } from "@/lib/job-draft-form";
import { DEFAULT_REQUIRED_DOCUMENTS, EMPLOYMENT_TYPES, splitRequirements } from "@/lib/job-posting-form";
import type { JobPosting, JobTemplate } from "@/lib/job-postings";
import type { FormState } from "@/app/(hrms)/job-postings/actions";
import { DeadlinePicker } from "./deadline-picker";
import { DeleteDraftButton } from "./delete-draft-button";
import { DraftWithAiButton } from "./draft-with-ai";
import { RequiredDocuments } from "./required-documents";
import { TemplatePicker } from "./template-picker";

type Props = {
  action?: (state: FormState, data: FormData) => Promise<FormState>;
  posting?: Pick<JobPosting, "id"> & Partial<JobPosting>;
  /** Draft actions: delete, and publish through the form's own submit. */
  deleteAction?: () => Promise<FormState>;
  canPublish?: boolean;
  /** A brand-new Job Posting: it can be saved as a Draft or published straight away. */
  isNew?: boolean;
  /** A Published posting: edits go live as soon as they are saved. */
  published?: boolean;
  /** Closed and Filled postings show their values and offer nothing else. */
  readOnly?: boolean;
  /** A Job Template form: no deadline, and nothing about publishing. */
  template?: boolean;
  /** Offers "Save as template": a named Job Template saved together with the posting. */
  canSaveTemplate?: boolean;
  /** Saved Job Templates to start a new posting from, shown beside the Job title. */
  templates?: JobTemplate[];
  /** Extra template-only action, e.g. delete. */
  templateActions?: React.ReactNode;
  /** The Job description drafter is switched on. It is still never offered on a Published, Closed or Filled posting. */
  canDraftWithAi?: boolean;
};

const noAction = async (): Promise<FormState> => ({});

const controlClass =
  "h-auto rounded-lg border-[#e4e4e7] bg-white px-[12px] py-[10px] text-sm text-[#18181b] shadow-none placeholder:text-[#a1a1aa] focus-visible:border-[#8b5cf6] aria-[invalid=true]:border-destructive";
const textareaClass = "min-h-0 resize-y leading-[21px]";
const buttonClass = "h-auto rounded-lg px-4 py-[9px] font-medium shadow-none";

function Field({
  name,
  label,
  error,
  required,
  children,
}: {
  name: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[6px]">
      <Label htmlFor={name} className="gap-[3px] text-[13px] font-medium text-[#27272a]">
        {label}
        {required && <span className="text-[#dc2626]"> *</span>}
      </Label>
      {children}
      {error && (
        <p id={`${name}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  /** A control in the card header, beside the title. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[14px] rounded-xl border bg-card px-[20px] py-[18px]">
      <div className="flex items-start justify-between gap-sm">
        <div className="flex flex-col gap-[2px]">
          <h2 className="text-[15px] font-semibold text-[#18181b]">{title}</h2>
          {description && <p className="text-xs text-[#71717a]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function CheckRow({
  children,
  hint,
  ...props
}: React.ComponentProps<typeof Checkbox> & { hint?: string }) {
  return (
    <div className="flex items-start gap-[10px]">
      <Checkbox
        {...props}
        className="mt-px size-4 rounded-[4px] border-[1.5px] border-[#d4d4d8] shadow-none data-[state=checked]:border-primary [&_svg]:size-3"
      />
      <Label htmlFor={props.id} className="flex flex-col gap-[2px] text-sm font-medium text-[#18181b]">
        {children}
        {hint && <span className="text-xs font-normal text-[#71717a]">{hint}</span>}
      </Label>
    </div>
  );
}

/** Employment types as selectable chips; a type outside the list (older postings) stays selectable. */
function EmploymentType({
  value,
  invalid,
}: {
  value?: string;
  invalid: Record<string, unknown>;
}) {
  const types = value && !EMPLOYMENT_TYPES.includes(value) ? [...EMPLOYMENT_TYPES, value] : EMPLOYMENT_TYPES;
  return (
    <div role="radiogroup" id="employmentType" {...invalid} className="flex flex-wrap gap-sm">
      {types.map((type) => (
        <label
          key={type}
          className="flex cursor-pointer items-center gap-sm rounded-lg border border-[#e4e4e7] bg-white py-[9px] pl-[12px] pr-[14px] text-sm font-medium text-[#18181b] has-[:checked]:border-[1.5px] has-[:checked]:border-[#8b5cf6] has-[:checked]:bg-[#f5f0ff] has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring"
        >
          <input
            type="radio"
            name="employmentType"
            value={type}
            defaultChecked={type === value}
            className="peer sr-only"
          />
          <span className="size-4 shrink-0 rounded-full border border-[#d4d4d8] bg-white peer-checked:border-[5px] peer-checked:border-[#8b5cf6]" />
          {type}
        </label>
      ))}
    </div>
  );
}

function PesoInput({
  name,
  invalid,
  defaultValue,
  placeholder,
}: {
  name: string;
  invalid: Record<string, unknown>;
  defaultValue?: number | null;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-[12px] flex items-center text-sm text-[#71717a]">
        ₱
      </span>
      <Input
        id={name}
        name={name}
        {...invalid}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        placeholder={placeholder}
        className={cn(controlClass, "pl-[30px]")}
        defaultValue={defaultValue ?? ""}
      />
    </div>
  );
}

/** "Save as template" and, once ticked, the name to save it under. */
function TemplateSection({ defaultName, error, initial }: { defaultName?: string; error?: string; initial?: { saveAsTemplate: boolean; templateName: string } }) {
  const [checked, setChecked] = useState(initial?.saveAsTemplate ?? false);
  return (
    <Section title="Template" description="Reuse this job’s details for future postings.">
      <CheckRow
        id="saveAsTemplate"
        name="saveAsTemplate"
        checked={checked}
        onCheckedChange={(value) => setChecked(value === true)}
        hint="Saves the title, department, type, pay, schedule and description. The deadline is not saved."
      >
        Save as template
      </CheckRow>
      {checked && (
        <Field name="templateName" label="Template name" error={error}>
          <Input
            id="templateName"
            name="templateName"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "templateName-error" : undefined}
            defaultValue={initial?.templateName || defaultName}
            className={controlClass}
          />
          <p className="text-xs text-[#71717a]">Shown in the Templates dropdown of the Job title field.</p>
        </Field>
      )}
    </Section>
  );
}

const ERROR_TEXT: Record<string, string> = {
  deadline: "Choose a deadline in the future.",
  openings: "Enter a whole number of 1 or more (up to 2,147,483,647).",
  salaryFrom: "Enter a salary of 0 or more that is not above Salary to.",
  salaryTo: "Enter a salary of 0 or more that is not below Salary from.",
  templateName: "Enter a name for the template.",
};

export function JobPostingForm({
  action,
  posting,
  deleteAction,
  canPublish,
  isNew,
  published,
  readOnly,
  template,
  canSaveTemplate,
  templates,
  templateActions,
  canDraftWithAi,
}: Props) {
  // Choosing a template refills the fields below; the deadline stays as it was.
  const [deadline, setDeadline] = useState(posting?.deadline ?? null);
  const [picked, setPicked] = useState<{ template: JobTemplate; count: number }>();
  const [state, submit, pending] = useActionState(action ?? noAction, {});
  // Using an AI draft refills the four description fields through the same path as a template, after merging in what is on the form now.
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState(posting?.title ?? "");
  const [aiNote, setAiNote] = useState(false);
  const [templateChoice, setTemplateChoice] = useState<{ saveAsTemplate: boolean; templateName: string }>();
  const offerDrafter = Boolean(canDraftWithAi) && !readOnly && !published;
  const formData = () => new FormData(formRef.current ?? undefined);
  const errors = Object.fromEntries(
    Object.keys(state.fieldErrors ?? {}).map((field) => [
      field,
      ERROR_TEXT[field] ?? "This field is required.",
    ]),
  ) as Record<string, string>;
  const values = picked?.template ?? posting;
  const sections = splitRequirements(values?.requirements ?? "");
  // Postings saved before the list existed keep their Responsibilities in requirements; show them until the list is saved.
  const responsibilities = values?.responsibilities?.length ? values.responsibilities.join("\n") : sections.responsibilities;
  // A new posting starts with the defaults ticked.
  const checkedDocuments = values ? (values.requiredDocuments ?? []) : DEFAULT_REQUIRED_DOCUMENTS;
  // Marks an input as invalid for assistive tech and styling.
  const invalid = (name: string, errorKey = name) =>
    errors[errorKey]
      ? { "aria-invalid": true, "aria-describedby": `${name}-error` }
      : {};

  return (
    <form action={submit} ref={formRef} className="flex flex-col gap-md">
      <fieldset disabled={readOnly} className="contents" key={picked?.count ?? 0}>
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <div className="grid items-start gap-md lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="flex min-w-0 flex-col gap-md">
            <Section title="Role">
              <Field name="title" label="Job title" required error={errors.title}>
                <div className="flex overflow-hidden rounded-lg border border-[#e4e4e7] bg-white focus-within:border-[#8b5cf6] has-[[aria-invalid=true]]:border-destructive">
                  <input
                    id="title"
                    name="title"
                    {...invalid("title")}
                    defaultValue={values?.title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="e.g. Production Staff"
                    className="min-w-0 flex-1 bg-transparent px-[12px] py-[10px] text-sm text-[#18181b] outline-none placeholder:text-[#a1a1aa]"
                  />
                  {templates && !template && !readOnly && (
                    <TemplatePicker
                      templates={templates}
                      onPick={(chosen) => {
                        setTitle(chosen.title);
                        setPicked((previous) => ({ template: chosen, count: (previous?.count ?? 0) + 1 }));
                      }}
                    />
                  )}
                </div>
                {templates && !template && !readOnly && (
                  <p className="text-xs text-[#71717a]">
                    {templates.length === 0
                      ? "No templates yet. Tick “Save as template” in the Template section and this role will show up here next time."
                      : "Pick a template to fill in the form, or type a new title to start blank."}
                  </p>
                )}
              </Field>
              <div className="grid gap-md sm:grid-cols-2">
                <Field name="department" label="Department" required error={errors.department}>
                  <Input
                    id="department"
                    name="department"
                    {...invalid("department")}
                    placeholder="e.g. Production"
                    className={controlClass}
                    defaultValue={values?.department}
                  />
                </Field>
                <Field name="location" label="Location" required error={errors.location}>
                  <Input
                    id="location"
                    name="location"
                    {...invalid("location")}
                    placeholder="e.g. Main kitchen · Antipolo"
                    className={controlClass}
                    defaultValue={values?.location}
                  />
                </Field>
              </div>
              <Field name="employmentType" label="Employment type" required error={errors.employmentType}>
                <EmploymentType value={values?.employmentType} invalid={invalid("employmentType")} />
              </Field>
              <div className="grid gap-md sm:grid-cols-2">
                <Field name="openings" label="Openings" error={errors.openings}>
                  <Input
                    id="openings"
                    name="openings"
                    {...invalid("openings")}
                    type="number"
                    min={1}
                    step={1}
                    placeholder="1"
                    className={controlClass}
                    defaultValue={values?.openings ?? ""}
                  />
                </Field>
              </div>
            </Section>
            {aiNote && (
              <div role="status" className="flex items-start gap-[8px] rounded-xl bg-[#f4f1f7] px-[16px] py-[12px]">
                <Sparkles aria-hidden className="mt-[2px] size-[16px] shrink-0 text-primary" />
                <p className="flex-1 text-[13px] leading-[19px] text-[#5b2a86]">
                  AI-drafted from your notes. Check every line before you save or publish. Pay and deadline were not filled in.
                </p>
                <button type="button" onClick={() => setAiNote(false)} className="flex shrink-0 items-center gap-[4px] text-[13px] font-medium text-primary hover:underline">
                  Dismiss<X aria-hidden className="size-[14px]" />
                </button>
              </div>
            )}
            <Section
              title="Job description"
              description="Shown on the careers page and in the applicant’s confirmation email."
              action={
                offerDrafter ? (
                  <DraftWithAiButton
                    title={title}
                    getContext={() => {
                      const data = formData();
                      const text = (name: string) => String(data.get(name) ?? "").trim();
                      return { title: text("title"), department: text("department"), employmentType: text("employmentType"), location: text("location") };
                    }}
                    hasExistingText={() => hasTypedText(formData())}
                    onUse={(draft) => {
                      const data = formData();
                      setTemplateChoice(templateChoiceFrom(data));
                      setPicked((previous) => ({ template: mergeDraft(data, draft), count: (previous?.count ?? 0) + 1 }));
                      setAiNote(true);
                    }}
                  />
                ) : undefined
              }
            >
              <Field name="summary" label="Summary" required error={errors.description}>
                <Textarea
                  id="summary"
                  name="summary"
                  {...invalid("summary", "description")}
                  rows={3}
                  placeholder="What this role does, in one or two sentences."
                  className={cn(controlClass, textareaClass)}
                  defaultValue={values?.description}
                />
              </Field>
              <Field name="responsibilities" label="Responsibilities (one per line)">
                <Textarea
                  id="responsibilities"
                  name="responsibilities"
                  rows={4}
                  placeholder="List the main tasks."
                  className={cn(controlClass, textareaClass)}
                  defaultValue={responsibilities}
                />
              </Field>
              <Field name="qualifications" label="Qualifications">
                <Textarea
                  id="qualifications"
                  name="qualifications"
                  rows={3}
                  placeholder="Education, experience, documents and schedule."
                  className={cn(controlClass, textareaClass)}
                  defaultValue={sections.qualifications}
                />
              </Field>
              <Field name="benefits" label="Benefits (one per line)">
                <Textarea
                  id="benefits"
                  name="benefits"
                  rows={3}
                  placeholder="Pay extras, leave, insurance and other perks."
                  className={cn(controlClass, textareaClass)}
                  defaultValue={values?.benefits?.join("\n")}
                />
              </Field>
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-md">
            <Section title="Pay & schedule">
              <div className="grid gap-[12px] sm:grid-cols-2">
                <Field name="salaryFrom" label="Salary from" error={errors.salaryFrom}>
                  <PesoInput
                    name="salaryFrom"
                    placeholder="Min"
                    invalid={invalid("salaryFrom")}
                    defaultValue={values?.salaryFrom}
                  />
                </Field>
                <Field name="salaryTo" label="Salary to" error={errors.salaryTo}>
                  <PesoInput
                    name="salaryTo"
                    placeholder="Max"
                    invalid={invalid("salaryTo")}
                    defaultValue={values?.salaryTo}
                  />
                </Field>
              </div>
              <p className="text-xs text-[#71717a]">Monthly. Leave blank to hide the salary on the careers page.</p>
              <Field name="workSchedule" label="Work schedule" error={errors.workSchedule}>
                <Input
                  id="workSchedule"
                  name="workSchedule"
                  {...invalid("workSchedule")}
                  placeholder="e.g. Mon–Fri, 9am–6pm"
                  className={controlClass}
                  defaultValue={values?.workSchedule ?? ""}
                />
              </Field>
            </Section>
            <Section title="Applications">
              {!template && (
                <Field name="deadline" label="Application deadline" error={errors.deadline}>
                  <DeadlinePicker
                    name="deadline"
                    {...invalid("deadline")}
                    defaultValue={deadline}
                    onChange={(value) => setDeadline(value ? new Date(`${value}T23:59:59.999Z`) : null)}
                  />
                </Field>
              )}
              <RequiredDocuments checked={checkedDocuments} />
              <Field name="screeningCriteria" label="Screening criteria (one per line)">
                <Textarea
                  id="screeningCriteria"
                  name="screeningCriteria"
                  rows={3}
                  className={cn(controlClass, textareaClass)}
                  defaultValue={values?.screeningCriteria?.join("\n")}
                />
              </Field>
            </Section>
            {canSaveTemplate && !readOnly && (
              <TemplateSection defaultName={values?.title} error={errors.templateName} initial={templateChoice} />
            )}
          </div>
        </div>
      </fieldset>
      <div className="sticky bottom-0 -mx-md flex items-center justify-between gap-sm border-t border-[#ebebeb] bg-background px-md py-[14px] sm:-mx-xl sm:px-xl">
        <p className="hidden text-[13px] text-[#71717a] sm:block">
          {template
            ? "A template saves everything except the deadline. Postings started from it are copies."
            : readOnly
              ? "This Job Posting is final and cannot be reopened. Create a new one instead."
              : published
                ? "Changes appear on Careers as soon as you save."
                : isNew
                  ? "Publishing makes it live on your careers page right away."
                  : "Nothing is required to save a Draft."}
        </p>
        <div className="flex items-center gap-sm">
          {templateActions}
          {deleteAction && <DeleteDraftButton action={deleteAction} />}
          <Button variant="outline" className={cn(buttonClass, "border-[#e4e4e7] text-[#1f1a2e]")} asChild>
            <Link href="/job-postings">{readOnly ? "Back" : "Cancel"}</Link>
          </Button>
          {!readOnly && (
            <Button
              type="submit"
              variant={canPublish || isNew ? "outline" : "default"}
              className={cn(buttonClass, (canPublish || isNew) && "border-[#e4e4e7] text-[#1f1a2e]")}
              disabled={pending}
            >
              {pending
                ? "Saving…"
                : template || published
                  ? "Save changes"
                  : isNew
                    ? "Save as draft"
                    : "Save as Draft"}
            </Button>
          )}
          {(canPublish || isNew) && !readOnly && (
            <Button
              type="submit"
              name="intent"
              value="publish"
              className={buttonClass}
              disabled={pending}
            >
              {isNew ? "Publish job" : "Publish"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
