-- Performance: the sales KPI's source reads "POS sales" on the Evaluation page and in KPI Setup. Forward-only; a KPI's source is display text only,
-- and no Evaluation has been submitted with the sales KPI yet (every sales weight starts at 0), so no saved result carries the old text.
UPDATE public.hrms_kpis SET source = 'POS sales' WHERE id = 'sales' AND source = 'POS sales import';
