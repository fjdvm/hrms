# Employee detail backend

`employeesFor(sessionHandle, database?, documentFiles?, clock?).read(employeeId)` is the Employee Information read seam. It validates the Portal Module on every operation, returns seven document slots, and uses `Not provided yet` for empty optional sections. Personal fields remain nullable so callers can show the same fallback per field. Age uses the Manila calendar date. Offer acceptance is the contract's signed indicator; the product has no separate offer-letter file.

Government IDs use AES-256-GCM with a random nonce and authenticated Employee id and field. Set `HRMS_EMPLOYEE_ENCRYPTION_KEY` to one base64-encoded 32-byte secret in every server environment that reads or writes IDs; keep a secure backup. There is no default or plaintext fallback. Retain the key when deploying. A future key rotation needs a controlled re-encryption migration.

Only the exact Portal roles `Super Admin` and `HRMS Manager` receive full IDs or `contract.monthlyPay`. Every full-value read writes a durable reveal event per provided ID and for pay before returning. Audit rows contain actor, field and time, never the sensitive value. `replaceGovernmentIds` replaces all four IDs and writes edit events in the same SQL statement; it is intended for the later editor integration. All other roles receive masked IDs and no pay property.

Application-source document links retain the applicant document id from hire and are resolved to their gateway File id, restricted to the hired Application's Applicant. Upload-source links already carry File ids. Viewing uses the existing private gateway mechanism. Missing files have a null URL; validity and unknown upload dates remain nullable.

## Synthetic scenarios

After `npm run db:migrate`, explicitly opt into `HRMS_ALLOW_DEMO_SEED=true node scripts/seed-employees.mjs` with the encryption key and `DIRECT_URL` set. Requires Node 24 (native TypeScript stripping for the shared encryption helper). It is transactional, serialized against another seed, and repeatable by synthetic `@example.test` email. It never changes Careers-owned data or existing Employee records.

The seed creates four Onboarding records (Not requested twice, Requested, Account created), and three Active records (one lacks NBI). The second Not requested record is for the later No account needed flow. Account requests are local synthetic records; no Portal accounts, requests or emails are sent. The additive Account request table supplies storage for the subsequent #329/#332 work; no request actions are implemented here.

Demo document rows contain filenames and dates, but do not forge storage File ids. Their view URLs are null until real files are supplied; production documents resolve through the gateway as usual. Seed data is opt-in and is not part of the production schema migration.
