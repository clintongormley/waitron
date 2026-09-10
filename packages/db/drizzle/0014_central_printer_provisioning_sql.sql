-- Central printer provisioning: printers keyed on a stable device id, jobs record their claimer.
-- The old (tenant_id, agent_id) → print_agents FK ("printers_agent_fk") and the old
-- "printers_transport_fields_ck" CHECK were hand-written in the baseline --custom migration, so
-- `db:generate` emits no DROP for them. Drop them EXPLICITLY rather than relying on the preceding
-- migration's DROP COLUMN to remove them (CLAUDE.md §2 decision) — IF EXISTS keeps this idempotent
-- either way. The end state — no printers constraint references print_agents, and agent_id/usb_path
-- are gone — is proven by reading pg_constraint/information_schema back in printing.test.ts, not
-- assumed (CLAUDE.md §1).
ALTER TABLE "printers" DROP CONSTRAINT IF EXISTS "printers_agent_fk";
--> statement-breakpoint
ALTER TABLE "printers" DROP CONSTRAINT IF EXISTS "printers_transport_fields_ck";
--> statement-breakpoint
-- Which connection field a transport requires, keyed on the device now (no agent_id): usb and
-- bluetooth need local_key, network_tcp needs host, cloud_poll needs poll_id.
--
-- The column is cast to text rather than compared to a bare enum literal. 0013 adds the bluetooth
-- label to print_transport, and drizzle applies every pending migration of a set in ONE transaction
-- (drizzle-orm@0.45.2/pg-core/dialect.js:60); PostgreSQL refuses to USE a label added in the
-- transaction that added it unless the type was created there too. Naming the label here therefore
-- migrates a virgin database, where 0000 creates the type in the same batch, and aborts every
-- upgrade of an existing one with 55P04. Comparing text is the same predicate: an enum's text form
-- is its label. Proven both ways by packages/db/src/migrate-upgrade.pg.test.ts.
ALTER TABLE "printers"
  ADD CONSTRAINT "printers_transport_fields_ck" CHECK (
    (transport::text = 'usb'         AND local_key IS NOT NULL)
    OR (transport::text = 'bluetooth'   AND local_key IS NOT NULL)
    OR (transport::text = 'network_tcp' AND host      IS NOT NULL)
    OR (transport::text = 'cloud_poll'  AND poll_id   IS NOT NULL)
  );
--> statement-breakpoint
-- One registered printer per physical USB/BT device per venue; a NULL local_key (network_tcp/
-- cloud_poll) is exempt (partial index), so many can coexist.
CREATE UNIQUE INDEX "printers_local_key_key" ON "printers" ("tenant_id", "location_id", "local_key")
  WHERE "local_key" IS NOT NULL;
--> statement-breakpoint
-- The claimer is tenant-consistent: (tenant_id, claimed_by) → print_agents (tenant_id, id). A bare
-- column carries no FK; MATCH SIMPLE skips the check when claimed_by IS NULL (a queued job).
ALTER TABLE "print_jobs"
  ADD CONSTRAINT "print_jobs_claimed_by_fk"
  FOREIGN KEY ("tenant_id", "claimed_by") REFERENCES "print_agents" ("tenant_id", "id") MATCH SIMPLE;
