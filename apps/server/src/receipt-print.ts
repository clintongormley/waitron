import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  receiptRollColumns,
  deviceProfiles,
  devices,
  drawerOpens,
  invoiceDeliveries,
  isReceiptPrinter,
  printers,
  printJobs,
  readTaxpayer,
  sales,
  tenderRefunds,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  MAX_DELIVERY_ATTEMPTS,
  PRINTER_DELETED,
  canResendPrintJob,
  enqueuePrintJob,
  esc,
} from "@waitron/printing";
import type { EscSetting } from "@waitron/printing";
import { profileAllows, readPrinterEquipment, readPrinterRoles } from "@waitron/layouts";
import type { ProfilePrinterRole } from "@waitron/layouts";
import { readKitchenLanguage } from "./kitchen-language.js";
import { formatOrderNumberSlip } from "./order-number-slip.js";
import { readReceiptLanguage } from "@waitron/menu";
import { deviceOrigin, resolveReceiptTrim } from "@waitron/shared";
import type { Origin } from "@waitron/shared";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { formatReceipt, type FormatReceiptInput } from "./receipt-ticket.js";
import { readPrintedGuests } from "./receipt-guests.js";
import { resolvePrintedLogo } from "./receipt-venue-logo.js";
import { optionalDocument } from "./optional-document.js";
import { reserveStagedInvoiceDelivery } from "./invoice-choice-delivery.js";
import {
  expireInvoiceDeliveryClaims,
  reserveInvoiceDelivery,
  type InvoiceDelivery,
} from "./invoice-delivery.js";
import { VENUE_SERVICE } from "./modules.js";
import { readReceiptAddress } from "./venue-address.js";
import type { OriginConfig, TradingContext } from "./trading-context.js";
import type { TillSaleResult } from "./till-sale.js";
import { readTransactionReceipt } from "./transaction-receipt.js";

/** Drawer commands are separate from documents, so printing and resending never open the drawer. */
export const DRAWER_KICK: Uint8Array = esc().kick().bytes();

/** The printers table's own default setting. */
export const DEFAULT_PRINTER: EscSetting = { paperWidth: "80mm", resolution: "180dpi" };

/** One of a device's current printers and the settings it lays documents out for. */
export interface DevicePrinter extends EscSetting {
  id: string;
  hasCashDrawer: boolean;
  /** The device's profile permits `open-cash-drawer` (`profileAllows`). */
  opensDrawer: boolean;
}

export type PrinterLookup = ((role: ProfilePrinterRole) => Promise<DevicePrinter | undefined>) & {
  /** It also resolves switched-off printers, so a job may be queued on the one it returns. */
  readonly whileSwitchedOff?: boolean;
};

/**
 * Do not reuse after changing the device's equipment: its role map is cached. `whileSwitchedOff`
 * also resolves a printer that is switched off, though never a deleted one.
 */
export function printerLookup(
  tx: Transaction,
  origin: Origin,
  { whileSwitchedOff = false }: { whileSwitchedOff?: boolean } = {},
): PrinterLookup {
  let read: Promise<Map<ProfilePrinterRole, DevicePrinter>> | undefined;
  const lookup = async (role: ProfilePrinterRole) => {
    read ??= readDevicePrinters(tx, origin, whileSwitchedOff);
    return (await read).get(role);
  };
  return Object.assign(lookup, { whileSwitchedOff });
}

/** Whether the device's profile allows `print-receipt`; false for a device that is not found. */
export async function deviceMayPrintReceipts(q: Transaction, deviceId: string): Promise<boolean> {
  const [profile] = await q
    .select({ formFactor: deviceProfiles.formFactor, capabilities: deviceProfiles.capabilities })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(eq(devices.id, deviceId));
  return (
    profile !== undefined &&
    profileAllows({ ...profile, capabilities: profile.capabilities as string[] }, "print-receipt")
  );
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

/** The device has a drawer it may open, by the same resolution the drawer paths use. */
export async function deviceOpensDrawer(tx: Transaction, deviceId: string): Promise<boolean> {
  return (await drawerPrinter(printerLookup(tx, deviceOrigin(deviceId)))) !== undefined;
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

/** A full invoice's printer: an A4 page printer or a receipt printer. */
export type InvoicePrinter = { kind: "a4" | "receipt"; id: string; name: string };

/**
 * The printer the device's full invoices resolve to: its own choice, else its profile's default.
 * `undefined` when it resolves to none, the printer is switched off, or the origin is not a device;
 * no other printer stands in.
 */
export async function resolveInvoicePrinter(
  tx: Transaction,
  origin: Origin,
): Promise<InvoicePrinter | undefined> {
  if (origin.source !== "device") return undefined;
  const equipment = await readPrinterEquipment(tx, [origin.deviceId], { lists: false });
  const role = equipment.roles.get(origin.deviceId)?.find((state) => state.role === "invoice");
  const printer = role?.resolvedId == null ? undefined : equipment.printers.get(role.resolvedId);
  if (printer === undefined || !printer.active) return undefined;
  return { kind: printer.kind, id: printer.id, name: printer.name };
}

/** Each role's printer, by role, when the device resolves one (see {@link printerLookup}). */
async function readDevicePrinters(
  tx: Transaction,
  origin: Origin,
  whileSwitchedOff: boolean,
): Promise<Map<ProfilePrinterRole, DevicePrinter>> {
  if (origin.source !== "device") return new Map();
  const roles = await readPrinterRoles(tx, origin.deviceId);
  const ids = roles.flatMap((role) => (role.resolvedId === null ? [] : [role.resolvedId]));
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: printers.id,
      hasCashDrawer: printers.hasCashDrawer,
      ...receiptRollColumns,
      formFactor: deviceProfiles.formFactor,
      capabilities: deviceProfiles.capabilities,
    })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .innerJoin(
      printers,
      and(
        isReceiptPrinter(),
        inArray(printers.id, ids),
        whileSwitchedOff ? isNull(printers.deletedAt) : eq(printers.active, true),
      ),
    )
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

/** The parts of a sale's receipt the venue prints today. */
export type PrintedVenue = Pick<FormatReceiptInput, "issuer" | "receipt" | "venueAddress" | "logo">;

/**
 * The taxpayer as issuer, and the current optional trim, address and logo of `departmentId` (none
 * for `null`) in `invoiceLocale`; a printer's test page uses all of it but the issuer.
 * `currentLocale` is the venue's receipt language, read here when not given. `undefined` when there
 * is no taxpayer.
 */
export async function readPrintedVenue(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  departmentId: string | null,
  printer: EscSetting,
  invoiceLocale: string,
  currentLocale?: string,
): Promise<PrintedVenue | undefined> {
  const taxpayer = await readTaxpayer(tx);
  if (taxpayer === null) {
    return undefined;
  }
  const diagnostic = (event: {
    operation: string;
    code: string;
    receiptId?: 1;
    departmentId?: string;
  }) => console.warn("receipt.optional_read_failed", event);
  const current = currentLocale ?? (await readReceiptLanguage(tx)).locale;
  const department =
    departmentId === null
      ? null
      : await VENUE_SERVICE.readPrintedDepartmentReceipt(
          tx,
          {
            ...cfg,
            receiptLanguages: [...new Set([invoiceLocale, current])],
            receiptDiagnostic: diagnostic,
          },
          departmentId,
          printer.paperWidth,
        );
  const { venue, logo } = await resolvePrintedLogo(tx, department, printer.paperWidth, diagnostic);
  const authored = department?.receipt ?? null;
  const receipt = resolveReceiptTrim(authored, venue, invoiceLocale, current);
  const venueAddress = await readReceiptAddress(tx, {
    printAddress: authored?.printAddress === true,
  });
  return {
    issuer: { venueName: taxpayer.legalName, nif: taxpayer.taxId },
    receipt,
    venueAddress,
    logo,
  };
}

/** Use the filed issuer where available and the current optional trim, address and logo. */
async function buildReceiptBytes(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
  language?: string,
): Promise<Uint8Array | undefined> {
  const header = await VENUE_SERVICE.readSaleReceiptHeader(tx, saleId);
  const departmentId = header?.departmentId ?? null;
  const invoiceLocale = language ?? ticket.locale;
  const venue = await readPrintedVenue(tx, cfg, departmentId, printer, invoiceLocale);
  /* v8 ignore start */
  if (venue === undefined) {
    return undefined;
  }
  /* v8 ignore stop */
  const receiptHeader = departmentId === null ? undefined : (header ?? undefined);
  const guests = await readPrintedGuests(tx, saleId);
  return formatReceipt({
    result: ticket,
    ...venue,
    issuer: ticket.issuer ?? venue.issuer,
    receiptHeader,
    invoiceLocale,
    namesLocale: ticket.namesLocale ?? ticket.locale,
    printer,
    simulated: cfg.practiceMode,
    simulatedCardPayment: ticket.simulatedCardPayment,
    duplicate,
    ...(guests === undefined ? {} : { guests }),
  });
}

/** `undefined` when `printers` resolves no receipt printer or the receipt cannot be built. */
async function resolvePrinterAndReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
  printers: PrinterLookup,
  language?: string,
): Promise<{ printer: DevicePrinter; receiptBytes: Uint8Array } | undefined> {
  const printer = await printers("receipt");
  if (printer === undefined) return undefined;
  const receiptBytes = await buildReceiptBytes(
    tx,
    cfg,
    ticket,
    saleId,
    duplicate,
    printer,
    language,
  );
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes); degrade, never throw (§5) */
  if (receiptBytes === undefined) return undefined;
  /* v8 ignore stop */
  return { printer, receiptBytes };
}

export async function enqueueSaleReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  printers: PrinterLookup = printerLookup(tx, cfg.origin),
): Promise<void> {
  await optionalDocument(tx, "enqueueSaleReceipt", saleId, async () => {
    const [sale] = await tx
      .select({ workingOrderId: sales.workingOrderId })
      .from(sales)
      .where(eq(sales.id, saleId));
    const context = sale?.workingOrderId
      ? await VENUE_SERVICE.findOrderContext(tx, sale.workingOrderId)
      : null;
    if (context?.serviceMode === "prepay") {
      await enqueueCollectionTicket(tx, cfg, context.zoneId, ticket.orderNumber, printers);
    }
    await reserveStagedInvoiceDelivery(tx, saleId);
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
  const policy = await VENUE_SERVICE.resolveSalePolicy(tx, zoneId);
  if (policy.collectionNumber !== "numbered") return;
  const printer = await printers("receipt");
  if (printer === undefined) return;
  const language = await readKitchenLanguage(tx);
  const bytes = formatOrderNumberSlip({ orderNumber, language }, printer);
  await enqueuePrintJob(tx, printer.id, bytes, "document");
}

export async function enqueueReceiptReprint(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  language?: string,
  personId?: string,
): Promise<void> {
  const printer = await resolveReceiptPrinter(tx, cfg.origin);
  if (printer === undefined) throw new AppError("receipt.no_printer", {});
  await enqueueReceiptCopy(tx, cfg, ticket, saleId, printer, language, personId);
}

/** A receipt copy is a document job; the cash drawer has its own audited job. */
export async function enqueueReceiptCopy(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  printer: { id: string } & EscSetting,
  language?: string,
  personId?: string,
): Promise<{ jobId: string } | undefined> {
  const bytes = await buildReceiptBytes(tx, cfg, ticket, saleId, true, printer, language);
  if (bytes === undefined) return undefined;
  const job = await enqueuePrintJob(tx, printer.id, bytes, "document", {
    saleId,
    receiptCopy: true,
  });
  await enrollExplicitInvoiceReceipt(tx, ticket, saleId, job.jobId, personId);
  return job;
}

export async function requireReceiptBytes(
  tx: Transaction,
  cfg: Pick<TradingContext, "practiceMode">,
  ticket: TillSaleResult,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
): Promise<Uint8Array> {
  const bytes = await buildReceiptBytes(tx, cfg, ticket, saleId, duplicate, printer);
  /* v8 ignore start -- issuer row structurally always present (buildReceiptBytes) */
  if (bytes === undefined) throw new Error("Cannot build a receipt without the taxpayer");
  /* v8 ignore stop */
  return bytes;
}

export type LayOutSaleReceipt = (
  tx: Transaction,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
) => Promise<Uint8Array>;

/** {@link layOutSaleReceipt} over `backend` and `cfg`. */
export function saleReceiptLayout(backend: FiscalBackend, cfg: TradingContext): LayOutSaleReceipt {
  return (tx, saleId, duplicate, printer) =>
    layOutSaleReceipt(backend, tx, cfg, saleId, duplicate, printer);
}

/** A filed sale's receipt laid out for `printer`, with today's trim, logo and address. */
export async function layOutSaleReceipt(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TradingContext,
  saleId: string,
  duplicate: boolean,
  printer: EscSetting,
): Promise<Uint8Array> {
  const ticket = await readTransactionReceipt(backend, tx, cfg, saleId);
  return requireReceiptBytes(tx, cfg, ticket, saleId, duplicate, printer);
}

/**
 * A full invoice printed on a receipt printer: an original or a duplicate as `designation` says,
 * as a document job, so it never opens the drawer, linked to a receipt delivery for `request`.
 */
export async function enqueueInvoiceReceipt(
  tx: Transaction,
  saleId: string,
  printerId: string,
  bytes: Uint8Array,
  designation: "original" | "duplicate",
  { requestKey, personId }: { requestKey?: string; personId: string },
): Promise<InvoiceDelivery> {
  const job = await enqueuePrintJob(tx, printerId, bytes, "document", {
    saleId,
    receiptCopy: designation === "duplicate",
  });
  return reserveInvoiceDelivery(tx, saleId, {
    requestKey: requestKey ?? job.jobId,
    personId,
    medium: "receipt",
    printJobId: job.jobId,
    printerChosen: true,
  });
}

async function enrollExplicitInvoiceReceipt(
  tx: Transaction,
  ticket: TillSaleResult,
  saleId: string,
  jobId: string,
  personId: string | null | undefined,
  requestKey = jobId,
): Promise<void> {
  if (ticket.invoiceType !== "F1" || personId === undefined) return;
  await expireInvoiceDeliveryClaims(tx);
  await reserveInvoiceDelivery(tx, saleId, {
    requestKey,
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
  await enqueuePrintJob(tx, printerId, DRAWER_KICK, "drawer");
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
  return (await readOriginalReceiptPrints(tx, [saleId])).get(saleId)!;
}

/** {@link readOriginalReceiptPrint} for several sales in one query. */
export async function readOriginalReceiptPrints(
  tx: Transaction,
  saleIds: readonly string[],
): Promise<Map<string, OriginalReceiptPrint>> {
  const rows = await tx
    .select({
      saleId: printJobs.saleId,
      id: printJobs.id,
      status: printJobs.status,
      attempts: printJobs.attempts,
      kind: printJobs.kind,
      lastError: printJobs.lastError,
      handedOverBy: printJobs.handedOverBy,
      handedOverAt: printJobs.handedOverAt,
      printerDeletedAt: printers.deletedAt,
    })
    .from(printJobs)
    .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
    .where(
      and(
        inArray(printJobs.saleId, [...saleIds]),
        eq(printJobs.receiptCopy, false),
        eq(printJobs.kind, "document"),
      ),
    )
    .orderBy(desc(sql`${printJobs}.rowid`));
  const bySale = new Map<string, typeof rows>();
  for (const row of rows) {
    const jobs = bySale.get(row.saleId!);
    if (jobs === undefined) bySale.set(row.saleId!, [row]);
    else jobs.push(row);
  }
  return new Map(saleIds.map((saleId) => [saleId, originalReceiptOf(bySale.get(saleId) ?? [])]));
}

/** `jobs` are one sale's original receipt jobs, newest first. */
function originalReceiptOf(
  jobs: readonly {
    id: string;
    status: "queued" | "printing" | "failed" | "done";
    attempts: number;
    kind: typeof printJobs.$inferSelect.kind;
    lastError: string | null;
    handedOverBy: string | null;
    handedOverAt: string | null;
    printerDeletedAt: string | null;
  }[],
): OriginalReceiptPrint {
  // A completed original attempt remains complete even if a later resend fails.
  const job = jobs.find((candidate) => candidate.status === "done") ?? jobs[0];
  if (job === undefined) return { status: "not_queued" };
  const handedOver = jobs.find((candidate) => candidate.handedOverBy !== null);
  const targetDeleted = job.printerDeletedAt !== null;
  return {
    status: job.status,
    jobId: job.id,
    canRetry: job.status === "failed" && !targetDeleted && canResendPrintJob(job),
    ...(job.status === "failed" && targetDeleted ? { failureCode: PRINTER_DELETED } : {}),
    ...(handedOver
      ? { handover: { personId: handedOver.handedOverBy!, confirmedAt: handedOver.handedOverAt! } }
      : {}),
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
      handedOverBy: personId,
      handedOverAt: new Date().toISOString(),
    })
    .where(eq(printJobs.id, original.jobId));
  return readOriginalReceiptPrint(tx, saleId);
}

async function hasOriginalReceiptJob(tx: Transaction, saleId: string): Promise<boolean> {
  const [original] = await tx
    .select({ id: printJobs.id })
    .from(printJobs)
    .where(and(eq(printJobs.saleId, saleId), eq(printJobs.receiptCopy, false)))
    .limit(1);
  return original !== undefined;
}

const waitingOriginal = and(
  eq(printJobs.kind, "document"),
  eq(printJobs.receiptCopy, false),
  eq(printJobs.status, "queued"),
  eq(printJobs.attempts, 0),
  isNull(printJobs.claimedAt),
);

/** The `last_error` of a waiting original {@link refreshWaitingOriginals} could not lay out again. */
export const RECEIPT_OUT_OF_DATE = "receipt.out_of_date";

/**
 * Lays out again each original receipt of the order's sale that no printer has taken or tried,
 * a resend included, so it lists every payment taken before it prints. One that cannot be laid out again gives up
 * where it waits, keeping any invoice delivery waiting on it, so its bytes never print and a
 * resend lays it out again.
 */
export async function refreshWaitingOriginals(
  backend: FiscalBackend,
  tx: Transaction,
  cfg: TradingContext,
  workingOrderId: string,
): Promise<void> {
  const waiting = await tx
    .select({ id: printJobs.id, saleId: sales.id, ...receiptRollColumns })
    .from(sales)
    .innerJoin(printJobs, and(eq(printJobs.saleId, sales.id), waitingOriginal))
    .innerJoin(printers, and(isReceiptPrinter(), eq(printers.id, printJobs.printerId)))
    .where(eq(sales.workingOrderId, workingOrderId));
  for (const job of waiting) {
    const laidOut = await optionalDocument(tx, "refreshWaitingOriginal", job.saleId, async () => {
      const payload = await layOutSaleReceipt(backend, tx, cfg, job.saleId, false, job);
      await tx
        .update(printJobs)
        .set({ payload })
        .where(and(eq(printJobs.id, job.id), waitingOriginal));
      return true;
    });
    if (laidOut === undefined)
      await tx
        .update(printJobs)
        .set({
          status: "failed",
          attempts: MAX_DELIVERY_ATTEMPTS,
          lastError: RECEIPT_OUT_OF_DATE,
          nextAttemptAt: null,
        })
        .where(and(eq(printJobs.id, job.id), waitingOriginal));
  }
}

/**
 * Queues the sale's original receipt on the receipt printer, and says what it did: `"exists"` when
 * the sale already has an original job, `"not_queued"` when no printer or receipt resolves, else the
 * queued job and whether it is marked a copy. A switched-off printer the lookup resolves
 * (`whileSwitchedOff`) is queued on, and the job waits until it is switched on.
 */
export async function enqueueOriginalReceipt(
  tx: Transaction,
  cfg: OriginConfig,
  ticket: TillSaleResult,
  saleId: string,
  options: {
    printers?: PrinterLookup;
    personId?: string | null;
    requestKey?: string;
    language?: string;
  } = {},
): Promise<"exists" | "not_queued" | { jobId: string; receiptCopy: boolean }> {
  const { personId, requestKey, language } = options;
  const printers = options.printers ?? printerLookup(tx, cfg.origin);
  // A failed original is retried through its existing job, keeping its history.
  if (await hasOriginalReceiptJob(tx, saleId)) return "exists";
  let duplicate = false;
  if (ticket.invoiceType !== "F1") {
    const emails = await tx
      .select({ status: invoiceDeliveries.status, designation: invoiceDeliveries.designation })
      .from(invoiceDeliveries)
      .where(and(eq(invoiceDeliveries.saleId, saleId), eq(invoiceDeliveries.medium, "email")));
    if (emails.some((email) => email.status === "queued" || email.status === "sending"))
      throw new AppError("invoice_delivery.active", {});
    duplicate = emails.some((email) => email.designation === "original" && email.status === "sent");
  }
  const resolved = await resolvePrinterAndReceipt(
    tx,
    cfg,
    ticket,
    saleId,
    duplicate,
    printers,
    language,
  );
  if (resolved === undefined) return "not_queued";
  const job = await enqueuePrintJob(tx, resolved.printer.id, resolved.receiptBytes, "document", {
    saleId,
    receiptCopy: duplicate,
    whileSwitchedOff: printers.whileSwitchedOff === true,
  });
  await enrollExplicitInvoiceReceipt(tx, ticket, saleId, job.jobId, personId, requestKey);
  return { jobId: job.jobId, receiptCopy: duplicate };
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
  await enqueuePrintJob(tx, printer.id, DRAWER_KICK, "drawer");
}

/**
 * Cash taken against a bill opens the drawer {@link drawerPrinter} finds, naming the bill payment.
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

export async function enqueueTenderRefundDrawer(
  tx: Transaction,
  cfg: OriginConfig,
  refundId: string,
  operatorId: string,
  authorization: { authorizedBy: string; viaOverride: boolean },
): Promise<void> {
  if (cfg.origin.source !== "device") return;
  const [refund] = await tx
    .select({ saleId: tenderRefunds.saleId })
    .from(tenderRefunds)
    .where(
      and(
        eq(tenderRefunds.id, refundId),
        eq(tenderRefunds.state, "completed"),
        eq(tenderRefunds.method, "cash"),
        eq(tenderRefunds.deviceId, cfg.origin.deviceId),
        eq(tenderRefunds.nodeId, cfg.nodeId),
      ),
    );
  if (refund === undefined) return;
  const [earlier] = await tx
    .select({ id: drawerOpens.id })
    .from(drawerOpens)
    .where(eq(drawerOpens.tenderRefundId, refundId));
  if (earlier !== undefined) return;
  const printer = await drawerPrinter(printerLookup(tx, cfg.origin));
  if (printer === undefined) return;
  await tx.insert(drawerOpens).values({
    deviceId: cfg.origin.deviceId,
    printerId: printer.id,
    personId: operatorId,
    saleId: refund.saleId,
    tenderRefundId: refundId,
    reason: "tender_refund",
    ...authorization,
  });
  await enqueuePrintJob(tx, printer.id, DRAWER_KICK, "drawer");
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
  await enqueuePrintJob(tx, printer.id, DRAWER_KICK, "drawer");
}
