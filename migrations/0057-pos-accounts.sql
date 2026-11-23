-- Performance: the POS staff number of each POS account (Portal user) that has stored sales, so the Needs linking list can show it when the Portal
-- has no name for the account. Forward-only and additive. One row per account, refreshed by each import; it holds no customer data.
CREATE TABLE public.hrms_pos_accounts (
  portal_user_id text PRIMARY KEY CHECK (length(btrim(portal_user_id)) > 0),
  staff_number integer NOT NULL CHECK (staff_number >= 1000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
