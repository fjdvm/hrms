-- Performance: the KPIs, the weight sets that score Employees with them, and the change log every Performance
-- module writes to. Forward-only and additive. Nothing is deleted from these tables by the application.

-- The starter KPIs. A KPI is deactivated, never deleted, so past scores stay explainable.
CREATE TABLE public.hrms_kpis (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL,
  source text NOT NULL CHECK (length(btrim(source)) > 0),
  target text NOT NULL,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  sort_order integer NOT NULL UNIQUE,
  updated_by_id text,
  updated_by_name text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO public.hrms_kpis (id, name, description, source, target, sort_order) VALUES
  ('attendanceRate', 'Attendance rate', 'Days present ÷ scheduled days', 'Attendance import', '100%', 1),
  ('punctuality', 'Punctuality', 'On-time days ÷ present days', 'Attendance import', '100%', 2),
  ('fullShift', 'Full shift', 'Full-shift days ÷ present days', 'Attendance import', '100%', 3),
  ('trainingCompletion', 'Training completion', 'Completed ÷ assigned Trainings', 'Training', '100%', 4),
  ('evaluatorRating', 'Evaluator rating', '0 to 100, entered by the Staff member evaluating', 'Staff rating', '100', 5);

-- A weight set gives each KPI a whole-number weight, and the five weights always total 100 (checked here, so no
-- write can break it). There is one default set, which applies to everyone, and at most one set per position.
-- A position set applies when the Employee's position text matches exactly, ignoring case and extra spaces:
-- position_key is that normalised text.
CREATE TABLE public.hrms_weight_sets (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  is_default boolean NOT NULL DEFAULT false,
  position text,
  position_key text,
  attendance_rate integer NOT NULL CHECK (attendance_rate BETWEEN 0 AND 100),
  punctuality integer NOT NULL CHECK (punctuality BETWEEN 0 AND 100),
  full_shift integer NOT NULL CHECK (full_shift BETWEEN 0 AND 100),
  training_completion integer NOT NULL CHECK (training_completion BETWEEN 0 AND 100),
  evaluator_rating integer NOT NULL CHECK (evaluator_rating BETWEEN 0 AND 100),
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_weight_set_total CHECK (attendance_rate + punctuality + full_shift + training_completion + evaluator_rating = 100),
  CONSTRAINT hrms_weight_set_kind CHECK (
    (is_default AND position IS NULL AND position_key IS NULL)
    OR (NOT is_default AND length(btrim(position)) > 0 AND position_key = lower(btrim(regexp_replace(position, '\s+', ' ', 'g'))))),
  CONSTRAINT hrms_weight_set_position_key UNIQUE (position_key)
);
CREATE UNIQUE INDEX hrms_weight_set_one_default ON public.hrms_weight_sets (is_default) WHERE is_default;

INSERT INTO public.hrms_weight_sets (name, is_default, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating,
  created_by_id, created_by_name, updated_by_id, updated_by_name)
VALUES ('Default set', true, 30, 25, 15, 15, 15, 'system', 'System', 'system', 'System');

-- Every Performance change records which Staff member made it. Later modules (periods, imports, submit, reopen)
-- write here too.
CREATE TABLE public.hrms_performance_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  subject text NOT NULL,
  subject_id text NOT NULL,
  detail jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON public.hrms_performance_audit (subject, subject_id, occurred_at DESC, id DESC);
