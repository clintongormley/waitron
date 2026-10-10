import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  drawerOpens,
  printers,
  printJobs,
  readTenant,
  sales,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { PRINTER_DELETED, canResendPrintJob, enqueuePrintJob, esc } from "@waitron/printing";
import type { EscSetting, PrintConfig } from "@waitron/printing";
import { getPrintedReceipt, profileAllows, readPrinterRoles } from "@waitron/layouts";
import type { ProfilePrinterRole } from "@waitron/layouts";
import { receiptLabelsFor } from "@waitron/country-packs";
import { readReceiptLanguage } from "@waitron/catalogue";
import { receiptLogoSource, resolveReceiptTrim } from "@waitron/shared";
import type { Origin } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { formatReceipt } from "./receipt-ticket.js";
import { optionalDocument } from "./optional-document.js";
import { reserveStagedInvoiceDelivery } from "./invoice-choice-delivery.js";
import { expireInvoiceDeliveryClaims, reserveInvoiceDelivery } from "./invoice-delivery.js";
import { VENUE_SERVICE } from "./modules.js";
import { readReceiptAddress } from "./venue-address.js";
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
  /** The device's profile permits `open-cash-drawer` (`profileAllows`). */
  opensDrawer: boolean;
}

/**
 * The device's active printer for a role, `undefined` for none. One lookup reads the device's
 * printers once, on first use, so it must not outlive a change to the device's equipment.
 */
export type PrinterLookup = (role: ProfilePrinterRole) => Promise<DevicePrinter | undefined>;

export function printerLookup(tx: Transaction, origin: Origin): PrinterLookup {
  let read: Promise<Map<ProfilePrinterRole, DevicePrinter>> | undefined;
  return async (role) => {
    read ??= readDevicePrinters(tx, origin);
    return (await read).get(role);
  };
}

/**
 * The device's drawer printer when it may open that drawer: its profile allows the drawer and the
 * printer has one. Otherwise `undefined`, and the automatic paths open nothing.
 */
async function drawerPrinter(printers: PrinterLookup): Promise<DevicePrinter | undefined> {
  const printer = await printers("cash_drawer");
  if (printer === undefined || !printer.opensDrawer || !printer.hasCashDrawer) return undefined;
  return printer;
}

/**
 * The printer the device's receipts resolve to (`readPrinterRoles`) when it is active; `undefined`
 * when it resolves to none, the printer is switched off, or the origin is a job rather than a
 * device. The caller decides what "no printer" means: the hooks enqueue nothing.
 */
export async function resolveReceiptPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return printerLookup(tx, origin)("receipt");
}

/**
 * As {@link resolveReceiptPrinter}, for the printer whose drawer the device opens: its own drawer
 * choice, else its profile's default, never its receipt printer.
 */
export async function resolveDrawerPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return printerLookup(tx, origin)("cash_drawer");
}

/** As {@link resolveReceiptPrinter}, for the device's payment slips. */
export async function resolvePaymentSlipPrinter(
  tx: Transaction,
  origin: Origin,
): Promise<DevicePrinter | undefined> {
  return printerLookup(tx, origin)("payment_slip");
}

/** Each role's printer, by role, when the device resolves one and it is switched on. */
async function readDevicePrinters(
  tx: Transaction,
  origin: Origin,
): Promise<Map<ProfilePrinterRole, DevicePrinter>> {
  if (origin.source !== "device") return new Map();
  const roles = await readPrinterRoles(tx, origin.deviceId);
  const ids = roles.flatMap((role) => (role.resolvedId === null ? [] : [role.resolvedId]));
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: printers.id,
      hasCashDrawer: printers.hasCashDrawer,
      paperWidth: printers.paperWidth,
      resolution: printers.resolution,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .innerJoin(printers, and(inArray(printers.id, ids), eq(printers.active, true)))
    .where(eq(devices.id, origin.deviceId));
  const byId = new Map(
    rows.map(({ formFactor, capabilities, ...printer }) => [
      printer.id,
      {
        ...printer,
        opensDrawer: profileAllows(
          { formFactor, capabilities: capabilities as string[] },
          "open-cash-drawer",
        ),
      },
    ]),
  );
  return new Map(
    roles.flatMap((role) => {
      const printer = role.resolvedId === null ? undefined : byId.get(role.resolvedId);
      return printer === undefined ? [] : [[role.role, printer] as const];
    }),
  );
}

/** Use the filed issuer where available and the current optional trim, address and logo. */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId" | "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
  language?: string,
): Promise<Uint8Array | undefined> {
  const taxpayer = await readTenant(tx);
  /* v8 ignore start */
  if (taxpayer === null) {
    return undefined;
  }
  /* v8 ignore stop */
  const diagnostic = (event: {
    operation: string;
    code: string;
    receiptId?: 1;
    departmentId?: string;
  }) => console.warn("receipt.optional_read_failed", event);
  const venue = await getPrintedReceipt(tx, printer.paperWidth, diagnostic);
  const venueAddress = await readReceiptAddress(tx, cfg.locationId, venue.receipt);
  const header = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  const departmentId = header?.departmentId ?? null;
  const current = await readReceiptLanguage(tx, cfg.locationId);
  const department =
    departmentId === null
      ? null
      : await VENUE_SERVICE.readPrintedDepartmentReceipt(
          tx,
          {
            ...cfg,
            receiptLanguages: [...new Set([language ?? ticket.locale, current.locale])],
            receiptDiagnostic: diagnostic,
          },
          departmentId,
          printer.paperWidth,
        );
  const authored = department?.receipt ?? null;
  const receipt = resolveReceiptTrim(
    authored,
    venue.receipt,
    language ?? ticket.locale,
    current.locale,
  );
  const logo =
    receiptLogoSource(authored, venue.receipt) === "department" ? department!.logo : venue.logo;
  const receiptHeader = departmentId === null ? undefined : (header ?? undefined);
  return formatReceipt({
    result: ticket,
    issuer: ticket.issuer ?? { venueName: taxpayer.legalName, nif: taxpayer.taxId },
    receipt,
    venueAddress,
    logo,
    receiptHeader,
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
  printers: PrinterLookup,
): Promise<{ printer: DevicePrinter; receiptBytes: Uint8Array } | undefined> {
  const printer = await printers("receipt");
  if (printer === undefined) return undefined;
  const receiptBytes = await buildReceiptBytes(tx, cfg, ticket, saleId, duplicate, printer);
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return undefined;
  /* v8 ignore stop */
  return { printer, receiptBytes };
}

/** Receipt policy applies to F2; an F1 follows its saved original delivery choice. */
export async function enqueueSaleReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  await optionalDocument(tx, "enqueueSaleReceipt", saleId, async () => {
    const [sale] = await tx
      .select({ workingOrderId: sales.workingOrderId, operatorId: sales.operatorId })
      .from(sales)
      .where(eq(sales.id, saleId));
    const context = sale?.workingOrderId
      ? await VENUE_SERVICE.findOrderContext(tx, cfg, sale.workingOrderId)
      : null;
    if (context?.serviceMode === "prepay") {
      await enqueueCollectionTicket(tx, cfg, context.zoneId, ticket.orderNumber, printers);
    }
    if ((await reserveStagedInvoiceDelivery(tx, saleId)) !== false) return;
    const mode = context
      ? (await VENUE_SERVICE.resolveSalePolicy(tx, cfg, context.zoneId)).receiptPrintMode
      : "auto";
    if (ticket.invoiceType !== "F1" && mode !== "auto") return;
    await enqueueOriginalReceipt(tx, cfg, ticket, saleId, printers, sale?.operatorId ?? null);
  });
}

/** A collection number is a separate document, never a fiscal receipt or a drawer command. */
export async function enqueueCollectionTicket(
  tx: Transaction,
  cfg: OriginConfig,
  zoneId: string,
  orderNumber: number,
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  const policy = await VENUE_SERVICE.resolveSalePolicy(tx, cfg, zoneId);
  if (policy.collectionNumber !== "numbered") return;
  const printer = await printers("receipt");
  if (printer === undefined) return;
  const builder = esc(printer);
  const bytes = builder
    .init()
    .printArea(builder.grid.widthDots)
    .align("center")
    .line(receiptLabelsFor(cfg.locale).order)
    .line(String(orderNumber))
    .feedAndCut()
    .bytes();
  await enqueuePrintJob(tx, printConfig(cfg), printer.id, bytes, "document");
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
  personId?: string,
): Promise<void> {
  const printer = await resolveReceiptPrinter(tx, cfg.origin);
  if (printer === undefined) return;
  await enqueueReceiptCopy(tx, cfg, ticket, saleId, printer, language, personId);
}

/** A receipt copy is a document job; the cash drawer has its own audited job. */
export async function enqueueReceiptCopy(
  tx: Transaction,
  cfg: Pick<TillConfig, "locationId" | "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  printer: { id: string } & EscSetting,
  language?: string,
  personId?: string,
): Promise<{ jobId: string } | undefined> {
  const bytes = await buildReceiptBytes(tx, cfg, ticket, saleId, true, printer, language);
  if (bytes === undefined) return undefined;
  const job = await enqueuePrintJob(tx, printConfig(cfg), printer.id, bytes, "document", {
    saleId,
    receiptCopy: true,
  });
  await enrollExplicitInvoiceReceipt(tx, ticket, saleId, job.jobId, personId);
  return job;
}

async function enrollExplicitInvoiceReceipt(
  tx: Transaction,
  ticket: TillSaleResult,
  saleId: string,
  jobId: string,
  personId: string | null | undefined,
): Promise<void> {
  if (ticket.invoiceType !== "F1" || personId === undefined) return;
  await expireInvoiceDeliveryClaims(tx);
  await reserveInvoiceDelivery(tx, saleId, {
    requestKey: jobId,
    personId,
    medium: "receipt",
    printJobId: jobId,
  });
}

/**
 * The audited manual drawer open: a `drawer_opens('manual')` row with no sale, and a kick-only job.
 * The caller has already resolved the printer.
 *
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

export type OriginalReceiptPrint =
  | { status: "not_queued" }
  | {
      status: "queued" | "printing" | "failed" | "done";
      jobId: string;
      canRetry: boolean;
      /** Only on a failed original: its printer was deleted, so it will never print there. */
      failureCode?: typeof PRINTER_DELETED;
      handover?: { personId: string; confirmedAt: string };
    };

/** Transport completion is not confirmation that the customer received the original. */
export async function readOriginalReceiptPrint(
  tx: Transaction,
  saleId: string,
): Promise<OriginalReceiptPrint> {
  const jobs = await tx
    .select({
      id: printJobs.id,
      status: printJobs.status,
      attempts: printJobs.attempts,
      kind: printJobs.kind,
      lastError: printJobs.lastError,
      handover: printJobs.receiptHandover,
      printerDeletedAt: printers.deletedAt,
    })
    .from(printJobs)
    .innerJoin(printers, eq(printers.id, printJobs.printerId))
    .where(
      and(
        eq(printJobs.saleId, saleId),
        eq(printJobs.receiptCopy, false),
        eq(printJobs.kind, "document"),
      ),
    )
    .orderBy(desc(sql`${printJobs}.rowid`));
  // A completed original attempt remains complete even if a later resend fails.
  const job = jobs.find((candidate) => candidate.status === "done") ?? jobs[0];
  if (job === undefined) return { status: "not_queued" };
  const handover = jobs.find((candidate) => candidate.handover !== null)?.handover;
  const targetDeleted = job.printerDeletedAt !== null;
  return {
    status: job.status,
    jobId: job.id,
    canRetry: job.status === "failed" && !targetDeleted && canResendPrintJob(job),
    ...(job.status === "failed" && targetDeleted ? { failureCode: PRINTER_DELETED } : {}),
    ...(handover == null ? {} : { handover }),
  };
}

export async function confirmReceiptHandover(
  tx: Transaction,
  saleId: string,
  personId: string,
): Promise<OriginalReceiptPrint> {
  const original = await readOriginalReceiptPrint(tx, saleId);
  if (original.status !== "done") throw new AppError("receipt.not_printed", {});
  if (original.handover !== undefined) return original;
  await tx
    .update(printJobs)
    .set({
      receiptHandover: { personId, confirmedAt: new Date().toISOString() },
    })
    .where(eq(printJobs.id, original.jobId));
  return readOriginalReceiptPrint(tx, saleId);
}

/** The issuance action emits an unmarked original without opening the drawer. */
export async function enqueueOriginalReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
  personId?: string | null,
): Promise<void> {
  if (ticket.invoiceType === "F1") {
    const [original] = await tx
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(and(eq(printJobs.saleId, saleId), eq(printJobs.receiptCopy, false)))
      .limit(1);
    // A failed original is retried through its existing job, preserving its bytes and history.
    if (original !== undefined) return;
  }
  const resolved = await resolvePrinterAndReceipt(tx, cfg, ticket, saleId, false, printers);
  if (resolved === undefined) return;
  const job = await enqueuePrintJob(
    tx,
    printConfig(cfg),
    resolved.printer.id,
    resolved.receiptBytes,
    "document",
    { saleId, receiptCopy: false },
  );
  await enrollExplicitInvoiceReceipt(tx, ticket, saleId, job.jobId, personId);
}

async function enqueueBillDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  billPaymentId: string,
  operatorId: string,
  reason: "bill_payment" | "bill_refund" | "card_slip",
  authorization: { authorizedBy: string; viaOverride: boolean } | null,
  printers: PrinterLookup,
): Promise<void> {
  const printer = await drawerPrinter(printers);
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
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  await enqueueBillDrawer(tx, cfg, billPaymentId, operatorId, "bill_payment", null, printers);
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
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  await enqueueBillDrawer(tx, cfg, billPaymentId, operatorId, "card_slip", null, printers);
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
  await enqueueBillDrawer(
    tx,
    cfg,
    billPaymentId,
    operatorId,
    "bill_refund",
    authorization,
    printerLookup(tx, cfg.origin),
  );
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
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  if (operatorId === undefined) return;
  const printer = await drawerPrinter(printers);
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
