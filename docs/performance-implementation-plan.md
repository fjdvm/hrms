# Performance module: implementation plan (draft for grilling)

**Status:** draft, 15 Nov 2026, updated after the draft Figma frames (section 13). Not approved. Nothing here has been built in code, specced or ticketed.
**Purpose:** input for a `/grill-with-docs` session. It states what is known, what was decided in discussion, what is only my assumption, and what is still open. Anything marked **[ASSUMPTION]** or **[OPEN]** should be challenged.
**Module name:** Performance (Portal and HRMS Module names match; `CONTEXT.md` lists "Training and Performance" among the Modules). Business requirement BR-04.

## 0. Frontend reference (strict)

Figma file: **Bren Raphael's CRM - Orders Prototype**, page **HRMS** (`244:2817`).

- Design link: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=244-2817&p=f&t=ybxnIXbjrCaoSf3j-0
- File link: https://www.figma.com/file/76nS6Pw2TXA6fWfUvTmzJ1?node-id=244:2817&locale=en&type=design
- Performance frames sit below the existing content on the HRMS page (screens at y = 15200, dialogs at y = 16500). The full list with node IDs is in section 13. `AGENTS.md` says to follow Figma over your own design instincts, so build each screen from its frame: same sidebar, top bar, spacing, tabs, table cards, dialogs and badges as the Training frames they were copied from.
- The frames are **drafts**: the design owner has not reviewed them, sample names are made up, and employee numbers use the Figma sample format (BR-EMP-00xx). Where no frame exists (Custom period date picker, a Performance tab on the employee profile, a Development needs list screen), ask for a frame; do not invent a layout.

## 0b. What the Performance module does (design walkthrough)

The Performance tab is where HR sets up KPIs for each position, brings in attendance records from the biometric export, and gets a weighted score for each employee per evaluation period. The HRMS Manager then reviews the results, enters a rating and submits the evaluation, and HR flags any development needs. Here's what it does in the current design.

**Performance list (the main screen)** · frames `973:5856`, states `984:7010` Loading, `984:7407` Empty, `984:7678` Error

- Every employee being evaluated in the selected period, with tabs: All, Draft, In review, Evaluated.
- A progress card at the top: "3 of 8 evaluated", and a warning line if someone is not scored because their shift is missing, with a "Set shift" link.
- For each employee: name and employee number, position and branch, shift, score, attendance import status, and evaluation status. A person with no shift shows "Not scored: shift missing".
- Header buttons: the period selector (for example "November 2026"), KPI setup, and Import attendance.
- Clicking a row opens that employee's performance page.
- Staff without the Performance Module see a No access screen (`979:7056`) and no PERFORMANCE group in the sidebar.

**Employee performance page (one per employee)** · frames `974:5979` Ready to submit, `974:6569` Submit locked, `984:7956` Evaluated

- Header: name, status badge (Draft, In review or Evaluated), employee number, position, branch and period.
- A banner that says whether Submit is unlocked or locked and why, with a button to enter the rating when it is missing.
- Evaluation period card: period, shift, scheduled days (and excused days), grace period.
- KPI results: for each KPI the source, result, weight and points, and the overall weighted score out of 100 (for example 93.0 / 100).
- Manager evaluation: the rating (0 to 100) and the Manager's comments, then the development needs flagged for this employee.
- Submit checklist: three checks, Attendance imported, Shift set, Manager rating entered. All three must be done before Submit unlocks.
- History: earlier periods with their saved scores.
- Reopening: a short note that only the HRMS Manager can reopen a submitted evaluation, with a recorded reason.
- Buttons: Print report, Flag development need, Submit evaluation (faded while locked).
- No stage tracker is drawn. The Submit checklist plays that role.

**Submit evaluation** · frame `977:6211`

- Locked until three things are true: attendance is imported for the period, the employee's shift is set, and the Manager's rating is entered. Training completion comes in automatically.
- It is one action by the HRMS Manager. When unlocked, clicking it asks for confirmation and then:
  - Locks the evaluation (it does not change when new data is imported).
  - Saves the score, KPI results and the weights used to the employee's history.
  - Records an audit event. No email is sent.

**Reopen evaluation** · frame `984:8298`

- Only the HRMS Manager can reopen, and a reason is required.
- The submitted version stays in History. The evaluation goes back to In review.
- Who reopened it, when and why are recorded in the audit log. If HR finds a problem (for example a bad import), they ask the Manager to reopen it.

**Flag development need** · frame `977:6737`

- HR or the Manager records a gap and a recommended action or Training. It is a recommendation and never changes the score.

**KPI setup** · frame `979:6675`

- The five starter KPIs with source, positions, weight, target and status (Active or Inactive): Attendance rate 30, Punctuality 25, Full shift 15, Training completion 15, Evaluator rating 15.
- A weights card shows the total (must be 100) for each position. HR can use a different weight set per position.
- A KPI used by a finished evaluation can only be deactivated, never deleted. Formulas, targets and weights need HR approval (a business step, not a screen).

**Evaluation period setup** · frames `979:7165` Month, `1002:8143` Quarter, `1002:8538` Quarter with an overlap error

- Period type: Month, Quarter or Custom. Month and Quarter fill the dates; Custom lets HR pick any start and end.
- Scheduled working days (for example 26 for a month, 78 for a quarter) and the grace period in minutes (default 10).
- A box shows which KPI weight set applies, and a callout says employees appear once their shift is set.
- A period cannot overlap another open period for the same employee. The overlap frame shows the error and a faded "Open period" button.

**Import attendance** · frame `977:7007`

- HR exports the records from the biometric device by USB (XLSX or CSV) and uploads the file. Rows are matched to employees by employee number.
- A preview shows usable rows and the rows that cannot be used (no matching employee number, duplicates, invalid time), and lists employees with no records.
- A coverage note says whether the file covers the whole period. Nothing is saved until HR confirms.
- The records are used only to compute scores, not shown as an attendance record.

**Shift on the employee record** · frame `985:8000`

- The Edit employment dialog on the employee profile gets Shift start, Shift end and Working days, next to the existing Work schedule text.
- Performance uses them for Punctuality and Full shift. An employee with no shift is not scored until HR sets one.

**Reports** · frames `985:7471` Reports, `985:7837` Print or export dialog

- A summary by branch, position or employee for the selected period: employees, how many are evaluated, average, highest and lowest score, and development needs flagged.
- Averages count only submitted, locked evaluations. Print or export offers a PDF or Excel file, with an option to include employee names.

**On the employee's side**

- Employees do not sign in to HRMS and get no emails from this module in the first release. HR and the HRMS Manager see all results.

**Not in the first release**

- POS and CRM KPIs, AI skill-gap suggestions, and microlearning.

## 1. Sources and how reliable each is

| Source | What it gave | Caveat |
|---|---|---|
| `HRMS_Training_and_Performance_Requirements.docx` (Drive), section 3 | BR-PM-01..06, FR-PM-01..11, data sources, starter weights, worked example, workflow | Source of truth for behavior |
| `Business_Requirement_HRMS_v2` v2.2, sheet "Performance" (BR-04) | KPI Setup is row 1, status **Planned**; "Formulas need HR approval" | I could only read the first row. The other screens in that sheet were not visible to me. **Read the full sheet.** |
| Same file, sheet "KPI References" | Attendance rate formula: days with time-in and time-out ÷ (scheduled days − excused days) × 100 | Other rows only partly visible |
| `HRMS Product Backlog v3` and `HRMS Sprint Plan` | Sprint 8 "Deliver the Performance Module", status **To plan**, BL-071..BL-079 plus BL-082 (Portal grant); Risks sheet cites BL-071..BL-080 | Item titles, sizes and priorities not read |
| Production Neon (`brenraphaels-ats`, branch `production`, read-only) | Real `schedule` values, employee columns | Snapshot of 15 Nov 2026 |
| `fjdvm/hrms` `main` at `36bd94a` | Placeholder page, existing patterns | |
| Branch `docs/training-and-development-brief` | How Training was planned (section 11) | |
| Figma file `76nS6Pw2TXA6fWfUvTmzJ1`, page HRMS | Frame list, Training patterns | Performance frames did not exist at first. Draft frames were added later (section 13) and are not reviewed by the design owner. |

## 2. Scope

**In (first release), per the requirements:**
- Position-based KPI setup, activate or deactivate (FR-PM-01).
- Assign KPI sets to employees by position for a defined evaluation period (FR-PM-02).
- Configurable KPI weights (FR-PM-03).
- Import attendance from the client's biometric export, XLSX or CSV, matched by employee number, with preview and confirm (FR-PM-04).
- Validate imported rows and exclude unusable ones from scoring (FR-PM-05).
- Calculate KPI results and the weighted overall score (FR-PM-06).
- Performance dashboard and period summaries (FR-PM-07).
- Manager evaluation, locked on submit, reopened only with a recorded reason (FR-PM-08).
- Reports for an employee, department or period (FR-PM-09).
- Performance history (FR-PM-10).
- Development needs: flag gaps and record recommended actions or training (FR-PM-11).

**Scoring sources (exactly three):** attendance import (Attendance rate, Punctuality, Full shift), Training completion (from the Training module), Evaluator rating (HRMS Manager, 0 to 100).

**Out:**
- No attendance monitoring, shift scheduling, leave filing or payroll. The Attendance module was dropped (Sprint Plan, "Dropped and Moved").
- No use of salary, overtime, deductions or payroll data in scoring.
- POS and CRM KPIs (Future Integration).
- AI skill-gap and training recommendations, and microlearning (optional, later).
- Employee sign-in: employees never sign in to HRMS, so there is no employee-facing screen and no emails from this module in the first release.

**Terminology rule carried from Training:** the UI says "Attendance import" and must never imply an attendance record, attendance screen or shift management. The requirements say imported records are not shown as an attendance record.

## 2b. Starter KPIs, formulas and the worked example

Weights are team proposals that HR must approve. HR may use a different weight set per position. Default grace period: 10 minutes.

| KPI | Weight | Source | Result formula |
|---|---|---|---|
| Attendance rate | 30 | Attendance import | days with time-in and time-out ÷ (scheduled days − excused days) × 100 |
| Punctuality | 25 | Attendance import | (present days − late days) ÷ present days × 100, late = time-in later than shift start + grace |
| Full shift | 15 | Attendance import | (present days − early-out days) ÷ present days × 100, early-out = time-out earlier than shift end **[ASSUMPTION on exact rule]** |
| Training completion | 15 | Training | Trainings marked Completed ÷ Trainings assigned in the period × 100 |
| Evaluator rating | 15 | HRMS Manager | the 0 to 100 score entered |

Worked example from the requirements (illustrative only): 96.2 (25 of 26 days) × .30 + 88 (3 late of 25) × .25 + 96 (1 early-out of 25) × .15 + 100 (2 of 2 trainings) × .15 + 85 × .15 = **93.0 / 100**. Use it as the first unit test for the scoring engine.

## 3. Decisions made in discussion (treat as settled unless the grill breaks them)

1. **Strict submit gate.** The HRMS Manager can submit an evaluation only when: attendance is imported for the period, the employee's shift is set, and the Manager's rating is entered. Training completion arrives automatically.
2. **One submit action**, performed by the Manager. It locks the evaluation, saves KPI results and score to history, and records an audit event. There is no separate "mark as evaluated" button.
3. **Reopen is Manager only**, with a required reason. The previously submitted version is kept in History. Who, when and why go to the audit log. HR asks the Manager if a correction is needed. A locked evaluation does not change when new data is imported.
4. **Access rule is based on the Performance Module grant plus a Manager flag, not on role names** (the Portal renamed Super Admin to Admin and HRMS still checks old names; backlog BL-115).
5. **Structured shift on the employee record (option A):** add nullable shift start, shift end and working days to the employee record. Keep the existing `schedule` text as display text. An employee with no shift shows "Not scored: shift missing".
6. **Mock attendance for testing:** build a test file in the real export's layout and keep it as a repo test fixture. Do not load mock attendance into production.
7. **Layout:** Performance follows Training's sizes, fonts and components (the shared `components/ui` primitives). Performance layout may differ where scoring needs it. Do not import from `components/training/*`.
8. **No spec or tickets yet.** Planning follows the Training precedent first (section 11).
9. **Period type: Month, Quarter or Custom.** An evaluation period is a date range. Month and Quarter are presets that fill the dates; Custom lets HR choose any start and end. Monthly is the default shown. Scores are percentages, so periods of different lengths stay readable, but reports compare periods of the same length only.
10. **No overlapping periods for the same employee** **[ASSUMPTION: HR to confirm]**. A monthly and a quarterly period covering the same days would count the same attendance twice, so the system refuses to open an overlapping period.
11. **Sidebar:** the Figma sidebar component now has a PERFORMANCE group with a Performance item. Group header spacing was NOT changed. In the real app, `components/layout/sidebar-nav.ts` does not list Performance yet (its comment says "Performance has a Module but no HRMS pages to list yet"), so building Performance adds one PERFORMANCE section there. No other module changes.

## 4. Rules proposed but not yet approved (HR sign-off needed) **[OPEN]**

| Topic | Proposed rule |
|---|---|
| No trainings assigned in the period (0 of 0) | Training completion is "Not applicable", excluded, other weights rescaled proportionally. The effective weights are saved with the evaluation. Applies identically to everyone in the same position. |
| Too little weight left | Below a floor (placeholder **60%**) the result is "Insufficient data" and HR reviews it. |
| Employee has no attendance rows at all | Unresolved blocks submit. HR re-imports, enters excused days, or confirms "no attendance this period" with a reason (counts as full absence). |
| Scheduled day missing for an employee who has other rows | Counts as absence. |
| Time-in with no time-out | Flagged for HR to resolve. Not counted automatically. |
| Import file does not cover the whole period | Warn or block before confirming. |
| "N/A" versus the strict gate | N/A is a computed outcome, not a missing input, so it does not block submit. |
| Overlapping periods | A period that overlaps another open period for the same employee cannot be opened (shown as an error on the Period field). |
| Scheduled working days | Entered per period by HR. The Figma sample uses 26 for a month and 78 for a quarter (26 × 3), which is only arithmetic, not a rule. |

## 5. Production facts (read-only, 15 Nov 2026)

- Tables carry an `hrms_` prefix in production (`hrms_employees`, `hrms_offers`, `hrms_employee_history`, `hrms_employee_documents`, and others). The database is shared with Careers.
- `hrms_employees` has 9 rows. `schedule` is `text NOT NULL`. Values: `Mon-Sat, 6 AM-2 PM` ×7, `Mon-Fri` ×2.
- `hrms_offers.schedule`: `Mon-Sat, 6 AM-2 PM` ×7, `Mon-Fri 8AM-5PM` ×2, `Mon-Fri` ×2. Employees have no `8AM-5PM` value; unresolved (not hired, or edited after hire). **[OPEN: verify]**
- `job_postings.work_schedule`: null ×9, `Mon-Fri, 9AM to 6PM` ×2, `Mon-Fri` ×1.
- Free text uses four different formats, so parsing it in code is rejected.
- `hrms_employees.offer_id` and `application_id` are `NOT NULL`, `status` is Onboarding or Active only. Relevant to cutover (section 9).
- Employee number and email exist on the record (needed for biometric matching and notices).

## 6. Proposed data model (all new tables unless stated) **[ASSUMPTION: names and shapes for the grill]**

Migrations continue the numbering after `0041-training-printed.sql`. New tables only, plus additive columns on `hrms_employees`.

- `hrms_employees` (existing): add `shift_start time`, `shift_end time`, `working_days` (e.g. smallint[] or bitmask), all nullable.
- `performance_kpis`: name, description, source (attendance, training, evaluator), method, target, status (active or inactive). Not deletable once used.
- `performance_kpi_sets` / position links: which KPIs and weights apply to which position.
- `performance_periods`: type (month, quarter, custom), start, end, grace minutes, status. No overlapping open periods per employee.
- `performance_period_days`: scheduled working days and excused days per employee per period.
- `performance_attendance_imports`: who, when, file name, row counts (usable and rejected), period; keep the source.
- `performance_attendance_rows`: employee, date, time-in, time-out, import reference, validity reason.
- `performance_evaluations`: employee, period, status (Draft, In review, Evaluated), rating, comments, submitted by and at, locked flag.
- `performance_evaluation_results`: per KPI: result, weight used, source, period. Snapshot of effective weights.
- `performance_evaluation_versions` / reopen log: previous submitted version, reopen reason, who, when.
- `performance_development_needs`: employee, gap, recommended action or Training, flagged by, flagged at.

Rules: forward-only migrations, additive where possible; revert is a down migration that drops new tables only while empty. Locked evaluations and audit records are history, not deletable.

## 7. Screens (draft frames exist, see sections 0b and 13)

Follow Training's patterns: tabs, table cards, dialogs, skeleton, empty, populated and error states, No access screen.

1. **Performance list**: period selector; tabs All, Draft, In review, Evaluated; columns as drawn: employee, position, shift, score, attendance import, status.
2. **Employee performance page**: header with shift and period; banner and Submit checklist (no stage tracker is drawn); KPI results table with result, weight, source and points; Manager evaluation panel; Development needs; History.
3. **KPI Setup**: list and create/edit dialog; weights must total 100.
4. **Evaluation period setup**: dates, working days, excused days, grace, KPI assignment by position.
5. **Import attendance dialog**: upload, preview, rejected rows, coverage check, confirm.
6. **Submit evaluation** and **Reopen evaluation** dialogs.
7. **Flag development need** dialog.
8. **Reports** and **Print or export** dialog.
9. **Employee profile tab** showing Performance history, gated like Training history (`staffWithModule`) **[ASSUMPTION]**.
10. **Employee form**: shift start, end and working days.

## 8. Implementation ordering (outline only, not tickets)

| # | Slice | Depends on |
|---|---|---|
| T0 | Performance access gate (Portal grant BL-082, Manager flag, BL-115) | none |
| T1 | Shift fields on employee record, form, validation, reviewed backfill of the 7 uniform rows | none |
| T2 | KPI Setup | T0 |
| T3 | Evaluation periods and assignment | T2 |
| T4 | Attendance import | T1, T3, real sample export |
| T5 | Scoring engine (pure code, unit tests, the 93.0 example) | T2, T3, T4, Training completion read |
| T6 | Performance list and employee page, read-only | T5, Figma frames |
| T7 | Manager evaluation: rating, comments, strict gate, submit, lock, audit | T6 |
| T8 | Reopen evaluation | T7 |
| T9 | History and development needs | T7 |
| T10 | Reports, print and export | T7 |

Suggested MVP cut: T0 to T8. Human tasks: draw Performance Figma frames; HR approves formulas, weights, grace, N/A rule and floor; get one real biometric export sample.

## 9. Cross-cutting concerns

- **Dependencies on other modules:** Training completion (built, read-only), Employee Information (employee number, email, shift), Offers hire hand-off (writes the employee record's `schedule` today; later could carry structured shift), audit-logs service (HRMS sends audit events), Portal (Module grants).
- **Repo conventions seen:** `requireModule("Performance")` and a `ModulePlaceholder` page already exist; `lib/modules.ts` already lists the Performance Module, but `components/layout/sidebar-nav.ts` does not list it in the sidebar yet (to be added). Training layout to mirror: `app/(hrms)/training/*`, `components/training/*`, `lib/trainings.ts`, `lib/portal/trainings`, tests under `tests/training-*.test.ts(x)`. No-polling rule applies (`AGENTS.md`).
- **Production data cutover (separate piece of work, not planned yet):** the client's real employees cannot be inserted today (employees only come from the hire hand-off and require `offer_id`/`application_id`). Recommended: a clean production environment instead of deleting mock rows, plus an import tool for employees and historical records marked "Imported". Performance needs imported history to allow a score without a KPI breakdown. Not in the backlog as far as I saw.
- **Testing approach:** pure unit tests for scoring and import validation; a test fixture file in the real export layout with deliberate bad rows (unmatched employee number, duplicate, invalid date or time, time-in with no time-out, employee with no rows, short period coverage, the two employees with no shift times); hand-computed expected scores.
- **Risks:** shared production database and migrations (no `hrms` rule found for applying production migrations before merge, check); formulas not yet approved; real export format unknown; Figma frames are drafts not yet reviewed by the design owner while `AGENTS.md` says Figma is the UI reference; role-name drift between Portal and HRMS.

## 10. Open questions for the grill **[OPEN]**

1. Who is the design owner for Performance, and when will they review the draft frames in section 13? (The Training brief said another person designs Performance.)
2. Exact access model: Module grant plus Manager flag. Can HR Staff without the Manager flag see scores? The requirements say the Manager "can see all employees"; HR configures KPIs and reports.
3. Evaluation period: monthly is the default and quarterly and custom ranges are allowed (decision 9). Still open: what HR does today, whether probation reviews use a different cadence, who opens a period, and the Custom date-picker design (not drawn).
4. Which employees are evaluated: Active only? Onboarding or probation employees? Mid-period joiners or leavers?
5. Source of excused days (HR-entered per period; leave is not in HRMS).
6. Rounding rules, and whether the Manager sees scores before entering the rating.
7. The N/A rule, the 60% floor, Full shift's exact rule, and the handling of time-in with no time-out: HR approval.
8. Real biometric export format (need one sample).
9. Production migration process for `hrms` (apply before merge?).
10. Should the Manager be notified (header bell) when a period is ready for review? Not in the requirements.
11. Which Neon branch is used for development and staging data?
12. The two `Mon-Fri` employees and the `8AM-5PM` offer discrepancy: verify and backfill.
13. Whether the unread BR-04 rows in the Business Requirements sheet or backlog items BL-071..BL-080 add requirements not in the docx.
14. Glossary: "KPI" is on the `Avoid` list for the Dashboard's Key Summary Card (`CONTEXT.md` line 92). Define KPI for Performance and scope that avoid rule.
15. Cutover: scope and owner of the historical data import, and how past evaluations are stored.

## 11. Precedent: how Training was planned (branch `docs/training-and-development-brief`)

1. Glossary first in `CONTEXT.md`: new terms with `_Avoid_` lists, the Module entry, updated related entries.
2. A Figma brief for the design owner: scope, source docs, strict layout reference to the existing frames, **13 settled decisions ("do not re-open")**, a frame table mapped to FR IDs, a reuse list with node IDs, measured tokens, copy style and sample data, and a hand-off ("send back frame names with node IDs mapped to FR IDs").
3. Frames drawn, then implemented from the frames, `CONTEXT.md` and the requirements doc.

Mirror for Performance: Performance terms in `CONTEXT.md` → a Performance Figma brief containing the settled decisions in section 3 → frames → spec and tickets → build.

## 12. Glossary candidates for `CONTEXT.md` **[ASSUMPTION: for the grill]**

KPI (Performance scope), Evaluation period (with period type), Attendance import, Performance score, Evaluator rating, Evaluation (Draft, In review, Evaluated), Development need, Shift. Each needs an `_Avoid_` list and care that "Attendance" does not suggest a record or module.

## 13. Draft Figma frames (HRMS page of file `76nS6Pw2TXA6fWfUvTmzJ1`)

Built from copies of Training frames so sizes, fonts and components match. These are drafts: the design owner has not reviewed them. Sample names are made up; employee numbers use the Figma sample format (BR-EMP-00xx). Frames sit below existing content: row 1 at y = 15200 (screens), row 2 at y = 16500 (dialogs).

| Frame | Node ID |
|---|---|
| Performance · List | `973:5856` |
| Employee evaluation · Ready to submit | `974:5979` |
| Employee evaluation · Submit locked | `974:6569` |
| Employee evaluation · Evaluated | `984:7956` |
| KPI Setup | `979:6675` |
| No access | `979:7056` |
| List · Loading / Empty / Error | `984:7010` / `984:7407` / `984:7678` |
| Reports | `985:7471` |
| Dialog · Submit evaluation | `977:6211` |
| Dialog · Reopen evaluation | `984:8298` |
| Dialog · Flag development need | `977:6737` |
| Dialog · Import attendance | `977:7007` |
| Dialog · Set up evaluation period · Month / Quarter / Quarter · Overlap | `979:7165` / `1002:8143` / `1002:8538` |
| Dialog · Print or export report | `985:7837` |
| Dialog · Edit employment · Shift (shift start, end, working days) | `985:8000` |

Shared sidebar `Sidebar · HRMS` (`244:2818`) now includes the PERFORMANCE group. Existing 900px-high frames show the Performance item partly under the footer, which reads as a scrolling menu.

**Not drawn:** Custom period date picker, a Performance tab on the employee profile, a Development needs list screen. **Not screenshot-checked:** Loading state, Submit evaluation dialog, No access, Print or export dialog. **Decided:** the "Pending HR approval" strip was removed from KPI Setup, because it implied an approval status the requirements do not define. HR approval of formulas, weights, targets, the N/A rule and the 60% floor stays a business step tracked in section 4. **[OPEN]:** the "Super Admin" label in the sidebar footer may change with the Portal role rename (BL-115).
