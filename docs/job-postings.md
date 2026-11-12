# Job Posting backend and shared Careers schema

Ticket #30 implements `jobPostingsFor(sessionHandle)` in `lib/job-postings.ts`.
Call it only on the server with the opaque Portal session handle from the current
request. It uses `DATABASE_URL`; tests may supply disposable Postgres as the second
argument. Each operation rechecks the Job Postings Module through the
Portal, including reads. Invalid, denied and unavailable decisions fail closed.

- `saveDraft(fields)` accepts any subset of the Job Posting fields.
- `editDraft(id, fields)` patches only supplied fields; an empty patch is a read.
- `read(id)` returns the posting or `undefined`.
- `list({ status?, search? })` includes every status by default. Search is a literal,
  case-insensitive title substring. Results are ordered by latest update, then id.
- `deleteDraft(id)` deletes only a Draft. Edit and delete refuse other statuses
  (`not-draft`) and missing ids (`not-found`). Both guard status in the write itself.

Drafts use lowercase `draft`, empty text/arrays for missing content and `null` for
an absent deadline. `deadline: null`, empty strings and empty arrays clear fields.
Status and id cannot be changed through field patches.

Ticket #32 adds `publish(id)`, `editOpen(id, fields)`, `close(id)` and
`markFilled(id)`. Publishing requires nonblank title, department, employment type,
location and description plus a future deadline. Optional requirements and arrays
may stay empty. Invalid publication or Open edits throw `JobPostingError` with
reason `validation` and a `fieldErrors` entry for each invalid field. The SQL write
validates the resulting row, so concurrent edits cannot bypass the requirements.

Only Draft → Open → Closed or Filled is allowed. Open-only operations refuse
other statuses with `not-open`; publish refuses them with `not-draft`. Missing
postings return `not-found`. Open edits patch the shared Careers row immediately.
Every operation rechecks Portal access; there is no approval step.

Reads, lists and lifecycle mutations persist expired Open postings as Closed
before proceeding. `closeExpired()` exposes the same authorized sweep for a
scheduled caller. `vercel.json` schedules `/api/cron/job-postings` daily (the Hobby plan allows
nothing more frequent; reads and lifecycle operations sweep expired postings too). Set `CRON_SECRET` in the
production deployment; the endpoint refuses missing/incorrect bearer credentials.
The scheduled caller uses the internal maintenance entry point, without a Staff
session. Idle rows close on the next sweep; repeated sweeps are harmless. Careers must enforce
its deadline predicate independently, so an idle expired row cannot accept an
Application. Templates, auditing and announcements belong to subsequent tickets.

## Migration and deployment

HRMS writes directly to the existing `public.job_postings` table in the
`brenraphaels-ats` Neon project. It does not create a second copy or use a webhook.
Set the pooled `DATABASE_URL` and direct, non-pooled `DIRECT_URL` in gitignored
`.env.local` and deployment environment variables. Never commit credentials.

Run `npm run db:migrate` before deploying callers of the new module. This runs the
versioned SQL in `migrations/` transactionally under an advisory lock, records
checksums in `public.hrms_schema_migrations`, and skips already applied migrations.
It rejects changed applied files. Migration does not run during app startup/build.

`0001-job-posting-drafts.sql` makes deadline nullable and constrains status to
`draft`, `open`, `closed`, or `filled`. Existing rows are retained. Rollback of the
nullable deadline requires resolving/deleting incomplete Drafts first; rolling
back application code alone does not require reverting this schema.

## Contract for Careers

Careers must keep filtering **every public list, detail lookup, filter-option query
and application eligibility check** to `status = 'open' AND deadline > now()`.
Draft, Closed and Filled postings must never appear publicly or accept Applications.
A missing deadline is never eligible. Do not replace the positive Open condition
with `status != 'closed'`; that would expose Drafts. Careers' current list/detail
queries already use the positive Open condition.

Careers' schema declaration should allow a nullable deadline and include `draft`
where it models stored status. The public Open representation may keep a required
deadline after the query proves it is present. Preserve these changes in future
Careers migrations and retire the legacy Job Posting webhook writer as the shared
ownership decision is rolled out. HRMS owns Job Posting writes.

## Verification

`npm test -- tests/job-postings.test.ts` runs against a fresh PGlite database
(real Postgres compiled to WASM, in memory) per test, starting with the existing
Careers table definition and applying the migration. It never connects to shared
rows. Only the module interface is exercised; the fake Portal sits at the HTTP
boundary. Existing Open/Closed/Filled rows are fixtures, not test-only publishing
operations. `npm run typecheck`, `npm run lint`, and `npm test` validate the repo.

## Job Templates

Ticket #34 adds `jobTemplatesFor(sessionHandle, db?)` from `lib/job-postings.ts`,
with the same per-operation Portal access checks and disposable database seam.
`create(fields)` explicitly saves reusable content; callers may pass a Job Posting
for "Save as template". Only content fields are stored: deadline, status, posting
id and timestamps are never copied from the caller. Empty templates are allowed.
`list()` returns templates ordered by latest update, then id. `edit(id, fields)`
patches supplied content fields; empty strings/arrays clear values and omitted
fields are preserved. `delete(id)` removes only the template.

`startPosting(id)` atomically copies the template into a new editable Draft with
no deadline. No relationship is retained, so subsequent edits/deletes on either
side leave the other untouched. Freehand Draft saves never create templates.
Edit, delete and start refuse missing ids with `JobTemplateError("not-found")`;
access failures use `denied`, `invalid` or `unavailable`.

Apply `0002-job-templates.sql` with `npm run db:migrate` before using templates.
It creates `public.job_templates` when absent. If Careers already provisioned the
table, it preserves its rows and sets the legacy `status` column default to `draft`
so content-only saves remain compatible. HRMS does not expose that legacy status.
Application rollback can leave the added table in place. Auditing remains in its
separate follow-up ticket.

## First-publish announcements (#37)

Publishing atomically queues one announcement with the publish Audit Event. It
performs no notification HTTP calls. The Server Action starts delivery through
Next.js `after`, after returning the publish response; the authenticated daily
maintenance route retries remaining work. Direct module callers must invoke the
maintenance entry point `retryJobPostingAnnouncements(db?)` from their worker.

Set server-only `CAREERS_URL` to Careers' public HTTPS origin. Delivery uses
`API_GATEWAY_URL` and `API_GATEWAY_KEY` for the HRMS Caller. Careers must already
provide `job_postings.announced_at`, `applicant_profiles.job_alerts_opt_in` and
Neon Auth's `neon_auth."user"` (`id`, `email`, `emailVerified`). Its migration
owns those columns; HRMS migration `0004` adds only its durable work tables.

The first delivery attempt snapshots all registered Neon Auth Applicants,
including those without a profile, for in-app sends. Only a Verified Applicant
with an opted-in profile receives App email, using the Auth email address.
Recipients, content and per-recipient/channel keys persist across retries;
registrations after the snapshot do not expand it. Edits and final status changes
never queue another announcement. Historical Open rows are never backfilled.

The notifications service must support `Idempotency-Key` on App email before
this code is deployed (companion notifications PR). In-app requests use its
existing `idempotencyKey` field. Failed and uncertain requests retain their keys.
Gateway acceptance means queued email/stored notification, rather than confirmed
SMTP delivery. Once every send is accepted, one atomic statement sets
`announced_at`, completes the work record and sets `applicants_notified: true`
on the original publish Audit Event. That event is held locally until completion,
since audit-logs treats accepted events as immutable. Other Audit Events proceed
independently. No separate announcement Audit Event is emitted.

Each maintenance invocation snapshots up to 20 announcements and attempts up to
50 sends with five-second timeouts and capped retry backoff. Larger audiences
continue on subsequent invocations. A service outage can delay the publication
Audit Event but cannot roll back or delay the publish response.

## First-published timestamp (#50)

Apply `0005-job-posting-first-published.sql` with `npm run db:migrate` before
deploying this code. It adds nullable `public.job_postings.first_published_at`
(`timestamptz`) with no default or backfill. Careers must include this nullable
column in its schema declaration and preserve it in future migrations.
Historical Open postings retain `NULL`, including after edits or closure.

Every posting returned by the module includes `firstPublishedAt: Date | null`.
Drafts, including those started from templates, have `null`. A successful first
publish records the database clock atomically with the Draft → Open transition;
failed publishing leaves it unset. Edits, closing, filling, deadline expiry and
announcement delivery never change it. It is distinct from `updated_at` and
`announced_at`, and cannot be supplied through content patches. Rolling back
application code can leave the added column in place.

## Number of openings (#54)

Apply `0006-job-openings.sql` before deploying these callers. Both shared tables,
`public.job_postings` and `public.job_templates`, gain nullable `openings` (integer,
positive when specified). Existing rows remain unchanged with `NULL`; no default
or backfill is applied. Careers must add `openings: number | null` to its schema
and preserve the columns and positive-value checks in future migrations.
Application rollback can leave these additive columns in place.

Posting and template results include `openings`. Create defaults omitted values
to `null`; edits preserve omitted values and clear the number with explicit
`null`. All content writes reject non-positive, fractional, non-numeric and
out-of-range values (maximum 2,147,483,647) with reason `validation` and an
`openings` field error. Templates retain the value and `startPosting` copies it
independently into the Draft. Openings remain optional when publishing. Existing
forms omit this backend-only field, so editing other content preserves it.

## Monthly salary range (#56)

Apply `0007-job-salary-range.sql` before deploying these callers. Both shared
Careers tables (`public.job_postings` and `public.job_templates`) gain nullable
`salary_from` and `salary_to` double-precision columns, expressed in PHP per month.
Existing rows keep `NULL` bounds; there is no default or backfill. Careers must
include both nullable numeric columns in its schema declaration and preserve
the non-negative, finite-value and ordered-range constraints in future migrations.
Application rollback can leave these additive columns in place.

Server results expose `salaryFrom: number | null` and `salaryTo: number | null`.
Create defaults omitted bounds to `null`; edits preserve omitted bounds and clear
explicit `null` bounds. Either bound can be unspecified; both `null` means the
salary is hidden on Careers. Equal bounds, zero and fractional amounts are valid.
When both bounds exist, salary-to must be at least salary-from. Violations return
`validation` with `salaryFrom` and `salaryTo` field errors, including partial edits
against existing bounds. Invalid non-numeric, negative or non-finite bounds return
an error on that field. Database constraints enforce the resulting range atomically
with the content and audit write. Templates retain the bounds and `startPosting`
copies them independently into the Draft. Publishing does not require a salary.
Current forms omit these backend fields, preserving stored salary on other edits;
Careers salary rendering and Staff form controls are separate UI work.

## Work schedule (#58)

Apply `0008-job-work-schedule.sql` before deploying these callers. Both shared
Careers tables (`public.job_postings` and `public.job_templates`) gain nullable
`work_schedule` text with no default or backfill. Existing rows keep `NULL`.
Careers must add this nullable text column to its schema declaration and preserve
it in future migrations. Application rollback can leave these additive columns.

Server results expose `workSchedule: string | null`. Creation defaults omission
to `null`; edits preserve omitted values and explicit `null` clears the schedule.
Templates retain the text and `startPosting` copies it independently into a Draft.
Publishing does not require a schedule. The Staff form's Pay & schedule section
has a Work schedule text field (#59); blank saves as `null`. Careers rendering is
separate UI work.

## Direct publication (#64)

`createAndPublish(fields)` creates a brand-new Open Job Posting without saving a
Draft first. It requires the same nonblank fields and future deadline as
`publish(id)`, returns all invalid field errors together, and rechecks Portal
access. Optional content follows the same defaults and Required Document
normalisation as `saveDraft`.

The insert, first-published timestamp, single `job_posting.published` Audit Event
and first-publish announcement commit in one SQL statement. Any write failure
leaves none of them behind; there is no separate `job_posting.created` event.
Callers schedule `retryJobPostingAnnouncements` as for Draft publication.
Careers visibility remains `status = 'open' AND deadline > now()`.
No new migration is required.

## Save a named template on submit (#69)

`saveDraft(fields, { saveAsTemplate: { name } })` and
`createAndPublish(fields, { saveAsTemplate: { name } })` optionally save an
independent Job Template in the same SQL statement as the posting, Audit Events
and (for publication) announcement. A missing or whitespace-only name returns
`JobPostingError("validation")` with a `templateName` field error and writes
neither row. Names are trimmed. Omitting the request retains existing behavior.
Any persistence failure rolls back both rows and their queued work.

Apply `0009-job-template-name.sql` before deploying. It adds nullable `name` to
`public.job_templates`; existing and standalone templates retain `NULL`, without
backfill. Template results include `name`, separate from the role `title`.
Careers must preserve the added column in future schema migrations. Application
rollback can leave it in place. Template content is copied from the saved posting;
deadline, status, id and timestamps are excluded, and identity/timestamps are
assigned independently by the template write.

Existing Drafts accept the same optional request through
`editDraft(id, fields, options)` and `publish(id, options)`. They copy the resulting
saved content; a failed template write preserves the original Draft unchanged.


## Responsibilities and Benefits (#106)

Job Postings accept `responsibilities` and `benefits` as lists of text in
`saveDraft`, `createAndPublish`, `editDraft` and `editOpen`. Both lists are returned
by saves, edits, reads and lists. Omitted values default to `[]` on creation;
on edits, omitted or `undefined` values preserve stored content, and `[]` clears
a list. Neither list is required to publish. Existing `requirements` text is
preserved independently; no legacy content is split or backfilled.

Careers owns the schema: its `0006_job_responsibilities_benefits.sql` migration
(ticket #100) provides the JSONB columns with empty defaults. It must be applied
before deploying this backend. No additional HRMS migration is needed. Job Template
support and form inputs belong to #117 and #126 respectively.

## Recover historical Audit Events (#129)

The read-only preflight on 2026-10-28 found two attempted outbox rows. Both
already use the new `job_template.*` actions. Their historical `staff` actor
type is accepted by the audit service, and their actor id remains the username.
No payload rewrite or schema migration is needed. Do not infer Portal user ids
or replace the original `occurred_at` or `idempotency_key`.

Use Node.js 24 or newer. Run `node scripts/recover-audit-outbox.mjs` to record
the current count in a read-only transaction. After authorization for the target
environment, run `node scripts/recover-audit-outbox.mjs --deliver` with
`DATABASE_URL`, `API_GATEWAY_URL` and `API_GATEWAY_KEY` configured. It uses the
existing audit-delivery boundary and does not run deadline or announcement work.
The command attempts up to 50 due events; it reports a nonzero remaining count
and exits unsuccessfully if any remain. Retry after their scheduled backoff,
or finish existing announcement work first for publication events waiting on it.
Successful sends delete their rows; failures retain the exact payload for retry.
Rerunning against a drained outbox sends nothing.

The parent spec excludes production database changes. The configured local
`DATABASE_URL` was confirmed to point at the ATS production branch; draining
that outbox requires explicit production authorization.
