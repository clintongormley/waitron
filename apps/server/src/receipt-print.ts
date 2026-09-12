// Receipt printing only enqueues bytes inside the caller's transaction. It opens no hardware
// connection. Printer resolution locks an active row through enqueue so deactivation cannot race it.
// Originals and duplicates are separate actions; a queue resend preserves the original job bytes.
import { and, eq } from "drizzle-orm";
import { drawerOpens, locations, printers, tenants, tills } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { getReceipt } from "@waitron/layouts";
import { formatReceipt } from "./receipt-ticket.js";
import type { TillConfig } from "./till-config.js";
import type { TillSaleResult } from "./till-sale.js";

/** Drawer commands are separate from documents, so printing and resending never open the drawer. */
export const DRAWER_KICK: Uint8Array = esc().kick().bytes();

/** The tenant + location scope `enqueuePrintJob` runs under — `TillConfig` carries both. */
function printConfig(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

/**
 * Resolve the calling till's ACTIVE receipt printer, or `undefined` when none applies (no printer set,
 * or the named one is inactive). Joined `tills → printers` on the tenant-consistent
 * (tenant_id, receipt_printer_id) key and filtered to `active = true`; `FOR SHARE OF printers` row-locks
 * the matched printer so a concurrent `deactivatePrinter` cannot flip it inactive before
 * `enqueuePrintJob`'s READ-COMMITTED re-check. Shared by all three consumers — the
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

/** Use the filed issuer where available, current optional trim, and the invoice locale. */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  duplicate: boolean,
): Promise<Uint8Array | undefined> {
  const [issuer] = await tx
    .select({ venueName: tenants.legalName, nif: tenants.taxId })
    .from(tenants)
    .where(eq(tenants.id, cfg.tenantId));
  /* v8 ignore start */
  if (issuer === undefined) {
    // Structurally unreachable: `cfg.tenantId` is this till's own tenant (provisioning stamped
    // it), so the row always exists and the by-id lookup returns it. Degrade to NOT printing
    // rather than throwing — a throw in the sale-tx hook would roll the filed sale back (§5). The
    // boot handler treats the same absence as corruption.
    return undefined;
  }
  /* v8 ignore stop */
  const receipt = await getReceipt(tx, cfg.tenantId);
  return formatReceipt({
    result: ticket,
    issuer: ticket.issuer ?? issuer,
    receipt,
    invoiceLocale: cfg.locale,
    simulated: cfg.practiceMode,
    duplicate,
  });
}

/**
 * Resolve BOTH inputs an enqueue path needs — the till's ACTIVE receipt printer and the built receipt
 * bytes — or `undefined` when EITHER guard trips: no active printer (nothing to print to), or an
 * unbuildable receipt (the structurally-unreachable missing-issuer degrade). Shared by the
 * print-on-sale hook and the reprint so the resolve → build order and its two early-returns live in one
 * place; each caller returns without enqueuing on `undefined`. `resolveReceiptPrinter` takes the
 * FOR SHARE printer lock and `buildReceiptBytes` degrades rather than throwing on the
 * missing-issuer path (§5) — both preserved here.
 */
async function resolvePrinterAndReceipt(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  duplicate: boolean,
): Promise<{ printer: { id: string }; receiptBytes: Uint8Array } | undefined> {
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined) return undefined;
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket, duplicate);
  /* v8 ignore next -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return undefined;
  return { printer, receiptBytes };
}

/** Automatic document printing follows the receipt setting and has no drawer side effects. */
export async function enqueueSaleReceipt(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
): Promise<void> {
  const [loc] = await tx
    .select({ mode: locations.receiptPrintMode })
    .from(locations)
    .where(and(eq(locations.tenantId, cfg.tenantId), eq(locations.id, cfg.locationId)));
  if (loc?.mode !== "auto") return;
  await enqueueOriginalReceipt(tx, cfg, ticket);
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
  const resolved = await resolvePrinterAndReceipt(tx, cfg, ticket, true);
  if (resolved === undefined) return;
  await enqueuePrintJob(tx, printConfig(cfg), resolved.printer.id, resolved.receiptBytes);
}

/**
 * Enqueue a KICK-ONLY job to `printerId` and record a manual drawer open (design §3d + cash-drawer-
 * authorization §3) — the audited `POST /api/drawer/open`. Pure INSERTs on the caller's tx: a
 * `drawer_opens('manual')` audit row (who/when, NO sale — a manual open is drawer accountability with
 * no attached sale) and the drawer-kick outbox job (no receipt, just the pulse). The caller
 * (`till-api.ts`) resolves the printer via `resolveReceiptPrinter` and throws `drawer.no_printer` when
 * there is none, so this helper is reached only with a real printer and throws nothing itself.
 *
 * `operatorId` (`person_id`) is who PERFORMED the open — the logged-in operator, always. `authorizedBy`
 * (`authorized_by`) is who AUTHORIZED it — the operator's own id under an `open` policy or a self-
 * authorizing supervisor, or the supervisor's id when a cashier opened via override — and `viaOverride`
 * records whether that authorization came through a supervisor override. Both are computed by the route
 * from `drawer_open_policy` + `authorize()`; this helper just persists them.
 */
export async function enqueueManualDrawerOpen(
  tx: Transaction,
  cfg: TillConfig,
  printerId: string,
  operatorId: string,
  authorizedBy: string | null,
  viaOverride: boolean,
): Promise<void> {
  await tx.insert(drawerOpens).values({
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    personId: operatorId,
    reason: "manual",
    authorizedBy,
    viaOverride,
  });
  await enqueuePrintJob(tx, printConfig(cfg), printerId, DRAWER_KICK, "drawer");
}

/** The issuance action emits an unmarked original without opening the drawer. */
export async function enqueueOriginalReceipt(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
): Promise<void> {
  const resolved = await resolvePrinterAndReceipt(tx, cfg, ticket, false);
  if (resolved === undefined) return;
  await enqueuePrintJob(tx, printConfig(cfg), resolved.printer.id, resolved.receiptBytes);
}

/** Cash collected at a till opens its drawer independently of document printing. */
export async function enqueueCashSaleDrawer(
  tx: Transaction,
  cfg: TillConfig,
  saleId: string,
  operatorId?: string,
): Promise<void> {
  if (operatorId === undefined || cfg.allowCashDrawer === false) return;
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined) return;
  await tx.insert(drawerOpens).values({
    tenantId: cfg.tenantId,
    tillId: cfg.tillId,
    personId: operatorId,
    reason: "cash_sale",
    saleId,
  });
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, DRAWER_KICK, "drawer");
}
