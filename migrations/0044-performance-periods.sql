-- Performance: Evaluation periods, the company calendar of non-working dates, and excused days. Forward-only and
-- additive. Nothing here is deleted by the application.

-- An Evaluation period is a company-wide date range of type Month, Quarter or Custom, with a grace period in whole
-- minutes. There is no open or closed state. `kind` and the nullable `employee_id` exist so that a later per-Employee
-- period needs no migration: every period today is 'Company' with no Employee. No two company-wide periods overlap by
-- date, enforced here so a request that bypasses the form cannot score a day twice.
CREATE TABLE public.hrms_evaluation_periods (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  type text NOT NULL CHECK (type IN ('Month', 'Quarter', 'Custom')),
  kind text NOT NULL DEFAULT 'Company' CHECK (kind IN ('Company', 'Employee')),
  employee_id integer REFERENCES public.hrms_employees (id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  grace_minutes integer NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_period_dates CHECK (end_date >= start_date),
  CONSTRAINT hrms_period_kind CHECK ((kind = 'Company' AND employee_id IS NULL) OR (kind = 'Employee' AND employee_id IS NOT NULL)),
  CONSTRAINT hrms_period_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&) WHERE (kind = 'Company')
);

-- The company calendar: one list of non-working dates for the whole company (holidays and closures), applied to every
-- period a date falls in. The same date cannot be added twice.
CREATE TABLE public.hrms_company_calendar (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  date date NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  type text NOT NULL CHECK (type IN ('Holiday', 'Closure', 'Other')),
  notes text,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Days HR excuses for one Employee in one period (approved leave is not in HRMS), with who recorded them.
CREATE TABLE public.hrms_excused_days (
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  period_id integer NOT NULL REFERENCES public.hrms_evaluation_periods (id),
  date date NOT NULL,
  recorded_by_id text NOT NULL,
  recorded_by_name text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (employee_id, period_id, date)
);
