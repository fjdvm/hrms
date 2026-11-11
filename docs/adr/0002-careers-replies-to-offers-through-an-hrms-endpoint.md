# Careers sends Offer replies and document uploads to HRMS instead of writing the shared tables

HRMS and Careers share one database (ADR-0001), and Job Postings are written straight into tables Careers reads. For Offers we did not extend that: when an Applicant accepts or declines an Offer, or uploads a Pre-employment Document, Careers calls an HRMS endpoint as a Careers caller, and HRMS makes every change. Careers only reads the Offer and document rows to show them.

A reply is not one write. It sets the Offer's status, moves the Application's Stage (declining makes it Rejected), writes activity, queues the email, and notifies Staff. Letting Careers write the tables would put a second copy of those rules in a second repository, and the two would drift. This is the same split the e-commerce app uses for Orders (its ADR-0003).

## Consequences

- An Applicant's reply or upload fails if HRMS is unavailable, even though the database is up. Careers shows "try again" and records nothing.
- The files service accepts the upload first, then Careers tells HRMS the file id, so a failed HRMS call can leave an orphaned file, which a retry replaces.
- Both apps can still read the shared tables directly; only writes go through HRMS.
