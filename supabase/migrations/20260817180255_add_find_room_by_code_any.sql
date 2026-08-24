/*
# Add find_room_by_code_any RPC for expired room detection

## Overview
Adds a SECURITY DEFINER function that finds a room by code regardless of expiry status.
This is used by the frontend to distinguish between "room not found" and "room expired"
when joining a channel.

## New RPC function
- `find_room_by_code_any(p_code text)` — returns room id, code, is_permanent, expires_at
  if the code matches any room (even expired ones). Used to detect expired rooms and
  show the dedicated "CANAL EXPIRADO" screen.

## Notes
1. SECURITY DEFINER bypasses RLS so it can read rooms despite the USING(false) SELECT policy.
2. Fixed search_path to prevent injection.
*/

CREATE OR REPLACE FUNCTION public.find_room_by_code_any(p_code text)
RETURNS TABLE (id uuid, code text, is_permanent boolean, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT r.id, r.code, r.is_permanent, r.expires_at
    FROM rooms r
    WHERE r.code = p_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_room_by_code_any(text) TO anon, authenticated;