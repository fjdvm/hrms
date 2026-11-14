# Printing and exporting a Training schedule

**Print schedule** (Training page, and the Reprint schedule button on its banner and the Notification log) opens the
**Print or export schedule** dialog: pick Trainings, turn **Include assigned names** on or off, choose a format, and
check the A4 preview. Only Trainings from today on that are not Cancelled can be picked.

## Formats (decided for #387)

The spec left "the export format for schedules" open. HRMS has no PDF or xlsx library (its other exports are CSV), so:

| Choice | What it does |
| --- | --- |
| **A4 print** | Opens the browser's print window, set to A4 by a print stylesheet; only the schedule prints. |
| **PDF** | The same print window; choose **Save as PDF** there. The page title is the suggested file name. |
| **Excel (.csv)** | Downloads a CSV (`POST /api/training-schedule`) that opens in Excel: one row per Training, names joined with `; ` when included. Cells that start with `=`, `+`, `-` or `@` are prefixed so they stay text. |

A true `.xlsx` or server-made PDF would need a new dependency; add one here if the requirements doc asks for it.

## Printed, and Reprint needed (decided for #387)

An Employee without an email is only ever reached by paper. When a schedule **with the names** is printed or exported,
every no-email Employee on the chosen Trainings is marked **printed**: `printed_at` (when) and `printed_date` (the
Training's date on that sheet), and **Reprint needed** is cleared. A later reschedule (#380) sets Reprint needed again, and
the Notification log then shows "Old date: <printed date>" beside a **Reprint schedule** flag.

- Without the names the sheet does not say who it is for, so no one is marked; the dialog says so.
- A browser cannot confirm that paper came out, so the mark is made when Staff press Print or Export. If marking fails
  the print window does not open.
- Previewing never marks anyone.

Migration `0041-training-printed.sql` adds `printed_at` and `printed_date` to `hrms_training_assignments`.
