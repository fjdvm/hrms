-- Performance: suggested development areas (AI). Forward-only and additive.
--
-- On an Evaluated Evaluation, a Performance holder can ask the AI for suggested development areas from the locked KPI results. Each
-- generation is saved as a SET against the submitted version it came from, with the model and who generated it. Regenerate saves a new
-- set and marks the old one 'superseded'; nothing is deleted. A suggestion is only a suggestion: it never changes a score, a rating or a
-- status, and a development need exists only when Staff flag one.
--
-- The stored output holds no prompt text. The Employee is reached through the Evaluation, never copied here.
CREATE TABLE public.hrms_suggestion_sets (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  evaluation_id integer NOT NULL REFERENCES public.hrms_evaluations (id),
  -- The submitted version of the Evaluation these suggestions were made from.
  version integer NOT NULL CHECK (version >= 1),
  model text NOT NULL CHECK (length(btrim(model)) > 0),
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  generated_by_id text NOT NULL,
  generated_by_name text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_suggestion_set_submission FOREIGN KEY (evaluation_id, version) REFERENCES public.hrms_evaluation_submissions (evaluation_id, version)
);
-- One current set per submitted version: two generations at the same moment cannot both stay current.
CREATE UNIQUE INDEX hrms_suggestion_sets_one_current ON public.hrms_suggestion_sets (evaluation_id, version) WHERE status = 'current';
CREATE INDEX hrms_suggestion_sets_evaluation ON public.hrms_suggestion_sets (evaluation_id, version DESC, id DESC);

CREATE TABLE public.hrms_suggestions (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  set_id integer NOT NULL REFERENCES public.hrms_suggestion_sets (id),
  -- Keeps the order the AI gave them in.
  position integer NOT NULL CHECK (position >= 1),
  -- The KPI the gap is tied to, with its result and target as the page showed them (for example "Punctuality 88.0, target 100%").
  kpi_id text NOT NULL,
  gap text NOT NULL CHECK (length(btrim(gap)) > 0),
  kpi_result numeric NOT NULL,
  kpi_target text NOT NULL,
  -- A scheduled Training that matches, or none: then the recommendation names a topic.
  training_id integer REFERENCES public.hrms_trainings (id),
  recommendation text NOT NULL CHECK (length(btrim(recommendation)) > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Flagged', 'Dismissed')),
  -- The development need a Flagged suggestion created.
  need_id integer REFERENCES public.hrms_development_needs (id),
  reviewed_by_id text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  CONSTRAINT hrms_suggestion_position UNIQUE (set_id, position),
  CONSTRAINT hrms_suggestion_flagged_has_need CHECK ((status = 'Flagged') = (need_id IS NOT NULL)),
  CONSTRAINT hrms_suggestion_reviewed CHECK ((status = 'Pending') = (reviewed_at IS NULL AND reviewed_by_id IS NULL AND reviewed_by_name IS NULL))
);
-- A need is flagged from a suggestion once: the link is unique.
CREATE UNIQUE INDEX hrms_suggestions_need ON public.hrms_suggestions (need_id) WHERE need_id IS NOT NULL;

-- The link 0050 left open: a need flagged from a suggestion points back to it.
ALTER TABLE public.hrms_development_needs
  ADD CONSTRAINT hrms_development_need_suggestion FOREIGN KEY (suggestion_id) REFERENCES public.hrms_suggestions (id);
