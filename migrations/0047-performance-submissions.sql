-- Performance: the submitted version of an Evaluation. Forward-only and additive. Submitting locks the evaluation and saves
-- everything that produced its score (the KPI results, the weighted score, the weights actually used, the formulas used, the
-- weight set's name and the rating), so nothing that changes afterwards (new attendance, a weight, a formula, the company
-- calendar, Training results) can alter it. A later reopen adds a new version; an earlier one is kept.
--
-- A submitted version is never changed or deleted: the triggers below refuse it, so even a direct write cannot.
CREATE TABLE public.hrms_evaluation_submissions (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  evaluation_id integer NOT NULL REFERENCES public.hrms_evaluations (id),
  version integer NOT NULL CHECK (version >= 1),
  -- 'scored' has a score out of 100, to one decimal; 'insufficient-data' has none.
  outcome text NOT NULL CHECK (outcome IN ('scored', 'insufficient-data')),
  score numeric(4, 1) CHECK (score BETWEEN 0 AND 100),
  rating integer NOT NULL CHECK (rating BETWEEN 0 AND 100),
  comments text NOT NULL,
  weight_set_id integer REFERENCES public.hrms_weight_sets (id),
  weight_set_name text NOT NULL,
  weight_set_default boolean NOT NULL,
  -- The set's weights as they were, and the weights actually used after leaving out Not-applicable results.
  weights jsonb NOT NULL,
  weights_used jsonb NOT NULL,
  -- The formulas, the grace period and the floor in force, as written when it was submitted.
  formulas jsonb NOT NULL,
  -- The figures behind the score: the shift, the scheduled and excused days, the day counts and the attendance status.
  figures jsonb NOT NULL,
  submitted_by_id text NOT NULL,
  submitted_by_name text NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_evaluation_submission_version UNIQUE (evaluation_id, version),
  CONSTRAINT hrms_evaluation_submission_score CHECK ((outcome = 'scored') = (score IS NOT NULL))
);

-- One row per KPI in a submitted version: what it was, its result, its weight and its points.
CREATE TABLE public.hrms_evaluation_results (
  submission_id integer NOT NULL REFERENCES public.hrms_evaluation_submissions (id),
  kpi_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  source text NOT NULL,
  target text NOT NULL,
  status text NOT NULL CHECK (status IN ('scored', 'not-applicable')),
  result numeric,
  weight integer NOT NULL,
  weight_used numeric,
  points numeric,
  reason text,
  flag text,
  PRIMARY KEY (submission_id, kpi_id)
);

CREATE FUNCTION public.hrms_submitted_evaluation_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A submitted evaluation is never changed or deleted' USING ERRCODE = 'integrity_constraint_violation';
END $$;
CREATE TRIGGER hrms_evaluation_submissions_final BEFORE UPDATE OR DELETE ON public.hrms_evaluation_submissions FOR EACH ROW EXECUTE FUNCTION public.hrms_submitted_evaluation_is_final();
CREATE TRIGGER hrms_evaluation_results_final BEFORE UPDATE OR DELETE ON public.hrms_evaluation_results FOR EACH ROW EXECUTE FUNCTION public.hrms_submitted_evaluation_is_final();
