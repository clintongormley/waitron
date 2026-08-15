-- Hand-written custom migration: sync_cursor is a raw-SQL table (0000_sync_outbox.sql:100-107), NOT a
-- Drizzle-modelled table, so drizzle-kit has nothing to diff a PK change against and 0002_snapshot.json
-- is a copy of 0001's (no table/column drizzle-kit tracks) — the 0000/0001 idiom
-- (0000_sync_outbox.sql:1-3, 0001_sync_retention.sql:1-4). @waitron/sync carries NO drizzle.config and
-- no db:generate script, so this .sql, its journal entry and its snapshot copy are all written by hand.
-- Runs LAST in migrations.manifest.json's `sync` set, after 0000/0001, so sync_cursor already exists.
--
-- WHAT THIS BUILDS. A `lane` dimension on sync_cursor so the fast (payments) and ordered streams track
-- INDEPENDENT cursors per (subscriber, origin): two lanes need two cursor rows, so the primary key
-- repivots from (subscriber_id, origin_id) to (subscriber_id, origin_id, lane). `default 'ordered'`
-- matches the wire default (an unknown/missing ?lane= clamps to ordered — sync-api.ts) and the
-- ApplyBatchOptions default, so a hand-run INSERT that omits lane lands on the ordered lane. NO data
-- migration: nothing is deployed (CLAUDE.md §3), a freshly-migrated database has zero sync_cursor rows,
-- so the default backfills nothing. The sync_cursor DELETE grant that dead-subscriber eviction needs is
-- NOT here — it ships with the verb in the deferred retention-operations slice (spec §1).

ALTER TABLE sync_cursor ADD COLUMN lane text NOT NULL DEFAULT 'ordered';
--> statement-breakpoint
ALTER TABLE sync_cursor DROP CONSTRAINT sync_cursor_pkey;
--> statement-breakpoint
ALTER TABLE sync_cursor ADD PRIMARY KEY (subscriber_id, origin_id, lane);
