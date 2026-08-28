// Counter-receipt / cash-drawer print-on-sale (design §3c) — the DB-facing half that turns a
// just-filed sale into the customer's receipt print job (and, for cash, the drawer kick + its audit
// row). It lives OUTSIDE till-sale.ts so that (already large) module gains only a call, not the whole
// receipt-building/printer-resolution body — the same split kitchen-print.ts makes from working-order.ts.
// Called from the shared filing tail `fileImmediateSale` (walk-up + retrieved pay + Mode-T collect) and
// from `collectOrder`'s Mode-I branch, on the caller's transaction, AFTER the sale is filed/settled and
// its `TillSaleResult` assembled — so every counter pay path prints identically and the enqueue rides the
// SAME tx (it commits with the sale, or rolls back with it; no second round trip).
//
// NEVER-BLOCK (CLAUDE.md §5): NOTHING may block a sale on anything but the sale itself, and printing is
// an outbox, never inline. Everything here is post-filing and INSERT-only — `enqueuePrintJob` is a pure
// outbox INSERT (it opens no socket, waits on no hardware), and the optional `drawer_opens` write is one
// more INSERT — so a slow, broken, or absent receipt printer can never delay or fail the sale. Because
// this runs INSIDE the sale tx, it must also THROW nothing on any reachable path (a throw would roll the
// filed sale back — the §5 violation this whole file exists to avoid). Two would-be throws are made
// unreachable rather than swallowed:
//   1. `enqueuePrintJob`'s `printer.not_found` (its only throw). The till's `receipt_printer_id` is a
//      real composite FK (tenant_id, receipt_printer_id) → printers, so a printer NAMED on the till
//      always exists — but existence is not ACTIVE-ness (`deactivatePrinter` flips `active = false`, never
//      deletes), and `enqueuePrintJob` rejects an inactive printer as `printer.not_found`. So the printer
//      read below FILTERS to `printers.active = true` (an inactive/absent printer resolves to "no printer"
//      → no enqueue, id never reaches `enqueuePrintJob`) AND takes a `FOR SHARE` row lock on the matched
//      `printers` row, so a concurrent `deactivatePrinter` UPDATE (which needs a conflicting lock) BLOCKS
//      until this sale tx commits — `active` cannot flip to false between this read and `enqueuePrintJob`'s
//      own READ-COMMITTED re-check. This is the identical guard `kitchen-print.ts` uses, proven by the
//      two-connection real-Postgres test in `kitchen-print.concurrency.test.ts`; the lock is symmetric, so
//      an admin deactivation in flight when the sale runs makes the SALE wait briefly (a bounded wait that
//      COMPLETES the sale, never an abort — §5 forbids a sale FAILING, not a sub-ms config lock wait).
//   2. `drawer_opens.person_id` is NOT NULL, so an INSERT with an absent operator would raise a
//      constraint violation and abort the sale. The drawer kick + its audit row are therefore recorded
//      ONLY when the operator identity is present (it always is on the real, session-guarded pay routes —
//      the parameter is optional only because the shared filing helpers thread it through generically);
//      an operator-less cash sale degrades to a plain receipt (no kick, no audit) rather than failing.
//
// This file THROWS no domain code of its own (the only throw on the path, `enqueuePrintJob`'s
// `printer.not_found`, is made unreachable by guard 1), so it needs no `import "./errors.js"`.
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
 * Auto-print the customer receipt for a just-filed counter sale, and — for a cash tender — append the
 * cash-drawer kick and record the drawer open (design §3c). Runs on the caller's `tx`, AFTER the sale is
 * filed/settled, so it commits atomically with the sale. Pure INSERTs; see the file header for the
 * never-block guarantee and why no path here can throw.
 *
 * The behaviour, all inside the tx (spec §3c):
 *  1. Read the location's `receipt_print_mode`. Only `auto` auto-prints; `on_request`/`never` enqueue
 *     nothing (the till reprints on demand — a later task).
 *  2. Read the till's ACTIVE `receipt_printer_id`. No printer set (or the named one is inactive) →
 *     enqueue nothing. The `FOR SHARE` lock + `active = true` filter keep `enqueuePrintJob`'s
 *     `printer.not_found` unreachable (header, guard 1).
 *  3. Build the receipt bytes from the filed `ticket` plus the issuer identity (`tenants` legal name +
 *     NIF, the same source `GET /api/till` prints) and the owner-authored header/footer trim
 *     (`getLayout`'s `receipt`), rendered in the FISCAL invoice locale (`cfg.locale`, NOT the operator
 *     UI language).
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

  // 2. The till's ACTIVE receipt printer. Joined `tills → printers` on the tenant-consistent
  //    (tenant_id, receipt_printer_id) key and filtered to `active = true`; `FOR SHARE OF printers`
  //    row-locks the matched printer so a concurrent `deactivatePrinter` cannot flip it inactive before
  //    `enqueuePrintJob`'s re-check (header, guard 1). A NULL `receipt_printer_id` (no printer set) or an
  //    inactive one yields no row → nothing to enqueue, and `printer.not_found` is never reached.
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
  if (printer === undefined) return;

  // 3. The issuer identity (art. 7.1.d) — venue legal name + NIF — from this till's own `tenants` row,
  //    the SAME source `GET /api/till`'s boot handler prints. `app_user` holds SELECT on `tenants` and
  //    RLS scopes it to this tenant, so the `eq(id)` filter returns exactly that row.
  const [issuer] = await tx
    .select({ venueName: tenants.legalName, nif: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, cfg.tenantId));
  /* v8 ignore start */
  if (issuer === undefined) {
    // Structurally unreachable: `cfg.tenantId` is this till's own tenant (provisioning stamped it), so
    // the row always exists and RLS returns it. Degrade to NOT printing rather than throwing — a throw
    // here would roll the filed sale back (§5). The boot handler treats the same absence as corruption.
    return;
  }
  /* v8 ignore stop */

  // The owner-authored non-fiscal header/footer trim, or the built-in default (`{}`) when the tenant has
  // never opened the editor — the same `getLayout` read the boot handler makes. Rendered in the FISCAL
  // invoice locale (`cfg.locale`), never the operator UI language.
  const { receipt } = await getLayout(tx, cfg.tenantId);
  const receiptBytes = formatReceipt({
    result: ticket,
    issuer,
    receipt,
    invoiceLocale: cfg.locale,
  });

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
