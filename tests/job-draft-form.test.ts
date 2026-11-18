import { describe, expect, it } from "vitest";
import type { Draft } from "@/lib/job-draft";
import { hasTypedText, mergeDraft, templateChoiceFrom } from "@/lib/job-draft-form";
import { fieldsFromForm, splitRequirements } from "@/lib/job-posting-form";

const draft: Draft = { summary: "AI summary.", responsibilities: ["AI task one", "AI task two", "AI task three", "AI task four"], qualifications: ["AI qual one", "AI qual two", "AI qual three"], benefits: ["AI benefit"] };

function form(values: Record<string, string | string[]> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  return data;
}

const everything = {
  title: "Cashier", department: "Retail", location: "Cainta branch", employmentType: "Part-time", openings: "3", salaryFrom: "15000", salaryTo: "18000", workSchedule: "Mon-Sat, 8am-5pm",
  requiredDocuments: ["Resume or CV", "Health certificate"], screeningCriteria: "Has a Food Handler card\nCan work weekends", deadline: "2026-12-15",
  summary: "", responsibilities: "", qualifications: "", benefits: "",
};

describe("has the Staff member typed in any of the four fields?", () => {
  it("is false when all four are empty or blank, whatever else is filled", () => {
    expect(hasTypedText(form(everything))).toBe(false);
    expect(hasTypedText(form({ ...everything, summary: "  \n " }))).toBe(false);
  });
  it.each(["summary", "responsibilities", "qualifications", "benefits"])("is true when %s has text", (name) => {
    expect(hasTypedText(form({ ...everything, [name]: "Something" }))).toBe(true);
  });
  it("does not count other fields", () => {
    expect(hasTypedText(form({ title: "Cashier", department: "Retail", screeningCriteria: "Has a card" }))).toBe(false);
  });
});

describe("merging a draft into the form", () => {
  it("replaces Summary, Responsibilities, Qualifications and Benefits", () => {
    const merged = mergeDraft(form({ ...everything, summary: "Typed summary", responsibilities: "Typed task", qualifications: "Typed qual", benefits: "Typed perk" }), draft);
    expect(merged.description).toBe("AI summary.");
    expect(merged.responsibilities).toEqual(draft.responsibilities);
    expect(merged.benefits).toEqual(["AI benefit"]);
    expect(splitRequirements(merged.requirements).qualifications).toBe("AI qual one\nAI qual two\nAI qual three");
  });
  it("keeps every other value as typed: title, department, location, type, openings, pay, schedule, documents and screening criteria", () => {
    const merged = mergeDraft(form(everything), draft);
    expect(merged).toMatchObject({
      title: "Cashier", department: "Retail", location: "Cainta branch", employmentType: "Part-time", openings: 3, salaryFrom: 15000, salaryTo: 18000, workSchedule: "Mon-Sat, 8am-5pm",
      requiredDocuments: ["Resume or CV", "Health certificate"], screeningCriteria: ["Has a Food Handler card", "Can work weekends"],
    });
  });
  it("never writes pay, openings, schedule, documents, screening criteria or a deadline from the draft", () => {
    const merged = mergeDraft(form({ title: "Cashier" }), draft);
    expect(merged).toMatchObject({ openings: null, salaryFrom: null, salaryTo: null, workSchedule: null, requiredDocuments: [], screeningCriteria: [] });
    expect("deadline" in merged).toBe(false);
  });
  it("matches what saving would read: the merged values go back through the form's own parsing unchanged", () => {
    const merged = mergeDraft(form(everything), draft);
    const again = new FormData();
    again.set("title", merged.title); again.set("summary", merged.description); again.set("responsibilities", merged.responsibilities.join("\n"));
    again.set("qualifications", splitRequirements(merged.requirements).qualifications); again.set("benefits", merged.benefits.join("\n"));
    const saved = fieldsFromForm(again);
    expect(saved).toMatchObject({ description: "AI summary.", responsibilities: draft.responsibilities, benefits: ["AI benefit"], requirements: merged.requirements });
  });
});

describe("the Save as template choice", () => {
  it("is read back as it was", () => {
    expect(templateChoiceFrom(form({ saveAsTemplate: "on", templateName: "Cashier template" }))).toEqual({ saveAsTemplate: true, templateName: "Cashier template" });
    expect(templateChoiceFrom(form({}))).toEqual({ saveAsTemplate: false, templateName: "" });
  });
});
