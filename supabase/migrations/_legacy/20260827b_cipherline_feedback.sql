/*
# Feedback (Reportar Bug / Sugestões)
*/

CREATE TABLE IF NOT EXISTS feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type text NOT NULL,
  message text NOT NULL,
  contact_email text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_can_submit_feedback" ON feedback;
CREATE POLICY "anyone_can_submit_feedback" ON feedback FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "users_see_own_feedback" ON feedback;
CREATE POLICY "users_see_own_feedback" ON feedback FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
