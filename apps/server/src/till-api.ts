import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq, inArray } from "drizzle-orm";
import {
  AppError,
  isAppError,
  isValidGuestCount,
  SUPPORTED_LOCALES,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { FloorAnnotator } from "@waitron/module";
import {
  locations,
  newId,
  readNodeMembership,
  readTenant,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorize,
  authorizeManager,
  checkPin,
  createPinThrottle,
  endSession,
  listActivePersonsWithPermission,
  listActiveStaff,
  listStaffAdmittedTo,
  loginWithPin,
  permissionsForRole,
  setPersonLocale,
  withPassiveManagementRead,
} from "@waitron/identity";
import type { PinAttempts, PinThrottle } from "@waitron/identity";
import {
  listAccessibleCatalogues,
  listAvailableProducts,
  readReceiptLanguage,
} from "@waitron/catalogue";
import {
  getReceipt,
  getCanvas,
  getCanvasForFormFactor,
  getDeviceProfile,
  readProfileStartingScreen,
  kindOfFormFactor,
} from "@waitron/layouts";
import type { CanvasDef, CapabilityFlag, NavigationScreen, ProfileAction } from "@waitron/layouts";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { CardProviderContribution, PaymentProvider } from "@waitron/payments";
import {
  cardProviderById,
  cardReaders,
  deviceCardReaders,
  DEMO_READER_ID,
  DEMO_READER_REF,
  SimulatorPaymentProvider,
} from "@waitron/payments";
import { resendPrintJob } from "@waitron/printing";
import { tenantCredentials } from "@waitron/credentials";
import { routableServers } from "@waitron/membership";
import { createErrorBoundary, requireManagementSession } from "@waitron/server-kit";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { listWatcherQueue, markWatcherItems } from "./watcher-board.js";
import { listWatchers } from "./watchers.js";
import { parseWatcherDoneBody } from "./watcher-done-body.js";
import type { Logger } from "./logger.js";
import type { OnboardingIntent } from "./trading-config.js";
import { VENUE_SERVICE } from "./modules.js";
import type { OriginConfig, TillConfig } from "./till-config.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { moveDishesToStation } from "./station-move.js";
import { madeHereAnswer, sendingCfg } from "./made-here.js";
import { requestCfg } from "./request-config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import {
  collectOrder,
  payWorkingOrderIntegrated,
  recordTillSale,
  readSettledTicket,
  reprintSale,
  printSaleReceipt,
} from "./till-sale.js";
import type { IntegratedPayRequest, TillSaleRequest, TillTender } from "./till-sale.js";
import {
  enqueueManualDrawerOpen,
  confirmReceiptHandover,
  readOriginalReceiptPrint,
  resolveReceiptPrinter,
} from "./receipt-print.js";
import {
  clearPlacement,
  listServiceStatuses,
  listTables,
  listZones,
  setTablePlacement,
  setTableStatus,
  type FloorTableShape,
} from "./tables.js";
import {
  abandonHeldOrder,
  advanceTicket,
  advanceTicketItem,
  bumpCourseReady,
  cancelPlacedOrder,
  fireCourse,
  getHeldOrder,
  getPlacedCounterOrder,
  listExpoQueue,
  listCounterWaiting,
  listHeldOrders,
  listStationQueue,
  listTablesWithState,
  handOverOrder,
  markCourseAway,
  markGroupServed,
  markServed,
  parkOrder,
  placeOrder,
  readTabLines,
  recallLines,
  sendLines,
  sendToPrep,
  setOrderInvoiceChoice,
  setLineCourse,
  unmarkServed,
  readOrderRevision,
  updateHeldOrder,
  updateOrderLine,
  bumpRevision,
  refusePaymentInFlight,
  priceOrderLines,
  paysAfterSending,
  unsentDishLines,
} from "./working-order.js";
import type { LineExtras, OrderLinePatch, TicketState } from "./working-order.js";
import { listCourses, listStations } from "./kitchen.js";
import {
  finishTable,
  markTableCleared,
  readPartyBills,
  seatTable,
  setPartyName,
  partyRevisionOfOrder,
  partyZone,
} from "./parties.js";
import { mergeBills, splitBill, transferItems } from "./bill-actions.js";
import type { BillCommand } from "./bill-actions.js";
import { moveBill, moveWouldSend } from "./move-bill.js";
import type { MoveBillOptions, MoveTarget, OtherPartyRead } from "./move-bill.js";
import { joinTables, moveGuests, splitTable } from "./table-actions.js";
import type { TableActionOptions } from "./table-actions.js";
import {
  bumpGroupReady,
  fireGroup,
  listOrderGroups,
  markGroupAway,
  moveLinesToGroup,
  readCurrentOrders,
  reorderHeldGroups,
  snoozeReminder,
  submitGroups,
  unsnoozeReminder,
} from "./order-groups.js";
import type { GroupLine, SubmitGroupsInput, PartyCommandArgs } from "./order-groups.js";
import { readDrafts, saveDraft, submitDraft, takeOverDraft } from "./order-drafts.js";
import { availableStations, findDeadEnds, requireMakeAtStation } from "./dead-ends.js";
import type { SubmitDraftInput } from "./order-drafts.js";
import { invalid } from "./bill-allocation.js";
import { printSalePaymentSlip } from "./payment-slip-print.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import { asObject, mountBillPaymentsApi, submissionIdOf } from "./bill-payments-api.js";
import { listPrintProblems, reprintOrderTickets } from "./kitchen-print.js";
import {
  canonicaliseUuid,
  clearSessionCookie,
  isUuid,
  readSessionToken,
  requireSession,
  setSessionCookie,
} from "./till-session.js";
import {
  assertDeviceCapability,
  assertProfileAction,
  assertDeviceStillProven,
  assertTakesCash,
  requireDeviceProof,
  tryReadDevice,
  type DeviceBinding,
} from "./device-session.js";
import { requireBodyUuid, requireUuidParam } from "@waitron/server-kit";
import { requestBill } from "./bill-request.js";
import { mountAdjustmentsApi } from "./adjustments-api.js";
import { mountUnpaidDepartureApi } from "./unpaid-departure-api.js";
import { mountBillLookupApi } from "./bill-lookup-api.js";
import { mountInvoiceLookupApi } from "./invoice-lookup-api.js";
import { resolveInstalledReceiptLanguageRules } from "@waitron/country-packs";
import { geographyOf } from "./venue-locale.js";
import { receiptAddressLines } from "./venue-address.js";
import { resolveLoginLocale } from "./login-locale.js";
// Side-effect only: loads this host's errors.ts augmentation.
import "./errors.js";
import { stationPrintersDown } from "./station-outputs-down.js";
import {
  checkZones,
  gateZones,
  inScope,
  readZoneScope,
  visibleOrders,
  type ZoneSubject,
} from "./zone-access.js";

export interface TillApiDeps {
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TillConfig;
  floorAnnotators?: readonly FloorAnnotator[];
  secureCookies: boolean;
  /**
   * Only ever the practice-mode local simulator; a real card sale routes through {@link pool} by
   * its reader's `provider`.
   */
  cardProvider?: PaymentProvider;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  pool?: CardProviderPool;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  providers?: readonly CardProviderContribution[];
  /** Gates the per-tab device override header (`x-waitron-dev-device`); unset leaves it inert. */
  devMode?: boolean;
  /** The venue's default UI locale, distinct from the location's receipt language. */
  venueLocale: string;
  /** The setup journey that created this installation, shown persistently by the till. */
  onboardingIntent?: OnboardingIntent;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
}

async function resolveHttpOrderZone(
  deps: TillApiDeps,
  session: { device: { deviceProfileId: string } },
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return withTransaction(
    deps.db,
    async (tx) =>
      (
        await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {
          profileId: session.device.deviceProfileId,
        })
      ).zoneId,
  );
}

/** The subjects that are named: a request's optional body ids leave out what they do not carry. */
function named(...subjects: (ZoneSubject | false)[]): ZoneSubject[] {
  return subjects.filter((subject): subject is ZoneSubject => subject !== false);
}

/** The subset of `apps/till`'s `CardProvider` union this surface hands out. */
type TillCardProvider = "sumup_cloud" | "stripe_terminal" | "simulator" | "none";

/**
 * An unrecognised provider maps to `undefined`, which callers answer as `"none"` rather than leak a
 * raw seat id.
 */
function tillProviderForReader(provider: string): "sumup_cloud" | "stripe_terminal" | undefined {
  if (provider === "sumup") return "sumup_cloud";
  if (provider === "stripe") return "stripe_terminal";
  return undefined;
}

async function resolvePayReader(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ id: string; provider: string; providerRef: string }> {
  return withTransaction(deps.db, async (tx) => {
    let readerId = requestedReaderId;
    if (readerId === undefined && deviceId !== undefined) {
      const [row] = await tx
        .select({ readerId: deviceCardReaders.readerId })
        .from(deviceCardReaders)
        .where(eq(deviceCardReaders.deviceId, deviceId));
      readerId = row?.readerId;
    }
    if (readerId === undefined) throw new AppError("reader.not_found", { id: "" });
    const [reader] = await tx
      .select({
        id: cardReaders.id,
        provider: cardReaders.provider,
        providerRef: cardReaders.providerRef,
      })
      .from(cardReaders)
      .where(and(eq(cardReaders.id, readerId), eq(cardReaders.active, true)));
    if (reader === undefined) throw new AppError("reader.not_found", { id: readerId });
    // Refuse a disconnected provider here with the actionable `reader.provider_disconnected`,
    // before an adapter meets the missing credential mid-charge.
    if (deps.providers !== undefined) {
      const purpose = cardProviderById(deps.providers, reader.provider).credentialPurpose;
      const [cred] = await tx
        .select({ purpose: tenantCredentials.purpose })
        .from(tenantCredentials)
        .where(eq(tenantCredentials.purpose, purpose));
      if (cred === undefined) {
        throw new AppError("reader.provider_disconnected", { providerId: reader.provider });
      }
    }
    return reader;
  });
}

/**
 * The provider a card on a reader is collected through.
 */
export async function resolveCardCollector(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ provider: PaymentProvider; reader?: { id: string; providerRef: string } }> {
  if (requestedReaderId === DEMO_READER_ID) {
    if (deps.cardProvider?.provider !== "simulator") {
      throw new AppError("reader.not_found", { id: requestedReaderId });
    }
    return {
      provider: deps.cardProvider,
      reader: { id: DEMO_READER_ID, providerRef: DEMO_READER_REF },
    };
  }
  if (deps.cardProvider?.provider === "simulator") {
    if (requestedReaderId !== undefined) {
      throw new AppError("reader.not_found", { id: requestedReaderId });
    }
    return { provider: deps.cardProvider };
  }
  const reader = await resolvePayReader(deps, deviceId, requestedReaderId);
  /* v8 ignore start -- a live boot always supplies the pool */
  if (deps.pool === undefined) throw new Error("card provider pool not configured");
  /* v8 ignore stop */
  // The provider carries no reader: the chosen one travels per collect as `readerRef`, so one
  // cached provider serves every reader on the same vendor.
  return { provider: await deps.pool.get(reader.provider), reader };
}

/** Every AppError code the till API answers, and its HTTP status; an unlisted code answers 400. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "print_job.not_found": 404,
  "print_job.not_resendable": 409,
  "receipt.not_printed": 409,
  "pin.invalid": 401,
  // 429, not 401, so the till can tell "wait N seconds" apart from "wrong PIN".
  "pin.throttled": 429,
  "person.not_found": 401,
  // Authenticated device lacks the action capability or is excluded from the workflow.
  "device.forbidden_action": 403,
  "device.cash_not_allowed": 403,
  // The same codes and statuses `device-api.ts`'s map assigns.
  "device.unauthorized": 401,
  "session.not_open": 401,
  "session.required": 401,
  "locale.unsupported": 400,
  "sale.empty_basket": 400,
  "product.variant_required": 400,
  // A line never sent whose product sold out, refused at send and at pay (spec §11.3).
  "product.unavailable": 409,
  "product.not_sold_separately": 409,
  // A basket priced against a menu version that is no longer live: nothing was priced or written.
  "menu.version_changed": 409,
  "sale.unsupported_tender": 400,
  "sale.tender_shortfall": 400,
  "quantity.invalid": 400,
  // Every id column is plain `text` (`packages/db/src/schema/columns.ts`), so the database does not
  // refuse a malformed id by its shape: a by-id read matches no row, and a write into a column with
  // no foreign key stores it. The `isUuid` screens in this app's routes refuse it by shape.
  "shared.invalid_id": 400,
  "authorization.not_permitted": 403,
  // The fiscal filing refuses the record: not a malformed request, and permanent for the same
  // basket, so 409 rather than 400 or 500.
  "fiscal.record_invalid": 409,
  "fiscal.foreign_recipient_unsupported": 409,
  // Adding a line refuses a classification snapshot the catalogue's data cannot make valid:
  // permanent until the catalogue is fixed, and not the till's fault.
  "sale_classification.invalid": 409,
  "working_order.not_found": 404,
  "watcher.not_found": 404,
  "working_order.not_open": 409,
  "working_order.out_of_date": 409,
  "order.payment_in_flight": 409,
  "working_order.not_placed": 409,
  "series.no_rectificative_for_node": 409,
  "sale.correction_not_whole": 409,
  "sale.correction_unsupported": 409,
  // A record built from the invoice as stored, or from the server's own pricing, disagrees with
  // itself: nothing the request sent, and permanent for the same invoice or basket.
  "sale.correction_lines_mismatch": 409,
  "sale.correction_line_not_on_invoice": 409,
  "sale.correction_line_not_reversed": 409,
  "sale.total_mismatch": 409,
  "sale.correction_exceeds_total": 409,
  // Permanent for the same basket or bill until it is made smaller.
  "sale.total_exceeds_simplified_limit": 409,
  "sale.full_invoice_unavailable": 409,
  "fiscal.taxpayer_domicile_missing": 409,
  "invoice.recipient_invalid": 400,
  "invoice.choice_locked": 409,
  "sale.voided": 409,
  "sale.already_settled": 409,
  "working_order.not_settled": 409,
  "working_order.already_collected": 409,
  "ticket.not_fired": 409,
  "ticket.not_sent": 409,
  "ticket.made_here": 409,
  "working_order.reason_required": 400,
  "ticket.already_fired": 409,
  "ticket.invalid_transition": 409,
  "ticket.item_held": 409,
  "ticket.already_started": 409,
  "course.not_found": 404,
  "station.no_default": 409,
  "station.no_replacement": 409,
  "station.not_found": 404,
  "kitchen_notice.not_found": 404,
  "service_zone.not_found": 404,
  // The request is sound; the device's profile may not work in that zone.
  "service_zone.not_allowed": 403,
  "device_profile.no_service_zone": 409,
  "service_zone.default_missing": 409,
  "service_zone.offer_not_allowed": 400,
  "service_zone.mode_incompatible": 409,
  "service_zone.join_mismatch": 409,
  "order.service_context_missing": 409,
  "route.subject_not_found": 404,
  "route.station_inactive": 409,
  "management.request_invalid": 400,
  "reader.not_found": 404,
  "reader.provider_disconnected": 409,
  "table.not_found": 404,
  "table.inactive": 409,
  "zone.not_found": 404,
  "placement.invalid": 400,
  "tab.already_open": 409,
  "tab.not_open": 409,
  "tab.line_not_found": 404,
  "table.needs_clearing": 409,
  "table.already_in_party": 409,
  "tab.merge_self": 400,
  "tab.transfer_self": 400,
  "tab.transfer_quantity_invalid": 400,
  "tab.serve_quantity_invalid": 400,
  "tab.transfer_duplicate_line": 400,
  "table.not_joined": 409,
  "table.not_shared": 409,
  "tab.transfer_modifier_line": 400,
  "tab.split_held_line": 400,
  "party.not_open": 409,
  "party.out_of_date": 409,
  "party.bill_outstanding": 409,
  "unpaid_departure.nothing_outstanding": 409,
  "unpaid_departure.unfired_dishes": 409,
  "unpaid_departure.bill_holds_payment": 409,
  "party.main_bill_stays": 409,
  "submission.id_reused": 409,
  "draft.taken_over": 409,
  "draft.already_submitted": 409,
  "draft.out_of_date": 409,
  "draft.not_found": 404,
  "group.not_held": 409,
  "group.not_waiting": 409,
  "group.not_found": 404,
  "group.held_leaves_party": 409,
  "group.line_held": 409,
  "bill.nothing_outstanding": 409,
  "bill.tip_not_allowed": 422,
  "bill.allocation_changed": 409,
  "bill.line_paid": 409,
  "bill.received_exceeds_total": 409,
  "bill.payments_received": 409,
  "bill.presented": 409,
  "bill.paid": 409,
  "bill.other_party": 409,
  "bill.payment_not_found": 404,
  "bill.refund_exceeds_payment": 422,
  "bill.refund_not_whole": 422,
  "bill.refund_unsupported": 422,
  "bill.manual_refund_pin_required": 403,
  "bill.refund_in_progress": 409,
  "payment.not_refundable": 409,
  "payment.refund_exceeds_capture": 422,
  "status.not_found": 404,
  "status.inactive": 409,
  "drawer.no_printer": 400,
  "drawer.not_attached": 400,
  "adjustment_reason.not_found": 404,
  // 403, as `authorization.not_permitted` answers: the request is sound, the person may not alone.
  "adjustment.approval_required": 403,
  // The rest follow their nearest siblings: a refusal that depends on the bill or the reason as they
  // stand is 409, like `bill.received_exceeds_total`; one about the request's own fields is 400,
  // like `tab.transfer_quantity_invalid` and `tab.transfer_modifier_line`.
  "adjustment.exceeds_amount": 409,
  "adjustment.over_limit": 409,
  "adjustment.action_not_allowed": 409,
  "adjustment.reason_inactive": 409,
  "adjustment.weighed_partial": 409,
  "adjustment.no_reduction": 409,
  "adjustment.note_required": 400,
  "adjustment.quantity_invalid": 400,
};

export const run = createErrorBoundary(STATUS, "till.failed");

export type Run = typeof run;

/** A malformed id is refused with the code the route gives an absent or wrong-state order. */
function requireUuidId(
  id: string,
  code:
    | "working_order.not_found"
    | "working_order.not_open"
    | "working_order.not_placed"
    | "working_order.not_settled",
): string {
  if (!isUuid(id)) {
    throw new AppError(code, { workingOrderId: id });
  }
  return id;
}

/**
 * An absent override leaves the operator's own role to decide. A malformed one is `pin.invalid`,
 * the one answer the credential gate gives any override that cannot sign in.
 */
export function parseDrawerOverride(
  raw: { personId?: unknown; pin?: unknown } | undefined | null,
): { personId: string; pin: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    throw new AppError("pin.invalid", {});
  }
  if (typeof raw.pin !== "string") {
    throw new AppError("pin.invalid", {});
  }
  return { personId: raw.personId, pin: raw.pin };
}

const REASON_LIMIT = 500;

/** A reason, trimmed, refused as `reason` when it is not text, is blank or is too long. */
export function parseReason(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > REASON_LIMIT) {
    throw invalid("reason");
  }
  return value.trim();
}

/** A body's `override`, refused as `override` when it is present and not an object. */
export function parseOverrideField(value: unknown): { personId: string; pin: string } | undefined {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "object" || Array.isArray(value))
  ) {
    throw invalid("override");
  }
  return parseDrawerOverride(value as { personId?: unknown; pin?: unknown } | null | undefined);
}

/**
 * Where the till's override PINs count their wrong tries: one bucket per device, apart from sign-in's
 * per-device one. It is the requesting SESSION's device because that is fixed when the session
 * opens: the device cookie can be left off a request, and anyone can open a fresh session with their
 * own PIN, so keying on either would let a caller start the count again.
 */
export function overridePinAttempts(
  pinThrottle: PinThrottle,
  sessionDeviceId: string,
): PinAttempts {
  return { throttle: pinThrottle, slot: `override:${sessionDeviceId}` };
}

async function drawerOverrideToCheck(
  db: Database,
  sessionId: string,
  body: { override?: { personId?: unknown; pin?: unknown } },
): Promise<{ personId: string; pin: string } | undefined> {
  let override;
  try {
    override = parseDrawerOverride(body.override);
  } catch {
    return undefined;
  }
  return overrideToCheck(db, { sessionId, permission: "cash.drawer" }, override);
}

/** A non-UUID names no open tab, so it gets the absent tab's `tab.not_open`. */
export function requireTabParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("tab.not_open", { tabId: id });
  }
  return id;
}

/**
 * A revision as a body carries it, an order's or a party's: a whole number from 0, else
 * `management.request_invalid` naming `field`.
 */
export function requireRevision(
  value: unknown,
  field:
    | "revision"
    | "draftRevision"
    | "expectedRevision"
    | "expectedPartyRevision"
    | "expectedOtherPartyRevision" = "revision",
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("management.request_invalid", { field });
  }
  return value;
}

/** A non-UUID names no party, so it gets the absent party's `party.not_open`. */
export function requirePartyParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("party.not_open", { partyId: id });
  }
  return id;
}

/** An optional guest count: absent or null records none, otherwise a whole number from 1. */
function requireGuestCount(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!isValidGuestCount(value)) {
    throw new AppError("management.request_invalid", { field: "guestCount" });
  }
  return value;
}

/**
 * A bill route's command: the party revision, the party the till read the bill under, and the
 * acting person. A revision may be absent here: the verb refuses its absence only where the bill
 * belongs to a party.
 */
function billCommand(personId: string, body: Record<string, unknown>): BillCommand {
  const command: BillCommand = { operatorId: personId };
  if (body.expectedPartyRevision !== undefined) {
    command.expectedPartyRevision = requireRevision(
      body.expectedPartyRevision,
      "expectedPartyRevision",
    );
  }
  if (body.partyId !== undefined) {
    command.partyId = requireBodyUuid(body.partyId, "partyId").toLowerCase();
  }
  return command;
}

/** A plain object whose keys are exactly `keys`. */
function hasExactly(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

/**
 * A move's target: exactly one of a table's id, or the counter with its zone id or null. A
 * malformed table id is refused as the seat, Move guests and Join tables routes refuse one, a zone
 * id as the sale route.
 */
function requireMoveTarget(value: unknown): MoveTarget {
  if (hasExactly(value, ["tableId"])) {
    const { tableId } = value;
    if (typeof tableId === "string") {
      if (!isUuid(tableId)) throw new AppError("table.not_found", { tableId });
      return { tableId: tableId.toLowerCase() };
    }
  } else if (hasExactly(value, ["counter"]) && hasExactly(value.counter, ["zoneId"])) {
    const { zoneId } = value.counter;
    if (zoneId === null) return { counter: { zoneId: null } };
    if (typeof zoneId === "string") {
      return { counter: { zoneId: requireUuidParam(zoneId, "ServiceZoneId").toLowerCase() } };
    }
  }
  throw invalid("to");
}

/** A bill choice as a body carries it: merge by default, else `"separate"`. */
function requireBillChoice(bills: unknown): "merge" | "separate" {
  if (bills === undefined) return "merge";
  if (bills !== "merge" && bills !== "separate") throw invalid("bills");
  return bills;
}

/** The party the till read at the target table, and its revision, as a body carries them. */
function otherPartyRead(body: Record<string, unknown>): OtherPartyRead {
  const read: OtherPartyRead = {};
  if (body.expectedOtherPartyRevision !== undefined) {
    read.expectedOtherPartyRevision = requireRevision(
      body.expectedOtherPartyRevision,
      "expectedOtherPartyRevision",
    );
  }
  if (body.otherPartyId === null) read.otherPartyId = null;
  else if (body.otherPartyId !== undefined) {
    read.otherPartyId = requireBodyUuid(body.otherPartyId, "otherPartyId").toLowerCase();
  }
  return read;
}

/**
 * A move's command: {@link billCommand}'s, with `partyId: null` for a bill read with no party, the
 * bill choice, and the party read at the target table.
 */
function moveCommand(personId: string, body: Record<string, unknown>): MoveBillOptions {
  const { partyId, ...rest } = body;
  const bills = requireBillChoice(body.bills);
  const command: MoveBillOptions = {
    ...billCommand(personId, partyId === null ? rest : body),
    bills,
  };
  if (partyId === null) command.partyId = null;
  return { ...command, ...otherPartyRead(body) };
}

/**
 * A table action's command: the path party's revision, the bill choice and the party read at the
 * target table.
 */
function tableActionCommand(personId: string, body: Record<string, unknown>): TableActionOptions {
  const bills = requireBillChoice(body.bills);
  return {
    bills,
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId: personId,
    ...otherPartyRead(body),
  };
}

/** The table a move or join names, which the body must carry; a malformed id names no table. */
function requireTargetTable(value: unknown, field: string): string {
  if (value === undefined) throw invalid(field);
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("table.not_found", { tableId: String(value) });
  }
  return value.toLowerCase();
}

/**
 * The other bill a bill route names, which the body must carry: a non-UUID names no open bill, as a
 * malformed path id.
 */
function requireOtherBill(value: unknown, field: string): string {
  if (value === undefined) throw invalid(field);
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("tab.not_open", { tabId: String(value) });
  }
  return value;
}

/**
 * A list of objects, each with a numeric `lineNo`. A line number naming no line, and a bad quantity,
 * are left to the verb's domain codes.
 */
function requireTransfers(value: unknown): { lineNo: number; quantity?: string }[] {
  if (!Array.isArray(value)) throw invalid("transfers");
  for (const entry of value) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as { lineNo?: unknown }).lineNo !== "number"
    ) {
      throw invalid("transfers");
    }
  }
  return value as { lineNo: number; quantity?: string }[];
}

/** What every group command carries: its submission id, the party revision read, and who acts. */
function groupCommand(personId: string, body: Record<string, unknown>): PartyCommandArgs {
  return {
    submissionId: submissionIdOf(body),
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId: personId,
  };
}

/** A submission's held group to add to, when it names one. */
function joinGroupOf(body: Record<string, unknown>): { joinGroupId?: string } {
  const { joinGroupId } = body;
  if (joinGroupId === undefined) return {};
  if (typeof joinGroupId !== "string") throw invalid("joinGroupId");
  return { joinGroupId };
}

/** A submission's bill, when it names one: a UUID, in lower case as ids are stored. */
function billOf(body: Record<string, unknown>): { billId?: string } {
  const { billId } = body;
  if (billId === undefined) return {};
  return { billId: requireBodyUuid(billId, "billId").toLowerCase() };
}

/**
 * Submitted groups: each a release and a list of round lines. Only the shape is screened; pricing
 * refuses a line's contents.
 */
function parseSubmittedGroups(value: unknown): SubmitGroupsInput["groups"] {
  if (!Array.isArray(value)) throw invalid("groups");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalid("groups");
    }
    const { lines, release } = entry as Record<string, unknown>;
    if (
      !Array.isArray(lines) ||
      !lines.every((line) => typeof line === "object" && line !== null && !Array.isArray(line))
    ) {
      throw invalid("lines");
    }
    if (release !== "fire" && release !== "hold") throw invalid("release");
    return { lines: lines as GroupLine[], release };
  });
}

/** A draft route's party, in lower case as ids are stored, so a draft on it compares equal. */
function requireDraftPartyParam(id: string): string {
  return requirePartyParam(id).toLowerCase();
}

/** A draft route's draft, in lower case as ids are stored: an id that is no UUID names none. */
function requireDraftParam(draftId: string): string {
  if (!isUuid(draftId)) throw new AppError("draft.not_found", { draftId });
  return draftId.toLowerCase();
}

/** A save's draft: null for the operator's new one, else a UUID. */
function requireDraftId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !isUuid(value)) throw invalid("draftId");
  return value;
}

/** Groups of draft line ids, each with its release. Only the shape is screened. */
function parseDraftGroups(value: unknown): SubmitDraftInput["groups"] {
  if (!Array.isArray(value)) throw invalid("groups");
  return value.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw invalid("groups");
    }
    const { lineIds, release } = entry as Record<string, unknown>;
    if (!Array.isArray(lineIds) || !lineIds.every((id) => typeof id === "string")) {
      throw invalid("lineIds");
    }
    if (release !== "fire" && release !== "hold") throw invalid("release");
    return { lineIds: lineIds as string[], release };
  });
}

/** A list of `{ lineId, quantity }`, both strings; anything else is refused naming `field`. */
function parseLineQuantities(
  value: unknown,
  field: string,
): { lineId: string; quantity: string }[] {
  if (!Array.isArray(value)) throw invalid(field);
  return value.map((entry: unknown) => {
    const item =
      typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : null;
    if (item === null || typeof item.lineId !== "string" || typeof item.quantity !== "string") {
      throw invalid(field);
    }
    return { lineId: item.lineId, quantity: item.quantity };
  });
}

function parseMoveTarget(value: unknown): { groupId: string } | "new" {
  if (value === "new") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { groupId?: unknown }).groupId === "string"
  ) {
    return { groupId: (value as { groupId: string }).groupId };
  }
  throw invalid("target");
}

/** A value that cannot be a line number gets the absent line's `tab.line_not_found`. */
function requireLineNo(tabId: string, raw: string): number {
  const lineNo = Number(raw);
  if (!Number.isInteger(lineNo) || lineNo < 1 || lineNo > 2_147_483_647) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  return lineNo;
}

/**
 * `POST /api/orders/:id/courses/:courseId/<suffix>`. Session-gated with no permission: the
 * `fire_control` venue setting decides which UI shows the button, not who may call it. The profile
 * must permit `action`.
 */
function mountCourseVerb(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  suffix: string,
  action: ProfileAction,
  verb: (
    tx: Transaction,
    cfg: OriginConfig,
    orderId: string,
    courseId: string,
    operatorId: string,
  ) => Promise<void>,
): void {
  app.post(`/api/orders/:id/courses/:courseId/${suffix}`, (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const courseId = c.req.param("courseId");
      if (!isUuid(courseId)) throw new AppError("course.not_found", { courseId });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId }]);
        await verb(tx, cfg, orderId, courseId, personId);
      });
      return c.body(null, 200);
    }),
  );
}

/** Cash needs the profile's `take-cash`; a card taken here, never on a connected reader, needs its
 * `hand-keyed-card-payment`. */
function assertTakesTender(device: DeviceBinding, tender: TillTender | undefined): void {
  if (tender?.method === "cash") assertTakesCash(device);
  if (tender?.method === "card") assertProfileAction(device, "hand-keyed-card-payment");
}

/** A kitchen display cannot open a shift session. */
function refuseKitchenSignIn(device: DeviceBinding): void {
  if (kindOfFormFactor(device.formFactor) === "kds_station")
    throw new AppError("device.forbidden_action", { action: "sign_in" });
}

/** Mount the till routes with the shared error boundary. */
export function mountTillApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.use("/api/*", madeHereAnswer(deps.db, deps.cfg.locale));
  const simulator = deps.cardProvider;
  if (simulator instanceof SimulatorPaymentProvider) {
    const demoRun = createErrorBoundary(
      {
        "management_session.required": 401,
        "management_session.expired": 401,
        "person.suspended": 403,
        "authorization.not_permitted": 403,
        "reader.not_found": 404,
        "management.request_invalid": 400,
      },
      "till.failed",
    );
    const authorizeDemoReader = async (c: Parameters<typeof requireManagementSession>[0]) => {
      const sessionId = requireManagementSession(c);
      await withTransaction(deps.db, (tx) =>
        authorizeManager(tx, { managementSessionId: sessionId, permission: "payments.manage" }),
      );
    };
    app.get("/management-api/demo-reader/payments", (c) =>
      demoRun(c, log, async () => {
        await withPassiveManagementRead(() => authorizeDemoReader(c));
        return c.json({ payments: simulator.pendingDemoReaderPayments() });
      }),
    );
    app.post("/management-api/demo-reader/payments/:id/decision", (c) =>
      demoRun(c, log, async () => {
        await authorizeDemoReader(c);
        const body = await readRawJsonBody<unknown>(c);
        const outcome =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>).outcome
            : undefined;
        if (outcome !== "captured" && outcome !== "declined") {
          throw new AppError("management.request_invalid", { field: "outcome" });
        }
        const id = c.req.param("id");
        if (!simulator.decideDemoReaderPayment(id, outcome)) {
          throw new AppError("reader.not_found", { id });
        }
        return c.json({ decided: true });
      }),
    );
    app.post("/api/demo-reader/cancel", (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { permission: "sale.take_payment" });
        const body = await readJsonBody<{ workingOrderId: string; attemptId?: string }>(c);
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
        if (body.attemptId !== undefined) requireUuidParam(body.attemptId, "DemoAttemptId");
        return c.json({
          cancelled: simulator.cancelDemoReaderPayment(
            body.workingOrderId,
            session.device.deviceId,
            body.attemptId,
          ),
        });
      }),
    );
  }
  // Built once per mount so its in-memory state persists across requests.
  const pinThrottle = deps.pinThrottle ?? createPinThrottle();
  // What a write that leaves a bill fully paid issues its invoice with (bill payments design §7).
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, log };
  mountBillPaymentsApi(app, deps, log, run, pinThrottle);
  mountAdjustmentsApi(app, deps, log, run, pinThrottle);
  mountUnpaidDepartureApi(app, deps, log, run, pinThrottle);
  mountBillLookupApi(app, deps, log, run);
  mountInvoiceLookupApi(app, deps, log, run);

  // Device-gated: the throttle keys on the authenticated device, so dropping the cookie cannot
  // evade it.
  app.post("/api/session", (c) =>
    run(c, log, async () => {
      const { personId: rawPersonId, pin } = await readJsonBody<{ personId: string; pin: string }>(
        c,
      );
      // Canonicalised before it keys the throttle and the lookup: the throttle keys on the string,
      // and the `text` id column folds no spellings (`canonicaliseUuid`).
      const personId = canonicaliseUuid(rawPersonId);
      // Not throttled: this id never reaches the lookup, so no PIN is being tried against anyone.
      if (personId === null) throw new AppError("pin.invalid", {});
      const proof = await requireDeviceProof(deps, c);
      const { device } = proof;
      // Before the PIN work, and again under the lock: the profile can change while the PIN is
      // checked.
      refuseKitchenSignIn(device);
      pinThrottle.check(device.deviceId, personId);
      const checked = await checkPin(deps.db, personId, pin);
      let session;
      try {
        session = await withTransaction(deps.db, async (tx) => {
          refuseKitchenSignIn(await assertDeviceStillProven(tx, proof));
          return loginWithPin(tx, {
            deviceId: device.deviceId,
            personId,
            pin,
            checked,
          });
        });
      } catch (err) {
        if (isAppError(err) && err.code === "pin.invalid") {
          pinThrottle.recordFailure(device.deviceId, personId);
        }
        throw err;
      }
      pinThrottle.clear(device.deviceId, personId);
      setSessionCookie(c, session.token, deps.secureCookies);
      // Display only: the server checks each permission itself, so a tampered client list grants
      // nothing.
      return c.json({
        personId: session.personId,
        permissions: permissionsForRole(session.role),
        locale: session.locale,
      });
    }),
  );

  // Idempotent: a missing, malformed or closed session still clears the cookie and answers 200.
  app.delete("/api/session", (c) =>
    run(c, log, async () => {
      const token = readSessionToken(c);
      if (token !== null && isUuid(token)) {
        await withTransaction(deps.db, async (tx) => {
          await endSession(tx, token);
        });
      }
      clearSessionCookie(c);
      return c.json({ ok: true });
    }),
  );

  // The session, not the body, names the person, so an operator can set only their own locale. A
  // missing or non-string `locale` becomes "", refused as `locale.unsupported`.
  app.put("/api/session/locale", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      await withTransaction(deps.db, async (tx) => {
        await setPersonLocale(tx, { personId, locale });
      });
      return c.body(null, 204);
    }),
  );

  // Deliberately unauthenticated: the lock screen's roster. No PIN material, role or status. A
  // request that identifies a device lists only the people its profile admits.
  app.get("/api/staff", (c) =>
    run(c, log, async () => {
      // Before the transaction: `tryReadDevice` opens one of its own when a sighting is due.
      const device = await tryReadDevice({ db: deps.db, devMode: deps.devMode }, c);
      const staff = await withTransaction(deps.db, async (tx) => {
        return device === null
          ? listActiveStaff(tx)
          : listStaffAdmittedTo(tx, device.deviceProfileId);
      });
      return c.json(staff);
    }),
  );

  // Unauthenticated boot info the till needs before login; it carries no secrets.
  app.get("/api/till", (c) =>
    run(c, log, async () => {
      // Resolved before the boot transaction: `tryReadDevice` opens one of its own when a sighting
      // is due.
      const device = await tryReadDevice({ db: deps.db, devMode: deps.devMode }, c);
      const held = await readNodeMembership(deps.db);
      const boot = await withTransaction(deps.db, async (tx) => {
        const taxpayer = await readTenant(tx);
        const [loc] = await tx
          .select({
            bumpMode: locations.bumpMode,
            fireControl: locations.fireControl,
            addressLine1: locations.addressLine1,
            addressLine2: locations.addressLine2,
            postalCode: locations.postalCode,
            city: locations.city,
            province: locations.province,
          })
          .from(locations)
          .where(eq(locations.id, deps.cfg.locationId));
        const courses = (await listCourses(tx, deps.cfg)).map((course) => ({
          id: course.id,
          name: course.name,
          displayOrder: course.displayOrder,
        }));
        const receipt = await getReceipt(tx);
        const venueAddress = receiptAddressLines(receipt, loc);
        let canvas: CanvasDef;
        let capabilities: CapabilityFlag[] = [];
        let inactivityTimeoutSeconds: number | null = null;
        let startingScreen: NavigationScreen | null = null;
        if (device != null) {
          const profile = await getDeviceProfile(tx, device.deviceProfileId);
          capabilities = device.capabilities;
          inactivityTimeoutSeconds = profile?.inactivityTimeoutSeconds ?? null;
          startingScreen = await readProfileStartingScreen(tx, device.deviceProfileId);
          let assigned: CanvasDef | undefined;
          if (profile?.canvasId != null) {
            assigned = (await getCanvas(tx, profile.canvasId))?.definition;
          }
          // A set `canvasId` always resolves (`device_profiles.canvas_id` is `onDelete: "restrict"`
          // and foreign keys are on); the fallback covers a NULL `canvasId`.
          canvas = assigned ?? (await getCanvasForFormFactor(tx, device.formFactor));
        } else {
          canvas = await getCanvasForFormFactor(tx, "till");
        }
        let defaultReaderProvider: "sumup_cloud" | "stripe_terminal" | undefined;
        let defaultReaderId: string | undefined;
        if (device != null) {
          const [reader] = await tx
            .select({ id: cardReaders.id, provider: cardReaders.provider })
            .from(deviceCardReaders)
            .innerJoin(cardReaders, eq(cardReaders.id, deviceCardReaders.readerId))
            .where(
              and(eq(deviceCardReaders.deviceId, device.deviceId), eq(cardReaders.active, true)),
            );
          if (reader !== undefined) {
            const provider = tillProviderForReader(reader.provider);
            if (provider !== undefined) {
              defaultReaderProvider = provider;
              defaultReaderId = reader.id;
            }
          }
        }
        const activeReaders = (
          await tx
            .select({ id: cardReaders.id, name: cardReaders.name, provider: cardReaders.provider })
            .from(cardReaders)
            .where(eq(cardReaders.active, true))
        ).flatMap((r) => {
          const provider = tillProviderForReader(r.provider);
          return provider === undefined ? [] : [{ id: r.id, name: r.name, provider }];
        });
        return {
          invoiceLocale: (await readReceiptLanguage(tx, deps.cfg.locationId)).locale,
          receiptLanguages: resolveInstalledReceiptLanguageRules(geographyOf(taxpayer, loc))
            .choices,
          issuer:
            taxpayer === null ? undefined : { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          bumpMode: loc?.bumpMode,
          fireControl: loc?.fireControl,
          courses,
          receipt,
          venueAddress,
          canvas,
          capabilities,
          inactivityTimeoutSeconds,
          startingScreen,
          defaultReaderProvider,
          defaultReaderId,
          activeReaders,
        };
      });
      /* v8 ignore start */
      if (
        boot.issuer === undefined ||
        boot.bumpMode === undefined ||
        boot.fireControl === undefined
      ) {
        // Unreachable once provisioned: the taxpayer row and the till's own location both exist.
        throw new Error(`GET /api/till: no taxpayer/location row for ${deps.cfg.locationId}`);
      }
      /* v8 ignore stop */
      return c.json({
        locale: deps.venueLocale,
        // The location's receipt language, kept separate from the UI `locale`: the UI derivation
        // drops UI-unsupported codes, which must never reach the receipt.
        invoiceLocale: boot.invoiceLocale,
        receiptLanguages: boot.receiptLanguages,
        onboardingIntent: deps.onboardingIntent,
        venueName: boot.issuer.venueName,
        nif: boot.issuer.nif,
        bumpMode: boot.bumpMode,
        fireControl: boot.fireControl,
        courses: boot.courses,
        cardProvider: (deps.cardProvider?.provider === "simulator"
          ? "simulator"
          : (boot.defaultReaderProvider ?? "none")) satisfies TillCardProvider,
        // A venue can have several active readers on one provider, so the till needs the row id.
        defaultReaderId:
          deps.cardProvider?.provider === "simulator" ? undefined : boot.defaultReaderId,
        activeReaders:
          deps.cardProvider?.provider === "simulator"
            ? [{ id: DEMO_READER_ID, name: "Demo card reader", provider: "simulator" }]
            : boot.activeReaders,
        tipsEnabled: deps.cfg.tipsEnabled,
        receipt: boot.receipt,
        venueAddress: boot.venueAddress,
        canvas: boot.canvas,
        capabilities: boot.capabilities,
        inactivityTimeoutSeconds: boot.inactivityTimeoutSeconds,
        ...(boot.startingScreen === null ? {} : { startingScreen: boot.startingScreen }),
        // The till polls each server's `GET /api/node` to follow the primary across a failover.
        nodeId: deps.cfg.nodeId,
        servers: routableServers(held),
        // So the basket refuses an order over it as it is entered, not at the pay step.
        simplifiedInvoiceLimit: deps.cfg.simplifiedInvoiceLimit,
      });
    }),
  );

  // Unauthenticated: the till fetches it before login.
  app.get("/api/locales", (c) =>
    run(c, log, async () => {
      c.header("Vary", "Accept-Language");
      return c.json({
        locales: SUPPORTED_LOCALES,
        venueDefault: deps.venueLocale,
        loginDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
      });
    }),
  );

  app.get("/api/products", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const { menus, products } = await withTransaction(deps.db, async (tx) => {
        return {
          menus: await listAccessibleCatalogues(tx, deps.cfg.locationId),
          products: (await listAvailableProducts(tx, deps.cfg.locationId)).products,
        };
      });
      return c.json({ menus, products });
    }),
  );

  app.get("/api/default-service-zone/offers", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const result = await withTransaction(deps.db, async (tx) => {
        const context = await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {
          deviceId: device.deviceId,
          profileId: device.deviceProfileId,
        });
        const scope = await readZoneScope(tx, deps.cfg, device.deviceProfileId);
        const salePolicy = await VENUE_SERVICE.resolveSalePolicy(tx, deps.cfg, context.zoneId);
        return {
          context: {
            ...context,
            serviceMode:
              context.serviceMode === "table_tab" ? context.serviceMode : salePolicy.paidWhen,
            receiptPrintMode: salePolicy.receiptPrintMode,
          },
          zones: (await VENUE_SERVICE.listServiceZones(tx, deps.cfg)).filter(
            (zone) => zone.serviceMode !== "table_tab" && inScope(scope, zone.id),
          ),
          ...(await VENUE_SERVICE.listZoneOffers(tx, deps.cfg, context.zoneId)),
        };
      });
      return c.json(result);
    }),
  );

  // The offers available in one service zone. The zone decides both the visible menus and the
  // payment flow; the menu-item id in each offer is the selling identity and may price the same
  // product differently from another zone's menu.
  app.get("/api/service-zones/:zoneId/offers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const context = await VENUE_SERVICE.resolveZoneContext(tx, deps.cfg, zoneId);
        const salePolicy = await VENUE_SERVICE.resolveSalePolicy(tx, deps.cfg, zoneId);
        return {
          context: {
            ...context,
            serviceMode:
              context.serviceMode === "table_tab" ? context.serviceMode : salePolicy.paidWhen,
            receiptPrintMode: salePolicy.receiptPrintMode,
          },
          ...(await VENUE_SERVICE.listZoneOffers(tx, deps.cfg, zoneId)),
        };
      });
      return c.json(result);
    }),
  );

  app.get("/api/menu-state", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { device } = session;
      const asked = c.req.query("zoneId");
      const zoneId = asked === undefined ? undefined : requireUuidParam(asked, "ServiceZoneId");
      const state = await withTransaction(deps.db, async (tx) => {
        if (zoneId !== undefined) await checkZones(tx, deps.cfg, session, [{ zoneId }]);
        const zone =
          zoneId === undefined
            ? (
                await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {
                  deviceId: device.deviceId,
                  profileId: device.deviceProfileId,
                })
              ).zoneId
            : (await VENUE_SERVICE.resolveZoneContext(tx, deps.cfg, zoneId)).zoneId;
        return VENUE_SERVICE.menuState(tx, zone);
      });
      return c.json(state);
    }),
  );

  app.post("/api/dead-ends/sale", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{
        step: "pay" | "place" | "edit";
        lines: (TillSaleRequest["lines"][number] & { workingOrderLineId?: string })[];
        zoneId?: string;
        workingOrderId?: string;
      }>(c);
      if (!Array.isArray(body.lines) || !["pay", "place", "edit"].includes(body.step))
        throw invalid("lines");
      if (body.workingOrderId !== undefined)
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      if (body.zoneId !== undefined) requireUuidParam(body.zoneId, "ServiceZoneId");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(
          tx,
          deps.cfg,
          session,
          named(
            body.zoneId !== undefined && { zoneId: body.zoneId },
            body.workingOrderId !== undefined && { orderId: body.workingOrderId },
          ),
        );
        const at = new Date();
        const order =
          body.workingOrderId === undefined
            ? undefined
            : (
                await tx
                  .select({
                    id: workingOrders.id,
                    partyId: workingOrders.partyId,
                    status: workingOrders.status,
                  })
                  .from(workingOrders)
                  .where(eq(workingOrders.id, body.workingOrderId))
              )[0];
        const context =
          order === undefined ? null : await VENUE_SERVICE.findOrderContext(tx, cfg, order.id);
        const zoneId =
          order === undefined
            ? await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId)
            : context?.zoneId;
        const mode =
          context?.serviceMode ??
          (zoneId === undefined
            ? "prepay"
            : (await VENUE_SERVICE.resolveZoneContext(tx, cfg, zoneId)).serviceMode);
        const unsentCount =
          order === undefined ? body.lines.length : (await unsentDishLines(tx, order.id)).length;
        const sends =
          body.step === "pay"
            ? unsentCount > 0 &&
              (mode === "prepay" ||
                (order?.partyId !== null && order?.partyId !== undefined
                  ? false
                  : paysAfterSending(mode)))
            : body.step === "place"
              ? unsentCount > 0
              : body.lines.length > 0;
        const alreadySent = new Set<string>();
        if (order !== undefined) {
          const rows = await tx
            .select({
              id: workingOrderLines.id,
              sentAt: workingOrderLines.sentAt,
              ticketId: ticketItems.id,
            })
            .from(workingOrderLines)
            .leftJoin(ticketItems, eq(ticketItems.workingOrderLineId, workingOrderLines.id))
            .where(eq(workingOrderLines.workingOrderId, order.id));
          for (const row of rows)
            if (row.sentAt !== null || row.ticketId !== null) alreadySent.add(row.id);
        }
        const active = body.lines.flatMap((line, index) =>
          line.workingOrderLineId !== undefined && alreadySent.has(line.workingOrderLineId)
            ? []
            : [{ line, key: String(index) }],
        );
        const priced =
          sends && active.length > 0
            ? await priceOrderLines(
                tx,
                cfg,
                body.workingOrderId ?? newId(),
                active.map(({ line }) => line),
                zoneId ?? undefined,
                undefined,
                "ignore",
              )
            : null;
        const parents = priced?.lineRows.filter((line) => line.parentLineId === null) ?? [];
        return {
          sends,
          deadEnds: sends
            ? await findDeadEnds(
                tx,
                cfg,
                zoneId ?? null,
                active.map(({ line, key }, index) => ({
                  key,
                  productId: parents[index]!.productId!,
                  quantity: line.quantity,
                  makeAt: line.makeAt ?? null,
                })),
                at,
              )
            : [],
          stations: await availableStations(tx, cfg, at),
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/api/sales", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { permission: "sale.take_payment" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<TillSaleRequest>(c);
      if (body.workingOrderId !== undefined) {
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      }
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const zoneId = await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId);
      await gateZones(
        deps,
        session,
        named(
          zoneId !== undefined && { zoneId },
          body.workingOrderId !== undefined && { orderId: body.workingOrderId },
        ),
      );
      const saleCfg = sendingCfg(cfg, c, session.device);
      // The tender first, so a refused cash payment answers `device.cash_not_allowed` whatever else
      // the profile lacks.
      assertTakesTender(session.device, body.tender);
      assertProfileAction(session.device, "take-orders");
      const result = await recordTillSale(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        saleCfg,
        { ...body, zoneId },
        personId,
      );
      return c.json(result);
    }),
  );

  // A payment outcome (declined, network unavailable) is neither a client nor a server fault, so it
  // answers 200 with the outcome as data, even a decline.
  app.post("/api/pay", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { permission: "sale.take_payment" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const device = session.device;
      await assertDeviceCapability(deps, c, "integrated-card-payment", "pay", device);
      assertProfileAction(device, "take-orders");
      const body = await readJsonBody<IntegratedPayRequest>(c);
      // Screened before the provider guard, so a malformed body is a 400 whatever the card config.
      requireUuidParam(body.id, "WorkingOrderId");
      if (
        body.simulationOutcome !== undefined &&
        (deps.cardProvider?.provider !== "simulator" ||
          (body.simulationOutcome !== "captured" && body.simulationOutcome !== "declined"))
      ) {
        throw new AppError("management.request_invalid", { field: "simulationOutcome" });
      }
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const zoneId = await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId);
      await gateZones(
        deps,
        session,
        named(zoneId !== undefined && { zoneId }, { orderId: body.id }),
      );
      if (body.readerId !== undefined) {
        requireUuidParam(body.readerId, "CardReaderId");
      }
      if (body.demoAttemptId !== undefined) {
        requireUuidParam(body.demoAttemptId, "DemoAttemptId");
        if (deps.cardProvider?.provider !== "simulator")
          throw new AppError("management.request_invalid", { field: "demoAttemptId" });
      }
      // Resolved after the capability firewall so its refusal keeps its status.
      const saleCfg = sendingCfg(cfg, c, device);

      const { provider, reader } = await resolveCardCollector(deps, device.deviceId, body.readerId);
      const outcome = await payWorkingOrderIntegrated(
        {
          db: deps.db,
          backend: deps.backend,
          clock: deps.clock,
          provider,
          ...(reader === undefined ? {} : { readerRef: reader.providerRef, readerId: reader.id }),
          log,
        },
        saleCfg,
        { ...body, zoneId },
        personId,
      );
      return c.json(outcome); // 200 with the discriminated outcome — even a decline.
    }),
  );

  // Idempotent on the client-minted `body.id`: a re-sent park collides on the primary key and
  // replays the existing open order's `{ id, orderNumber }`.
  app.post("/api/working-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{
        id: string;
        lines: ({
          menuItemId: string;
          quantity: string;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
        } & LineExtras)[];
        zoneId?: string;
        label?: string;
      }>(c);
      // The client mints `body.id`, which becomes the stored primary key; this screen is the only
      // refusal of a malformed one.
      requireUuidParam(body.id, "WorkingOrderId");
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const zoneId = await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId);
      await gateZones(
        deps,
        session,
        named(zoneId !== undefined && { zoneId }, { orderId: body.id }),
      );
      const result = await parkOrder({ db: deps.db }, cfg, {
        id: body.id,
        lines: body.lines,
        zoneId,
        label: body.label,
        operatorId: personId,
      });
      return c.json(result);
    }),
  );

  // Venue-wide: every open working order, whatever `node_id` it carries.
  app.get("/api/working-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const orders = await listHeldOrders({ db: deps.db }, deps.cfg);
      return c.json(await visibleOrders(deps, session, orders));
    }),
  );

  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const order = await getHeldOrder({ db: deps.db }, deps.cfg, id);
      return c.json(order);
    }),
  );

  app.get("/api/working-orders/:id/placed", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      return c.json(await getPlacedCounterOrder({ db: deps.db }, deps.cfg, id));
    }),
  );

  app.put("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        lines: ({
          menuItemId: string;
          quantity: string;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
        } & LineExtras)[];
        label?: string;
        revision?: unknown;
      }>(c);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const revision = await updateHeldOrder(
        { db: deps.db },
        sendCfg,
        id,
        {
          lines: body.lines,
          label: body.label,
          revision: requireRevision(body.revision),
          operatorId: personId,
        },
        { fiscal, saleCfg: sendCfg },
      );
      return c.json({ revision });
    }),
  );

  app.put("/api/working-orders/:id/invoice-choice", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        revision?: unknown;
        invoiceType: "F1" | "F2";
        recipient: {
          taxId: string;
          legalName: string;
          address: string;
          countryCode: string;
        } | null;
      }>(c);
      const revision = await setOrderInvoiceChoice(deps.db, deps.backend, cfg, id, {
        revision: requireRevision(body.revision),
        invoiceType: body.invoiceType,
        recipient: body.recipient,
      });
      return c.json({ revision });
    }),
  );

  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      await abandonHeldOrder({ db: deps.db }, cfg, id);
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/place", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const result = await placeOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        sendingCfg(cfg, c, session.device),
        id,
        personId,
      );
      return c.json(result);
    }),
  );

  app.post("/api/working-orders/:id/prep", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      await gateZones(deps, session, [{ orderId: id }]);
      await sendToPrep({ db: deps.db }, cfg, id);
      return c.body(null, 200);
    }),
  );

  app.get("/api/stations", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const stations = await withTransaction(deps.db, async (tx) => {
        const listed = await listStations(tx, deps.cfg);
        const states = await VENUE_SERVICE.stationStates(
          tx,
          { locationId: deps.cfg.locationId },
          new Date(),
        );
        return listed.map((station) => ({
          ...station,
          open: states.get(station.id)?.open ?? false,
        }));
      });
      return c.json(stations);
    }),
  );

  // The station's work, and the corrections to it (recalls, voids) a cook has not acknowledged.
  app.get("/api/stations/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
      const queue = await withTransaction(deps.db, async (tx) => ({
        items: await listStationQueue(tx, id),
        notices: await VENUE_SERVICE.listStationNotices(tx, deps.cfg, id),
        printersDown: (await stationPrintersDown(tx, deps.cfg.locationId, new Date(), id)).map(
          ({ printerId, printerName, since }) => ({ printerId, printerName, since }),
        ),
      }));
      return c.json(queue);
    }),
  );

  app.post("/api/kitchen-notices/:id/acknowledge", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("ticket.invalid_transition", { ticketItemId: id });
      const body = await readJsonBody<{ to?: string }>(c);
      // `advanceTicketItem` refuses any target outside its transition table before the update runs.
      const to = body.to as TicketState;
      await withTransaction(deps.db, async (tx) => {
        await advanceTicketItem(tx, cfg, id, to);
      });
      return c.body(null, 200);
    }),
  );

  // Unlike the per-line verb, `advanceTicket` does not validate `to` and no-ops on an empty match,
  // so the route screens `to`, and a malformed id gets the same no-op 200.
  app.post("/api/orders/:id/stations/:sid/advance", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const orderId = c.req.param("id");
      const stationId = c.req.param("sid");
      const body = await readJsonBody<{ to?: string }>(c);
      if (body.to !== "preparing" && body.to !== "ready") {
        throw new AppError("management.request_invalid", { field: "to" });
      }
      // The narrowing above does not survive into the closure.
      const to = body.to;
      if (!isUuid(orderId) || !isUuid(stationId)) return c.body(null, 200);
      await withTransaction(deps.db, async (tx) => {
        await advanceTicket(tx, cfg, orderId, stationId, to);
      });
      return c.body(null, 200);
    }),
  );

  mountCourseVerb(app, deps, log, "fire", "take-orders", fireCourse);

  app.get("/api/expo/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const queue = await withTransaction(deps.db, async (tx) => {
        return listExpoQueue(tx, deps.cfg);
      });
      return c.json(queue);
    }),
  );

  app.get("/api/watchers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const watchers = await withTransaction(deps.db, (tx) => listWatchers(tx, deps.cfg));
      return c.json(watchers.map(({ id, name, runsPass }) => ({ id, name, runsPass })));
    }),
  );

  app.get("/api/watchers/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("watcher.not_found", { watcherId: id });
      return c.json(await withTransaction(deps.db, (tx) => listWatcherQueue(tx, deps.cfg, id)));
    }),
  );

  app.post("/api/watchers/:id/done", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("watcher.not_found", { watcherId: id });
      const body = parseWatcherDoneBody(await readJsonBody(c));
      const at = new Date();
      await withTransaction(deps.db, (tx) =>
        markWatcherItems(
          tx,
          cfg,
          id,
          body.ticketItemIds,
          body.done,
          { personId: session.personId },
          at,
        ),
      );
      return c.body(null, 204);
    }),
  );

  // Unlike `fire`/`away`, `bumpCourseReady` does not existence-check the course: an unknown one
  // updates zero rows and answers 200.
  mountCourseVerb(app, deps, log, "ready", "prepare-orders", bumpCourseReady);

  mountCourseVerb(app, deps, log, "away", "hand-over-orders", markCourseAway);

  app.get("/api/orders/counter-waiting", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const waiting = await listCounterWaiting({ db: deps.db }, deps.cfg);
      return c.json(await visibleOrders(deps, session, waiting));
    }),
  );

  // The non-fiscal counter handover; the fiscal collect is `POST /api/working-orders/:id/collect`.
  app.post("/api/orders/:id/collect", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "hand-over-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const submissionId = body.submissionId === undefined ? undefined : submissionIdOf(body);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        return handOverOrder(tx, cfg, id, submissionId);
      });
      return c.body(null, 200);
    }),
  );

  // Re-enqueues through the same outbox a fire uses, so a broken printer cannot make it hang.
  app.post("/api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        await reprintOrderTickets(tx, cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  app.get("/api/sales/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const ticket = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return readSettledTicket(deps.backend, tx, cfg, id);
      });
      return c.json(ticket);
    }),
  );

  app.get("/api/sales/:id/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return readOriginalReceiptPrint(tx, sale.id);
      });
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/receipt/handover", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        return confirmReceiptHandover(tx, sale.id, session.personId);
      });
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/receipt/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt_retry", session.device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const original = await readOriginalReceiptPrint(tx, sale.id);
        if (original.status === "not_queued") throw new AppError("print_job.not_found", { id });
        if (!original.canRetry)
          throw new AppError("print_job.not_resendable", { id: original.jobId });
        return resendPrintJob(tx, original.jobId);
      });
      return c.json(result);
    }),
  );

  // Document actions use the working-order id and never enqueue drawer commands.
  // A filed but unpaid invoice renders without a payment block.
  for (const action of ["receipt", "payment-slip"] as const) {
    app.post(`/api/sales/:id/${action}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c);
        const cfg = requestCfg(deps.cfg, session);
        await assertDeviceCapability(deps, c, "print-receipt", action, session.device);
        const id = requireUuidId(c.req.param("id"), "working_order.not_found");
        await gateZones(deps, session, [{ orderId: id }]);
        if (action === "receipt")
          await printSaleReceipt({ db: deps.db, backend: deps.backend }, cfg, id, false);
        else await printSalePaymentSlip(deps.db, cfg, id);
        return c.body(null, 200);
      }),
    );
  }

  app.post("/api/sales/:id/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const { language } = await readJsonBody<{ language?: unknown }>(c);
      if (language !== undefined && typeof language !== "string") {
        throw new AppError("management.request_invalid", { field: "language" });
      }
      await reprintSale({ db: deps.db, backend: deps.backend }, cfg, id, language);
      return c.body(null, 200);
    }),
  );

  // Session-gated, not permission-gated: any operator may list who could authorize an override.
  app.get("/api/drawer/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const authorizers = await withTransaction(deps.db, async (tx) => {
        return listActivePersonsWithPermission(tx, "cash.drawer");
      });
      return c.json(authorizers);
    }),
  );

  app.post("/api/drawer/open", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const device = session.device;
      await assertDeviceCapability(deps, c, "open-cash-drawer", "drawer_open", device);
      const body = await readJsonBody<{ override?: { personId?: unknown; pin?: unknown } }>(c);
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = await drawerOverrideToCheck(deps.db, sessionId, body);
      await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          const { authorizedBy, viaOverride } = await authorize(
            tx,
            {
              sessionId,
              permission: "cash.drawer",
              override: withCheck(parseDrawerOverride(body.override), checked),
            },
            attempts,
          );

          const printer = await resolveReceiptPrinter(tx, cfg.origin);
          if (printer === undefined) {
            throw new AppError("drawer.no_printer", { deviceId: session.deviceId });
          }
          if (!printer.hasCashDrawer) {
            throw new AppError("drawer.not_attached", { printerId: printer.id });
          }
          await enqueueManualDrawerOpen(tx, cfg, printer.id, personId, authorizedBy, viaOverride);
        }),
      );
      return c.body(null, 200);
    }),
  );

  // `collectOrder` files the placed order's frozen composition, never a client basket, so the body
  // carries only the tender.
  app.post("/api/working-orders/:id/collect", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { permission: "sale.take_payment" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ tender: TillTender }>(c);
      assertTakesTender(session.device, body.tender);
      const result = await collectOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        cfg,
        { id, lines: [], tender: body.tender },
        personId,
      );
      return c.json(result);
    }),
  );

  // Like the refund's list: any operator may see who could approve their cancel and credit.
  app.get("/api/cancel-credit-authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await withTransaction(deps.db, (tx) => listActivePersonsWithPermission(tx, "sale.rectify")),
      );
    }),
  );

  app.post("/api/working-orders/:id/cancel", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ reason: string; override?: unknown }>(c);
      const override = parseOverrideField(body.override);
      await cancelPlacedOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        cfg,
        id,
        body.reason,
        { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
        override,
      );
      return c.body(null, 200);
    }),
  );

  app.get("/api/tables", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const tables = await withTransaction(deps.db, async (tx) => {
        const scope = await readZoneScope(tx, deps.cfg, device.deviceProfileId);
        return (await listTables(tx, deps.cfg)).filter((table) => inScope(scope, table.zoneId));
      });
      return c.json(tables);
    }),
  );

  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const state = await withTransaction(deps.db, async (tx) => {
        const scope = await readZoneScope(tx, deps.cfg, device.deviceProfileId);
        return (await listTablesWithState(tx, deps.cfg, deps.floorAnnotators ?? [])).filter(
          (table) => inScope(scope, table.zoneId),
        );
      });
      return c.json(state);
    }),
  );

  app.get("/api/zones", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const zones = await withTransaction(deps.db, async (tx) => {
        const scope = await readZoneScope(tx, deps.cfg, device.deviceProfileId);
        return (await listZones(tx, deps.cfg)).filter((zone) => inScope(scope, zone.id));
      });
      return c.json(zones);
    }),
  );

  app.get("/api/statuses", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const statuses = await withTransaction(deps.db, async (tx) => {
        return listServiceStatuses(tx);
      });
      return c.json(statuses);
    }),
  );

  app.post("/api/tables/:id/seat", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{ guestCount?: unknown }>(c);
      const guestCount = requireGuestCount(body.guestCount);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ tableId: id }]);
        return seatTable(tx, cfg, { tableId: id, guestCount, operatorId: personId });
      });
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/finish", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = await readJsonBody<{ expectedPartyRevision?: unknown }>(c);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return finishTable(tx, { partyId, expectedPartyRevision, operatorId: personId });
      });
      return c.json(result);
    }),
  );

  app.post("/api/tables/:id/cleared", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ tableId: id }]);
        return markTableCleared(tx, id);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/parties/:id/bill-request", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      const { requested } = body;
      if (typeof requested !== "boolean") throw invalid("requested");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return requestBill(tx, partyId, requested, args);
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/name", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      // The wire always carries a name; null or "" clears it.
      if (body.name === undefined) throw invalid("name");
      const named = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return setPartyName(tx, { partyId, name: body.name, expectedPartyRevision });
      });
      return c.json(named);
    }),
  );

  for (const [path, act, field] of [
    ["move", moveGuests, "toTableId"],
    ["join", joinTables, "tableId"],
  ] as const) {
    app.post(`/api/parties/:id/${path}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "take-orders" });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
        const body = asObject(await readRawJsonBody<unknown>(c));
        const tableId = requireTargetTable(body[field], field);
        const command = tableActionCommand(personId, body);
        const sendCfg = sendingCfg(cfg, c, session.device);
        const result = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, deps.cfg, session, [{ partyId }, { tableId }]);
          return act(tx, sendCfg, partyId, tableId, command);
        });
        return c.json(result);
      }),
    );
  }

  app.post("/api/parties/:id/split-table", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const { tableId } = body;
      if (tableId === undefined) throw invalid("tableId");
      // A malformed id names no table of the party.
      if (typeof tableId !== "string" || !isUuid(tableId)) {
        throw new AppError("table.not_joined", { tableId: String(tableId), partyId });
      }
      const billId =
        body.billId === null ? null : requireOtherBill(body.billId, "billId").toLowerCase();
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const sendCfg = sendingCfg(cfg, c, session.device);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return splitTable(tx, sendCfg, partyId, tableId.toLowerCase(), billId, {
          expectedPartyRevision,
          operatorId: personId,
        });
      });
      return c.json(result);
    }),
  );

  app.get("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const bills = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return readPartyBills(tx, partyId);
      });
      return c.json(bills);
    }),
  );

  app.get("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groups = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return listOrderGroups(tx, partyId);
      });
      return c.json(groups);
    }),
  );

  app.get("/api/parties/:id/current-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const current = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return readCurrentOrders(tx, partyId);
      });
      return c.json(current);
    }),
  );

  app.get("/api/parties/:id/print-problems", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const problems = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return listPrintProblems(tx, partyId);
      });
      return c.json({ problems });
    }),
  );

  app.post("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitGroupsInput = {
        ...groupCommand(personId, body),
        groups: parseSubmittedGroups(body.groups),
        ...joinGroupOf(body),
        ...billOf(body),
      };
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return submitGroups(tx, sendCfg, partyId, input);
      });
      return c.json(submitted);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/fire", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const command = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const fired = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return fireGroup(tx, cfg, partyId, groupId, command);
      });
      return c.json(fired);
    }),
  );

  for (const [step, command, action] of [
    ["ready", bumpGroupReady, "prepare-orders"],
    ["away", markGroupAway, "hand-over-orders"],
  ] as const) {
    app.post(`/api/parties/:id/groups/:gid/${step}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id"));
        const groupId = c.req.param("gid");
        if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
        const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, deps.cfg, session, [{ partyId }]);
          return command(tx, cfg, partyId, groupId, args);
        });
        return c.json(answer);
      }),
    );
  }

  // Serving is an operational fact: nothing here reaches a filed sale.
  for (const [path, command] of [
    ["served", markServed],
    ["unserved", unmarkServed],
  ] as const) {
    app.post(`/api/parties/:id/${path}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action: "hand-over-orders" });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id"));
        const body = asObject(await readRawJsonBody<unknown>(c));
        const args = groupCommand(personId, body);
        const items = parseLineQuantities(body.items, "items");
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, deps.cfg, session, [{ partyId }]);
          return command(tx, cfg, partyId, items, args);
        });
        return c.json(answer);
      }),
    );
  }

  app.post("/api/parties/:id/groups/:gid/served", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "hand-over-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return markGroupServed(tx, cfg, partyId, groupId, args);
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/snooze", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      if (typeof body.minutes !== "number") throw invalid("minutes");
      const minutes = body.minutes;
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return snoozeReminder(tx, cfg, partyId, groupId, minutes, args);
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/unsnooze", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return unsnoozeReminder(tx, cfg, partyId, groupId, args);
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/groups/order", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const { heldGroupIds } = body;
      if (!Array.isArray(heldGroupIds) || !heldGroupIds.every((id) => typeof id === "string")) {
        throw invalid("heldGroupIds");
      }
      const reordered = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return reorderHeldGroups(tx, partyId, heldGroupIds as string[], command);
      });
      return c.json(reordered);
    }),
  );

  app.post("/api/parties/:id/groups/move", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const moves = parseLineQuantities(body.moves, "moves");
      const target = parseMoveTarget(body.target);
      const moved = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return moveLinesToGroup(tx, cfg, partyId, moves, target, command);
      });
      return c.json(moved);
    }),
  );

  app.get("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const drafts = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return readDrafts(tx, deps.cfg, partyId);
      });
      return c.json({ drafts });
    }),
  );

  app.put("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const draftId = requireDraftId(body.draftId);
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return saveDraft(tx, cfg, partyId, personId, { draftId, revision, lines: body.lines });
      });
      return c.json(draft);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/take-over", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return takeOverDraft(tx, cfg, partyId, draftId, personId, revision);
      });
      return c.json(draft);
    }),
  );

  app.post("/api/dead-ends/draft", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{ partyId: string; draftId: string; lineIds: string[] }>(c);
      const partyId = requireDraftPartyParam(body.partyId);
      const draftId = requireDraftParam(body.draftId);
      if (!Array.isArray(body.lineIds)) throw invalid("lineIds");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        const at = new Date();
        const draft = (await readDrafts(tx, cfg, partyId)).find((entry) => entry.id === draftId);
        if (draft === undefined) throw new AppError("draft.not_found", { draftId });
        const ids = new Set(body.lineIds);
        const lines = draft.lines.filter((line) => ids.has(line.id));
        if (lines.length !== ids.size) throw invalid("lineIds");
        const zoneId = await partyZone(tx, cfg, partyId);
        const priced = await priceOrderLines(
          tx,
          cfg,
          newId(),
          lines.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
            options: line.options,
            extras: line.extras,
            note: line.note ?? undefined,
            variantId: line.variantId ?? undefined,
            menuVersionId: line.menuVersionId ?? undefined,
            courseId: line.courseId ?? undefined,
            makeAt: line.makeAt,
          })),
          zoneId ?? undefined,
          undefined,
          "ignore",
        );
        const parents = priced.lineRows.filter((line) => line.parentLineId === null);
        return {
          sends: true,
          deadEnds: await findDeadEnds(
            tx,
            cfg,
            zoneId,
            lines.map((line, index) => ({
              key: line.id,
              productId: parents[index]!.productId!,
              quantity: line.quantity,
              makeAt: line.makeAt ?? null,
            })),
            at,
          ),
          stations: await availableStations(tx, cfg, at),
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/submit", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitDraftInput = {
        ...groupCommand(personId, body),
        draftRevision: requireRevision(body.draftRevision, "draftRevision"),
        groups: parseDraftGroups(body.groups),
        ...joinGroupOf(body),
        ...billOf(body),
      };
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ partyId }]);
        return submitDraft(tx, sendCfg, partyId, draftId, input);
      });
      return c.json(submitted);
    }),
  );

  // A tab does not re-price: the stored locked gross rides back verbatim. The revision is read in
  // the same transaction, so it is the one these lines are at.
  app.post("/api/dead-ends/order", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{ workingOrderId: string; toZoneId?: string }>(c);
      const id = requireUuidParam(body.workingOrderId, "WorkingOrderId");
      if (body.toZoneId !== undefined) requireUuidParam(body.toZoneId, "ServiceZoneId");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(
          tx,
          deps.cfg,
          session,
          named({ orderId: id }, body.toZoneId !== undefined && { zoneId: body.toZoneId }),
        );
        const at = new Date();
        const [order] = await tx
          .select({
            status: workingOrders.status,
            partyId: workingOrders.partyId,
            revision: workingOrders.revision,
          })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (order === undefined || (order.status !== "open" && order.status !== "placed"))
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const context = await VENUE_SERVICE.findOrderContext(tx, cfg, id);
        const zoneId = body.toZoneId ?? context?.zoneId ?? null;
        const unsent = await unsentDishLines(tx, id);
        const sends =
          unsent.length > 0 &&
          (body.toZoneId === undefined
            ? (context?.serviceMode ?? "prepay") === "prepay" ||
              (order.partyId === null && paysAfterSending(context?.serviceMode))
            : await moveWouldSend(tx, cfg, id, body.toZoneId));
        const chosen =
          unsent.length === 0
            ? []
            : await tx
                .select({ id: workingOrderLines.id, makeAt: workingOrderLines.makeAtStationId })
                .from(workingOrderLines)
                .where(
                  inArray(
                    workingOrderLines.id,
                    unsent.map((line) => line.id),
                  ),
                );
        const makeAtById = new Map(chosen.map((line) => [line.id, line.makeAt]));
        return {
          sends,
          deadEnds: sends
            ? await findDeadEnds(
                tx,
                cfg,
                zoneId,
                unsent
                  .filter((line) => line.productId !== null)
                  .map((line) => ({
                    key: line.id,
                    productId: line.productId!,
                    quantity: thousandthsToDecimal(line.quantity),
                    makeAt: makeAtById.get(line.id) ?? null,
                  })),
                at,
              )
            : [],
          stations: await availableStations(tx, cfg, at),
          revision: order.revision,
        };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/working-orders/:id/make-at", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const body = await readJsonBody<{ revision: unknown; lines: Record<string, string | null> }>(
        c,
      );
      const copy = requireRevision(body.revision);
      if (body.lines === null || typeof body.lines !== "object" || Array.isArray(body.lines))
        throw invalid("lines");
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const [order] = await tx
          .select({ status: workingOrders.status, revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, id));
        if (order === undefined || order.status !== "open")
          throw new AppError("working_order.not_open", { workingOrderId: id });
        if (copy !== order.revision)
          throw new AppError("working_order.out_of_date", {
            workingOrderId: id,
            revision: order.revision,
          });
        const entries = Object.entries(body.lines);
        const unsent = new Set((await unsentDishLines(tx, id)).map((line) => line.id));
        for (const [lineId, stationId] of entries) {
          if (!unsent.has(lineId)) throw invalid("lines");
          if (stationId !== null) {
            if (typeof stationId !== "string") throw invalid("lines");
            await requireMakeAtStation(tx, cfg, stationId);
          }
        }
        for (const [lineId, stationId] of entries)
          await tx
            .update(workingOrderLines)
            .set({ makeAtStationId: stationId })
            .where(eq(workingOrderLines.id, lineId));
        if (entries.length > 0) await bumpRevision(tx, [id]);
        else await refusePaymentInFlight(tx, [id]);
        return copy + (entries.length > 0 ? 1 : 0);
      });
      return c.json({ revision });
    }),
  );

  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const tab = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        return {
          lines: await readTabLines(tx, deps.cfg, id),
          revision: await readOrderRevision(tx, id),
          editSentLines: await VENUE_SERVICE.readEditSentLines(tx),
        };
      });
      return c.json(tab);
    }),
  );

  app.post("/api/working-orders/:id/lines/move-station", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const submissionId = submissionIdOf(body);
      if (
        !Array.isArray(body.lineIds) ||
        body.lineIds.length === 0 ||
        body.lineIds.length > 100 ||
        !body.lineIds.every((lineId) => typeof lineId === "string")
      )
        throw invalid("lineIds");
      const lineIds = body.lineIds as string[];
      for (const lineId of lineIds)
        if (!isUuid(lineId)) throw new AppError("tab.line_not_found", { tabId: id, lineId });
      if (typeof body.stationId !== "string" || !isUuid(body.stationId))
        throw new AppError("station.not_found", { stationId: String(body.stationId) });
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        return moveDishesToStation(tx, cfg, id, {
          submissionId,
          lineIds,
          stationId: body.stationId as string,
        });
      });
      return c.json(result);
    }),
  );

  // One line of any open order, edited from the copy at `revision` (plan D10).
  app.put("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const { revision, ...patch } = await readJsonBody<OrderLinePatch & { revision?: unknown }>(c);
      const copy = requireRevision(revision);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const saved = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        const revision = await updateOrderLine(tx, sendCfg, id, lineNo, patch, copy, personId);
        await issueIfFullyPaid(tx, fiscal, sendCfg, id, personId);
        return { revision, party: await partyRevisionOfOrder(tx, id) };
      });
      return c.json(saved);
    }),
  );

  app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const body = await readJsonBody<{ courseId?: string | null }>(c);
      const courseId = body.courseId ?? null;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        await setLineCourse(tx, cfg, id, lineNo, courseId);
      });
      return c.body(null, 200);
    }),
  );

  // An omitted or empty `lineNos` releases every held line of the tab outside a held group.
  app.post("/api/working-orders/:id/lines/send", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ lineNos?: number[] }>(c);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        await sendLines(tx, cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/lines/recall", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ lineNos?: number[] }>(c);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: id }]);
        await recallLines(tx, cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tables/:id/status", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{ statusId: string | null }>(c);
      const statusId = body.statusId ?? null;
      if (statusId !== null && !isUuid(statusId))
        throw new AppError("status.not_found", { statusId });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ tableId: id }]);
        await setTableStatus(tx, cfg, id, statusId);
      });
      return c.body(null, 200);
    }),
  );

  // Unlike the sibling table routes, placement is a manager-level venue-config write: `authorize`
  // checks the operator's own `venue.configure`, with no supervisor override, before any write.
  app.put("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{
        zoneId?: unknown;
        posX?: unknown;
        posY?: unknown;
        shape?: unknown;
        rotation?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.zoneId !== "string")
        throw new AppError("management.request_invalid", { field: "zoneId" });
      if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
      if (typeof body.posX !== "number")
        throw new AppError("management.request_invalid", { field: "posX" });
      if (typeof body.posY !== "number")
        throw new AppError("management.request_invalid", { field: "posY" });
      if (typeof body.shape !== "string")
        throw new AppError("management.request_invalid", { field: "shape" });
      if (typeof body.rotation !== "number")
        throw new AppError("management.request_invalid", { field: "rotation" });
      // The narrowings above do not survive into the closure; the verb re-validates `shape`.
      const { zoneId, posX, posY, rotation } = body;
      const shape = body.shape as FloorTableShape;
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ tableId: id }, { zoneId }]);
        await authorize(tx, { sessionId, permission: "venue.configure" });
        await setTablePlacement(tx, cfg, id, { zoneId, posX, posY, shape, rotation });
      });
      return c.body(null, 204);
    }),
  );

  // The same gate as the PUT.
  app.delete("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ tableId: id }]);
        await authorize(tx, { sessionId, permission: "venue.configure" });
        await clearPlacement(tx, cfg, id);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/bills/:id/split", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const transfers = requireTransfers(body.transfers);
      const command = billCommand(personId, body);
      const saleCfg = sendingCfg(cfg, c, session.device);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: billId }]);
        const split = await splitBill(tx, cfg, billId, transfers, command);
        await issueIfFullyPaid(tx, fiscal, saleCfg, billId, personId);
        return split;
      });
      return c.json(result);
    }),
  );

  // The path is the bill merged INTO.
  app.post("/api/bills/:id/merge", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const intoBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const fromBillId = requireOtherBill(body.fromBillId, "fromBillId");
      const command = billCommand(personId, body);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: intoBillId }, { orderId: fromBillId }]);
        return mergeBills(tx, cfg, intoBillId, fromBillId, command);
      });
      return c.body(null, 204);
    }),
  );

  // The path is the bill the items leave.
  app.post("/api/bills/:id/transfer", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const fromBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const toBillId = requireOtherBill(body.toBillId, "toBillId");
      const transfers = requireTransfers(body.transfers);
      const command = billCommand(personId, body);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [{ orderId: fromBillId }, { orderId: toBillId }]);
        return transferItems(tx, cfg, fromBillId, toBillId, transfers, command);
      });
      return c.body(null, 204);
    }),
  );

  // A move changes no amount, so nothing is invoiced here.
  app.post("/api/bills/:id/move", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const to = requireMoveTarget(body.to);
      const command = moveCommand(personId, body);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, deps.cfg, session, [
          { orderId: billId },
          ...named(
            "tableId" in to && { tableId: to.tableId },
            "counter" in to && to.counter.zoneId !== null && { zoneId: to.counter.zoneId },
          ),
        ]);
        return moveBill(tx, sendCfg, billId, to, command);
      });
      return c.json(result);
    }),
  );
}
