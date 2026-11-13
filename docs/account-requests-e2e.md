# Account requests: end-to-end acceptance run

Ticket: [#347](https://github.com/fjdvm/hrms/issues/347), part of [#315](https://github.com/fjdvm/hrms/issues/315).
Contract: [Portal ↔ HRMS](https://github.com/fjdvm/hrms/issues/315#issuecomment-6833529748).

## Run of 2026-11-13 (Manila)

Used the real production pair, `https://hrms.buildwrite.me` and `https://portal.buildwrite.me`,
then both applications locally on ports 3001 and 3000 against the configured databases and
real gateway, notifications service and Portal identity service. No fake Portal was used.
The local Portal sent authenticated status webhooks directly to local HRMS.

Signed in as Super Admin. All test people were synthetic: the existing Maria Santos and
Jose Reyes demo Employee records, plus `E2E Live Verify` and `E2E Recovery Verify`.
Work addresses use `hrms-e2e-347-…@example.test`; personal addresses also use `example.test`.
Each created User has Staff/Employee Role and only HRMS Dashboard access.
SMTP acceptance and the recorded Login sent event were checked, not receipt in a real mailbox.

| Exercise | Evidence and result |
| --- | --- |
| Send from Onboarding | `RQ-0007` appeared in the production Portal with the same person, work email, Role, Module, dates and note. |
| Remind | Reminded `RQ-0007` once; HRMS showed the reminder timestamp and the next allowed time, 24 hours later. Portal's administrator inbox received the reminder. |
| Seen | Opening the Portal detail recorded Seen in HRMS. After the fixes below, opening local `RQ-0011` updated the already-open HRMS panel through its WebSocket, without a reload. |
| Cancel | Cancelled `RQ-0007` in HRMS after confirmation. HRMS returned Maria to Not requested; Portal's All tab showed Cancelled. |
| Decline | Declined `RQ-0008` in Portal with reason “Details are incorrect” and message “E2E #347: use the corrected test work email.” HRMS showed both and offered a new request. |
| Prefilled account creation | For production `RQ-0009`, Portal prefilled Maria / Santos, the requested work email, Staff/Employee and HRMS Dashboard only. Create user produced `2026-MS-002`. |
| Progress and login delivery | HRMS's `RQ-0009` panel showed the recorded Sent, Seen, Account created and Login details sent timestamps. |
| Requester notified | The corrected HRMS sender delivered Account created and Declined to the real notifications service; the requester saw Account created in the production HRMS bell. |
| Future start date | Maria remained Onboarding after account creation while her start date was 12 December. |
| Start date arrived | Edited the synthetic Maria's start date to 13 November through Employee information. The corrected local cron endpoint returned `200 {"ok":true,"activated":1}`. Production Employee information then showed Active. The Active notification was delivered too. |
| Automatic activation | Local `RQ-0011`, Employee `BR-EMP-0008`, started today. Creating its account produced WebSocket pushes and removed its Onboarding row without a reload. Employee information showed Active. |
| Taken email | Requested the already-existing signed-in administrator's email. HRMS showed “That work email is already in use” and the field error; no active request was retained. |
| Portal outage | A temporary local forwarding proxy returned 503 only for Account request endpoints. The HRMS request dialog showed “HRMS could not reach the Portal. Nothing was sent. Please try again in a moment.” No production Portal outage was induced. |
| Login email failure recovery | Local SMTP did not confirm delivery for `RQ-0010`–`RQ-0012`. The Users and Account created statuses survived. After the Portal fix, reopening `RQ-0012`'s creation URL redirected to its Created request panel, with Resend login details available, rather than 404. |
| Resend succeeds | Local env overrides had blank SMTP credentials. Restarted only the test process with the already-configured credentials (no env file edits); Resend for `RQ-0012` succeeded and HRMS recorded Login sent at 18:52 Manila. |

The synthetic records and request history are retained as evidence. `BR-EMP-0001` and
`BR-EMP-0008` are Active; Jose and the recovery fixture remain Onboarding with future dates.
`RQ-0012` reached Login sent after recovery. The other locally created requests retain their
confirmed delivery state. No credentials
were printed or stored in this report. Temporary proxy and browser instrumentation are not app code.

## Mismatches fixed

1. The notification service rejects relative links with `400 {"errors":{"link":["Invalid URL"]}}`.
   HRMS now resolves its stored relative paths against `HRMS_APP_URL` before sending them.
   Pending rows keep their original idempotency keys and can be retried normally.
2. The gateway's HRMS Caller issues Live tickets for the case-sensitive app name `hrms`.
   HRMS previously sent and read `HRMS`, so a saved inbox notification never reached that socket.
   Sending and inbox reads now share the `hrms` default. An explicit `NOTIFICATIONS_APP` must
   match the gateway Caller's app exactly. Notifications saved under the old `HRMS` app are not
   moved by this change; the synthetic production notifications above were delivered there before
   the channel correction. New notifications use `hrms`.
3. Seen and Login sent previously saved their steps without a push. They now queue one
   requester notification on a forward transition, using the existing durable delivery and
   WebSocket. Duplicate and late deliveries do not send another transition notification.
4. The session proxy intercepted the daily employee-activation scheduler and redirected it to
   sign-in. The exact cron path now passes through to the route's own bearer authentication.
   Verified anonymous 401 and authorized 200 against the running local server.
5. Portal re-rendering a creation form after a committed account and failed SMTP delivery
   produced 404. A created request now routes to its existing status panel and Resend action.

The Account request HTTP contract did not change: paths, authentication, payloads and status
semantics remain those in the parent contract comment. No schema change was needed.

## Repository and migration check

Fetched all three repositories and updated them to their remote main on 13 November:
HRMS baseline `d824635`, Portal `20bc7be`, e-commerce `7c59b93`.
The Portal's divergent former local main was preserved as `archive/main-before-347-update`.
Unrelated local changes were preserved.

- HRMS: ran `npm run db:migrate`; every migration through `0033-account-request-reminders.sql`
  was already applied with matching checksums.
- Portal: checked `_prisma_migrations` against the repository; all 15 migrations were applied,
  including HRMS Modules, Account requests, fulfillment, delivery lease and decline.
  Regenerated Prisma Client for the updated checkout.
- E-commerce: compared the production Drizzle history with the journal and SHA-256 of each SQL
  file: all 27 storefront migrations were applied, through `0026_payment_proof_file`.
- Careers: the same check found all 8 migrations applied, through `0007_massive_exiles`.

There were no pending migrations to apply and no seed or destructive migration was run.
The two dedicated Employee fixtures were inserted as synthetic test data, not migrations.

## Repeat the run

1. Check migrations and configure both apps with the same registered HRMS system secret.
   For a local pair, set Portal's `HRMS_ACCOUNT_REQUEST_WEBHOOK_URL` to
   `http://localhost:3001/api/portal/account-requests/status` and `HRMS_SYSTEM_SECRET` to HRMS's
   `PORTAL_SYSTEM_SECRET`. HRMS's `PORTAL_URL` must reach that Portal. Never commit credentials.
2. Confirm `HRMS_APP_URL` is the browser-facing HRMS origin and `NOTIFICATIONS_APP` matches the
   app claim in a gateway-issued Live ticket. Keep both tabs open before sending a request.
3. Use a fresh synthetic Onboarding person and an unused test work email. Request only the
   access needed for the check. Verify the Portal payload, Seen, prefilled creation, requester
   notification and HRMS status progression.
4. Use separate requests for Remind/Cancel and Decline/new request. Try a taken work email.
   Isolate outage simulation to the test process's Account request transport.
5. Verify a future-dated person stays Onboarding and a due person becomes Active. Call the
   daily activation endpoint with its scheduler secret to test the account-first case.
6. Simulate SMTP failure and confirm the committed request exposes Resend login details.
   Record request references, date, environment, failures and fixes here.

No timer or focus refetch is involved: updates use the existing WebSocket or explicit user actions.
