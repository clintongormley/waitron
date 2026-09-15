-- Custom SQL migration file, put your code below! --
REVOKE ALL ON "payments" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payments" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "payment_refunds" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_refunds" TO app_user;
--> statement-breakpoint
REVOKE ALL ON "payment_policy" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "payment_policy" TO app_user;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_external_ref_key"
  ON "payments" ("provider", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "provider" <> 'manual';
--> statement-breakpoint
REVOKE ALL ON "card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "card_readers" TO app_user;
--> statement-breakpoint
-- device_card_readers is a mutable mapping (a device's default reader can be repointed or
-- cleared), unlike card_readers itself — so app_user holds DELETE here, which card_readers'
-- grant above deliberately withholds.
REVOKE ALL ON "device_card_readers" FROM app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "device_card_readers" TO app_user;
