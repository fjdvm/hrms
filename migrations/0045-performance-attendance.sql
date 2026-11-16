-- Performance: attendance records brought in only to compute scores, and the ways HR resolves the days that cannot be
-- scored. Forward-only and additive. These rows are never shown as an attendance record and are never edited.

-- One import: who, when, the file name, how many rows were usable and how many were rejected, and a reference to where the
-- source file is kept. Rejected rows are counted here and never reach the rows table.
CREATE TABLE public.hrms_performance_imports (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  file_name text NOT NULL CHECK (length(btrim(file_name)) > 0),
  source_ref text,
  total_rows integer NOT NULL CHECK (total_rows >= 0),
  usable_rows integer NOT NULL CHECK (usable_rows >= 0),
  rejected_rows integer NOT NULL CHECK (rejected_rows >= 0),
  imported_by_id text NOT NULL,
  imported_by_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_performance_import_counts CHECK (total_rows = usable_rows + rejected_rows)
);

-- The normalised rows, keyed by Employee and date (not by import or period) so one date is never counted twice. A later
-- import of the same Employee and date replaces the earlier row, and a range can be covered by several imports. Overnight
-- punches are not supported: a time-out is after its time-in.
CREATE TABLE public.hrms_performance_attendance (
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  date date NOT NULL,
  time_in time NOT NULL,
  time_out time,
  import_id integer NOT NULL REFERENCES public.hrms_performance_imports (id),
  PRIMARY KEY (employee_id, date),
  CONSTRAINT hrms_performance_attendance_times CHECK (time_out IS NULL OR time_out > time_in)
);
CREATE INDEX hrms_performance_attendance_date ON public.hrms_performance_attendance (date);

-- A day with a time-in and no time-out, resolved by marking it Absent with a reason. (Excused days go to
-- hrms_excused_days, which gains an optional reason below.) The imported record itself is never edited.
CREATE TABLE public.hrms_absent_days (
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  period_id integer NOT NULL REFERENCES public.hrms_evaluation_periods (id),
  date date NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  marked_by_id text NOT NULL,
  marked_by_name text NOT NULL,
  marked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (employee_id, period_id, date)
);

-- An Employee with no rows at all, resolved by confirming there was no attendance for the period, with a reason. It counts
-- as full absence.
CREATE TABLE public.hrms_attendance_confirmations (
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  period_id integer NOT NULL REFERENCES public.hrms_evaluation_periods (id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  confirmed_by_id text NOT NULL,
  confirmed_by_name text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (employee_id, period_id)
);

-- Excusing a day while resolving an issue takes an optional reason.
ALTER TABLE public.hrms_excused_days ADD COLUMN reason text;
