-- Performance: the reopen history of an Evaluation. Forward-only and additive. Reopening returns an Evaluated evaluation to
-- In review so a mistake (a bad import, say) can be corrected, with a required reason. The submitted version it came from is
-- kept as it was in hrms_evaluation_submissions, and submitting again adds a new version.
--
-- A submitted version can be reopened once: (evaluation_id, version) is unique, so two reopens at the same moment cannot both
-- be recorded. A reopen record is never changed or deleted, like a submitted version.
CREATE TABLE public.hrms_evaluation_reopens (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  evaluation_id integer NOT NULL REFERENCES public.hrms_evaluations (id),
  -- The submitted version that was reopened.
  version integer NOT NULL CHECK (version >= 1),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reopened_by_id text NOT NULL,
  reopened_by_name text NOT NULL,
  reopened_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT hrms_evaluation_reopen_once_per_version UNIQUE (evaluation_id, version),
  CONSTRAINT hrms_evaluation_reopen_submission FOREIGN KEY (evaluation_id, version) REFERENCES public.hrms_evaluation_submissions (evaluation_id, version)
);
CREATE TRIGGER hrms_evaluation_reopens_final BEFORE UPDATE OR DELETE ON public.hrms_evaluation_reopens FOR EACH ROW EXECUTE FUNCTION public.hrms_submitted_evaluation_is_final();
