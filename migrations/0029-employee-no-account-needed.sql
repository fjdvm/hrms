-- "No account needed" decision for an Onboarding Employee record: who and when. Cleared (both NULL) to undo.
-- Only the read model uses it here; the action that sets it arrives with the Automatic Active ticket (#345).
ALTER TABLE public.hrms_employees
  ADD COLUMN no_account_needed_at timestamptz,
  ADD COLUMN no_account_needed_by text,
  ADD CONSTRAINT hrms_employees_no_account_needed_pair CHECK ((no_account_needed_at IS NULL) = (no_account_needed_by IS NULL));
