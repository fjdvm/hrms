-- AI layer: the usage log. Forward-only and additive (HRMS and Careers share one database, so no existing table or column changes).
-- One row per AI request from a Staff member. It holds no prompt text and no drafted text: only who, which feature and model, how many
-- tokens, what came of it, and the internal error code and Reference ID when something went wrong (docs/ai-error-codes.md).
CREATE TABLE public.hrms_ai_usage (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- The Staff member (their Portal id).
  staff_id text NOT NULL CHECK (length(btrim(staff_id)) > 0),
  feature text NOT NULL CHECK (feature IN ('job-draft', 'suggestions')),
  model text NOT NULL CHECK (length(btrim(model)) > 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  -- pending: the call is in flight (a row left pending by a crash keeps its slot). success: a usable result. refused: we did not call
  -- the provider. failed: the provider failed on its side. unusable: the provider answered but the result could not be used.
  outcome text NOT NULL CHECK (outcome IN ('pending', 'success', 'refused', 'failed', 'unusable')),
  -- The internal code (AI-0089 and so on). Never shown to Staff.
  error_code text CHECK (error_code ~ '^AI-[0-9]{4}$'),
  -- The finer internal reason behind a code, for example provider-quota behind AI-0091. Never shown to Staff.
  error_reason text,
  -- Random six characters shown to Staff on a red error, so support can find this row. Holds no meaning and no personal data.
  reference_id text CHECK (reference_id ~ '^[A-Z0-9]{6}$'),
  -- Whether this request uses one of the Staff member's daily slots and one of the company's daily calls.
  counts_toward_limit boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- The Manila calendar day the request belongs to: the limits reset at Manila midnight.
  usage_day date GENERATED ALWAYS AS ((created_at AT TIME ZONE 'Asia/Manila')::date) STORED,
  CONSTRAINT hrms_ai_usage_code_matches_outcome CHECK (outcome IN ('pending', 'success') OR error_code IS NOT NULL),
  CONSTRAINT hrms_ai_usage_refused_not_counted CHECK (outcome <> 'refused' OR NOT counts_toward_limit)
);
CREATE UNIQUE INDEX hrms_ai_usage_reference_id_key ON public.hrms_ai_usage (reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX hrms_ai_usage_staff_day ON public.hrms_ai_usage (staff_id, feature, usage_day) WHERE counts_toward_limit;
CREATE INDEX hrms_ai_usage_day ON public.hrms_ai_usage (usage_day) WHERE counts_toward_limit;

-- Checks the daily limits and writes the usage row in ONE statement (SELECT * FROM hrms_ai_reserve(...)), so two requests at the same
-- moment cannot both take the last slot. The advisory lock makes concurrent reservations take turns, and a plpgsql function takes a
-- fresh snapshot for each of its statements, so the count below always sees the request that just finished ahead of it.
--   p_limit: the Staff member's allowance for the feature per Manila day.
--   p_budget: the company's allowance across all features per Manila day, or NULL for no cap.
--   p_now: the time of the request (so the Manila day can be tested).
-- Returns the new row's id, and the refusal code when the request was refused (the row is then logged as refused and counts for nothing).
CREATE FUNCTION public.hrms_ai_reserve(p_staff_id text, p_feature text, p_model text, p_limit integer, p_budget integer, p_now timestamptz)
RETURNS TABLE (usage_id integer, refusal text)
LANGUAGE plpgsql AS $$
DECLARE
  v_day date := (p_now AT TIME ZONE 'Asia/Manila')::date;
  v_code text;
  v_id integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('hrms_ai_usage'));
  IF (SELECT count(*) FROM public.hrms_ai_usage WHERE staff_id = p_staff_id AND feature = p_feature AND usage_day = v_day AND counts_toward_limit) >= p_limit THEN
    v_code := 'AI-0089';
  ELSIF p_budget IS NOT NULL AND (SELECT count(*) FROM public.hrms_ai_usage WHERE usage_day = v_day AND counts_toward_limit) >= p_budget THEN
    v_code := 'AI-0090';
  END IF;
  IF v_code IS NULL THEN
    INSERT INTO public.hrms_ai_usage (staff_id, feature, model, outcome, counts_toward_limit, created_at)
    VALUES (p_staff_id, p_feature, p_model, 'pending', true, p_now) RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.hrms_ai_usage (staff_id, feature, model, outcome, error_code, error_reason, counts_toward_limit, created_at)
    VALUES (p_staff_id, p_feature, p_model, 'refused', v_code, CASE v_code WHEN 'AI-0089' THEN 'limit-reached' ELSE 'budget-reached' END, false, p_now) RETURNING id INTO v_id;
  END IF;
  RETURN QUERY SELECT v_id, v_code;
END;
$$;
