-- Feedback typed by Staff from the paper feedback form: one rating (1 to 5) and optional comments per Assigned employee.
-- Only an employee marked Completed has feedback; leaving Completed clears it (done in the application).
ALTER TABLE public.hrms_training_assignments
  ADD COLUMN feedback_rating smallint CHECK (feedback_rating BETWEEN 1 AND 5),
  ADD COLUMN feedback_comments text NOT NULL DEFAULT '',
  ADD COLUMN feedback_recorded_at timestamptz,
  ADD COLUMN feedback_recorded_by text;
