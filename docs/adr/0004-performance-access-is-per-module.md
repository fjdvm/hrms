# Performance access is the Module grant alone

Anyone who holds the Performance Module can do everything in it: rate, submit, reopen with a reason, set up KPIs, import attendance and flag development needs. There is no separate manager permission, and no role names such as "HRMS Manager" or "Super Admin" are checked. Every action records which Staff member did it in the audit log, and a reopen requires a reason.

We rejected a Manager flag, set per Staff member in the Portal, that would reserve rating, submit and reopen for some Performance holders. It would be a second kind of access beside the Module grant, which every other Module relies on alone, and it needs new Portal work before Performance can start. We rejected checking role names because the Portal has already renamed Super Admin to Admin and HRMS still checks the old names (BL-115), so a role check would break the same way again.

## Consequences

- The person who sets up KPIs and imports attendance can also rate and submit. Accountability rests on the audit log and the required reopen reason, not on separated duties. If the client later wants real sign-off authority, this decision is reopened and a Portal permission is added then.
- Staff who hold Performance but not Training still see each Employee's Training completion result inside the score, but not the Trainings themselves, with one exception: the title of a scheduled Training (see the amendment below).
- The Performance access gate needs only the Module grant (BL-082); BL-115 is no longer a dependency.
- The wording "only the HRMS Manager can reopen" in the draft Figma frames changes to match.

## Amendment: Training titles

Staff who hold Performance but not Training may see the **titles of scheduled Trainings**, in the Flag development need dialog and in the AI suggestions, and nothing else about a Training. A scheduled Training is one that is not cancelled and whose date has not passed in Manila time (the Upcoming status on the Trainings page). This lets a Performance holder recommend a real Training when they flag a development need, and lets the suggestions name one, without opening the rest of the Training Module.

We rejected asking Staff to hold Training as well, because that would give every evaluator the trainer, dates, venues, assignees and results of every session. We rejected showing no titles, because a recommendation of "a Training" with no name cannot be acted on. The titles are the narrowest thing that works.

- The lookup needs the Performance Module and not the Training Module. It returns, for each scheduled Training, the id and the title, and nothing else: no trainer, date, time, venue, assignee or result. A cancelled Training and one that has already been held are not returned.
- The objectives of the same Trainings are sent to the AI request so a suggestion can match a Training to a gap. They are never shown on a screen to a Staff member who lacks Training.
- Training completion stays figures only, as before.
- If a screen ever needs more about a Training than its title, this decision is reopened rather than stretched.
