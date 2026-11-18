import type { Draft } from "./job-draft";
import { fieldsFromForm, joinRequirements } from "./job-posting-form";
import type { JobTemplate } from "./job-postings";

/**
 * Using an AI draft on the posting form. The draft fills the Summary, Responsibilities, Qualifications and Benefits and nothing else:
 * everything else on the form (title, department, location, type, openings, pay, schedule, documents, screening criteria, the
 * Save as template box) stays as the Staff member typed it. The merge starts from what is on the form now, read with the form's own
 * parsing, so it cannot drift from what saving would read.
 */

/** The names of the four text fields the drafter fills. */
export const DRAFT_FIELDS = ["summary", "responsibilities", "qualifications", "benefits"] as const;

/** Has the Staff member typed anything in any of the four fields? Then using a draft asks before it replaces them. */
export const hasTypedText = (data: FormData) => DRAFT_FIELDS.some((name) => String(data.get(name) ?? "").trim() !== "");

/**
 * The form's current values with the four draft fields replaced. It has the shape of a Job Template, which is what the form already
 * knows how to show (the deadline is held apart by the form, so it is not part of it).
 */
export function mergeDraft(data: FormData, draft: Draft): JobTemplate {
  // The deadline is held apart by the form, so it is left out here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { deadline: _deadline, ...current } = fieldsFromForm(data);
  return {
    ...current,
    description: draft.summary,
    responsibilities: draft.responsibilities,
    requirements: joinRequirements({ responsibilities: "", qualifications: draft.qualifications.join("\n") }),
    benefits: draft.benefits,
    id: "ai-draft",
    name: null,
    updatedAt: new Date(),
  };
}

/** The "Save as template" box and name, which live in their own component, so a merge can hand them back as they were. */
export const templateChoiceFrom = (data: FormData) => ({ saveAsTemplate: data.get("saveAsTemplate") != null, templateName: String(data.get("templateName") ?? "") });
