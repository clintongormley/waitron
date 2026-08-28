// Counter-receipt / cash-drawer printing (design §3c/§3d) — the DB-facing half that turns a filed sale
// into the customer's receipt print job, plus the manual reprint + manual drawer-open the till's ticket
// screen drives. It lives OUTSIDE till-sale.ts so that (already large) module gains only a call, not the
// whole receipt-building/printer-resolution body — the same split kitchen-print.ts makes from
// working-order.ts. Three consumers share the SAME printer-resolution + receipt-build sourcing here (so a
// change to how the issuer/layout/printer are read touches one place):
//   - `enqueueSaleReceipt` (§3c) — the PRINT-ON-SALE hook, called from the shared filing tail
//     `fileImmediateSale` + `collectOrder`'s Mode-I branch on the caller's tx, AFTER the sale is
//     filed/settled: respects the location's `receipt_print_mode`, and for a cash tender appends the
//     drawer kick + records a `drawer_opens('cash_sale')`.
//   - `enqueueReceiptReprint` (§3d) — the MANUAL reprint, called by `POST /api/sales/:id/reprint` via
//     `till-sale.ts`'s `reprintSale` after it reads the already-filed ticket back: the SAME receipt
//     sourcing, but with NO mode gate (a reprint is always available, §0) and NO drawer kick.
//   - `enqueueManualDrawerOpen` (§3d) — the MANUAL, audited drawer-open, called by `POST /api/drawer/open`:
//     a kick-only job + a `drawer_opens('manual')` audit row.
//
// NEVER-BLOCK (CLAUDE.md §5): NOTHING may block a sale on anything but the sale itself, and printing is
// an outbox, never inline. Everything here is INSERT-only — `enqueuePrintJob` is a pure outbox INSERT (it
// opens no socket, waits on no hardware), and the `drawer_opens` writes are one more INSERT. The
// print-on-sale hook runs INSIDE the sale tx, so it must additionally THROW nothing on any reachable path
// (a throw would roll the filed sale back — the §5 violation). Two would-be throws are made unreachable
// rather than swallowed:
//   1. `enqueuePrintJob`'s `printer.not_found` (its only throw). The till's `receipt_printer_id` is a
//      real composite FK (tenant_id, receipt_printer_id) → printers, so a printer NAMED on the till
//      always exists — but existence is not ACTIVE-ness (`deactivatePrinter` flips `active = false`, never
//      deletes), and `enqueuePrintJob` rejects an inactive printer as `printer.not_found`. So
//      `resolveReceiptPrinter` FILTERS to `printers.active = true` (an inactive/absent printer resolves to
//      "no printer" → no enqueue, id never reaches `enqueuePrintJob`) AND takes a `FOR SHARE` row lock on
//      the matched `printers` row, so a concurrent `deactivatePrinter` UPDATE (which needs a conflicting
//      lock) BLOCKS until this tx commits — `active` cannot flip to false between this read and
//      `enqueuePrintJob`'s own READ-COMMITTED re-check. This is the identical guard `kitchen-print.ts`
//      uses, proven by the two-connection real-Postgres test in `kitchen-print.concurrency.test.ts`; the
//      lock is symmetric, so an admin deactivation in flight when the sale runs makes the SALE wait
//      briefly (a bounded wait that COMPLETES the sale, never an abort — §5 forbids a sale FAILING, not a
//      sub-ms config lock wait).
//   2. `drawer_opens.person_id` is NOT NULL, so an INSERT with an absent operator would raise a
//      constraint violation and abort the sale. The cash-sale kick + its audit row are therefore recorded
//      ONLY when the operator identity is present (it always is on the real, session-guarded pay routes —
//      the parameter is optional only because the shared filing helpers thread it through generically);
//      an operator-less cash sale degrades to a plain receipt (no kick, no audit) rather than failing.
//
// This file THROWS no domain code of its own — the only throw on the path, `enqueuePrintJob`'s
// `printer.not_found`, is made unreachable by guard 1, and the manual drawer-open's `drawer.no_printer`
// (raised when the till has no printer) is thrown at the ROUTE layer (till-api.ts, which imports
// errors.js), never here: `resolveReceiptPrinter` returns `undefined` and the route decides. So this file
// needs no `import "./errors.js"`.
import { and, eq } from "drizzle-orm";
import { drawerOpens, locations, printers, tenants, tills } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { getLayout } from "@waitron/layouts";
import { formatReceipt } from "./receipt-ticket.js";
import type { TillConfig } from "./till-config.js";
import type { TillSaleResult, TillTender } from "./till-sale.js";

/**
 * The cash-drawer pulse bytes (`ESC p 0 25 250`, Task 3's `esc().kick()`) appended after the receipt so
 * one job prints the ticket THEN opens the drawer. Built once at module load (the builder is pure).
 * Exported so the print-on-sale suite can assert the kick is present in (cash) / absent from (card) the
 * enqueued payload.
 */
export const DRAWER_KICK: Uint8Array = esc().kick().bytes();

/** The tenant + location scope `enqueuePrintJob` runs under — `TillConfig` carries both. */
function printConfig(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

/** Append the drawer-kick bytes to a receipt payload, returning a fresh array (one job: receipt → kick). */
function withDrawerKick(receipt: Uint8Array): Uint8Array {
  const out = new Uint8Array(receipt.length + DRAWER_KICK.length);
  out.set(receipt);
  out.set(DRAWER_KICK, receipt.length);
  return out;
}

/**
 * Resolve the calling till's ACTIVE receipt printer, or `undefined` when none applies (no printer set,
 * or the named one is inactive). Joined `tills → printers` on the tenant-consistent
 * (tenant_id, receipt_printer_id) key and filtered to `active = true`; `FOR SHARE OF printers` row-locks
 * the matched printer so a concurrent `deactivatePrinter` cannot flip it inactive before
 * `enqueuePrintJob`'s READ-COMMITTED re-check (header, guard 1). Shared by all three consumers — the
 * print-on-sale hook, the reprint, and the manual drawer-open — so the ONE place a till's printer is
 * resolved carries the lock + active filter, and the route/hook decides what "no printer" means (the
 * hooks enqueue nothing; the drawer-open route throws `drawer.no_printer`).
 */
export async function resolveReceiptPrinter(
  tx: Transaction,
  cfg: TillConfig,
): Promise<{ id: string } | undefined> {
  const [printer] = await tx
    .select({ id: printers.id })
    .from(tills)
    .innerJoin(
      printers,
      and(
        eq(printers.tenantId, tills.tenantId),
        eq(printers.id, tills.receiptPrinterId),
        eq(printers.active, true),
      ),
    )
    .where(and(eq(tills.tenantId, cfg.tenantId), eq(tills.id, cfg.tillId)))
    .for("share", { of: printers });
  return printer;
}

/**
 * Build the customer-receipt bytes for a filed `ticket`: the issuer identity (`tenants` legal name + NIF,
 * art. 7.1.d — the SAME source `GET /api/till`'s boot handler prints, RLS-scoped to this tenant), the
 * owner-authored header/footer trim (`getLayout`'s `receipt`, or the built-in default when the tenant has
 * never opened the editor), rendered in the FISCAL invoice locale (`cfg.locale`, NOT the operator UI
 * language). Shared by the print-on-sale hook and the reprint, so the mandated-element rendering lives in
 * one place. Returns `undefined` ONLY on the structurally-unreachable missing-issuer path (see below), so
 * a caller inside the sale tx degrades to no-print rather than throwing (§5).
 */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
): Promise<Uint8Array | undefined> {
  const [issuer] = await tx
    .select({ venueName: tenants.legalName, nif: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, cfg.tenantId));
  /* v8 ignore start */
  if (issuer === undefined) {
    // Structurally unreachable: `cfg.tenantId` is this till's own tenant (provisioning stamped it), so
    // the row always exists and RLS returns it. Degrade to NOT printing rather than throwing — a throw
    // in the sale-tx hook would roll the filed sale back (§5). The boot handler treats the same absence
    // as corruption.
    return undefined;
  }
  /* v8 ignore stop */
  const { receipt } = await getLayout(tx, cfg.tenantId);
  return formatReceipt({ result: ticket, issuer, receipt, invoiceLocale: cfg.locale });
}

/**
 * Auto-print the customer receipt for a just-filed counter sale, and — for a cash tender — append the
 * cash-drawer kick and record the drawer open (design §3c). Runs on the caller's `tx`, AFTER the sale is
 * filed/settled, so it commits atomically with the sale. Pure INSERTs; see the file header for the
 * never-block guarantee and why no path here can throw.
 *
 * The behaviour, all inside the tx (spec §3c):
 *  1. Read the location's `receipt_print_mode`. Only `auto` auto-prints; `on_request`/`never` enqueue
 *     nothing (the till reprints on demand — `enqueueReceiptReprint`).
 *  2. Resolve the till's ACTIVE receipt printer (`resolveReceiptPrinter`). None → enqueue nothing.
 *  3. Build the receipt bytes (`buildReceiptBytes`).
 *  4. Cash tender WITH a known operator → append the drawer kick to the payload and INSERT a
 *     `drawer_opens('cash_sale', saleId)` audit row (who/when/which sale). Card, or no operator, gets
 *     the receipt with no kick and no audit row.
 *  5. Enqueue the one payload (receipt, or receipt+kick) to the till's printer — a single outbox INSERT.
 *
 * `saleId` is the just-filed sale (the `drawer_opens.sale_id` back-reference); `operatorId` is the person
 * who rang the sale (the `drawer_opens.person_id`), present on every session-guarded pay route.
 */
export async function enqueueSaleReceipt(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  tender: TillTender,
  saleId: string,
  operatorId?: string,
): Promise<void> {
  // 1. `auto` mode only. Read from the till's own LOCATION (tenant-scoped beside RLS), the way
  //    `readOrderFlow`/the boot handler read location config. `on_request`/`never` → nothing to enqueue.
  const [loc] = await tx
    .select({ mode: locations.receiptPrintMode })
    .from(locations)
    .where(and(eq(locations.tenantId, cfg.tenantId), eq(locations.id, cfg.locationId)));
  /* v8 ignore next -- the till's own location always exists (RLS returns it); degrade to no-print, never abort the sale (§5) */
  if (loc === undefined) return;
  if (loc.mode !== "auto") return;

  // 2. The till's ACTIVE receipt printer (FOR SHARE-locked; header guard 1). No printer → nothing to enqueue.
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined) return;

  // 3. The receipt bytes (issuer + trim + fiscal-locale rendering).
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket);
  /* v8 ignore next -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return;

  // 4. Cash WITH a known operator → the drawer opens as the receipt prints: append the kick to the SAME
  //    payload and record the open. Card (no drawer) and the operator-less path (can't attribute the
  //    NOT-NULL `person_id`, header guard 2) both print the plain receipt with no kick and no audit row.
  let payload = receiptBytes;
  if (tender.method === "cash" && operatorId !== undefined) {
    payload = withDrawerKick(receiptBytes);
    await tx.insert(drawerOpens).values({
      tenantId: cfg.tenantId,
      tillId: cfg.tillId,
      personId: operatorId,
      reason: "cash_sale",
      saleId,
    });
  }

  // 5. The single outbox INSERT — a `queued` job the agent runtime delivers asynchronously. Opens no
  //    socket, waits on no hardware; `printer.id` came from the ACTIVE + FOR SHARE-locked read, so
  //    `enqueuePrintJob`'s `printer.not_found` pre-check cannot fire.
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, payload);
}

/**
 * Re-enqueue an ALREADY-FILED sale's customer receipt to the till's printer — the manual reprint (design
 * §3d), called by `POST /api/sales/:id/reprint` (via `till-sale.ts`'s `reprintSale`, which reads the
 * filed `ticket` back first). It re-renders and re-enqueues PAPER only: it files NOTHING (the caller read
 * the immutable record), has NO `receipt_print_mode` gate (a reprint is ALWAYS available, §0 — so it
 * works even under `on_request`/`never`), and NEVER opens the drawer (no kick, no `drawer_opens`). A till
 * with no active printer resolves to none and this is a no-op (nothing to print to) — the SAME
 * "no printer → enqueue nothing" degrade the print-on-sale hook makes and the kitchen-reprint route's
 * shape. Runs on the caller's tx; a single outbox INSERT.
 */
export async function enqueueReceiptReprint(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
): Promise<void> {
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined) return;
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket);
  /* v8 ignore next -- issuer row structurally always present (buildReceiptBytes); degrade, never throw */
  if (receiptBytes === undefined) return;
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, receiptBytes);
}

/**
 * Enqueue a KICK-ONLY job to `printerId` and record a manual drawer open (design §3d) — the audited
 * `POST /api/drawer/open`. Pure INSERTs on the caller's tx: a `drawer_opens('manual')` audit row
 * (who/when, NO sale — a manual open is drawer accountability with no attached sale) and the drawer-kick
 * outbox job (no receipt, just the pulse). The caller (`till-api.ts`) resolves the printer via
 * `resolveReceiptPrinter` and throws `drawer.no_printer` when there is none, so this helper is reached
 * only with a real printer and throws nothing itself.
 */
export async function enqueueManualDrawerOpen(
  tx: Transaction,
  cfg: TillConfig,
  printerId: string,
  operatorId: string,
): Promise<void> {
  await tx.insert(drawerOpens).values({
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    personId: operatorId,
    reason: "manual",
  });
  await enqueuePrintJob(tx, printConfig(cfg), printerId, DRAWER_KICK);
}
