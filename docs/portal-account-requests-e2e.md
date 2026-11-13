# Portal ↔ HRMS Account requests: end-to-end acceptance run (#347)

Repeat this run after changing the system secret, either side's webhook or endpoint URL, or the contract (issue #315, "Portal ↔ HRMS contract"). It creates real Portal Users and sends real login emails, so use a throwaway person whose work and personal emails you control.

Setup: HRMS `PORTAL_URL`, `PORTAL_SYSTEM_NAME` and `PORTAL_SYSTEM_SECRET` point at the Portal; the Portal's `HRMS_SYSTEM_SECRET` equals HRMS's `PORTAL_SYSTEM_SECRET`, and `HRMS_ACCOUNT_REQUEST_WEBHOOK_URL` is HRMS's `/api/portal/account-requests/status`. Sign in to HRMS as Super Admin or HRMS Manager and to the Portal as an Administrator.

1. **Send.** Onboarding → Request user account for a person whose start date is in the future. Expect the row to read Requested and the Portal's Account requests tab to show a New request with the same `RQ-####` reference.
2. **Seen.** Open the request in the Portal. Expect HRMS's panel to show "Seen by admin" with the administrator's **name** (not an id) and the time, with no reload.
3. **Create.** In the Portal choose Create account, adjust nothing, confirm. Expect HRMS to show Account created with the administrator's name, then "Login details sent", and the requester to get the in-app "Account created" notification. The row reads "Becomes Active on <start date>" and has no button.
4. **Active.** Once the start date (Manila) has arrived, expect the person to leave Onboarding as Active: on the webhook if the account was created after the start date, otherwise at the next daily run of `/api/cron/employee-activation`. The audit shows the change by "System" and the requester is notified.
5. **Decline.** With a second person: send, then Decline in the Portal with a reason and message. Expect the panel to show Declined with both, the requester notified with the reason, and the row back to Not requested with Request user account available.
6. **Cancel and Remind.** With a third person: send, Remind admin (the Portal's administrators get an in-app notification; HRMS says when the next reminder is allowed), then Cancel request. Expect the Portal to show Cancelled and the row back to Not requested.
7. **Taken email.** Request an account with a work email an existing Portal User already has. Expect "A Portal user already has that work email." in the dialog and no request left behind.
8. **Outage.** Stop the Portal (or point `PORTAL_URL` at a closed port) and send a request. Expect "HRMS could not reach the Portal. Nothing was sent." and no request left behind.

## Findings from reading both sides (2026-11-13)

Comparing HRMS's `lib/portal/account-requests.ts` with the Portal's `docs/integrations/account-requests.md` and code: the endpoint paths, Basic and Bearer authentication, payloads, `email-taken`, the remind and cancel `409 { status }`, and the status vocabulary match, and the `declined` push carries `reason` and `message`.

One mismatch: the Portal sent `actor` as the administrator's internal User id, while HRMS shows `actor` as a name. The contract comment was clarified first (`actor` is the administrator's display name, "Portal" for system steps). The Portal still has to send the name; until it does, steps 2, 3 and 5 will show an id.

## Run record

Not yet run against real deployments. Record the date, who ran it, and the result of each step here when it is.
