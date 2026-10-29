-- The next migration adds a not-null `purpose` column, which this engine refuses to add to a table
-- holding rows. A challenge is accepted for five minutes and none on file names the ceremony that
-- issued it, so all are dropped.
DELETE FROM `webauthn_challenges`;
