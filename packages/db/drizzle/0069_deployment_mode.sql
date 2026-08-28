-- Which ROLE this database plays in the cloud-mirror topology (C2a design §3). A `primary` writes and
-- originates; a `mirror` pulls + applies a primary's rows and serves read-only (writes refused at the
-- HTTP layer; deployment.mode read at runtime so a later promotion needs no restart). One row, ever
-- (0010's singleton CHECK). Default 'primary' so every existing deployment is unchanged — pre-production,
-- no backfill (CLAUDE.md §3). Read by app_user through the table-wide SELECT 0010 already granted (a
-- table-level GRANT covers future columns); the WRITE (stamp-mirror, promote) is an OWNER-role write —
-- app_user holds no INSERT/UPDATE on deployment, which the grant read-back test asserts. No new grant.
ALTER TABLE "deployment" ADD COLUMN "mode" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_mode_ck" CHECK ("deployment"."mode" in ('primary', 'mirror'));
