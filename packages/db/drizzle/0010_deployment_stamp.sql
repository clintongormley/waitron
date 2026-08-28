-- Which environment this DATABASE belongs to. One row, ever: `id` is pinned to 1 by a CHECK, so
-- "what environment is this" can never have two answers. Written once at provisioning and never
-- updated — a database does not change environment, it gets replaced (see the design's §2: a
-- pre-production database can never be promoted, because its invoice series has a hole no stamp
-- can fill).
--
-- 2026-08-28 (cloud-mirror C2a): "written once and never updated" describes the `environment` column
-- ONLY. This same singleton row later gained a `mode` column (`primary`|`mirror`), added by
-- drizzle/0067_deployment_mode.sql, and `mode` IS mutable — a mirror is PROMOTED to a primary in
-- place via a single owner-role `UPDATE deployment SET mode='primary'` (C2a design §10). No
-- replace-not-update rule applies to it; only `environment` is fixed for the life of the database.
--
-- Deliberately NOT tenant-scoped and NOT RLS-protected: it is a fact about the whole database, so
-- there is no tenant to isolate it by, and every role must be able to read it before any tenant
-- scope exists. It carries no secret — the environment name is already in the host's own config.
CREATE TABLE "deployment" (
	"id" integer PRIMARY KEY NOT NULL,
	"environment" text NOT NULL,
	"stamped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_singleton_ck" CHECK ("deployment"."id" = 1),
	CONSTRAINT "deployment_environment_ck" CHECK ("deployment"."environment" in ('production', 'preproduction'))
);
--> statement-breakpoint
GRANT SELECT ON "deployment" TO app_user;
