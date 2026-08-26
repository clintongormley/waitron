-- The print-job claim LEASE anchor (failover-printing design §5, Gap 1): the agent pull stamps
-- `claimed_at = now()` on every claim and re-selects a `printing` row whose claim is older than
-- PRINT_JOB_LEASE_MS (packages/printing/src/runtime.ts) — a visibility timeout so a job whose claimer
-- died mid-service is reclaimed instead of stranded in `printing` forever. Nullable, no default (NULL
-- while queued / never-claimed). No RLS/grant change: 0063's FOR ALL policy + the table-level
-- SELECT/INSERT/UPDATE grant to app_user already cover a new column.
ALTER TABLE "print_jobs" ADD COLUMN "claimed_at" timestamp with time zone;