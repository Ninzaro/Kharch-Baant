-- The browser client subscribes as realtime:public:<table>. The first policy
-- only listed public:<table>, so private joins were refused and the other
-- device never saw a new expense until a refresh.

DROP POLICY IF EXISTS "authenticated read app realtime topics" ON realtime.messages;

CREATE POLICY "authenticated read app realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  (SELECT realtime.topic()) ~ '^((realtime:)?public:)(groups|transactions|payment_sources|people|group_members)$'
);
