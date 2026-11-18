"use client";

import { useRef, useState } from "react";
import { Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { draftJobDescription, jobDraftStatus } from "@/app/(hrms)/job-postings/draft-actions";
import { DialogBody, DialogFrame } from "@/components/performance/dialog-frame";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { aiMessage } from "@/lib/ai/messages";
import { NOTES_MAX, type Draft, type DraftField, type FlaggedPhrase } from "@/lib/job-draft";
import { cn } from "@/lib/utils";
import { cleanMultiline, hasDisallowedText } from "@/lib/validators/text";

/** The Draft with AI button and its dialog: Describe, Generating, Preview (with Needs a look) and the limit and error states. The AI only fills the form: nothing is saved here. */

export type DraftContext = { title: string; department: string; employmentType: string; location: string };

type Failure = { tone: "yellow" | "red"; message: string; referenceId: string | null; notCounted: boolean };
type View =
  | { kind: "describe"; failure?: Failure; notesError?: string }
  | { kind: "generating" }
  | { kind: "preview"; draft: Draft; warnings: FlaggedPhrase[] }
  | { kind: "confirm"; draft: Draft };

const FIELD_LABEL: Record<DraftField, string> = { summary: "Summary", responsibilities: "Responsibilities", qualifications: "Qualifications", benefits: "Benefits" };

const primary = "h-auto rounded-lg bg-[#5b2a86] px-[16px] py-[9px] hover:bg-[#4c2271]";
const secondary = "h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] shadow-none";

export function DraftWithAiButton({
  title,
  getContext,
  hasExistingText,
  onUse,
}: {
  /** The Job title as typed now: the button is disabled until it has text. */
  title: string;
  getContext: () => DraftContext;
  /** True when any of the four fields already has text, so using a draft must ask first. */
  hasExistingText: () => boolean;
  onUse: (draft: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>({ kind: "describe" });
  const [notes, setNotes] = useState("");
  const [left, setLeft] = useState<{ draftsLeft: number; limit: number } | null>(null);
  const [statusProblem, setStatusProblem] = useState<string | null>(null);
  // A dialog closed or restarted while a request was out ignores that request's answer.
  const request = useRef(0);
  const hasTitle = title.trim() !== "";

  function reset(next: boolean) {
    request.current += 1;
    setOpen(next);
    if (!next) return;
    setView({ kind: "describe" });
    setLeft(null);
    setStatusProblem(null);
    const mine = request.current;
    // Read when the dialog opens: a user action, not polling.
    void jobDraftStatus().then((status) => {
      if (mine !== request.current) return;
      if ("unavailable" in status) setStatusProblem(status.unavailable);
      else setLeft({ draftsLeft: status.draftsLeft, limit: status.limit });
    });
  }

  const describing = view.kind === "describe" ? view : null;
  const cleanedNotes = cleanMultiline(notes);
  const notesProblem = hasDisallowedText(notes) ? "Notes contain characters that can't be used." : cleanedNotes.length > NOTES_MAX ? `Notes are too long (${NOTES_MAX.toLocaleString("en-US")} characters at most).` : null;
  const limitReached = left !== null && left.draftsLeft <= 0;
  const notesMessage = notesProblem ?? describing?.notesError ?? null;
  const showHint = describing !== null && !describing.failure && !limitReached;

  async function generate() {
    const mine = ++request.current;
    const before = left?.draftsLeft ?? null;
    setView({ kind: "generating" });
    const result = await draftJobDescription({ ...getContext(), notes });
    if (mine !== request.current) return;
    if ("unavailable" in result) {
      setView({ kind: "describe", failure: { tone: "red", message: result.unavailable, referenceId: null, notCounted: false } });
      return;
    }
    if (result.ok) {
      setLeft((previous) => (previous ? { ...previous, draftsLeft: result.draftsLeft } : { draftsLeft: result.draftsLeft, limit: result.draftsLeft }));
      setView({ kind: "preview", draft: result.draft, warnings: result.warnings });
      return;
    }
    if (result.kind === "invalid") {
      setView({ kind: "describe", notesError: result.fieldErrors.notes ?? result.fieldErrors.title ?? "Check the notes and try again." });
      return;
    }
    setLeft((previous) => (previous ? { ...previous, draftsLeft: result.draftsLeft } : previous));
    const { banner, message, referenceId } = result.failure;
    const red = banner === "red";
    setView({
      kind: "describe",
      failure: {
        tone: red ? "red" : "yellow",
        message: message ?? "AI drafting isn't available right now.",
        referenceId,
        // A failed attempt on the provider's side gives its slot back: the count is unchanged.
        notCounted: red && before !== null && result.draftsLeft >= before,
      },
    });
  }

  function use(draft: Draft) {
    if (hasExistingText()) return setView({ kind: "confirm", draft });
    apply(draft);
  }
  function apply(draft: Draft) {
    request.current += 1;
    setOpen(false);
    onUse(draft);
  }

  const context = `Job posting · ${title.trim()}`;
  const counter = left ? `${left.draftsLeft} of ${left.limit} drafts left today` : statusProblem ? "" : null;

  return (
    <Dialog open={open} onOpenChange={reset}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button gets no pointer events, so the tooltip hangs off a wrapper. */}
            <span tabIndex={hasTitle ? -1 : 0} className="inline-flex">
              <DialogTrigger asChild>
                <Button type="button" variant="outline" disabled={!hasTitle} className="h-auto gap-[6px] rounded-lg border-[#e4e4e7] px-[14px] py-[9px] font-medium text-[#1f1a2e] shadow-none">
                  <Sparkles aria-hidden className="size-4 text-primary" />
                  Draft with AI
                </Button>
              </DialogTrigger>
            </span>
          </TooltipTrigger>
          {!hasTitle && <TooltipContent>Enter a job title first, so the draft knows what role to write for.</TooltipContent>}
        </Tooltip>
      </TooltipProvider>

      {view.kind === "preview" || view.kind === "confirm" ? (
        <DialogFrame title={view.kind === "confirm" ? "Replace what you’ve typed?" : "Review the AI draft"} description={context}>
          {view.kind === "confirm" ? (
            <>
              <DialogBody>
                <p className="text-sm text-zinc-700">
                  This replaces what you’ve typed in Summary, Responsibilities, Qualifications and Benefits. Everything else on the form stays as it is.
                </p>
              </DialogBody>
              <Footer>
                <Button key="keep" type="button" variant="outline" className={secondary} onClick={() => setOpen(false)}>Keep mine</Button>
                <Button key="replace" type="button" className={primary} onClick={() => apply(view.draft)}>Replace</Button>
              </Footer>
            </>
          ) : (
            <>
              <DialogBody>
                <PreviewBanner warnings={view.warnings} />
                <Block label="Summary" fieldName="summary" warnings={view.warnings}>{view.draft.summary}</Block>
                <Block label="Responsibilities" fieldName="responsibilities" warnings={view.warnings} items={view.draft.responsibilities} />
                <Block label="Qualifications" fieldName="qualifications" warnings={view.warnings} items={view.draft.qualifications} />
                <Block label="Benefits" fieldName="benefits" warnings={view.warnings} items={view.draft.benefits} empty="None drafted. Your notes didn’t mention any benefits." />
              </DialogBody>
              <Footer note={counter}>
                <DialogClose key="cancel-review" asChild><Button type="button" variant="outline" className={secondary}>Cancel</Button></DialogClose>
                <Button key="regenerate" type="button" variant="outline" className={secondary} disabled={limitReached} onClick={generate}>Regenerate</Button>
                <Button key="use" type="button" className={primary} onClick={() => use(view.draft)}>Use this draft</Button>
              </Footer>
            </>
          )}
        </DialogFrame>
      ) : (
        <DialogFrame title="Draft with AI" description={context}>
          <DialogBody>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="ai-notes" className="text-[13px] font-medium text-zinc-800">What should this posting say?</label>
              <Textarea
                id="ai-notes"
                value={notes}
                rows={6}
                disabled={view.kind === "generating"}
                onChange={(event) => setNotes(event.target.value)}
                aria-invalid={notesMessage ? true : undefined}
                aria-describedby="ai-notes-help"
                placeholder="e.g. Cashier for our Cainta branch. Monday to Saturday, 8 AM to 5 PM. Handles POS sales and the end-of-day cash count. Free meals and 13th month pay."
                className="h-auto min-h-0 resize-y rounded-lg border-[#e4e4e7] bg-white px-[12px] py-[10px] text-sm leading-[21px] text-[#18181b] shadow-none placeholder:text-[#a1a1aa] focus-visible:border-[#8b5cf6]"
              />
              <div className="flex items-start justify-between gap-sm text-xs">
                <p id="ai-notes-help" className={notesMessage ? "text-[#9a3412]" : "text-zinc-500"} role={notesMessage ? "alert" : undefined}>
                  {notesMessage ?? "Add the schedule, perks and must-haves. Don't include personal data."}
                </p>
                <p className={cn("shrink-0", cleanedNotes.length > NOTES_MAX ? "text-[#9a3412]" : "text-zinc-500")} aria-live="polite">{notes.length} / {NOTES_MAX}</p>
              </div>
            </div>
            {view.kind === "generating" && <GeneratingSkeleton />}
            {describing?.failure && <FailureBanner failure={describing.failure} />}
            {describing && !describing.failure && limitReached && left && (
              <FailureBanner failure={{ tone: "yellow", message: aiMessage("limit-reached", "job-draft", left.limit) ?? "", referenceId: null, notCounted: false }} />
            )}
            {statusProblem && <FailureBanner failure={{ tone: "red", message: statusProblem, referenceId: null, notCounted: false }} />}
            {showHint && <p className="text-xs text-zinc-500">AI writes the summary, responsibilities, qualifications and benefits. It never sets pay or the deadline.</p>}
          </DialogBody>
          <Footer note={counter}>
            <DialogClose key="cancel-describe" asChild>
              <Button type="button" variant="outline" className={secondary}>{limitReached || describing?.failure?.tone === "yellow" ? "Close" : "Cancel"}</Button>
            </DialogClose>
            <Button
              key="generate"
              type="button"
              className={primary}
              onClick={generate}
              disabled={view.kind === "generating" || limitReached || describing?.failure?.tone === "yellow" || notesProblem !== null || (left === null && !statusProblem)}
            >
              {view.kind === "generating" && <Loader2 aria-hidden className="animate-spin" />}
              {describing?.failure?.tone === "red" ? "Try again" : "Generate draft"}
            </Button>
          </Footer>
        </DialogFrame>
      )}
    </Dialog>
  );
}

function Footer({ children, note }: { children: React.ReactNode; note?: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
      {note ? <p className="mr-auto max-w-[260px] text-xs text-zinc-500">{note}</p> : null}
      <div className="ml-auto flex items-center gap-sm">{children}</div>
    </div>
  );
}

function GeneratingSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-[10px] rounded-lg bg-[#f4f1f7] px-[14px] py-[12px]">
      <p className="flex items-center gap-[6px] text-sm font-semibold text-foreground"><Sparkles aria-hidden className="size-4 text-primary" />Writing your draft…</p>
      <p className="text-[13px] text-zinc-500">Generating… this usually takes a few seconds.</p>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-[90%]" />
      <Skeleton className="h-3 w-[70%]" />
    </div>
  );
}

/** Yellow (a refusal) or red (something went wrong). Staff see the message and, on a red one, a Reference ID: never a code. */
function FailureBanner({ failure }: { failure: Failure }) {
  const red = failure.tone === "red";
  return (
    <div role="alert" className={cn("flex items-start gap-[8px] rounded-lg px-[12px] py-[10px]", red ? "bg-[#fdecea]" : "bg-[#fdf1d8]")}>
      <TriangleAlert aria-hidden className={cn("mt-[2px] size-[16px] shrink-0", red ? "text-[#b42318]" : "text-[#8a5a00]")} />
      <div className={cn("flex flex-col gap-[2px] text-[13px] leading-[19px]", red ? "text-[#b42318]" : "text-[#8a5a00]")}>
        <p>{failure.message}</p>
        {failure.referenceId && <p className="text-xs">Reference {failure.referenceId} · give this to support if the problem continues</p>}
        {failure.notCounted && <p className="text-xs">This attempt didn&apos;t count toward your daily drafts.</p>}
      </div>
    </div>
  );
}

/** "Check every line", or "Needs a look" when the wording check flagged a phrase. */
function PreviewBanner({ warnings }: { warnings: FlaggedPhrase[] }) {
  if (warnings.length === 0) {
    return (
      <div className="flex items-start gap-[8px] rounded-lg bg-[#f4f1f7] px-[12px] py-[10px]">
        <Sparkles aria-hidden className="mt-[2px] size-[16px] shrink-0 text-primary" />
        <p className="text-[13px] leading-[19px] text-[#5b2a86]">AI draft. Check every line: it goes public on the careers page once you publish.</p>
      </div>
    );
  }
  const where = warnings.map((w) => `“${w.phrase}” in ${FIELD_LABEL[w.field]}`).join(", ");
  return (
    <div role="alert" className="flex items-start gap-[8px] rounded-lg bg-[#fdf1d8] px-[12px] py-[10px]">
      <TriangleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-[#8a5a00]" />
      <p className="text-[13px] leading-[19px] text-[#8a5a00]">
        Needs a look: {where}. Job postings shouldn’t state a gender, age or similar preference. Remove or reword {warnings.length === 1 ? "it" : "them"} before you use this draft.
      </p>
    </div>
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The text with each flagged phrase underlined. */
function Highlighted({ text, phrases }: { text: string; phrases: string[] }) {
  if (phrases.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${phrases.map(escape).join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        phrases.some((phrase) => phrase.toLowerCase() === part.toLowerCase())
          ? <mark key={index} className="bg-transparent text-inherit underline decoration-[#dc2626] decoration-wavy underline-offset-4">{part}</mark>
          : <span key={index}>{part}</span>,
      )}
    </>
  );
}

function Block({ label, fieldName, warnings, items, empty, children }: { label: string; fieldName: DraftField; warnings: FlaggedPhrase[]; items?: string[]; empty?: string; children?: React.ReactNode }) {
  const phrases = warnings.filter((w) => w.field === fieldName).map((w) => w.phrase);
  return (
    <section className="flex flex-col gap-[4px]" aria-label={label}>
      <h3 className="text-[13px] font-semibold text-zinc-800">{label}</h3>
      <div className="rounded-lg border border-[#ebebeb] bg-zinc-50 px-[12px] py-[10px] text-sm leading-[21px] text-[#18181b]">
        {items ? (
          items.length ? (
            <ul className="list-disc pl-[18px]">{items.map((item, index) => <li key={index}><Highlighted text={item} phrases={phrases} /></li>)}</ul>
          ) : (
            <p className="text-zinc-500">{empty}</p>
          )
        ) : (
          <p><Highlighted text={String(children)} phrases={phrases} /></p>
        )}
      </div>
    </section>
  );
}
