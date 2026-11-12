# Careers “Your details” endpoint

`POST /api/careers/offers/:id/details` authenticates the server-side Careers caller with `Authorization: Bearer <CAREERS_CALLER_KEY>`. Careers must pass the Applicant id from its signed-in session, never an id supplied by the browser. HRMS checks it against the Offer's own Application.

```json
{
  "applicantId": "signed-in-applicant-id",
  "birthday": "1995-06-15",
  "sex": "Female",
  "civilStatus": "Single",
  "governmentIds": {
    "sss": "34-1234567-8",
    "philhealth": "123456789012",
    "pagibigMid": "987654321012",
    "tin": "123-456-789"
  },
  "emergencyContact": {
    "name": "Maria Santos",
    "relationship": "Mother",
    "mobile": "09171234567"
  }
}
```

Every answer is optional. This is a full replacement: omitted, null and blank answers clear earlier answers. Dates must be real ISO dates, with birthdays no later than today in Manila. Sex, civil status, IDs, relationship and mobile allow up to 100 characters; contact names allow 200. Strings are trimmed.

Success returns `200 { "ok": true }`. Invalid input is 400, a missing/bad caller key is 401, an unknown Offer or wrong Applicant is 404, and an unavailable Offer (Draft, Declined, Withdrawn or already Hired) is 409. Infrastructure failures return 503. Responses use `private, no-store` and never echo answers. On conflict, reload the Offer before retrying.

Migration `0031-offer-applicant-details.sql` adds `hrms_offers.applicant_details` and `details_revision`. All four government IDs are encrypted with the existing `HRMS_EMPLOYEE_ENCRYPTION_KEY`, AES-256-GCM, a random nonce, and an authenticated context of negative Offer id plus field. Positive Employee ids use a separate context. The key is the existing base64-encoded 32-byte Employee encryption key; retain it across deployments.

Hiring re-encrypts the IDs for the Employee record and copies personal answers and the emergency contact within the same SQL statement as the Stage change and document links. Revision checks serialize a competing save and hire: one may return a conflict for the caller to reload. A failed hire rolls the entire write back. Blank details never require the encryption key and never gate hire; only the existing seven documents do. The Employee record is the source of truth after hire.
