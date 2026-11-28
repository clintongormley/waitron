import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { correctionTargetFor, formatInvoiceNumber } from "@waitron/core";
import {
  devices,
  invoiceDeliveries,
  invoiceSeries,
  isReceiptPrinter,
  printers,
  receiptRollColumns,
  sales,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  centsToDecimal,
  isUuid,
  isValidEmail,
  saleId as brandSaleId,
  type DocumentOffers,
} from "@waitron/shared";
import type { DeviceBinding } from "./device-session.js";
import { readOfferedPrinters } from "./document-printer-offers.js";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import {
  readInvoiceDeliveries,
  readOriginalWay,
  type InvoiceDeliveryAttempt,
  type OriginalWay,
} from "./invoice-delivery-status.js";
import { canEmailInvoice, type InvoiceEmailContactSource } from "./invoice-email-contact.js";
import type { InvoiceCorrectionDeps } from "./invoice-corrections.js";
import { optionalDocument } from "./optional-document.js";
import {
  deviceMayPrintReceipts,
  enqueueOriginalReceipt,
  printerLookup,
  resolveInvoicePrinter,
  resolveReceiptPrinter,
  type PrinterLookup,
} from "./receipt-print.js";
import { readTransactionReceipt } from "./transaction-receipt.js";
import type { DeviceRequestConfig } from "./trading-context.js";

const correctiveRequestKey = (correctionId: string) => `corrective:${correctionId}`;

/** How the invoice `targetId` went; for a replacement that never went out, how the invoice it
 * replaced went. */
async function readWayOf(tx: Transaction, targetId: string): Promise<OriginalWay | null> {
  const [target] = await tx
    .select({ corrects: sales.correctsSaleId, replaces: sales.replacesOriginal })
    .from(sales)
    .where(eq(sales.id, targetId));
  // A replacement is never itself replaced (packages/core/src/record-replacement.ts), so one
  // step back reaches the invoice it replaced.
  return (
    (await readOriginalWay(tx, targetId)) ??
    (target!.replaces ? await readOriginalWay(tx, target!.corrects!) : null)
  );
}

/** How the invoice `correctiveSaleId` corrects went, as {@link readWayOf}. */
async function readCorrectedWay(
  tx: Transaction,
  correctiveSaleId: string,
): Promise<OriginalWay | null> {
  const [corrective] = await tx
    .select({ corrects: sales.correctsSaleId })
    .from(sales)
    .where(eq(sales.id, correctiveSaleId));
  return readWayOf(tx, corrective!.corrects!);
}

/** Where a corrective full invoice goes. */
export type CorrectiveWay =
  | { medium: "email"; recipient: string }
  | { medium: "a4"; printerId: string; printerName: string }
  | { medium: "receipt"; printerId: string; printerName: string };

/** The way staff chose on the give-back form; checked by {@link checkCorrectiveDelivery}. */
export type CorrectiveDelivery =
  { medium: "print"; printerId: string } | { medium: "email"; recipient: string };

/**
 * The way a corrective full invoice of the invoice `targetId` goes when nobody chooses: by email to
 * the address that invoice went to (for a replacement that never went out, the invoice it replaced)
 * when this box can email the invoice now (`emailSource`, `emailAvailable`, asked only then); on
 * `cfg`'s device's own A4 printer when that way was A4 and the device has one; otherwise on the
 * device's receipt printer when its profile may print receipts. Null when none of these is there.
 */
async function defaultCorrectiveWay(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  targetId: string,
  emailSource: InvoiceEmailContactSource,
  emailAvailable: () => Promise<boolean>,
): Promise<CorrectiveWay | null> {
  const way = await readWayOf(tx, targetId);
  if (
    way?.medium === "email" &&
    way.recipient !== null &&
    (await canEmailInvoice(tx, emailSource, await emailAvailable()))
  )
    return { medium: "email", recipient: way.recipient };
  if (way?.medium === "a4") {
    const printer = await resolveInvoicePrinter(tx, cfg.origin);
    if (printer?.kind === "a4")
      return { medium: "a4", printerId: printer.id, printerName: printer.name };
  }
  if (!(await deviceMayPrintReceipts(tx, cfg.origin.deviceId))) return null;
  const receipt = await resolveReceiptPrinter(tx, cfg.origin);
  if (receipt === undefined) return null;
  const [named] = await tx
    .select({ name: printers.name })
    .from(printers)
    .where(and(isReceiptPrinter(), eq(printers.id, receipt.id)));
  return { medium: "receipt", printerId: receipt.id, printerName: named!.name };
}

/** What the give-back form offers for the corrective full invoice of `originalSaleId`. */
export interface CorrectiveChoice {
  /** The way it goes unless staff choose another; the email address is null on a device that may
   * not print receipts, as the till's delivery read hides it. */
  default:
    | { medium: "email"; recipient: string | null }
    | Exclude<CorrectiveWay, { medium: "email" }>
    | null;
  /** The printers Find a bill offers this device for a full invoice, the default's first. */
  printers: DocumentOffers["printers"];
  /** Whether staff may choose email now. */
  emailAvailable: boolean;
  /** This box can send invoice email, but the invoice has no receipt contact address, which an
   * invoice email needs. */
  emailNeedsReceiptContact: boolean;
}

/** Whether this box can send invoice email now; a failed read counts as no, so email is then
 * neither offered nor sent. */
async function emailTransportNow(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "invoiceEmailAvailable">,
): Promise<boolean> {
  try {
    return (await deps.invoiceEmailAvailable?.(tx)) === true;
  } catch {
    return false;
  }
}

/** What `device` may choose among for a corrective whose email contact `contactSaleId` gives. */
async function readCorrectiveOffers(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "invoiceEmailAvailable">,
  device: Pick<DeviceBinding, "deviceId" | "deviceProfileId">,
  contactSaleId: string,
): Promise<{ mayPrint: boolean } & Omit<CorrectiveChoice, "default">> {
  const mayPrint = await deviceMayPrintReceipts(tx, device.deviceId);
  if (!mayPrint)
    return { mayPrint, printers: [], emailAvailable: false, emailNeedsReceiptContact: false };
  const offered = await readOfferedPrinters(
    tx,
    { deviceId: device.deviceId, profileId: device.deviceProfileId },
    "invoice",
  );
  const transport = await emailTransportNow(tx, deps);
  const emailAvailable = await canEmailInvoice(
    tx,
    { kind: "sale", saleId: contactSaleId },
    transport,
  );
  return {
    mayPrint,
    printers: offered.printers,
    emailAvailable,
    emailNeedsReceiptContact: transport && !emailAvailable,
  };
}

/** The give-back form's corrective block for a give-back on `originalSaleId` from `device`. */
export async function readCorrectiveChoice(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "invoiceEmailAvailable">,
  cfg: DeviceRequestConfig,
  device: DeviceBinding,
  originalSaleId: string,
): Promise<CorrectiveChoice> {
  const offers = await readCorrectiveOffers(tx, deps, device, originalSaleId);
  const way = await defaultCorrectiveWay(
    tx,
    cfg,
    await correctionTargetFor(tx, brandSaleId(originalSaleId)),
    { kind: "sale", saleId: originalSaleId },
    () => emailTransportNow(tx, deps),
  );
  const first = way !== null && way.medium !== "email" ? way.printerId : null;
  return {
    default:
      way?.medium === "email" && !offers.mayPrint ? { medium: "email", recipient: null } : way,
    printers: [
      ...offers.printers.filter((printer) => printer.id === first),
      ...offers.printers.filter((printer) => printer.id !== first),
    ],
    emailAvailable: offers.emailAvailable,
    emailNeedsReceiptContact: offers.emailNeedsReceiptContact,
  };
}

function refuseChoice(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

/** `value` as a {@link CorrectiveDelivery}, refusing the first field that is not one. */
export function parseCorrectiveDelivery(value: unknown): CorrectiveDelivery {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    refuseChoice("correctiveDelivery");
  const given = value as Record<string, unknown>;
  if (given.medium === "print") {
    if (typeof given.printerId !== "string" || !isUuid(given.printerId))
      refuseChoice("correctiveDelivery.printerId");
    return { medium: "print", printerId: given.printerId.toLowerCase() };
  }
  if (given.medium !== "email") refuseChoice("correctiveDelivery.medium");
  if (typeof given.recipient !== "string" || !isValidEmail(given.recipient))
    refuseChoice("correctiveDelivery.recipient");
  return { medium: "email", recipient: given.recipient.trim() };
}

/** Refuses `chosen` unless `device` is offered it now for a corrective whose email contact
 * `contactSaleId` gives. */
export async function checkCorrectiveDelivery(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "invoiceEmailAvailable">,
  device: Pick<DeviceBinding, "deviceId" | "deviceProfileId">,
  contactSaleId: string,
  chosen: CorrectiveDelivery,
): Promise<void> {
  const offers = await readCorrectiveOffers(tx, deps, device, contactSaleId);
  if (chosen.medium === "email") {
    if (!offers.emailAvailable)
      throw new AppError("invoice_delivery.email_unavailable", {
        field: "correctiveDelivery.recipient",
      });
    return;
  }
  if (!offers.printers.some((printer) => printer.id === chosen.printerId))
    throw new AppError("invoice_delivery.printer_invalid", {
      field: "correctiveDelivery.printerId",
    });
}

/** The receipt printer `printerId` as the receipt path lays a document out for it, while it is an
 * active receipt printer. */
function receiptPrinterLookup(tx: Transaction, cfg: DeviceRequestConfig, printerId: string) {
  const fallback = printerLookup(tx, cfg.origin);
  return Object.assign(
    async (role: Parameters<PrinterLookup>[0], includeSwitchedOff?: boolean) => {
      if (role !== "receipt") return fallback(role, includeSwitchedOff);
      const [printer] = await tx
        .select({ id: printers.id, hasCashDrawer: printers.hasCashDrawer, ...receiptRollColumns })
        .from(printers)
        .where(
          and(
            isReceiptPrinter(),
            eq(printers.id, printerId),
            eq(printers.active, true),
            isNull(printers.deletedAt),
          ),
        );
      return printer === undefined ? undefined : { ...printer, opensDrawer: false };
    },
    { whileSwitchedOff: false },
  ) satisfies PrinterLookup;
}

/**
 * Sends the corrective full invoice `correctiveSaleId` (request key `corrective:<correction id>`),
 * under the person who opened the correction: the way `chosen` on the give-back form while `cfg`'s
 * device is still offered it ({@link checkCorrectiveDelivery}), else nothing; with no choice, the
 * way {@link defaultCorrectiveWay} gives. A failure to send leaves the filing as it is.
 */
export async function sendFiledCorrective(
  tx: Transaction,
  deps: Pick<InvoiceCorrectionDeps, "backend" | "invoiceEmailAvailable">,
  cfg: DeviceRequestConfig,
  correction: { id: string; requestedBy: string },
  correctiveSaleId: string,
  chosen?: CorrectiveDelivery,
): Promise<void> {
  await optionalDocument(tx, "sendFiledCorrective", correctiveSaleId, async () => {
    const requestKey = correctiveRequestKey(correction.id);
    const personId = correction.requestedBy;
    let way: CorrectiveWay | { medium: "receipt"; printerId: string | null } | null;
    if (chosen !== undefined) {
      const [device] = await tx
        .select({ deviceId: devices.id, deviceProfileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, cfg.origin.deviceId));
      await checkCorrectiveDelivery(tx, deps, device!, correctiveSaleId, chosen);
    }
    if (chosen?.medium === "email") way = chosen;
    else if (chosen?.medium === "print") {
      const [printer] = await tx
        .select({ kind: printers.kind, name: printers.name })
        .from(printers)
        .where(eq(printers.id, chosen.printerId));
      way =
        printer?.kind === "a4"
          ? { medium: "a4", printerId: chosen.printerId, printerName: printer.name }
          : { medium: "receipt", printerId: chosen.printerId };
    } else {
      const [corrective] = await tx
        .select({ corrects: sales.correctsSaleId })
        .from(sales)
        .where(eq(sales.id, correctiveSaleId));
      way = await defaultCorrectiveWay(
        tx,
        cfg,
        corrective!.corrects!,
        { kind: "sale", saleId: correctiveSaleId },
        () => emailTransportNow(tx, deps),
      );
      if (way?.medium === "receipt") way = { medium: "receipt", printerId: null };
    }
    if (way === null) return;
    if (way.medium === "email") {
      await reserveInvoiceDelivery(tx, correctiveSaleId, {
        requestKey,
        personId,
        medium: "email",
        recipient: way.recipient,
      });
      return;
    }
    if (way.medium === "a4") {
      await reserveInvoiceDelivery(tx, correctiveSaleId, {
        requestKey,
        personId,
        medium: "a4",
        pagePrinterId: way.printerId,
      });
      return;
    }
    await enqueueOriginalReceipt(
      tx,
      cfg,
      await readTransactionReceipt(deps.backend, tx, cfg, correctiveSaleId),
      correctiveSaleId,
      {
        personId,
        requestKey,
        ...(way.printerId === null
          ? {}
          : { printers: receiptPrinterLookup(tx, cfg, way.printerId), printerChosen: true }),
      },
    );
  });
}

/** A filed corrective full invoice as a give-back's answer shows it. */
export interface SentCorrective {
  saleId: string;
  invoiceNumber: string;
  customerName: string | null;
  /** The money it takes off the invoice, as a positive amount. */
  amount: string;
  /** How it is being sent, in the till's delivery-status shape; null when nothing was sent. */
  delivery: InvoiceDeliveryAttempt | null;
  /** The invoice it corrects went on A4, and the send recorded when it was filed put it on the
   * till's receipt printer without staff choosing that printer. */
  printedOnReceiptNotA4: boolean;
}

/** The corrective `correctiveSaleId` that correction `correctionId` filed, when it is a full
 * invoice's, else null. The recipient's email is shown only to a device that may print receipts,
 * as the till's delivery read does. */
export async function readSentCorrective(
  tx: Transaction,
  cfg: DeviceRequestConfig,
  correctionId: string,
  correctiveSaleId: string,
): Promise<SentCorrective | null> {
  const [sale] = await tx
    .select({
      customerTaxId: sales.counterpartyTaxId,
      customerName: sales.counterpartyLegalName,
      total: sales.total,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, correctiveSaleId));
  if (sale === undefined || sale.customerTaxId === null) return null;
  const status = await readInvoiceDeliveries(tx, correctiveSaleId, {
    emailAvailable: false,
    includeInvoiceRecipientEmail: await deviceMayPrintReceipts(tx, cfg.origin.deviceId),
  });
  const delivery = status?.current ?? null;
  const [sentWhenFiled] = await tx
    .select({ medium: invoiceDeliveries.medium, printerChosen: invoiceDeliveries.printerChosen })
    .from(invoiceDeliveries)
    .where(
      and(
        eq(invoiceDeliveries.saleId, correctiveSaleId),
        eq(invoiceDeliveries.requestKey, correctiveRequestKey(correctionId)),
      ),
    );
  return {
    saleId: correctiveSaleId,
    invoiceNumber: formatInvoiceNumber(sale.code, sale.number),
    customerName: sale.customerName,
    amount: centsToDecimal(-sale.total),
    delivery,
    printedOnReceiptNotA4:
      sentWhenFiled?.medium === "receipt" &&
      !sentWhenFiled.printerChosen &&
      (await readCorrectedWay(tx, correctiveSaleId))?.medium === "a4",
  };
}
