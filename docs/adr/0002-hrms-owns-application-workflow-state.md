# HRMS owns the Application workflow and keeps its data in its own tables

Careers writes an Application when an Applicant submits it, and HRMS takes over from there. HRMS changes `applications.status` directly in the shared `brenraphaels-ats` database, as it already does for Job Postings (ADR-0001), instead of sending Careers the signed `application.status_changed` webhook. Everything else HR records about an Application, such as its source, notes, activity and stage dates, lives in new `hrms_`-prefixed tables keyed by `applications.id`, created by HRMS migrations. HRMS reads Careers' tables and alters none of them.

We rejected asking Careers to add columns to `applications`, because that makes every HR-side change wait on a Careers migration and puts HR-only data in a table Careers owns. We rejected the webhook because it adds a second path to keep in sync for no benefit when both apps share one database.

## Consequences

- Careers' contract must say that HRMS owns `applications.status` from `Received` onward. Careers' Frozen rule is unaffected, since the snapshot freezes once the status moves past `Received`.
- Careers and HRMS now fail together on an Application status change, as they already do for Job Postings.
- A Careers schema change to `applications` must be made with HRMS in mind, since HRMS reads it.
