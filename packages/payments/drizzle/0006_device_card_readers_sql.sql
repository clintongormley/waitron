-- device_card_readers is a mutable mapping (a device's default reader can be repointed or
-- cleared), unlike card_readers itself — so app_user holds DELETE here, the shape
-- 0004_card_readers_sql.sql deliberately withholds.
REVOKE ALL ON "device_card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_card_readers" TO app_user;
