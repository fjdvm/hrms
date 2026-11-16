-- Performance: the saved Evaluation of one Employee in one period. Forward-only and additive. The roster and the status
-- read this table; saving a rating, submitting and reopening write to it in later tickets, which add what they need (the
-- submitted version, the weights and formulas used, the reopen history) in migrations of their own.
--
-- There is a row only once a rating is saved: an Employee with no row is a Draft, taken from the live roster. A saved
-- row is "In review" until it is submitted ("Evaluated"), and goes back to "In review" on a reopen. An Employee with a
-- row stays in the period's roster whatever later happens to their record, so a submitted evaluation never disappears.
CREATE TABLE public.hrms_evaluations (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  period_id integer NOT NULL REFERENCES public.hrms_evaluation_periods (id),
  rating integer NOT NULL CHECK (rating BETWEEN 0 AND 100),
  comments text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'In review' CHECK (status IN ('In review', 'Evaluated')),
  rated_by_id text NOT NULL,
  rated_by_name text NOT NULL,
  rated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_evaluation_one_per_period UNIQUE (employee_id, period_id)
);
CREATE INDEX hrms_evaluations_period ON public.hrms_evaluations (period_id);
