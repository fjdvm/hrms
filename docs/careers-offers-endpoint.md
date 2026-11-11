# Careers offer endpoint (#288)

Careers calls HRMS to record an Applicant's reply to an Offer and to submit a Pre-employment Document (ADR-0002, ADR-0003).
HRMS makes every change; Careers only reads the shared tables.

Both routes need `Authorization: Bearer $CAREERS_CALLER_KEY`. With the key unset, every call is refused (401).
`applicantId` is the Applicant Careers signed in; HRMS checks the Offer belongs to that Applicant's own Application, never trusting it from a browser.
The routes bypass the Staff sign-in redirect in `proxy.ts` for this reason.

| Route | Body | Result |
|---|---|---|
| `POST /api/careers/offers/{id}/reply` | `{ applicantId, answer: "Accepted" \| "Declined" }` | `200 { ok: true }` |
| `POST /api/careers/offers/{id}/documents` | `{ applicantId, type, fileId, fileName }` | `200 { ok: true, submitted, total }` |

`type` is one of `resume`, `valid-id`, `nbi`, `health`, `sss`, `philhealth`, `pagibig`.

Errors are `{ error, message }`: `400` invalid body, `401` bad key, `404` no such Offer for this Applicant,
`409` with `error` of `withdrawn`, `draft`, `already-answered` (replies are final) or `declined` (uploads), `503` HRMS unavailable.

- A reply follows the same rules as Staff recording one (one shared function), with the email queued to go out at once.
- An upload marks the row Submitted and replaces any earlier file. It is allowed while the Offer is Sent or Accepted.
- Staff holding Recruitment and Hiring are notified of each reply and upload, linking to `/offers/{id}`. "Ready to hire" is sent once,
  when an Accepted Offer has all seven documents Submitted (whichever of the 7th upload or the acceptance comes last).
- No migration: the notifications reuse `hrms_staff_notifications`, and uploads write no Offer activity row.
