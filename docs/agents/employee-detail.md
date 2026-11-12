# Employee detail backend

`employeesFor(sessionHandle, database?, documentFiles?, clock?).read(employeeId)` is the Employee Information read seam. It validates the Portal Module on every operation, returns seven document slots, and uses `Not provided yet` for empty optional sections. Personal fields remain nullable so callers can show the same fallback per field. Age uses the Manila calendar date. Offer acceptance is the contract's signed indicator; the product has no separate offer-letter file.

Government IDs use AES-256-GCM with a random nonce and authenticated Employee id and field. Set `HRMS_EMPLOYEE_ENCRYPTION_KEY` to one base64-encoded 32-byte secret in every server environment that reads or writes IDs; keep a secure backup. There is no default or plaintext fallback. Retain the key when deploying. A future key rotation needs a controlled re-encryption migration.

Only the exact Portal roles `Super Admin` and `HRMS Manager` receive full IDs or `contract.monthlyPay`. Every full-value read writes a durable reveal event per provided ID and for pay before returning. Audit rows contain actor, field and time, never the sensitive value. `replaceGovernmentIds` replaces all four IDs and writes edit events in the same SQL statement; it is intended for the later editor integration. All other roles receive masked IDs and no pay property.

Application-source document links retain the applicant document id from hire and are resolved to their gateway File id, restricted to the hired Application's Applicant. Upload-source links already carry File ids. Viewing uses the existing private gateway mechanism. Missing files have a null URL; validity and unknown upload dates remain nullable.

## Synthetic scenarios

After `npm run db:migrate`, explicitly opt into `HRMS_ALLOW_DEMO_SEED=true node scripts/seed-employees.mjs` with the encryption key and `DIRECT_URL` set. Requires Node 24 (native TypeScript stripping for the shared encryption helper). It is transactional, serialized against another seed, and repeatable by synthetic `@example.test` email. It never changes Careers-owned data or existing Employee records.

The seed creates four Onboarding records (Not requested twice, Requested, Account created), and three Active records (one lacks NBI). The second Not requested record is for the later No account needed flow. Account requests are local synthetic records; no Portal accounts, requests or emails are sent. The additive Account request table supplies storage for the subsequent #329/#332 work; no request actions are implemented here.

Demo document rows contain filenames and dates, but do not forge storage File ids. Their view URLs are null until real files are supplied; production documents resolve through the gateway as usual. Seed data is opt-in and is not part of the production schema migration.

## Onboarding read model (#329)

`employeesFor(...).onboarding({ state?, search? })` validates the `Employee Onboarding` Module (not Employee Information). It lists only Employee records with status Onboarding; Active records never appear. Each row has name, Employee ID, position, branch, start date, work email, `accountState`, the request reference and raw status, `overdue` (Manila start date passed with no account or "No account needed") and `becomesActiveOn` (account exists, start date still ahead).

Account state comes from the employee's active request (`requested`/`seen` → Requested, `account_created`/`login_sent` → Account created); cancelled and declined requests are ignored. Otherwise `no_account_needed_at` set → No account needed, else Not requested. The work email is the active request's, or `firstname.lastname@brenraphaels.ph` derived from the name. Counts (All, Needs account, Requested, Account created, No account needed) cover the search narrowing, not the state tab; `summary` has the three workload counts.

`actions` are filled only for Super Admin and HRMS Manager (`ONBOARDING_ACTING_ROLES`, one list shared with the sensitive-field roles): Not requested → `request`, `no-account-needed`; Requested → `remind`, `cancel`; No account needed → `undo-no-account-needed`. Other holders get `canAct: false` and empty actions. Migration 0029 adds the nullable `no_account_needed_at/by` pair; the action that sets it belongs to #345.

## Sending an Account request (#332)

`employeesFor(...).accountRequestOptions()` returns the Portal's Roles (each with its access-template `moduleIds`) and Modules per system, fetched on demand for the Request dialog. `requestAccount(employeeId, { workEmail, roleId, moduleIds, neededFrom?, note? })` sends one. Both validate the `Employee Onboarding` Module and then require Super Admin or HRMS Manager (`canActInOnboarding`); they throw `AccountRequestError` (`lib/account-requests.ts`) with a `reason` and, for `validation`, `email-taken` and `conflict`, per-field `problems` for the dialog.

Rules: the work email is required, well formed and unique (case-insensitive) among active requests and Portal Users; the Role and every Module must come from the Portal's current list; at least one Module; `neededFrom` defaults to the start date; the note is optional. The person must still be Onboarding. Active means `requested`, `seen`, `account_created` or `login_sent` (the last follows `account_created`, so the person must not get a second request): at most one per Employee record and one per work email, enforced by partial unique indexes (migration 0030). A cancelled or declined request is not active and allows a new one with a new `RQ-####` reference. The reference comes from HRMS's sequence, so numbers can skip when a send fails.

Order: the row is inserted first (so the database settles a double click or concurrent send), then the Portal is called with the personal email for login details. If the Portal is unreachable or answers non-2xx, or says `email-taken`, the row is deleted again and the caller is told (`unavailable` or `email-taken`); nothing is left behind. Only after the Portal accepts is the first `requested` event written to `hrms_account_request_events`. The Portal treats `reference` as an idempotency key.

`lib/portal/account-requests.ts` holds the Portal calls. The contract (issue #315) names them but not their paths; the paths used, following the Portal's `/api/integrations/*` pattern, are `GET /api/integrations/account-requests/options` and `POST /api/integrations/account-requests`. Confirm them with the Portal developer; they are constants in that file. Remind and cancel (#342) and the status webhook (#336) are not part of this ticket.

## Portal status webhook (#336)

`POST /api/portal/account-requests/status` (`app/api/portal/account-requests/status/route.ts`) receives the Portal's progress on an Account request. The contract (issue #315) names the call but not its path; this path is an assumption to confirm with the Portal developer. The Portal authenticates with `Authorization: Bearer <PORTAL_SYSTEM_SECRET>` (`lib/portal/webhook.ts`, constant-time, refused when the secret is unset). Body: `{ reference, status, actor, occurredAt, reason?, message? }`, `status` one of `seen`, `account_created`, `login_sent`, `cancelled`, `declined`; `reason` and `message` are kept only for `declined`.

Answers: `200` for any valid delivery (including a repeat or out-of-order one, so the Portal stops retrying), `401` for a missing or wrong secret, `400` for an invalid body, `404` for an unknown reference, `503` when HRMS itself failed (the Portal retries).

`lib/account-request-status.ts` applies a delivery in one SQL statement: each status is recorded once per request (unique index, migration 0032) with actor and time; the request only moves forward requested → seen → account_created → login_sent; cancelled and declined apply only while the request is requested or seen; an account that exists wins over a cancel or decline whichever arrives first, so HRMS never pretends to undo a real account. `account_created` also sets `account_created_at` and `account_created_by`, which Onboarding shows. If moving an old cancelled or declined request would clash with the person's newer active request, the step is still recorded and the status is left alone (logged).

Notifications: the requester is told once when the account is created, and once when the request is declined (with the reason), through `hrms_staff_notifications` and the existing gateway, so the live connection delivers them. A notification can name its recipients (`recipientIds` in the payload, removed before sending); the rest keep going to the holders of their area's Module. Not here: the Active rule (#345), remind and cancel (#342).
