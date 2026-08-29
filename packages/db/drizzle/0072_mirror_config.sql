-- Custom migration (drizzle-kit models no grants). The mirror's connection config — an operational
-- whole-database singleton like `deployment`/`sync_cursor`: NO tenant_id, NO RLS, out of the fiscal
-- inmutabilidad FORCE-RLS scan by construction. Written owner-role at adopt (C2b); read app_user at
-- mirror boot. Non-secret only — the per-peer sync token lives in the credentials vault, never here.
CREATE TABLE "mirror_config" (
	"id" integer PRIMARY KEY NOT NULL DEFAULT 1,
	"relay_url" text NOT NULL,
	"box_hostname" text NOT NULL,
	"box_ca_pem" text NOT NULL,
	"adopted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mirror_config_singleton_ck" CHECK ("mirror_config"."id" = 1)
);
--> statement-breakpoint
GRANT SELECT ON "mirror_config" TO app_user;
