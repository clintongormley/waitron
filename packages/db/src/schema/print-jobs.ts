import { sql } from "drizzle-orm";
import { check, index } from "drizzle-orm/sqlite-core";
import {
  binary,
  count,
  enumCheck,
  enumType,
  id,
  label,
  newId,
  nowIso,
  table,
  tsString,
} from "./columns.js";
import { locations } from "./tenants.js";

/**
 * The lifecycle of one outbox job (§2c). `queued` (default) → the agent atomically claims it as
 * `printing` (a locking UPDATE … RETURNING, so two agent instances never double-print) → `done` on a
 * successful push, or `failed` (retried with bounded backoff). A closed vocabulary declared once
 * (`enumType`), matching the repo precedent.
 */
export const printJobStatus = enumType(["queued", "printing", "done", "failed"]);

/**
 * The print OUTBOX (§2c) — delivery decoupled from creation so a fire or a sale is NEVER blocked by a
 * printer (CLAUDE.md §5). `enqueuePrintJob` (a later task) is a single INSERT (`queued`) that opens no
 * socket and waits on no hardware; the agent runtime's pull→push→report loop moves the row through
 * `printing` → `done`/`failed` asynchronously. Any node (local or cloud) may enqueue; the agent that
 * pulls it delivers it.
 *
 * `payload` is OPAQUE bytes (`bytea`): Slice B fills it with ESC/POS, and this subsystem never
 * inspects them — it only moves bytes. `printer_id` is a BARE uuid whose
 * (printer_id) → printers (id) FK is hand-written in the paired
 * --custom migration (a bare column carries no FK), exactly as `devices.station_id`.
 */
export const printJobs = table(
  "print_jobs",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    locationId: id("location_id")
      .notNull()
      /* v8 ignore start */
      .references(() => locations.id, { onDelete: "restrict" }),
    /* v8 ignore stop */
    // The target printer. Bare column: the (printer_id) → printers
    // FK is hand-written in the --custom migration.
    printerId: id("printer_id").notNull(),
    // The agent currently holding this job (set on claim, overwritten by a lease reclaim). Bare
    // column: the (claimed_by) → print_agents FK is hand-written
    // in the --custom migration (MATCH SIMPLE skips it on NULL). Authorises the report — only the
    // claimer reports its own job (runtime.ts). NULL while queued and after the job leaves `printing`.
    claimedBy: id("claimed_by"),
    // OPAQUE ESC/POS bytes (Slice B fills them; the subsystem never inspects them). Bytes rather
    // than base64 text, so nothing sits between the caller and the row. A read THROUGH this column
    // hands back a `Uint8Array`, which is what `enqueuePrintJob` already passes in. The agent pull
    // (`claimPrintJobs` in packages/printing/src/runtime.ts) reads the same row with raw SQL, where
    // no column mapping runs at all and the driver's own value arrives instead.
    payload: binary("payload").notNull(),
    // Drawer pulses share transport delivery but cannot be repeated through document resend.
    kind: label("kind").$type<"document" | "drawer">().notNull().default("document"),
    status: printJobStatus("status").notNull().default("queued"),
    // Delivery attempt count, bumped by the agent's report path; drives bounded backoff.
    attempts: count("attempts").notNull().default(0),
    // The last delivery failure message, for the dashboard's failing-printer surface. NULL until a failure.
    lastError: label("last_error"),
    createdAt: tsString("created_at").notNull().$defaultFn(nowIso),
    // The claim LEASE anchor (failover-printing design §5, Gap 1). Stamped `now()` each time the agent
    // pull claims the row (queued/failed/lease-expired-printing → printing); NULL until first claimed
    // and while `queued`. The pull re-selects a `printing` row whose `claimed_at` is older than
    // PRINT_JOB_LEASE_MS (runtime.ts) — a visibility timeout that reclaims a job whose claimer died
    // mid-service instead of stranding it in `printing` forever. It ALSO reclaims a `printing` row whose
    // `claimed_at IS NULL` (anomalous — every real claim stamps it, so such a row is by definition not a
    // live claim): defense-in-depth so the lease's own guarantee cannot be defeated by a NULL comparison
    // being UNKNOWN. At-least-once by design (§5): a reclaim may reprint a job that printed but lost its
    // `done`.
    claimedAt: tsString("claimed_at"),
    // Set when the job reaches `done`. NULL while queued/printing/failed.
    deliveredAt: tsString("delivered_at"),
  },
  (t) => [
    index("print_jobs_pull_idx").on(t.printerId, t.status),
    check("print_jobs_kind_ck", sql`${t.kind} in ('document', 'drawer')`),
    check("print_jobs_status_ck", enumCheck(t.status)),
  ],
);
