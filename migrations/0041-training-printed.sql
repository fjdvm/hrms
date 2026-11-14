-- Printing a schedule for Employees without an email. Printing or exporting a schedule with the assigned names marks each
-- no-email Employee on the chosen Trainings as printed: printed_at is when, printed_date is the Training's date on the sheet
-- (so "Old date" can be shown after a reschedule), and reprint_needed (0038) is cleared. A browser cannot confirm that
-- paper came out, so the mark is made when Staff press Print or Export.
ALTER TABLE public.hrms_training_assignments
  ADD COLUMN printed_at timestamptz,
  ADD COLUMN printed_date date,
  ADD CONSTRAINT hrms_training_assignments_printed_pair CHECK ((printed_at IS NULL) = (printed_date IS NULL));
