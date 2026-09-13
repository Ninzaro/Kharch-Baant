-- S-02 / R-05: DELETE postgres_changes is not RLS-filtered. FULL replica identity
-- put every column of the deleted row on the wire. DEFAULT sends PK only.
-- App subscriptions no longer bind DELETE (S-06 resume refetch covers deletes).

ALTER TABLE groups REPLICA IDENTITY DEFAULT;
ALTER TABLE transactions REPLICA IDENTITY DEFAULT;
ALTER TABLE payment_sources REPLICA IDENTITY DEFAULT;
ALTER TABLE people REPLICA IDENTITY DEFAULT;
ALTER TABLE group_members REPLICA IDENTITY DEFAULT;
