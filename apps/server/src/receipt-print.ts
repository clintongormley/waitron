// Receipt printing only enqueues bytes inside the caller's transaction. It opens no hardware
// connection. Printer resolution reads an active row, and the caller's write transaction is the only
// one running on the venue file, so a deactivation cannot land between that read and the enqueue.
// Originals and duplicates are separate actions; a queue resend preserves the original job bytes.
import { and, eq } from "drizzle-orm";
import { drawerOpens, locations, printers, readTenant, tills } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { getReceipt } from "@waitron/layouts";
import { formatReceipt } from "./receipt-ticket.js";
import type { ReceiptPrinterSettings } from "./receipt-ticket.js";
import type { TillConfig } from "./till-config.js";
import type { TillSaleResult } from "./till-sale.js";

/** Drawer commands are separate from documents, so printing and resending never open the drawer. */
export const DRAWER_KICK: Uint8Array = esc().kick().bytes();

function printConfig(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

/** The till's active receipt printer and the settings its receipts are laid out for. */
export interface ReceiptPrinter extends ReceiptPrinterSettings {
  id: string;
  hasCashDrawer: boolean;
}

/**
 * The calling till's ACTIVE receipt printer, or `undefined` when none is set or it is inactive. The
 * caller decides what "no printer" means: the hooks enqueue nothing, the drawer-open route throws
 * `drawer.no_printer`.
 */
export async function resolveReceiptPrinter(
  tx: Transaction,
  cfg: TillConfig,
): Promise<ReceiptPrinter | undefined> {
  const [printer] = await tx
    .select({
      id: printers.id,
      hasCashDrawer: printers.hasCashDrawer,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      characterSet: printers.characterSet,
      characterTable: printers.characterTable,
    })
    .from(tills)
    .innerJoin(printers, and(eq(printers.id, tills.receiptPrinterId), eq(printers.active, true)))
    .where(eq(tills.id, cfg.tillId));
  return printer;
}

/** Use the filed issuer where available, current optional trim, and the invoice locale. */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  duplicate: boolean,
  printer: ReceiptPrinterSettings,
): Promise<Uint8Array | undefined> {
  const taxpayer = await readTenant(tx);
  /* v8 ignore start */
  if (taxpayer === null) {
    // Unreachable: provisioning writes the one taxpayer row. Degrade to not printing, because a
    // throw in the sale hook would roll the filed sale back (§5).
    return undefined;
  }
  /* v8 ignore stop */
  const receipt = await getReceipt(tx);
  return formatReceipt({
    result: ticket,
    issuer: ticket.issuer ?? { venueName: taxpayer.legalName, nif: taxpayer.taxId },
    receipt,
    invoiceLocale: cfg.locale,
    printer,
    simulated: cfg.practiceMode,
    duplicate,
  });
}

/**
 * `undefined` when there is no active printer or the receipt cannot be built; callers then enqueue
 * nothing.
 */
async function resolvePrinterAndReceipt(
  tx: Transaction,
  cfg: TillConfig,
  ticket: TillSaleResult,
  duplicate: boolean,
): Promise<{ printer: ReceiptPrinter; receiptBytes: Uint8Array } | undefined> {
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined) return undefined;
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket, duplicate, printer);
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return undefined;
  /* v8 ignore stop */
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
    .where(eq(locations.id, cfg.locationId));
  if (loc?.mode !== "auto") return;
  await enqueueOriginalReceipt(tx, cfg, ticket);
}

/**
 * The manual reprint of an already-filed sale: it files nothing, has no `receipt_print_mode` gate
 * (a reprint is always available), and never opens the drawer. No active printer means no job.
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
 * The audited manual drawer open: a `drawer_opens('manual')` row with no sale, and a kick-only job.
 * The caller has already resolved the printer.
 *
 * `operatorId` is who PERFORMED the open, always the logged-in operator. `authorizedBy` is who
 * AUTHORIZED it — the operator under an `open` policy or as a self-authorizing supervisor, else the
 * overriding supervisor — and `viaOverride` records whether a supervisor override supplied it. The
 * route computes both.
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
    tillId: cfg.tillId,
    printerId,
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

/** Cash collected at a till opens its attached drawer independently of document printing. */
export async function enqueueCashSaleDrawer(
  tx: Transaction,
  cfg: TillConfig,
  saleId: string,
  operatorId?: string,
): Promise<void> {
  if (operatorId === undefined || cfg.allowCashDrawer === false) return;
  const printer = await resolveReceiptPrinter(tx, cfg);
  if (printer === undefined || !printer.hasCashDrawer) return;
  await tx.insert(drawerOpens).values({
    tillId: cfg.tillId,
    printerId: printer.id,
    personId: operatorId,
    reason: "cash_sale",
    saleId,
  });
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, DRAWER_KICK, "drawer");
}
