-- Assigned employees: only Employee records are assignable, so an assignment must point at one (Staff are never Employees).
-- Employee records are never deleted, so the rows follow them. Who assigned and when is kept for the notification log.
ALTER TABLE public.hrms_training_assignments
  ADD CONSTRAINT hrms_training_assignments_employee FOREIGN KEY (employee_id) REFERENCES public.hrms_employees (id) ON DELETE CASCADE,
  ADD COLUMN assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN assigned_by text;
CREATE INDEX IF NOT EXISTS hrms_training_assignments_employee ON public.hrms_training_assignments (employee_id);
