# Applications list

`applicationsFor(sessionHandle, db).list({ page, stage, search, jobPostingId })` is the server-side boundary
for the Applicants list. Every call rechecks the Applications Module (Interviews for scheduling, results and the calendar)
through the Portal before querying; invalid, denied and unavailable decisions
throw `ApplicationError` with the corresponding reason.

The result contains `rows`, `total`, `page` (one-based, default 1), and
`pageSize` (25), `stageCounts`, `jobPostingOptions`, and `newThisWeek`. Invalid page numbers or filters
throw `ApplicationError("validation")`.

`stage` defaults to `All`, which includes Withdrawn. The selectable Stages are
`New`, `Screening`, `Interview`, `Offer`, `Hired`, and `Rejected`; there is no
Withdrawn tab. `search` defaults to an empty string and matches a literal,
case-insensitive substring of the Applicant's name or email (including literal
`%` and `_` characters). Stage, search, Job Posting and paging combine for `rows` and `total`.

`jobPostingId` optionally limits the list to one Job Posting, including a Closed
or Filled one. Omit it to include all Job Postings. Empty or non-string ids are
invalid; unknown ids return an empty list and zero tab counts.
`jobPostingOptions` contains Open Job Postings only, ordered by title then id.
Each option has `id`, `title`, and `applicationCount`, counting every Application
for that Job Posting regardless of Stage (including Withdrawn), search, selected
Job Posting or page. Open Job Postings with no Applications have a zero count.

`stageCounts` contains `All` and each selectable Stage, including zero counts.
These counts follow search and the Job Posting filter and ignore the selected Stage and page; `All` includes
Withdrawn. `newThisWeek` is the overall number of Applications applied from seven
days ago through now, inclusive, using the database clock. It ignores Stage,
search, Job Posting and paging and excludes future applied dates. All figures and rows come
from one database statement so they share a snapshot.
Rows are ordered by applied date descending, then Application id descending to
keep equal dates stable. Empty and out-of-range pages retain the total.

Migration `0011-applications-list.sql` creates the HRMS-owned
`hrms_careers_applications` read view. It reads the Application's profile snapshot
name, Applicant profile email, and Job Posting title and location. It includes
all posting statuses and Withdrawn Applications and maps stored `Received` to
`New`. It changes no Careers table or record. Run it through `npm run db:migrate`
with the existing direct database connection before using the module.

Next step labels are fixed per Stage except Interview, which shows
`Interview · Nov 3, 2026, 9:00 AM` for the next upcoming interview without a result,
using Manila time and the database clock. Without one it reads `Awaiting result`.
CSV exports use the same labels and include every matching row.

## Application documents

`readProfile(id).documents` returns submitted documents from `documents_snapshot`
with `id`, `name`, `size` (bytes), `contentType`, `requiredFor`, `status: "Submitted"`
and an HRMS `downloadUrl`. Each Job Posting Required Document with no matching
snapshot `requiredFor` is included as `{ requiredFor, status: "Requested" }`.
Requested is a display status only; nothing is written or sent to the Applicant.

`downloadDocument(applicationId, documentId)` returns a 307 redirect to a short-lived
file-storage signed address. Every request rechecks the Staff session and Recruitment
and Hiring Module, snapshot membership and Applicant ownership. The HTTP endpoint
stays `GET /api/applications/:id/documents/:documentId`; responses disable caching.
Missing Applications, unsubmitted or wrong-owner Documents, missing `file_id` and
file-storage failures return not-found. Missing File ids and storage failures are
logged without exposing credentials or signed addresses.

Document list data includes `contentType` and `uploadedAt` (a Date, or null when
live metadata is unavailable), read from the Applicant's Document metadata.
The snapshot continues to supply the displayed filename.

Set `API_GATEWAY_URL` and `API_GATEWAY_CALLER_KEY` in HRMS. The gateway Caller
must map to system code `HRMS`. HRMS only reads Careers' `file_id`; Careers owns
the schema migration. No HRMS database migration is needed. A real signed PNG
address was checked: HTTP 200, image/png, no attachment disposition, permitting
inline viewing. Staff can save the opened file; the existing download icon retains
its route. Deployment operators must verify both settings in HRMS's environment.

## Scheduling interviews

`applicationsFor(sessionHandle, db).scheduleInterview(id, fromStage, input)`
accepts the Stage Staff reviewed and `{ startsAt, endsAt, type, interviewerName,
interviewerId, meetingLink, mapLink, province, city, address }`. The legacy profile
caller may still supply `location`. Timestamps must include a timezone, end after
start, and type must be `Online` or `In person`. Only Screening and Interview
accept scheduling. A stale Stage or a second booking returns `conflict`; a missing
Application returns `not-found`. Every call rechecks Module access.

Booking never changes the Stage or emits a Stage notification. Staff move an
Application to Interview separately; that Stage can have no Interview. The
booking and its Staff activity commit atomically. The database enforces one
Interview per Application, including concurrent calls. Rescheduling is separate
future work. `readProfile` returns the Interview with nullable score, result,
private notes and result-email time. `recordInterviewResult` accepts optional
`privateNotes` and `resultEmailAt`; this ticket stores those fields only, without
sending or scheduling email.

Migration `0021-interview-model.sql` preserves existing ids, times, scores, results,
name snapshots and location text, copying Online locations to meeting links and
In person locations to addresses. Unknown legacy Staff ids remain null. If an
Application has extra legacy rounds, its highest-id Interview is kept as the
current booking. The other rows remain intact in
`hrms_legacy_application_interviews`; their activity links move to
`legacy_interview_id`. No legacy data is discarded. These archival rounds are
excluded from the current booking and Dashboard, and remain readable through the
authorised `readLegacyInterviews(id)` interface. Profile activity keeps their original
Interview ids so callers can resolve them against that history.

The profile tracker's `stageDates.Interview` comes only from recorded Stage history;
booking never supplies or overrides the date the Application reached that Stage.

## Private Application notes

`applicationsFor(sessionHandle, db).addNote(applicationId, text)` saves a private
note with the acting Staff member's Portal name and a database timestamp. Text
is trimmed; blank or non-string text and invalid Application ids return
validation. An unknown Application returns not-found. The caller cannot supply
an author or timestamp. Each write rechecks the Applications Module (Interviews for scheduling, results and the calendar).

`readProfile(id).notes` returns `{ id, text, authorName, createdAt }` entries,
newest first by timestamp and then id for stable ties. `createdAt` is a Date.
Applications with no notes return an empty array. The existing profile access
check protects notes; lists and CSV exports do not contain private notes.

Run `npm run db:migrate` before deploying this module. Migration
`0012-application-notes.sql` creates the HRMS-owned `hrms_application_notes`
table and its Application/time index without changing Careers tables.

## Recording interview results

`applicationsFor(sessionHandle, db).recordInterviewResult(applicationId, interviewId,
{ score, result })` records a whole-number score from 1 through 5 and either
`Passed` or `Not passed`. Every call rechecks Interviews access.
The interview must belong to the Application and have reached its start time
according to the database clock. A future interview returns `conflict`; a missing
interview or one belonging to another Application returns `not-found`. Invalid
ids, scores and results return `validation`.

The result and activity commit atomically. Activity includes `interviewId`, the
acting Staff name, timestamp and a reason such as
`Interview result: Passed (score: 4/5)`. Recording or correcting a result does not
advance the Stage or send an Applicant notification. The data stays in existing
HRMS-owned tables and is returned only through the authorised Staff profile;
lists and CSV exports omit scores and results. Run `npm run db:migrate` before
using this write: `0016-interview-result-activity.sql` permits activity after Hired,
Rejected or Withdrawn without changing workflow transitions or the Stage.

## Adding an applicant by hand

`addApplicant({ fullName, email, mobile, address, jobPostingId, expectedSalary, availableFrom })`
records a walk-in or referral on an Open Job Posting and returns the new id. `availableFrom` is
`YYYY-MM-DD`; the applied date is the database clock's now; the Stage is New. Rows live in
`hrms_manual_applications` (migration `0017-manual-applications.sql`), never in a Careers table,
and are listed through the `hrms_all_applications` view, so filters, tabs, search, counts and CSV
export treat them like any other Application. The "added by HR" marker is stored (`added_by_name`)
but not exposed.

Errors: `validation` for bad input, `not-found` for an unknown Job Posting, `conflict` for a
Job Posting that is not Open or an email (case-insensitive) already applied to that posting,
whether Careers-submitted or HR-added.

HR-added ids are negative (counting down from -1) so they never collide with Careers ids.

### Working an HR-added Application

`readProfile`, `moveStage`, `scheduleInterview`, `recordInterviewResult` and `addNote` accept HR-added
ids and behave as for any Application. The profile returns the added name, email, mobile, address,
expected salary and availability, and every Job Posting Required Document as `Requested` (HR-added
Applications have no submitted documents). The Stage lives in `hrms_manual_applications.status`;
history, activity, interviews and notes use the shared HRMS tables. Stage changes do not queue a Careers notification for HR-added Applications. Interview
invites always send email, and also notify a matching Careers account when one exists. Document download rejects these ids with `validation`, as they have no submitted documents.
Migration `0018-manual-application-workflow.sql` adds the status column and drops the foreign keys
from those HRMS tables to Careers' `applications` so they can hold HR-added ids. Run `npm run db:migrate`.


### Booking and rescheduling Interviews

`applicationsFor(...).scheduleInterview(applicationId, "Interview", input)` books
one Interview after the Application reaches the Interview Stage.
`rescheduleInterview(applicationId, interviewId, input)` updates that same row;
an Interview with a result cannot be rescheduled. Both methods recheck Portal
access and Interviewer eligibility, and use `interviewValidation` for Manila
weekdays, future starts, 8 AM–5 PM hours and type-specific location requirements.
The Interviewer's name is read from the Portal, never trusted from the input.

`ApplicationError.detail` supplies the specific validation or conflict reason.
Overlap conflicts also carry `conflicts` (Applicant name and interval) and
`freeSlots` (up to four duration-matched suggestions over the next 30 days).
Suggestions must be revalidated when saved. Touching ends are permitted.
Interviews dropped by a Stage move without a result do not block booking.

Migration `0023-interview-booking.sql` installs the atomic save function. It
serializes Interview saves with an advisory transaction lock, locks the
Application against concurrent Stage changes, and writes the Interview and
activity together. The lock is intentionally global for this low-volume HR
workflow, including moves between Interviewers. Existing rows are unchanged.
Migration `0024-interview-invites.sql` adds a channel to the notification outbox
and queues invite email plus a Careers notification atomically with each booking
or reschedule. Everyone receives email; Careers recipients must have an account,
resolved by Applicant id for Careers Applications or profile email for HR-added
Applications. The fixed wording is shared with the read-only invite preview;
updated invites have an "Updated:" title. Online email has a Join meeting button;
In person email has View map only when a map link was supplied. Stage notifications
remain brief and separate. The server action drains the outbox after the response;
the existing cron retries failed deliveries with stable per-event/channel keys.
Older callers without invite data remain compatible during migration rollout. The shared Schedule interview dialog (`components/hiring/schedule-interview.tsx`)
calls the `saveInterview` server action, which books or, given an Interview id,
reschedules. Screening now offers Move to Interview; booking never moves a Stage.
Client-side checks (`lib/interview-form.ts`) only guide HR; the server decides.

The regular Applications tests use PGlite. To also run the independent-session
PostgreSQL concurrency acceptance check, set `TEST_POSTGRES_URL` to a disposable
local PostgreSQL server whose role may create databases, then run
`npx vitest run tests/interview-concurrency.test.ts`. The test creates and removes
its own database. It deliberately commits one booking while another session
competes, verifying the post-lock snapshot sees the committed Interview.
