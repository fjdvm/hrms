-- Performance: links from a POS account (a Portal user) to an Employee. Forward-only and additive. Linking is by hand.
-- An Employee can hold several POS accounts over time; a POS account belongs to at most one Employee at a time. A link is
-- ended, never deleted, so the history of who linked what, when and why stays. Sales are never stored per Employee: they are
-- found through the links that are active when they are read, so unlinking removes an account's sales from the Employee,
-- past months included, and linking later repairs history.
CREATE TABLE public.hrms_pos_account_links (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  portal_user_id text NOT NULL CHECK (length(btrim(portal_user_id)) > 0),
  employee_id integer NOT NULL REFERENCES public.hrms_employees (id),
  linked_by_id text NOT NULL,
  linked_by_name text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  -- Required, and only then, when the Employee already had an active account.
  link_reason text,
  unlinked_by_id text,
  unlinked_by_name text,
  unlinked_at timestamptz,
  unlink_reason text,
  unlink_note text,
  CONSTRAINT hrms_pos_account_link_unlink CHECK (
    (unlinked_at IS NULL AND unlinked_by_id IS NULL AND unlinked_by_name IS NULL AND unlink_reason IS NULL AND unlink_note IS NULL)
    OR (unlinked_at IS NOT NULL AND unlinked_by_id IS NOT NULL AND unlinked_by_name IS NOT NULL
      AND unlink_reason IN ('Wrong person linked', 'Linked to the wrong POS account', 'Other')
      AND (unlink_reason <> 'Other' OR length(btrim(COALESCE(unlink_note, ''))) > 0)))
);
-- One POS account is linked to at most one Employee at a time.
CREATE UNIQUE INDEX hrms_pos_account_one_active ON public.hrms_pos_account_links (portal_user_id) WHERE unlinked_at IS NULL;
CREATE INDEX hrms_pos_account_by_employee ON public.hrms_pos_account_links (employee_id, linked_at DESC, id DESC);
