import { database, type Database } from "./database";
import { draftsLeft, readAiConfig, runAi, type AiBanner, type AiClient, type AiConfig, type AiFailure } from "./ai";
import { DRAFT_SCHEMA, buildDraftPrompt, checkWording, parseDraft, validateDraftRequest, type Draft, type DraftFieldErrors, type DraftRequest, type FlaggedPhrase } from "./job-draft";
import { JobPostingError } from "./job-postings";
import { accessFor } from "./portal/access";

/**
 * What a screen may know about a refusal or failure: the banner colour, the message and, on a red error, the Reference ID. The internal
 * code and reason stay on the server (the usage log), so nothing in the payload that reaches the browser carries one.
 */
export type DraftFailure = { banner: AiBanner; message: string | null; referenceId: string | null };

export type JobDraftResult =
  /** A draft that passed the schema. `warnings` lists any phrase the wording check flagged ("Needs a look"); HR can still use the draft. */
  | { ok: true; draft: Draft; warnings: FlaggedPhrase[]; draftsLeft: number }
  | { ok: false; kind: "invalid"; fieldErrors: DraftFieldErrors }
  /** A refusal or failure of the AI. */
  | { ok: false; kind: "ai"; failure: DraftFailure; draftsLeft: number };

type Options = { db?: Database; client?: AiClient; config?: AiConfig; now?: () => Date };

/**
 * The Job description drafter, for the Staff member making this request. Pass the opaque Portal session handle. Each call asks the
 * Portal anew. It writes nothing but the AI usage row: it never saves or publishes a posting and stores no AI marker on one.
 */
export function jobDrafterFor(sessionHandle: string | undefined, { db = database, client, config = readAiConfig(), now = () => new Date() }: Options = {}) {
  async function authorize() {
    const result = await accessFor(sessionHandle).check("Job Postings");
    if (result.decision !== "allowed") throw new JobPostingError(result.decision);
    // Older Portal deployments omit the id; the username identifies the Staff member then.
    return result.staff.id ?? result.staff.username;
  }

  return {
    /** What the dialog shows when it opens: drafts left today, and whether the feature is on. A user action reads this; nothing polls it. */
    async status() {
      const staffId = await authorize();
      return { enabled: config.enabled["job-draft"], draftsLeft: await draftsLeft(db, staffId, "job-draft", config, now()), limit: config.limits["job-draft"] };
    },

    /** Drafts the Summary, Responsibilities, Qualifications and Benefits from a title and notes. */
    async draft(request: DraftRequest): Promise<JobDraftResult> {
      const staffId = await authorize();
      const checked = validateDraftRequest(request);
      if (!checked.ok) return { ok: false, kind: "invalid", fieldErrors: checked.fieldErrors };
      const { value } = checked;
      const prompt = buildDraftPrompt(value);

      const result = await runAi<{ draft: Draft; warnings: FlaggedPhrase[] }>({
        db, staffId, feature: "job-draft", client, config, now,
        request: { ...prompt, schemaName: "job_description", schema: DRAFT_SCHEMA },
        // A draft that fails the schema or flags the wording check is regenerated once. A second schema failure is unusable (AI-0093);
        // a second draft that is still flagged is shown with its warnings ("Needs a look"), because HR can read, edit and use it.
        parse: (output, attempt) => {
          const draft = parseDraft(output, value.notes);
          if (!draft) return null;
          const warnings = checkWording(draft);
          return warnings.length && attempt === 0 ? null : { draft, warnings };
        },
      });

      const left = await draftsLeft(db, staffId, "job-draft", config, now());
      return result.ok ? { ok: true, ...result.value, draftsLeft: left } : { ok: false, kind: "ai", failure: toFailure(result), draftsLeft: left };
    },
  };
}

const toFailure = ({ banner, message, referenceId }: AiFailure): DraftFailure => ({ banner, message, referenceId });
