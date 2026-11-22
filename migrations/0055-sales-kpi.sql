-- Performance: the sales KPI. Forward-only and additive. The sales weight starts at 0 in every weight set, which keeps the feature off:
-- nothing about any Employee's score changes until HR gives a set a sales weight and the company-wide target is set.

-- The sales target is a peso amount (net sales per present day that scores 100), kept on the KPI. It is null until HR sets it, and
-- only the sales KPI uses it. Changes are audited by the application.
ALTER TABLE public.hrms_kpis ADD COLUMN target_amount numeric(12, 2) CHECK (target_amount IS NULL OR target_amount > 0);

INSERT INTO public.hrms_kpis (id, name, description, source, target, sort_order)
VALUES ('sales', 'Sales', 'Net sales per present day', 'POS sales import', 'Not set', 6);

-- Every existing set weighs sales at 0, so each still totals 100 (the deferred total check passes).
INSERT INTO public.hrms_weight_set_items (set_id, kpi_id, weight) SELECT id, 'sales', 0 FROM public.hrms_weight_sets;
