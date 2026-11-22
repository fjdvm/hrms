-- Performance: weight sets as one row per KPI, so a new KPI needs no new column. Forward-only and additive.
-- The five legacy columns on hrms_weight_sets stay and are still written for one release, so a code revert is safe;
-- a later clean-up ticket may drop them. Nothing here changes a weight, a score or a stored result.

CREATE TABLE public.hrms_weight_set_items (
  set_id integer NOT NULL REFERENCES public.hrms_weight_sets (id) ON DELETE CASCADE,
  kpi_id text NOT NULL REFERENCES public.hrms_kpis (id),
  weight integer NOT NULL CHECK (weight BETWEEN 0 AND 100),
  PRIMARY KEY (set_id, kpi_id)
);

-- Every existing set gets one row per starter KPI, with the weight its legacy column holds.
INSERT INTO public.hrms_weight_set_items (set_id, kpi_id, weight)
SELECT s.id, v.kpi_id, v.weight
FROM public.hrms_weight_sets s
CROSS JOIN LATERAL (VALUES
  ('attendanceRate', s.attendance_rate), ('punctuality', s.punctuality), ('fullShift', s.full_shift),
  ('trainingCompletion', s.training_completion), ('evaluatorRating', s.evaluator_rating)
) AS v (kpi_id, weight);

-- A set's items total 100. A KPI with no row counts as weight 0, so a new KPI can exist before any set weighs it.
-- Deferred, so one transaction may write all of a set's rows before the total is checked at commit. It guards the items
-- only: a set written by old code (legacy columns alone, after a revert) has no items and is not checked here.
CREATE FUNCTION public.hrms_weight_set_total_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target integer := COALESCE(NEW.set_id, OLD.set_id);
  total integer;
BEGIN
  -- The set was deleted in this transaction: its items went with it.
  IF NOT EXISTS (SELECT 1 FROM public.hrms_weight_sets WHERE id = target) THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(weight), 0) INTO total FROM public.hrms_weight_set_items WHERE set_id = target;
  IF total <> 100 THEN
    RAISE EXCEPTION 'Weight set % weights total %, not 100', target, total USING ERRCODE = '23514', CONSTRAINT = 'hrms_weight_set_items_total';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER hrms_weight_set_items_total
AFTER INSERT OR UPDATE OR DELETE ON public.hrms_weight_set_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.hrms_weight_set_total_check();
