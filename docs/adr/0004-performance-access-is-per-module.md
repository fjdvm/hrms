# Performance access is the Module grant alone

Anyone who holds the Performance Module can do everything in it: rate, submit, reopen with a reason, set up KPIs, import attendance and flag development needs. There is no separate manager permission, and no role names such as "HRMS Manager" or "Super Admin" are checked. Every action records which Staff member did it in the audit log, and a reopen requires a reason.

We rejected a Manager flag, set per Staff member in the Portal, that would reserve rating, submit and reopen for some Performance holders. It would be a second kind of access beside the Module grant, which every other Module relies on alone, and it needs new Portal work before Performance can start. We rejected checking role names because the Portal has already renamed Super Admin to Admin and HRMS still checks the old names (BL-115), so a role check would break the same way again.

## Consequences

- The person who sets up KPIs and imports attendance can also rate and submit. Accountability rests on the audit log and the required reopen reason, not on separated duties. If the client later wants real sign-off authority, this decision is reopened and a Portal permission is added then.
- Staff who hold Performance but not Training still see each Employee's Training completion result inside the score, but not the Trainings themselves.
- The Performance access gate needs only the Module grant (BL-082); BL-115 is no longer a dependency.
- The wording "only the HRMS Manager can reopen" in the draft Figma frames changes to match.
