// Receipt printing only enqueues bytes inside the caller's transaction. It opens no hardware
// connection. Printer resolution reads an active row, and the caller's write transaction is the only
// one running on the venue file, so a deactivation cannot land between that read and the enqueue.
// Originals and duplicates are separate actions; a queue resend preserves the original job bytes.
import { and, eq } from "drizzle-orm";
import { deviceProfiles, devices, drawerOpens, printers, readTenant, sales } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { enqueuePrintJob, esc } from "@waitron/printing";
import type { EscSetting, PrintConfig } from "@waitron/printing";
import { getReceipt } from "@waitron/layouts";
import type { Origin } from "@waitron/shared";
import { formatReceipt } from "./receipt-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import type { TillSaleResult } from "./till-sale.js";

/** Drawer commands are separate from documents, so printing and resending never open the drawer. */
export const DRAWER_KICK: Uint8Array = esc().kick().bytes();

function printConfig(cfg: Pick<TillConfig, "locationId">): PrintConfig {
  return { locationId: cfg.locationId };
}

/** One of a device's current printers, when active, and the settings it lays documents out for. */
export interface DevicePrinter extends EscSetting {
  id: string;
  hasCashDrawer: boolean;
  /** The device's profile has `open-cash-drawer`. */
  opensDrawer: boolean;
}

/**
 * The device's receipt printer when it may open that printer's drawer: its profile allows the
 * drawer and the printer has one. Otherwise `undefined`, and the automatic paths open nothing.
 */
async function drawerPrinter(tx: Transaction, origin: Origin): Promise<DevicePrinter | undefined> {
  const printer = await resolveReceiptPrinter(tx, origin);
  if (printer === undefined || !printer.opensDrawer || !printer.hasCashDrawer) return undefined;
  return printer;
}

/**
 * The device's current receipt printer when it is active; `undefined` when it has none, the printer
 * is switched off, or the origin is a job rather than a device. The caller decides what "no printer"
 * means: the hooks enqueue nothing, the drawer-open route throws `drawer.no_printer`.
 */
export async function resolveReceiptPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return resolveDevicePrinter(tx, origin, devices.receiptPrinterId);
}

/** As {@link resolveReceiptPrinter}, for the device's current payment slip printer. */
export async function resolvePaymentSlipPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return resolveDevicePrinter(tx, origin, devices.paymentSlipPrinterId);
}

async function resolveDevicePrinter(
  tx: Transaction,
  origin: Origin,
  column: typeof devices.receiptPrinterId | typeof devices.paymentSlipPrinterId,
): Promise<DevicePrinter | undefined> {
  if (origin.source !== "device") return undefined;
  const [row] = await tx
    .select({
      id: printers.id,
      hasCashDrawer: printers.hasCashDrawer,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .innerJoin(printers, and(eq(printers.id, column), eq(printers.active, true)))
    .where(eq(devices.id, origin.deviceId));
  if (row === undefined) return undefined;
  const { capabilities, ...printer } = row;
  return { ...printer, opensDrawer: (capabilities as string[]).includes("open-cash-drawer") };
}

/** Use the filed issuer where available and the current optional trim. */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: Pick<TillConfig, "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
  language?: string,
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
  const receiptHeader = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  return formatReceipt({
    result: ticket,
    issuer: ticket.issuer ?? { venueName: taxpayer.legalName, nif: taxpayer.taxId },
    receipt,
    receiptHeader: receiptHeader ?? undefined,
    invoiceLocale: language ?? ticket.locale,
    namesLocale: ticket.locale,
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
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
): Promise<{ printer: DevicePrinter; receiptBytes: Uint8Array } | undefined> {
  const printer = await resolveReceiptPrinter(tx, cfg.origin);
  if (printer === undefined) return undefined;
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket, saleId, duplicate, printer);
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return undefined;
  /* v8 ignore stop */
  return { printer, receiptBytes };
}

/** Unscoped sales default to automatic printing; a scoped sale follows its effective zone policy. */
export async function enqueueSaleReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
): Promise<void> {
  const [sale] = await tx
    .select({ workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  const context = sale?.workingOrderId
    ? await VENUE_SERVICE.findOrderContext(tx, cfg, sale.workingOrderId)
    : null;
  const mode = context
    ? (await VENUE_SERVICE.resolveSalePolicy(tx, cfg, context.zoneId)).receiptPrintMode
    : "auto";
  if (mode !== "auto") return;
  await enqueueOriginalReceipt(tx, cfg, ticket, saleId);
}

/**
 * The manual reprint of an already-filed sale: it files nothing, has no `receipt_print_mode` gate
 * (a reprint is always available), and never opens the drawer. No active printer means no job.
 * `language` puts the fixed words and the formatting in another receipt language; the caller has
 * checked it.
 */
export async function enqueueReceiptReprint(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  language?: string,
): Promise<void> {
  const printer = await resolveReceiptPrinter(tx, cfg.origin);
  if (printer === undefined) return;
  await enqueueReceiptCopy(tx, cfg, ticket, saleId, printer, language);
}

/** A receipt copy is a document job; the cash drawer has its own audited job. */
export async function enqueueReceiptCopy(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId" | "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  printer: { id: string } & EscSetting,
  language?: string,
): Promise<{ jobId: string } | undefined> {
  const bytes = await buildReceiptBytes(tx, cfg, ticket, saleId, true, printer, language);
  if (bytes === undefined) return undefined;
  return enqueuePrintJob(tx, printConfig(cfg), printer.id, bytes, "document", { saleId });
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
  cfg: OriginConfig,
  printerId: string,
  operatorId: string,
  authorizedBy: string | null,
  viaOverride: boolean,
): Promise<void> {
  await tx.insert(drawerOpens).values({
    deviceId: cfg.origin.deviceId,
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
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
): Promise<void> {
  const resolved = await resolvePrinterAndReceipt(tx, cfg, ticket, saleId, false);
  if (resolved === undefined) return;
  await enqueuePrintJob(
    tx,
    printConfig(cfg),
    resolved.printer.id,
    resolved.receiptBytes,
    "document",
    { saleId },
  );
}

async function enqueueBillDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  billPaymentId: string,
  operatorId: string,
  reason: "bill_payment" | "bill_refund" | "card_slip",
  authorization: { authorizedBy: string; viaOverride: boolean } | null,
): Promise<void> {
  const printer = await drawerPrinter(tx, cfg.origin);
  if (printer === undefined) return;
  await tx.insert(drawerOpens).values({
    deviceId: cfg.origin.deviceId,
    printerId: printer.id,
    personId: operatorId,
    reason,
    billPaymentId,
    ...(authorization ?? {}),
  });
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, DRAWER_KICK, "drawer");
}

/**
 * Cash taken against a bill before its invoice opens the drawer {@link drawerPrinter} finds, naming
 * the bill payment.
 */
export async function enqueueBillPaymentDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  billPaymentId: string,
  operatorId: string,
): Promise<void> {
  await enqueueBillDrawer(tx, cfg, billPaymentId, operatorId, "bill_payment", null);
}

/**
 * A hand-keyed card taken against a bill opens the drawer {@link drawerPrinter} finds, for its slip,
 * naming the bill payment, even when the payment issues the invoice.
 */
export async function enqueueBillCardSlipDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  billPaymentId: string,
  operatorId: string,
): Promise<void> {
  await enqueueBillDrawer(tx, cfg, billPaymentId, operatorId, "card_slip", null);
}

/**
 * Cash given back from a bill payment before the invoice opens the drawer {@link drawerPrinter}
 * finds, naming that payment and whoever authorised the refund.
 */
export async function enqueueBillRefundDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  billPaymentId: string,
  operatorId: string,
  authorization: { authorizedBy: string; viaOverride: boolean },
): Promise<void> {
  await enqueueBillDrawer(tx, cfg, billPaymentId, operatorId, "bill_refund", authorization);
}

/**
 * A sale paid in cash, or by a card hand-keyed on a machine Waitron does not talk to (whose slip is
 * kept in the drawer), opens the drawer {@link drawerPrinter} finds, independently of document
 * printing.
 */
export async function enqueueSaleDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  saleId: string,
  method: "cash" | "card",
  operatorId?: string,
): Promise<void> {
  if (operatorId === undefined) return;
  const printer = await drawerPrinter(tx, cfg.origin);
  if (printer === undefined) return;
  await tx.insert(drawerOpens).values({
    deviceId: cfg.origin.deviceId,
    printerId: printer.id,
    personId: operatorId,
    reason: method === "cash" ? "cash_sale" : "card_slip",
    saleId,
  });
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, DRAWER_KICK, "drawer");
}
