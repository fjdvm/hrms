# Careers uploads Documents to file-storage and HRMS views them through a signed address

Careers keeps each Applicant Document as a Private, Permanent File in the company file-storage service, reached through the api-gateway, and no longer in Vercel Blob. The Applicant's browser uploads the bytes straight to file-storage's signed upload address, and Careers records the File's id in a nullable `file_id` column on `applicant_documents`, drops `blob_pathname`, and Links the File to the Document. HRMS reads `file_id` from the shared database (ADR-0001) and, behind its own Staff session and Module check, redirects the browser to a short-lived signed viewing address. HRMS calls file-storage as its own Client System, `HRMS`, through its own gateway Caller key.

We rejected keeping Vercel Blob because its token was never configured, so no Document upload has ever worked, and the company already runs file-storage. We rejected relaying the bytes through the Careers server because a Vercel Function body is limited to 4.5 MB and Documents may be 5 MB. We rejected finding Files by Link alone because every other file-storage user stores the File id, and it costs an extra call on every view.

## Consequences

- The Document size cap is 5 MB, down from 10 MB. Careers still accepts only jpg, png, pdf, doc and docx, though file-storage allows more types.
- The private R2 bucket needs CORS for the Careers origin, and HRMS needs a gateway Caller key with system code `HRMS`.
- Careers ADR-0005 deferred this move; it is now made.
- No Blob Documents exist, so nothing is backfilled and HRMS keeps no Blob fallback.
- Any Client System can view any File. Who may see a Document stays enforced by HRMS and Careers, not by file-storage.
