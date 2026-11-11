# Careers Document pipeline: end-to-end acceptance run

Repeat this run after changing Caller keys, bucket CORS or the Document code on either side. It writes a real File.

1. In Careers, sign in as an Applicant and upload a small PDF on the profile. Expect the PUT to the private bucket's signed address to return 200 and the Document to stay after a reload (it is confirmed and Linked).
2. Apply to a posting and pick the PDF for a Required Document. Leave another uploaded Document unpicked. Submit.
3. In HRMS, sign in as Staff with Recruitment and Hiring access and open the Applicant. Expect only the picked Document, opening in the viewer.
4. `GET /api/applications/<id>/documents/<id>` answers 307 to a signed address with `Cache-Control: private, no-store`. The unpicked Document's id answers 404, and a request with no session redirects to login.

A posting needs at most as many Required Documents as the Applicant has Documents, because the same Document cannot fill two slots.

## Run of 2026-11-11 (ticket #262, production sites)

Passed: browser upload (PUT 200, no CORS failure), confirm and Link, submit, HR view in the viewer, unpicked Document hidden (404), anonymous request redirected. No Caller key or CORS fault was found.
