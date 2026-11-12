-- Optional Careers answers; government IDs in this JSON are authenticated ciphertext.
ALTER TABLE public.hrms_offers
  ADD COLUMN applicant_details jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN details_revision integer NOT NULL DEFAULT 0;
