# HRMS and Careers share one database, and Job Postings are written directly

HR-ATS (the Job Postings, Applications, Interviews and Offers Modules of HRMS) and the Careers site of the e-commerce app use the same Neon database, `brenraphaels-ats`. HRMS writes Job Postings straight into the `job_postings` table that Careers reads, so a published, edited or closed Job Posting is visible on Careers at once, with no webhook and no second copy to keep in sync. This supersedes the Job Posting part of the e-commerce repo's ADR-0005, which had Careers keep a webhook-fed copy so that its public page survived an HR-ATS outage; we chose one source of truth over that outage tolerance for a simpler build. Applicant identity stays in the same database but remains unrelated to Customer identity (ADR-0006 there still holds).

## Consequences

- Careers' public page and HRMS now fail together if the database is unavailable, and a schema change on `job_postings` must be made with both applications in mind.
- Notifying Applicants of a new Open Job Posting is done by HRMS at publish time, since it can read the Applicants from the same database.
- Application workflow ownership was extended by #133 and #140: HRMS writes `applications.status` directly from `Received` onward, replacing the Application-status webhook. Stage dates and activity live in HRMS-owned `hrms_` tables; The Careers schema and submitted snapshots stay unchanged.
