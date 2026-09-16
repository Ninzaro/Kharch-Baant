-- R-18: active invite links must not make their creator visible to every user.
-- Preserve self, shared-group, and group-creator visibility rules.

CREATE OR REPLACE FUNCTION public.i_can_see_person(p_person_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM people p
      WHERE p.id = p_person_id
        AND p.clerk_user_id IS NOT NULL
        AND p.clerk_user_id = requesting_user_id()
    )
    OR EXISTS (
      SELECT 1
      FROM group_members my_gm
      JOIN people me ON me.id = my_gm.person_id
      JOIN group_members their_gm
        ON their_gm.group_id = my_gm.group_id
       AND their_gm.person_id = p_person_id
      WHERE me.clerk_user_id = requesting_user_id()
    )
    OR EXISTS (
      SELECT 1
      FROM group_members gm
      WHERE gm.person_id = p_person_id
        AND i_created_group(gm.group_id)
    );
$$;

NOTIFY pgrst, 'reload schema';
