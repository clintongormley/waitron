// Side-effect only: keeps this package's `printer.*` codes (errors.ts) reachable from the file that
// throws them — the reachability convention every code-throwing file in the tree follows, guarded
// tree-wide by scripts/errors-reachable.test.ts. See errors.ts.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { printJobs, printers } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "./printers.js";

/**
 * Enqueue one outbox job (printing subsystem, §3b) — the NEVER-BLOCK guarantee (CLAUDE.md §5). This
 * is the WHOLE of what a caller (a fire, a sale, a test-print) does to print: a SINGLE DB write. It
 * opens no socket and waits on no hardware, so a slow, broken, or absent printer can never delay the
 * caller — the agent runtime (Task 5) moves the row through `printing`→`done`/`failed`
 * asynchronously. That INSERT-only shape is the never-block invariant, pinned by outbox.test.ts.
 *
 * Built SINGLE-WRITER-PER-ROW (memory: replication is shared infra; design §4): the enqueuer owns
 * creation, the pulling path owns the delivery transition.
 */
export async function enqueuePrintJob(
  tx: Transaction,
  cfg: PrintConfig,
  printerId: string,
  payload: Uint8Array,
): Promise<{ jobId: string }> {
  // A friendly `printer.not_found` for an absent printer, via a DB-only pre-check SELECT (indexed
  // PK lookup — no socket, no wait). Chosen over catching the FK violation because a raised 23503
  // would ABORT the caller's enclosing transaction (a fire/sale may enqueue mid-transaction),
  // whereas this pre-check leaves the tx clean on the not_found path. The explicit `tenant_id`
  // predicate limits the lookup to `cfg.tenantId`, the agent.ts shape; all values bind as `$n`,
  // never concatenated. `printerId` is not shape-screened here, and needs no screen of its own:
  // its sole caller — the test-print route (apps/server/src/print-api.ts's `/test-print` handler)
  // — validates the path param's uuid shape upstream with `requireUuidParam` before calling in,
  // so a malformed id never reaches this SELECT, and a well-formed-but-unknown id is resolved by
  // the pre-check below to `printer.not_found`.
  //
  // `active = true` treats a DEACTIVATED printer (`deactivatePrinter`) as unavailable to enqueue — an
  // inactive printer is not enqueueable, resolved to the existing `printer.not_found` rather than a new
  // edge code. It is the enqueue half of "deactivated = disabled"; the delivery half is the matching
  // `p.active = true` conjunct on `claimPrintJobs`'s pull (runtime.ts). Proven load-bearing by deletion
  // in outbox.test.ts.
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(
      and(
        eq(printers.tenantId, cfg.tenantId),
        eq(printers.id, printerId),
        eq(printers.active, true),
      ),
    );
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  // The single write: a `queued` outbox row carrying the OPAQUE payload bytes verbatim. `Buffer.from`
  // copies the Uint8Array into the Buffer the bytea customType binds (schema/print-jobs.ts).
  const [job] = await tx
    .insert(printJobs)
    .values({
      tenantId: cfg.tenantId,
      locationId: cfg.locationId,
      printerId,
      payload: Buffer.from(payload),
    })
    .returning({ id: printJobs.id });
  return { jobId: job!.id };
}
