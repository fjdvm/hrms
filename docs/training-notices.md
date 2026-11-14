# Training notice delivery and retries

Assigning Employees to a Training queues one **Assignment** notice per Employee in `hrms_training_notices` and sends it
straight away (`after()` in the assign action). Employees without an email never get a notice row: they are never
emailed, never Failed and never Not reached, and appear under "Needs printed schedule" in the Notification log.

## Retry policy

A failed send keeps the notice and counts the failure:

| Failed sends | State | Next |
| --- | --- | --- |
| 1 to 3 | Retrying | tried again about 15 minutes later |
| 4 (the first send plus 3 retries) | Failed, shown as **Not reached** | stops; Staff press **Retry** |

Retry on a Not reached Employee queues the notice again with a fresh set of 3 retries. Removing an Employee from a
Training drops their undelivered notices; delivered and failed ones stay in the log.

## Reminders

A **Reminder** goes out to each assigned Employee 1 day before the Training at **8:00 AM Manila time**, and Staff can send one
on demand with **Send reminder** on the Training page.

- **Automatic.** The same job that sends and retries notices (below) first queues the Reminders that are due. From 8:00 AM Manila
  time on the day before a Training, every Upcoming Training dated tomorrow gets one Reminder per assigned Employee who is still
  marked Assigned and has an email. The job runs every 15 minutes, so a Reminder is queued within about 15 minutes after 8:00 AM
  (GitHub can delay a run). A Training cancelled, or whose Employee is no longer Assigned, is skipped. A day the job did not run
  at all is not made up: once the Training's date is today, no "tomorrow" Reminder is sent.
- **Once only.** `hrms_training_notices.automatic_for` holds the Training date an automatic Reminder is for, and a unique index on
  (Training, Employee, that date) means a repeated or overlapping run queues nothing twice. A Training moved to a new date is
  reminded again for the new date. An Employee who already got a Reminder (sent by hand) in the last 24 hours is not sent
  another automatic one.
- **Manual.** Send reminder shows the recipient count, the names and the email as it will read, then queues the Reminder for every
  assigned Employee still marked Assigned who has an email, and sends it straight away (`after()`, like Assignment). Only an
  Upcoming Training can be reminded about.
- **No email, no Reminder.** Employees without an email are never emailed, never Failed and never Not reached. The dialog names
  them ("Give them a printed schedule instead"), and they stay under "Needs printed schedule" in the Notification log.
- **Same delivery and retries** as every other notice (table below), and each Reminder shows in the Notification log as kind
  "Reminder".
- **No polling.** Reminders are queued and sent by the server-side job only. No screen repeats a request on a timer
  (ADR-0005).

## Why GitHub Actions and not a Vercel cron

Something must wake the app about 15 minutes after a failure, and at 8:00 AM Manila time for Reminders, and an HRMS request cannot do that. A `*/15 * * * *` entry
in `vercel.json` made the Vercel deployment fail (Vercel limits crons to daily on some plans; confirmed on the #379 PR,
where removing the entry made the same code deploy). So the retry schedule lives in
`.github/workflows/training-notices.yml`, which calls `GET /api/cron/training-notices` every 15 minutes. This is the
same pattern as the ecommerce repo's Customer Notification retries (`customer-notifications.yml`, every 5 minutes), its
feedback-request and photo-retention jobs, and file-storage's daily cleanup.

The route needs `Authorization: Bearer $CRON_SECRET` and answers 401 otherwise. A repeated or overlapping run is safe:
each email carries a stable idempotency key (`training-notice:<id>`) and the workflow has a `concurrency` group.

## Setup (once)

In the `fjdvm/hrms` repository settings:

1. Actions variable **`HRMS_URL`**: the production HRMS origin, for example `https://hrms.buildwrite.me`.
2. Actions secret **`CRON_SECRET`**: the same value as the `CRON_SECRET` on the Vercel project (the other HRMS jobs use it).

Until both are set the workflow fails visibly (red runs) and changes nothing; due emails simply wait.

## Things to know

- GitHub can delay scheduled runs by several minutes, so "about 15 minutes apart" is the real guarantee.
- Scheduled workflows in a public repository are paused after 60 days without repository activity; re-enable one from the
  Actions tab. `fjdvm/hrms` is public, so its Actions minutes are free.
- Run it by hand with `gh workflow run training-notices.yml`.
- To stop sending: `gh workflow disable training-notices.yml`. Queued and retrying notices wait and go out once it is
  enabled again.
