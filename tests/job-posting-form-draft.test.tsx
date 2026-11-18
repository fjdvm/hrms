// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { JobPostingForm } from "@/components/job-postings/job-posting-form";
import type { Draft } from "@/lib/job-draft";

const actions = vi.hoisted(() => ({ draftJobDescription: vi.fn(), jobDraftStatus: vi.fn() }));
vi.mock("@/app/(hrms)/job-postings/draft-actions", () => actions);

const draft: Draft = {
  summary: "Run the till at our Cainta branch, serving walk-in customers.",
  responsibilities: ["Greet customers and process sales", "Count the cash drawer", "Keep the counter tidy", "Answer questions about our products"],
  qualifications: ["At least high school graduate", "Comfortable with basic math", "Available Monday to Saturday"],
  benefits: ["Free meals on shift"],
};
const ok = (overrides: Record<string, unknown> = {}) => ({ ok: true, draft, warnings: [], draftsLeft: 16, ...overrides });
const aiFailure = (failure: Record<string, unknown>, draftsLeft = 17) => ({ ok: false, kind: "ai", draftsLeft, failure });

let action: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  action = vi.fn(async () => ({}));
  actions.jobDraftStatus.mockResolvedValue({ enabled: true, draftsLeft: 17, limit: 20 });
  actions.draftJobDescription.mockResolvedValue(ok());
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const renderForm = (props: Record<string, unknown> = {}) =>
  render(<JobPostingForm action={action as never} isNew canSaveTemplate templates={[]} canDraftWithAi {...props} />);
const field = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
const draftButton = () => screen.queryByRole("button", { name: "Draft with AI" }) as HTMLButtonElement | null;
const dialog = () => screen.getByRole("dialog");
const notesBox = () => within(dialog()).getByRole("textbox", { name: "What should this posting say?" }) as HTMLTextAreaElement;

async function openAndGenerate(notes = "Cashier for our Cainta branch. Free meals.") {
  await userEvent.click(draftButton()!);
  await within(dialog()).findByText("17 of 20 drafts left today");
  await userEvent.type(notesBox(), notes);
  await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
  await within(dialog()).findByText("Review the AI draft");
}
const useDraft = () => userEvent.click(within(dialog()).getByRole("button", { name: "Use this draft" }));

describe("the Draft with AI button", () => {
  it("is disabled until the Job title has text, then opens the dialog", async () => {
    renderForm();
    expect(draftButton()!.disabled).toBe(true);
    await userEvent.type(field("title"), "Cashier");
    expect(draftButton()!.disabled).toBe(false);
    await userEvent.clear(field("title"));
    expect(draftButton()!.disabled).toBe(true);
  });
  it("is enabled straight away when the posting already has a title", () => {
    renderForm({ isNew: false, canPublish: true, posting: { id: "p1", title: "Cashier", status: "draft" } });
    expect(draftButton()!.disabled).toBe(false);
  });
  it("is offered on a new posting, a Draft and a Job template", () => {
    renderForm();
    expect(draftButton()).not.toBeNull();
    cleanup();
    renderForm({ isNew: false, canPublish: true, posting: { id: "p1", title: "Cashier", status: "draft" } });
    expect(draftButton()).not.toBeNull();
    cleanup();
    renderForm({ isNew: false, template: true, canSaveTemplate: false });
    expect(draftButton()).not.toBeNull();
  });
  it("is not offered on an Open posting, or on a Closed or Filled one", () => {
    renderForm({ isNew: false, published: true, posting: { id: "p1", title: "Cashier", status: "open" } });
    expect(draftButton()).toBeNull();
    cleanup();
    renderForm({ isNew: false, readOnly: true, posting: { id: "p1", title: "Cashier", status: "closed" } });
    expect(draftButton()).toBeNull();
  });
  it("is hidden when the feature is switched off", () => {
    renderForm({ canDraftWithAi: false });
    expect(draftButton()).toBeNull();
  });
});

describe("the Describe dialog", () => {
  beforeEach(() => { renderForm({ posting: { id: "n", title: "Branch Cashier" } }); });
  it("shows the notes field, a counter up to 1,000, the personal-data reminder and the drafts left today", async () => {
    await userEvent.click(draftButton()!);
    expect(within(dialog()).getByText("Job posting · Branch Cashier")).toBeTruthy();
    expect(within(dialog()).getByText("0 / 1000")).toBeTruthy();
    expect(within(dialog()).getByText("Add the schedule, perks and must-haves. Don't include personal data.")).toBeTruthy();
    expect(await within(dialog()).findByText("17 of 20 drafts left today")).toBeTruthy();
    await userEvent.type(notesBox(), "Hello");
    expect(within(dialog()).getByText("5 / 1000")).toBeTruthy();
  });
  it("reads the drafts left when it opens, once, and not again on its own", async () => {
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    expect(actions.jobDraftStatus).toHaveBeenCalledTimes(1);
  });
  it("blocks Generate over 1,000 characters with a message", async () => {
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(notesBox());
    await userEvent.paste("a".repeat(1001));
    expect(within(dialog()).getByText("Notes are too long (1,000 characters at most).")).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "Generate draft" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("sends the title, context and notes, and shows the skeleton with Generate disabled while it works", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.draftJobDescription.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.type(notesBox(), "Free meals");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    expect(within(dialog()).getByText("Writing your draft…")).toBeTruthy();
    expect(within(dialog()).getByText("Generating… this usually takes a few seconds.")).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "Generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.draftJobDescription).toHaveBeenCalledWith({ title: "Branch Cashier", department: "", employmentType: "", location: "", notes: "Free meals" });
    finish(ok());
    await within(dialog()).findByText("Review the AI draft");
  });
});

describe("the preview", () => {
  beforeEach(() => { renderForm({ posting: { id: "n", title: "Branch Cashier" } }); });
  it("shows the four fields read-only with the check-every-line banner and the drafts left", async () => {
    await openAndGenerate();
    const d = dialog();
    expect(within(d).getByText("AI draft. Check every line: it goes public on the careers page once you publish.")).toBeTruthy();
    for (const text of [draft.summary, ...draft.responsibilities, ...draft.qualifications, ...draft.benefits]) expect(within(d).getByText(text)).toBeTruthy();
    for (const heading of ["Summary", "Responsibilities", "Qualifications", "Benefits"]) expect(within(d).getByRole("heading", { name: heading })).toBeTruthy();
    expect(within(d).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(d).getByText("16 of 20 drafts left today")).toBeTruthy();
    expect(within(d).getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(within(d).getByRole("button", { name: "Use this draft" })).toBeTruthy();
  });
  it("says so when no benefits were drafted", async () => {
    actions.draftJobDescription.mockResolvedValue(ok({ draft: { ...draft, benefits: [] } }));
    await openAndGenerate();
    expect(within(dialog()).getByText("None drafted. Your notes didn’t mention any benefits.")).toBeTruthy();
  });
  it("Regenerate asks again and counts down", async () => {
    await openAndGenerate();
    actions.draftJobDescription.mockResolvedValue(ok({ draftsLeft: 15, draft: { ...draft, summary: "A second summary." } }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Regenerate" }));
    await within(dialog()).findByText("A second summary.");
    expect(within(dialog()).getByText("15 of 20 drafts left today")).toBeTruthy();
  });
  it("Needs a look: underlines the flagged phrase with its banner and still allows Use this draft", async () => {
    actions.draftJobDescription.mockResolvedValue(ok({
      draft: { ...draft, qualifications: [...draft.qualifications, "Female applicants preferred"] },
      warnings: [{ phrase: "Female applicants", category: "gender", field: "qualifications" }],
    }));
    await openAndGenerate();
    const d = dialog();
    expect(within(d).getByText(/Needs a look: “Female applicants” in Qualifications\. Job postings shouldn’t state a gender, age or similar preference\. Remove or reword it before you use this draft\./)).toBeTruthy();
    const marked = d.querySelector("mark");
    expect(marked?.textContent).toBe("Female applicants");
    expect((within(d).getByRole("button", { name: "Use this draft" }) as HTMLButtonElement).disabled).toBe(false);
    await useDraft();
    await waitFor(() => expect(field("qualifications").value).toContain("Female applicants preferred"));
  });
});

describe("Use this draft", () => {
  it("fills only Summary, Responsibilities, Qualifications and Benefits, and keeps every other value as typed", async () => {
    renderForm({ posting: { id: "n", title: "Branch Cashier" } });
    await userEvent.type(field("department"), "Retail");
    await userEvent.type(field("location"), "Cainta branch");
    await userEvent.click(screen.getByLabelText("Part-time"));
    await userEvent.type(field("openings"), "3");
    await userEvent.type(field("salaryFrom"), "15000");
    await userEvent.type(field("salaryTo"), "18000");
    await userEvent.type(field("workSchedule"), "Mon-Sat");
    await userEvent.type(field("screeningCriteria"), "Has a Food Handler card");
    await userEvent.click(screen.getByLabelText("Valid government ID"));
    await userEvent.click(screen.getByLabelText(/^Save as template/));
    await userEvent.clear(field("templateName"));
    await userEvent.type(field("templateName"), "My cashier template");

    await openAndGenerate();
    await useDraft();

    await waitFor(() => expect(field("summary").value).toBe(draft.summary));
    expect(field("responsibilities").value).toBe(draft.responsibilities.join("\n"));
    expect(field("qualifications").value).toBe(draft.qualifications.join("\n"));
    expect(field("benefits").value).toBe("Free meals on shift");
    expect(field("title").value).toBe("Branch Cashier");
    expect(field("department").value).toBe("Retail");
    expect(field("location").value).toBe("Cainta branch");
    expect((screen.getByLabelText("Part-time") as HTMLInputElement).checked).toBe(true);
    expect(field("openings").value).toBe("3");
    expect(field("salaryFrom").value).toBe("15000");
    expect(field("salaryTo").value).toBe("18000");
    expect(field("workSchedule").value).toBe("Mon-Sat");
    expect(field("screeningCriteria").value).toBe("Has a Food Handler card");
    // The one document ticked before stays ticked, and the others stay unticked.
    expect(screen.getByLabelText("Valid government ID").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Resume or CV").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByLabelText(/^Save as template/).getAttribute("aria-checked")).toBe("true");
    expect(field("templateName").value).toBe("My cashier template");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask when the four fields are empty, and shows the dismissible AI-drafted note", async () => {
    renderForm({ posting: { id: "n", title: "Branch Cashier" } });
    await openAndGenerate();
    await useDraft();
    await waitFor(() => expect(field("summary").value).toBe(draft.summary));
    expect(screen.queryByText("Replace what you’ve typed?")).toBeNull();
    expect(screen.getByText("AI-drafted from your notes. Check every line before you save or publish. Pay and deadline were not filled in.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(screen.queryByText(/AI-drafted from your notes/)).toBeNull();
  });

  describe("when a field already has text", () => {
    beforeEach(async () => {
      renderForm({ posting: { id: "n", title: "Branch Cashier" } });
      await userEvent.type(field("summary"), "My own summary");
      await userEvent.type(field("benefits"), "My own perk");
      await userEvent.type(field("department"), "Retail");
      await openAndGenerate();
      await useDraft();
    });
    it("asks first: This replaces what you've typed, with Replace and Keep mine", async () => {
      expect(within(dialog()).getByRole("heading", { name: "Replace what you’ve typed?" })).toBeTruthy();
      expect(within(dialog()).getByText(/This replaces what you’ve typed in Summary, Responsibilities, Qualifications and Benefits/)).toBeTruthy();
      expect(field("summary").value).toBe("My own summary");
    });
    it("Keep mine changes nothing", async () => {
      await userEvent.click(within(dialog()).getByRole("button", { name: "Keep mine" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(field("summary").value).toBe("My own summary");
      expect(field("benefits").value).toBe("My own perk");
      expect(field("responsibilities").value).toBe("");
      expect(field("qualifications").value).toBe("");
      expect(field("department").value).toBe("Retail");
      expect(screen.queryByText(/AI-drafted from your notes/)).toBeNull();
      expect(action).not.toHaveBeenCalled();
    });
    it("Replace fills the four fields and keeps the rest", async () => {
      await userEvent.click(within(dialog()).getByRole("button", { name: "Replace" }));
      await waitFor(() => expect(field("summary").value).toBe(draft.summary));
      expect(field("benefits").value).toBe("Free meals on shift");
      expect(field("department").value).toBe("Retail");
      expect(screen.getByText(/AI-drafted from your notes/)).toBeTruthy();
    });
  });

  it("saves nothing: cancelling the dialog or using a draft never submits the form", async () => {
    renderForm({ posting: { id: "n", title: "Branch Cashier" } });
    await openAndGenerate();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(field("summary").value).toBe("");
    await openAndGenerate();
    await useDraft();
    await waitFor(() => expect(field("summary").value).toBe(draft.summary));
    expect(action).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save as draft" }));
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});

describe("limits and errors", () => {
  beforeEach(() => { renderForm({ posting: { id: "n", title: "Branch Cashier" } }); });
  it("limit reached: the yellow message with the reset time, Generate disabled, and no code on screen", async () => {
    actions.jobDraftStatus.mockResolvedValue({ enabled: true, draftsLeft: 0, limit: 20 });
    await userEvent.click(draftButton()!);
    const d = dialog();
    expect(await within(d).findByText("You've used all 20 AI drafts today. The limit resets at 12:00 AM Manila time. You can still write the posting yourself.")).toBeTruthy();
    expect(within(d).getByText("0 of 20 drafts left today")).toBeTruthy();
    expect((within(d).getByRole("button", { name: "Generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(d).getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
    expect(d.textContent).not.toMatch(/AI-\d{4}/);
    expect(d.textContent).not.toMatch(/Reference/);
  });
  it("a refusal on generate (yellow) shows its message and disables Generate", async () => {
    actions.draftJobDescription.mockResolvedValue(aiFailure({ banner: "yellow", message: "AI drafting is unavailable right now. Please try again tomorrow.", referenceId: null }));
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    expect(await within(dialog()).findByText("AI drafting is unavailable right now. Please try again tomorrow.")).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "Generate draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).queryByText(/Reference/)).toBeNull();
  });
  it.each([
    ["busy", "The AI service is busy. Please try again in a moment."],
    ["timed out", "That took too long. Please try again."],
    ["unusable", "The AI draft couldn't be used. Please try again or write it yourself."],
  ])("%s: the red message, a Reference ID, and Try again", async (_name, message) => {
    actions.draftJobDescription.mockResolvedValueOnce(aiFailure({ banner: "red", message, referenceId: "7F3K2A" }));
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    const d = dialog();
    expect(await within(d).findByText(message)).toBeTruthy();
    expect(within(d).getByText("Reference 7F3K2A · give this to support if the problem continues")).toBeTruthy();
    expect(d.textContent).not.toMatch(/AI-\d{4}/);
    actions.draftJobDescription.mockResolvedValueOnce(ok());
    await userEvent.click(within(d).getByRole("button", { name: "Try again" }));
    await within(dialog()).findByText("Review the AI draft");
  });
  it("tells Staff a failed attempt did not count when the number left is unchanged", async () => {
    actions.draftJobDescription.mockResolvedValue(aiFailure({ banner: "red", message: "The AI service is busy. Please try again in a moment.", referenceId: "7F3K2A" }, 17));
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    expect(await within(dialog()).findByText("This attempt didn't count toward your daily drafts.")).toBeTruthy();
  });
  it("does not say that when the attempt did count (an unusable draft)", async () => {
    actions.draftJobDescription.mockResolvedValue(aiFailure({ banner: "red", message: "The AI draft couldn't be used. Please try again or write it yourself.", referenceId: "7F3K2A" }, 16));
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    await within(dialog()).findByText(/couldn't be used/);
    expect(within(dialog()).queryByText(/didn't count/)).toBeNull();
    expect(within(dialog()).getByText("16 of 20 drafts left today")).toBeTruthy();
  });
  it("shows the message when HRMS cannot reach the Portal or database", async () => {
    actions.draftJobDescription.mockResolvedValue({ unavailable: "HRMS could not reach the Portal or database. Please try again in a moment." });
    await userEvent.click(draftButton()!);
    await within(dialog()).findByText("17 of 20 drafts left today");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Generate draft" }));
    expect(await within(dialog()).findByText("HRMS could not reach the Portal or database. Please try again in a moment.")).toBeTruthy();
  });
});

describe("the page does not poll", () => {
  it("makes no request until a user action opens the dialog", async () => {
    renderForm({ posting: { id: "n", title: "Branch Cashier" } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(actions.jobDraftStatus).not.toHaveBeenCalled();
    expect(actions.draftJobDescription).not.toHaveBeenCalled();
  });
});
