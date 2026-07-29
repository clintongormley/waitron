-- Which environment this DATABASE belongs to. One row, ever: `id` is pinned to 1 by a CHECK, so
-- "what environment is this" can never have two answers. Written once at provisioning and never
-- updated — a database does not change environment, it gets replaced (see the design's §2: a
-- pre-production database can never be promoted, because its invoice series has a hole no stamp
-- can fill).
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
