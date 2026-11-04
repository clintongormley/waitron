import "./errors.js";
import { and, eq, isNull } from "drizzle-orm";
import { deviceInvoiceRevisions, invoiceSeries, pagePrinters, printers, sales } from "@waitron/db";
import { persons, sessions, resolveManagementSession, roleHasPermission } from "@waitron/identity";
import { readPrinterEquipment } from "@waitron/layouts";
import { formatInvoiceNumber } from "@waitron/core";
import { currentBusinessDay, resolveVenueClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { assertDeviceStillProven, assertProfileAction } from "./device-session.js";
import { assertSubjectZones } from "./zone-access.js";
import { resolveTransactionScope } from "./find-bill-transactions.js";
import { readVisibleOrder } from "./orders-list.js";
import { readInvoiceDeliveries } from "./invoice-delivery-status.js";
import { canEmailInvoice } from "./invoice-email-contact.js";
import { readOfferedReceiptLanguages } from "./venue-locale.js";
import type { Transaction } from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import type {
  DeliveryContext,
  DocumentChoice,
  DocumentOffers,
  RoutingOrigin,
} from "@waitron/shared";
import type { TradingContext } from "./trading-context.js";
import type { DeviceProof } from "./device-session.js";
export type RoutingOriginSource = { current(): RoutingOrigin };
export type RoutingDeps = {
  backend: FiscalBackend;
  cfg: TradingContext;
  emailAvailable: boolean;
  originSource: RoutingOriginSource;
};
export type DeliveryAuthority =
  | { surface: "till"; sessionId: string; deviceProof: DeviceProof }
  | { surface: "dashboard"; managementSessionId: string; deviceProof: DeviceProof | null };
export type AuthorizedSale = {
  saleId: string;
  workingOrderId: string | null;
  personId: string;
  context: DeliveryContext;
};

export async function authorizeDocumentDelivery(
  tx: Transaction,
  deps: RoutingDeps,
  authority: DeliveryAuthority,
  saleId: string,
): Promise<AuthorizedSale> {
  let personId: string;
  let seesHistory = true;
  if (authority.surface === "till") {
    const [session] = await tx
      .select({ personId: persons.id, deviceId: sessions.deviceId })
      .from(sessions)
      .innerJoin(persons, eq(persons.id, sessions.personId))
      .where(
        and(
          eq(sessions.id, authority.sessionId),
          isNull(sessions.endedAt),
          eq(persons.status, "active"),
        ),
      );
    if (session === undefined || session.deviceId !== authority.deviceProof.device.deviceId)
      throw new AppError("session.not_open", { sessionId: authority.sessionId });
    personId = session.personId;
  } else {
    const session = await resolveManagementSession(tx, authority.managementSessionId, {
      touch: false,
    });
    personId = session.personId;
    seesHistory = roleHasPermission(session.role, "report.view");
  }
  const [sale] = await tx
    .select({ id: sales.id, workingOrderId: sales.workingOrderId })
    .from(sales)
    .where(eq(sales.id, saleId));
  if (sale === undefined) throw new AppError("sale.not_found", { saleId });
  if (!seesHistory) {
    const clock = await resolveVenueClock(tx, deps.cfg.nodeId);
    const today = currentBusinessDay(clock);
    await readVisibleOrder(tx, sale.workingOrderId ?? sale.id, {
      today: { from: today, to: today, ...clock },
    });
  }
  let context: DeliveryContext;
  if (authority.deviceProof === null) {
    context = { surface: "dashboard", deviceId: null, profileId: null };
  } else {
    const device = await assertDeviceStillProven(tx, authority.deviceProof);
    assertProfileAction(device, "print-receipt");
    const scope = await resolveTransactionScope(tx, saleId);
    await assertSubjectZones(
      tx,
      device.deviceProfileId,
      scope.workingOrderIds.map((orderId) => ({ orderId })),
    );
    context = {
      surface: authority.surface,
      deviceId: device.deviceId,
      profileId: device.deviceProfileId,
    };
  }
  return { saleId: sale.id, workingOrderId: sale.workingOrderId, personId, context };
}

export async function readDocumentOffers(
  tx: Transaction,
  deps: RoutingDeps,
  authority: DeliveryAuthority,
  saleId: string,
  document: DocumentChoice,
): Promise<DocumentOffers> {
  const authorized = await authorizeDocumentDelivery(tx, deps, authority, saleId);
  const [sale] = await tx
    .select({
      id: sales.id,
      recipient: sales.counterpartyTaxId,
      locale: sales.locale,
      code: invoiceSeries.code,
      number: sales.invoiceNumber,
    })
    .from(sales)
    .innerJoin(invoiceSeries, eq(invoiceSeries.id, sales.seriesId))
    .where(eq(sales.id, authorized.saleId));
  if (sale === undefined) throw new AppError("sale.not_found", { saleId });
  const full = sale.recipient !== null;
  if (!full && document !== "receipt")
    throw new AppError("management.request_invalid", { field: "document" });
  const thermal = await tx
    .select({ id: printers.id, name: printers.name })
    .from(printers)
    .where(eq(printers.active, true));
  const pages = await tx
    .select({ id: pagePrinters.id, name: pagePrinters.name })
    .from(pagePrinters)
    .where(eq(pagePrinters.active, true));
  if (pages.some((page) => thermal.some((printer) => printer.id === page.id)))
    throw new AppError("invoice_delivery.printer_invalid", {});
  let offered: DocumentOffers["printers"] = [
    ...thermal.map((printer) => ({ ...printer, kind: "receipt" as const })),
    ...pages.map((printer) => ({ ...printer, kind: "a4" as const })),
  ];
  let chosenPrinterId: string | null = null;
  let defaultPrinterId: string | null = null;
  let invoiceRevision: number | null = null;
  const deviceId = authorized.context.deviceId;
  if (deviceId !== null) {
    const equipment = await readPrinterEquipment(tx, [deviceId], { lists: true });
    const role = document === "invoice" ? "invoice" : "receipt";
    const state = equipment.roles.get(deviceId)!.find((candidate) => candidate.role === role)!;
    const allowed = new Set(
      equipment.listed
        .filter(
          (printer) =>
            printer.profileId === authorized.context.profileId &&
            printer.role === role &&
            printer.active,
        )
        .map((printer) => printer.id),
    );
    offered = offered.filter((printer) => {
      if (!allowed.has(printer.id)) return false;
      const info = equipment.printers.get(printer.id)!;
      return role === "invoice" || !info.portable || info.holderDeviceId === deviceId;
    });
    const eligible = (id: string | null) =>
      offered.some((printer) => printer.id === id) ? id : null;
    chosenPrinterId = role === "receipt" ? state.chosenId : eligible(state.chosenId);
    defaultPrinterId =
      role === "receipt" && state.chosenId !== null ? null : eligible(state.defaultId);
    const [revision] = await tx
      .select({ value: deviceInvoiceRevisions.revision })
      .from(deviceInvoiceRevisions)
      .where(eq(deviceInvoiceRevisions.deviceId, deviceId));
    invoiceRevision = revision?.value ?? 0;
  }
  offered.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  let emailAllowed = deps.emailAvailable;
  if (authority.surface === "dashboard") {
    const session = await resolveManagementSession(tx, authority.managementSessionId, {
      touch: false,
    });
    emailAllowed = emailAllowed && roleHasPermission(session.role, "report.export");
  }
  const state = full
    ? await readInvoiceDeliveries(tx, saleId, {
        emailAvailable: await canEmailInvoice(tx, saleId, emailAllowed),
        printers: async () => offered,
      })
    : null;
  const origin = deps.originSource.current();
  const languages = full
    ? [sale.locale]
    : [...new Set([sale.locale, ...(await readOfferedReceiptLanguages(tx))])];
  return {
    origin,
    applianceId: origin.applianceId,
    saleId: sale.id,
    invoiceType: full ? "F1" : "F2",
    invoiceNumber: formatInvoiceNumber(sale.code, sale.number),
    documents: full ? ["receipt", "invoice"] : ["receipt"],
    languages,
    language: sale.locale,
    context: authorized.context,
    designation: state?.originalCompleted === false ? "original" : "duplicate",
    printers: offered,
    chosenPrinterId,
    defaultPrinterId,
    invoiceRevision,
    actions: {
      print: full ? state!.actions.print !== null : offered.length > 0,
      email: state?.actions.email != null,
      replacesAttemptId: state?.actions.receiptInstead?.deliveryId ?? null,
      retryAttemptId: state?.actions.retryOriginal != null ? state.current!.id : null,
    },
  };
}
