import {
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * The lifecycle of one outbox job (§2c). `queued` (default) → the agent atomically claims it as
 * `printing` (a locking UPDATE … RETURNING, so two agent instances never double-print) → `done` on a
 * successful push, or `failed` (retried with bounded backoff). A pgEnum, matching the repo precedent.
 */
export const printJobStatus = pgEnum("print_job_status", ["queued", "printing", "done", "failed"]);

/** `bytea` as a Node `Buffer` in both directions. drizzle-orm 0.45 ships no first-class bytea type
 * (the `packages/credentials` schema defines the same local helper for the same reason). The payload
 * is OPAQUE ESC/POS bytes — a text column holding base64 would put a second encoding between the
 * caller and the row for no benefit. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * The print OUTBOX (§2c) — delivery decoupled from creation so a fire or a sale is NEVER blocked by a
 * printer (CLAUDE.md §5). `enqueuePrintJob` (a later task) is a single INSERT (`queued`) that opens no
 * socket and waits on no hardware; the agent runtime's pull→push→report loop moves the row through
 * `printing` → `done`/`failed` asynchronously. Any node (local or cloud) may enqueue; the agent that
 * pulls it delivers it.
 *
 * `payload` is OPAQUE bytes (`bytea`): Slice B fills it with ESC/POS, and this subsystem never
 * inspects them — it only moves bytes. `printer_id` is a BARE uuid whose tenant-consistent
 * (tenant_id, printer_id) → printers (tenant_id, id) composite FK is hand-written in the paired
 * --custom migration (a bare column carries no FK), exactly as `devices.station_id`.
 *
 * Built SINGLE-WRITER-PER-ROW (memory: replication is shared infra; §4): the enqueuer owns creation,
 * the pulling path owns the `printing`→`done`/`failed` transition. Single-node venues work today; full
 * multi-node routing lands when app-level replication does. `app_user` holds SELECT/INSERT/UPDATE and
 * no DELETE (a job is a durable record). `.enableRLS()` emits only ENABLE; FORCE + the
 * `print_jobs_tenant_isolation` policy + the grant are hand-written in the --custom migration
 * (inmutabilidad requires FORCE on every tenant_id-bearing table).
 */
export const printJobs = pgTable(
  "print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The target printer. Bare column: the tenant-consistent (tenant_id, printer_id) → printers
    // composite FK is hand-written in the --custom migration.
    printerId: uuid("printer_id").notNull(),
    // OPAQUE ESC/POS bytes (Slice B fills them; the subsystem never inspects them).
    payload: bytea("payload").notNull(),
    status: printJobStatus("status").notNull().default("queued"),
    // Delivery attempt count, bumped by the agent's report path; drives bounded backoff.
    attempts: integer("attempts").notNull().default(0),
    // The last delivery failure message, for the dashboard's failing-printer surface. NULL until a failure.
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    // The claim LEASE anchor (failover-printing design §5, Gap 1). Stamped `now()` each time the agent
    // pull claims the row (queued/failed/lease-expired-printing → printing); NULL until first claimed
    // and while `queued`. The pull re-selects a `printing` row whose `claimed_at` is older than
    // PRINT_JOB_LEASE_MS (runtime.ts) — a visibility timeout that reclaims a job whose claimer died
    // mid-service instead of stranding it in `printing` forever. At-least-once by design (§5): a
    // reclaim may reprint a job that printed but lost its `done`.
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "string" }),
    // Set when the job reaches `done`. NULL while queued/printing/failed.
    deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: "string" }),
  },
  (t) => [
    // The agent's pull scan: the queued jobs for the agent's printers, keyed (tenant_id, printer_id,
    // status). tenant_id leads, matching the RLS predicate's leading column.
    index("print_jobs_pull_idx").on(t.tenantId, t.printerId, t.status),
  ],
).enableRLS();
