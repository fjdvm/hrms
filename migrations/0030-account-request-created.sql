-- Who created the Portal account and when, as reported back by the Portal (written by the webhook slice; read by Onboarding).
ALTER TABLE public.hrms_account_requests ADD COLUMN account_created_at timestamptz, ADD COLUMN account_created_by text;
