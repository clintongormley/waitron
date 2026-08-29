-- The SINGLETON-OWNERSHIP axis (promotion runbook design §2), orthogonal to `mode` (0069). `mode` says
-- read-write (`primary`) vs read-only (`mirror`); `singleton_role` says whether THIS database holds the
-- venue's singleton duties — the AEAT submitter + payment reconciler (#33 §7): `primary` holds them,
-- `secondary` is sell-only. Two axes are needed because a local secondary in active-active is
-- read-WRITE (it sells) yet holds no singletons — a state `mode` alone cannot express. Default 'primary'
-- so every existing single-node deployment (mode='primary') stays a singleton-holder, unchanged —
-- pre-production, no backfill (CLAUDE.md §3). This ADD COLUMN + deployment_role_valid_ck (below) apply
-- cleanly on an empty `deployment` table OR an already-stamped `primary` row (its 'primary' backfill →
-- (primary, primary), which the CHECK permits). The ONLY row they would reject is a pre-existing
-- `mode='mirror'` one, whose 'primary' backfill is the forbidden (mirror, primary) pair — a migrate-in-
-- place-over-a-live-mirror case that is out of scope (recreate, not migrate, CLAUDE.md §3). Read by
-- app_user through the table-wide SELECT 0010
-- already granted; the WRITE (demote-to-mirror, promote) is an OWNER-role write, no new grant (as `mode`).
-- Selling never reads it (#33 — selling needs no role); only the fiscal pass does.
ALTER TABLE "deployment" ADD COLUMN "singleton_role" text DEFAULT 'primary' NOT NULL;
--> statement-breakpoint
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_singleton_role_ck" CHECK ("deployment"."singleton_role" in ('primary', 'secondary'));
--> statement-breakpoint
-- A read-only mirror cannot hold singleton duties: the (mirror, primary) pair is rejected at the write
-- boundary (design §2). setDeploymentMode('mirror') co-sets singleton_role='secondary' in one UPDATE so
-- the pair is never even transiently written; this CHECK is the backstop.
ALTER TABLE "deployment" ADD CONSTRAINT "deployment_role_valid_ck" CHECK (NOT ("deployment"."mode" = 'mirror' AND "deployment"."singleton_role" = 'primary'));
