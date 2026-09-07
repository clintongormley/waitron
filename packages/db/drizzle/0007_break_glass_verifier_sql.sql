-- A scrypt verifier of the offline break-glass secret, set at promotion time by the owner. Nullable:
-- a node minted before this column, and the primary (which is never promoted), both hold NULL. No new
-- grant: the table-wide `GRANT SELECT ON "deployment" TO app_user` (0001_db_baseline_sql.sql) covers
-- the new column for reads, and the write is owner-only (app_user holds no UPDATE — an app-role write
-- must fail 42501, proven in deployment.break-glass.test.ts). Hand-written as a --custom migration
-- (snapshot-less), like the `mode`/`singleton_role` ALTERs, because `deployment` is deliberately not
-- in the drizzle schema barrel (see the header of src/schema/deployment.ts).
ALTER TABLE "deployment" ADD COLUMN "break_glass_verifier" text;
