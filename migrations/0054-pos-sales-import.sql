-- Performance: the stored POS sales figures, the record of each import, the POS branch map and the go-live date. Forward-only and
-- additive; no existing table is changed. Imported rows are aggregates only (no customer data, order numbers or order lines) and can
-- be re-created by importing again.

-- Performance settings, one row per key. The POS go-live date is the first; the sales target joins it later.
CREATE TABLE public.hrms_performance_settings (
  key text PRIMARY KEY CHECK (length(btrim(key)) > 0),
  value text NOT NULL,
  updated_by_id text NOT NULL,
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Each run that saved figures: who, when, the range of Manila days read and the result. A month stays Provisional until an import
-- run in the following month has re-read it, and a sales KPI needs an import after its period ended: both read this table.
CREATE TABLE public.hrms_pos_imports (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  range_from date NOT NULL,
  range_to date NOT NULL,
  days integer NOT NULL CHECK (days >= 0),
  orders integer NOT NULL CHECK (orders >= 0),
  net_sales numeric(14, 2) NOT NULL,
  unlinked_accounts integer NOT NULL CHECK (unlinked_accounts >= 0),
  imported_by_id text NOT NULL,
  imported_by_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (range_to >= range_from)
);

-- The POS branches as the POS reports them, and the HRMS branch each maps to. The POS branch type is kept (a bazaar is a branch type).
-- An import refreshes the name, type and active flag, and never touches hrms_branch, which is set by hand.
CREATE TABLE public.hrms_pos_locations (
  pos_location_id integer PRIMARY KEY,
  name text NOT NULL,
  pos_type text NOT NULL,
  is_active boolean NOT NULL,
  hrms_branch text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- One row per cashier (Portal user id), POS branch and Manila business day. There is no Employee id: the Employee is found through the
-- POS account links when the figures are read, so linking later repairs history and unlinking removes sales retroactively.
CREATE TABLE public.hrms_pos_sales_daily (
  portal_user_id text NOT NULL CHECK (length(btrim(portal_user_id)) > 0),
  location_id integer NOT NULL,
  business_date date NOT NULL,
  orders integer NOT NULL CHECK (orders >= 0),
  gross_sales numeric(14, 2) NOT NULL CHECK (gross_sales >= 0),
  refund_amount numeric(14, 2) NOT NULL CHECK (refund_amount >= 0),
  net_sales numeric(14, 2) NOT NULL,
  import_id integer NOT NULL REFERENCES public.hrms_pos_imports (id),
  PRIMARY KEY (portal_user_id, location_id, business_date),
  CONSTRAINT hrms_pos_sales_net CHECK (net_sales = gross_sales - refund_amount)
);
CREATE INDEX hrms_pos_sales_by_day ON public.hrms_pos_sales_daily (business_date, location_id);
