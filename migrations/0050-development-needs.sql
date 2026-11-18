-- Performance: development needs. Forward-only and additive.
--
-- A development need is a gap that Staff flag for one Employee in one Evaluation period, with the action or Training they recommend.
-- It belongs to the Employee and the period, not to a submitted version of the Evaluation, so Submit and Reopen never change it and a
-- Reopen neither copies nor removes it. It can be flagged while the Evaluation is In review or Evaluated. A flag never changes the score,
-- the rating or the status, and sends no email. Editing or removing a need is not built, so nothing here is updated or deleted.
--
-- `source` is 'manual' for a need Staff typed, or 'ai' for one they flagged from a suggested development area; `suggestion_id` links it to
-- that suggestion. The suggestions table arrives with the AI suggestions ticket, which adds the foreign key then.
CREATE TABLE public.hrms_development_needs (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  period_id integer NOT NULL REFERENCES public.hrms_evaluation_periods (id),
  -- What the gap is. Job-related gaps only; required.
  gap text NOT NULL CHECK (length(btrim(gap)) > 0),
  -- The action or Training Staff recommend, in words; required.
  action text NOT NULL CHECK (length(btrim(action)) > 0),
  -- The scheduled Training recommended, when one was picked. The words above are what Staff read.
  training_id integer REFERENCES public.hrms_trainings (id),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai')),
  suggestion_id integer,
  CONSTRAINT hrms_development_need_suggestion_is_ai CHECK (suggestion_id IS NULL OR source = 'ai'),
  flagged_by_id text NOT NULL,
  flagged_by_name text NOT NULL,
  flagged_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hrms_development_needs_employee_period ON public.hrms_development_needs (employee_id, period_id, flagged_at DESC, id DESC);
