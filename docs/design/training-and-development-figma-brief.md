# Training and Development: Figma brief

For the developer who owns the main Figma file. Design only the Training and Development Module as NEW frames. Do not edit or restyle existing frames. Another person designs Performance Management; do not build Performance screens.

- Figma file: `76nS6Pw2TXA6fWfUvTmzJ1`, page **HRMS** (`244:2817`)
- Source requirements: Drive doc `HRMS_Training_and_Performance_Requirements.docx`, sections 1 and 2 (FR-TD-01..12)
- Vocabulary: `CONTEXT.md` at the repo root. Use its terms exactly (Training, Assigned employee, Training notice, Training completion, Employee, Staff).
- Placement: below the existing frames, starting at y = 8800 (existing content ends at y = 8600). Use the existing 1540 px column spacing and about 1300 px row spacing. Frames are 1440 wide and 900 tall (grow taller when needed).

## Strict layout reference

The HRMS layout in the Figma file is the **strict reference** for every Training screen. Start from the Dashboard frame: https://www.figma.com/design/76nS6Pw2TXA6fWfUvTmzJ1/Bren-Raphael-s-CRM---Orders-Prototype?node-id=273-4646&t=y2cElvqawkIfoFEg-0

Match it exactly: same sidebar, top bar, spacing, header, tabs, table cards, dialogs and cards. Do not change sizes, colours or structure, and do not invent a new pattern when an existing frame already shows one. If a Training screen needs something no existing frame shows, copy the closest frame and keep its style.

## Decisions already made (do not re-open)

1. The Module is **Training and Development**. The sidebar group label is **TRAINING**. The Portal grants or revokes the whole Module; there are no finer permissions and no read-only role.
2. **Employees never sign in.** They are people with an Employee record. Staff (HR users) are never assigned to a Training. No screen may imply an Employee can open HRMS.
3. A **Training** is one dated session: one date, one time, one venue or meeting link. A multi-day or repeating course is separate Trainings. The UI says "Training" and "Trainings". Do not use "Program".
4. **Training status** is derived, not picked: Upcoming (not yet happened, not cancelled), Completed (date has passed, not cancelled), Cancelled (Staff cancelled it, with a reason). There is **no "Rescheduled" status**. A rescheduled Training stays Upcoming and shows a muted caption "Rescheduled from 29 Oct 2026" under its date, plus a "Schedule changed" entry in its notification log.
5. **Assigned employee status** is what Staff edit after the session, from the paper sign-in sheet: Assigned, Completed (with a completion date), Did not attend, Cancelled (set automatically when the Training is cancelled).
6. Once any Employee has a recorded result, the Training's date is locked. Staff create a new Training instead.
7. The results screen is named **"Training · Mark results"**. Do not use the word "attendance"; HRMS already has an Attendance Module and this module adds no attendance monitoring, shift scheduling, leave or payroll.
8. **Training notices** (emails): Assignment (sent on assign); Schedule changed and Cancelled (the "Notify assigned employees" toggle is ON by default, and Staff can turn it off with a warning); Reminder (automatic 1 day before at 8:00 AM Manila time, plus a manual "Send reminder"). States: Sent, Failed, Retrying. A failed email is retried 3 times, about 15 minutes apart, then the Employee moves to a **Not reached** list with a **Retry** button. An Employee with no email is never emailed and is never "Failed": show a "Needs printed schedule" flag, and "Reprint schedule" after a change.
9. **Training completion** is a summary card at the top of the Trainings list (not on the Dashboard). It is the Assigned employees marked Completed as a whole percent of results due for Trainings held this month (Manila time), with "X of Y completed" beneath. Cancelled Employees are not counted. Empty state: "Nothing to show yet", never 0%.
10. **Upcoming Events** (the existing Dashboard Widget) also lists Upcoming Trainings for Staff holding this Module: title, date and time, a small "Training" tag, linked to the Training. Cancelled Trainings are left out. Do not add new Dashboard Widgets.
11. Employees paper forms: HR types feedback (rating and comments) from the paper form; HR marks results from the sign-in sheet.
12. Destructive actions need a confirm dialog: cancel a Training, remove an Employee from a Training, delete an uploaded material.
13. Every screen needs loading skeleton, empty, populated and error states. Make them separate frames only for the Trainings list; elsewhere use variants or overlays on the same frame.

## Sidebar

Edit the `Sidebar · HRMS` component (`244:2818`) once. Re-read it first: another session may be adding a PERFORMANCE group. Add only a new group **TRAINING** at the end of Nav with three items in the existing item style: **Trainings**, **Calendar**, **Training history**. Existing icons are 18 px outline (stroke #52525b, 1.5), so use 18 px to match. Provide an active state for each item the same way existing frames do it: item fill #EFEFF1 and label Semi Bold. Do not touch other items.

## Frames to build

Name frames "Area · Screen · State". Prefix layers btn/, tab/, th/, row, cell, Badge.

| # | Frame name | Contents | FR |
|---|---|---|---|
| 1 | Training · List | Title "Trainings", subtitle, primary button "New training". Training completion summary card above the tabs. Tabs All / Upcoming / Past / Cancelled with counts. Table: Training (title link + trainer, caption "Materials attached"), Date and time (caption "Rescheduled from ..." when relevant), Mode (Online / In person), Assigned, Completed ("0 of 12"), Status badge. Note strip: "Assigned employees are notified by email. For employees without an email, print the schedule from the training page." | 01, 02 |
| 1a-c | Training · List · Loading / Empty / Error | Skeleton rows; empty card with "New training" button; error strip with "Try again" | 01 |
| 2 | Form · New training · No materials yet | Title, description, objectives, date, time, mode radio cards (Online / In person) with a meeting link or venue field, materials upload | 01, 07 |
| 2b | Form · New training · Filled | Same, filled in, with uploaded material rows (remove action) | 01, 07 |
| 3 | Training · Detail | Summary, schedule, Assigned employees with status, materials, notification log preview. Prompts: "Results not recorded" after the date passes; "Reprint schedule" flag. Actions: Edit, Cancel training, Assign employees, Send reminder, Print schedule, Mark results | 08, 09 |
| 4 | Dialog · Assign employees | Pick Employees or a whole department. Flag Employees with no email as "Needs printed schedule" | 03 |
| 5a | Dialog · Send reminder | Recipients count, email preview, excluded no-email Employees noted | 05 |
| 5b | Training · Notification log | Rows per Employee: notice kind (Assignment / Schedule changed / Cancelled / Reminder), time, Sent / Failed / Retrying. A "Not reached" list with a Retry action. A separate "Needs printed schedule" list | 04, 05 |
| 6a | Dialog · Edit training | Editable fields; when date, time or venue changes show old and new side by side; "Notify assigned employees" toggle (on) with email preview box (same pattern as the Schedule interview dialog). Locked date state when results exist | 02, 04 |
| 6b | Dialog · Cancel training | Required reason field, "Notify assigned employees" toggle with preview, destructive primary button | 02, 04 |
| 7 | Training · Calendar | Copy the "Interviews · Calendar" (`621:15608`) pattern. Events are Trainings; legend Online / In person; click shows a popover | 06 |
| 8 | Training · Mark results | Bulk mark from the sign-in sheet; per Employee status (Assigned / Completed / Did not attend / Cancelled) and completion date. Counter "0 of 12" | 08, 09 |
| 9 | Dialog · Record feedback | Rating and comments typed from the paper form; note "Typed from the paper feedback form" | 10 |
| 10 | Employee · Training history | For one Employee (existing profile pattern, e.g. `710:16141`): assigned and completed Trainings with status and completion date | 11 |
| 11 | Dialog · Print or export schedule | Choose Trainings, toggle "Include assigned names", Print / Export, plus an A4 print preview | 12 |
| 12 | Training · Later | Two small placeholders labelled "Later": microlearning materials card; AI training recommendation card (recommendation only; HR must review before assigning) | optional |
| 13 | Dashboard · Upcoming events with trainings | Duplicate Dashboard `273:4645`. Upcoming Events lists Trainings with a "Training" tag. Add an empty variant ("Nothing to show yet") | - |
| 14 | Training · No access | Normal shell with no TRAINING group in the sidebar. Message: "You don't have access to Training and Development. Ask an administrator to grant it in the Portal." Button back to Dashboard | - |
| 15 | Dialog · Remove employee / Dialog · Delete material | Small confirm dialogs | 03, 07 |

## Reuse, do not redraw

Sidebar `244:2818`, Top bar `244:2964`, Badge components (`6:178` green, `6:174` neutral, `6:182` amber, `244:2815` red), and the patterns in: Job postings · List `246:2795`, Applicants · List `248:3028`, Interviews · Calendar `621:15608`, Dialog · Schedule interview · Online `265:3563`, Offer · Waiting for reply `266:3827`, Dashboard `273:4645`, Digital 201 · Folders `270:4281`. The file has no Figma variables; do not invent a variable system. Follow the Figma file over any instinct (see AGENTS.md).

## Measured tokens

Font Inter. Primary purple #5B2A86 (primary buttons, links, active tab text); toggles and radios #6D28D9. Active tab and selected pill #EFE6F8. Text #1F1A2E; muted #6E6680; sidebar labels #A1A1AA. Sidebar #FAFAFA, active item #EFEFF1. Card border #E6E1EE (radius 12); table row divider #EFEBF4; note strip #F7F5FA with muted 12 px text.

Badges (pill, 21 px, 3/10 padding): green #E3F4E8 on #1E6B3A; neutral #EEECF2 on #5A5368; amber #FDF1D8 on #8A5A00; red #FBE6E0 on #9A3412. Use green for Upcoming/Completed/Sent, neutral for Cancelled or "Assigned", amber for Retrying or "Needs printed schedule", red for Failed or "Did not attend".

Layout: sidebar 256, content 1184, top bar 64, main padding 28/32, gap 20. Title 24 px Semi Bold; subtitle 14 px muted. Buttons 35 px tall, 14 px side padding, radius 8 (secondary: white, 1 px #E6E1EE or #E4E4E7 border). Tabs 33 px tall, 4 px gap, 14 px padding. Table card padding 20, header row 28 px, rows 57 px. Dialog: 580 wide, radius 16, header padding 20/18/16/24, body padding 20/24 with gap 16, footer #FAFAFA with a muted note on the left and Cancel plus primary on the right, scrim #120D1A at 45%.

Copy: sentence case, dates "29 Oct 2026", times "3:00 – 3:30 PM", counts "0 of 12", empty "—". Philippine sample data: Production Staff, Branch Cashier, Quality Control Inspector, Main kitchen Antipolo, Cainta and Taytay branches; names such as Mylene Santos and Carla Mendoza; trainers such as HR, QA Manager, Safety Officer.

## When done

Send back a list of frame names with node IDs mapped to FR IDs. The implementation then follows these frames, `CONTEXT.md`, and the requirements doc.
