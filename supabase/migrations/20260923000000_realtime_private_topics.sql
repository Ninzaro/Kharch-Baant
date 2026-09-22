-- R-23 / S-11: signed-in clients may join the five postgres_changes topics.
-- Anon has no policy, so it cannot join once Realtime "Allow public access" is off.
-- No INSERT policy: clients cannot broadcast on these topics.
-- Row contents stay filtered by each table's own RLS.

DROP POLICY IF EXISTS "authenticated read app realtime topics" ON realtime.messages;

CREATE POLICY "authenticated read app realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (SELECT realtime.topic()) IN (
    'public:groups',
    'public:transactions',
    'public:payment_sources',
    'public:people',
    'public:group_members'
  )
);
