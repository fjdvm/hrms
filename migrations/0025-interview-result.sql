-- Result, private evaluation and Stage transition are one transaction. Match
-- booking's lock order so a reschedule cannot race the start-time check.
CREATE FUNCTION public.hrms_record_interview_result(p_application integer, p_interview bigint, p_result jsonb, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  current_stage text;
  existing public.hrms_application_interviews%ROWTYPE;
  next_stage text;
  recorded_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(730032);
  PERFORM id FROM public.applications WHERE id = p_application FOR UPDATE;
  PERFORM id FROM public.hrms_manual_applications WHERE id = p_application FOR UPDATE;
  SELECT * INTO existing FROM public.hrms_application_interviews
    WHERE application_id = p_application AND id = p_interview FOR UPDATE;
  IF existing.id IS NULL THEN RETURN jsonb_build_object('error', 'not-found'); END IF;
  IF existing.result IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'conflict', 'detail', 'An Interview result can only be recorded once.');
  END IF;
  recorded_at := clock_timestamp();
  IF existing.starts_at > recorded_at THEN
    RETURN jsonb_build_object('error', 'conflict', 'detail', 'The Interview has not started.');
  END IF;
  SELECT stage INTO current_stage FROM public.hrms_all_applications WHERE id = p_application;
  IF current_stage IS DISTINCT FROM 'Interview' THEN
    RETURN jsonb_build_object('error', 'conflict', 'detail', 'Application must be in the Interview Stage.');
  END IF;
  IF p_result->>'result' NOT IN ('Passed', 'Not passed') OR p_result->>'result' IS NULL
    OR (p_result->>'score')::numeric NOT BETWEEN 1 AND 5
    OR (p_result->>'score')::numeric <> trunc((p_result->>'score')::numeric)
    OR p_result->>'score' IS NULL THEN
    RETURN jsonb_build_object('error', 'validation');
  END IF;
  next_stage := CASE WHEN p_result->>'result' = 'Passed' THEN 'Offer' ELSE 'Rejected' END;
  UPDATE public.hrms_application_interviews
    SET score = (p_result->>'score')::integer, result = p_result->>'result',
      private_notes = p_result->>'privateNotes', result_email_at = (p_result->>'resultEmailAt')::timestamptz
    WHERE id = p_interview;
  UPDATE public.applications SET status = next_stage, updated_at = recorded_at WHERE id = p_application;
  UPDATE public.hrms_manual_applications SET status = next_stage, updated_at = recorded_at WHERE id = p_application;
  INSERT INTO public.hrms_application_stage_history(application_id, stage, reached_at)
    VALUES (p_application, next_stage, recorded_at);
  INSERT INTO public.hrms_application_activity(application_id, from_stage, to_stage, actor_name, reason, interview_id, occurred_at)
    VALUES (p_application, 'Interview', next_stage, p_actor,
      'Interview result: ' || (p_result->>'result') || ' (score: ' || (p_result->>'score') || '/5)', p_interview, recorded_at);
  RETURN '{}'::jsonb;
END;
$$;
