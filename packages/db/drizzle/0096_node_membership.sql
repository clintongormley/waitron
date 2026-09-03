-- Custom migration (drizzle-kit models no grants). The venue's current membership document — an
-- operational whole-database singleton like `deployment`/`mirror_config`/`sync_cursor`: NO tenant_id,
-- NO RLS, out of the fiscal inmutabilidad FORCE-RLS scan by construction. `document` (jsonb) holds
-- the whole signed SignedMembershipDocument (design §3); `term` is denormalised from
-- document.body.term for ordering. GRANT SELECT to app_user (a node reads the held document on the
-- app pool at boot); writes are owner-role only. The runtime-adoption write grant is deferred to
-- membership Slice 3.
CREATE TABLE "node_membership" (
	"id" integer PRIMARY KEY NOT NULL DEFAULT 1,
	"term" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "node_membership_singleton_ck" CHECK ("node_membership"."id" = 1)
);
--> statement-breakpoint
GRANT SELECT ON "node_membership" TO app_user;
