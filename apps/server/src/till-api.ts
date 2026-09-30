import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import { AppError, isAppError, isValidGuestCount, SUPPORTED_LOCALES } from "@waitron/shared";
import type { FloorAnnotator } from "@waitron/module";
import { locations, readNodeMembership, readTenant, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorize,
  createPinThrottle,
  endSession,
  listActivePersonsWithPermission,
  listActiveStaff,
  loginWithPin,
  roleHasPermission,
  setPersonLocale,
} from "@waitron/identity";
import type { PinAttempts, PinThrottle } from "@waitron/identity";
import { listAccessibleCatalogues, listAvailableProducts } from "@waitron/catalogue";
import {
  kindOfFormFactor,
  getReceipt,
  getCanvas,
  getCanvasForFormFactor,
  getDeviceProfile,
} from "@waitron/layouts";
import type { CanvasDef, CapabilityFlag } from "@waitron/layouts";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { CardProviderContribution, PaymentProvider } from "@waitron/payments";
import { cardProviderById, cardReaders, deviceCardReaders } from "@waitron/payments";
import { tenantCredentials } from "@waitron/credentials";
import { routableServers } from "@waitron/membership";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { OnboardingIntent } from "./trading-config.js";
import { VENUE_SERVICE } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import {
  collectOrder,
  payWorkingOrderIntegrated,
  recordTillSale,
  reprintSale,
  printSaleReceipt,
} from "./till-sale.js";
import type { IntegratedPayRequest, TillSaleRequest, TillTender } from "./till-sale.js";
import { enqueueManualDrawerOpen, resolveReceiptPrinter } from "./receipt-print.js";
import {
  clearPlacement,
  createTable,
  deactivateTable,
  listServiceStatuses,
  listTables,
  listZones,
  setTablePlacement,
  setTableStatus,
  updateTable,
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
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  listTablesWithState,
  markCollected,
  markCourseAway,
  markGroupServed,
  markServed,
  parkOrder,
  placeOrder,
  readTabLines,
  recallLines,
  sendLines,
  sendToPrep,
  setLineCourse,
  unmarkServed,
  readOrderRevision,
  updateHeldOrder,
  updateOrderLine,
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
} from "./parties.js";
import { mergeBills, splitBill, transferItems } from "./bill-actions.js";
import type { BillCommand } from "./bill-actions.js";
import { moveBill } from "./move-bill.js";
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
import type { SubmitDraftInput } from "./order-drafts.js";
import { invalid } from "./bill-allocation.js";
import { printSalePaymentSlip } from "./payment-slip-print.js";
import { issueIfFullyPaid } from "./bill-payments.js";
import {
  asObject,
  mountBillPaymentsApi,
  submissionIdOf,
  withSaleTillWhenIssuing,
} from "./bill-payments-api.js";
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
  assertNotHandheld,
  requireDevice,
  requireSaleTillId,
  tryReadDevice,
} from "./device-session.js";
import { requireBodyUuid, requireUuidParam } from "@waitron/server-kit";
import { requestBill } from "./bill-request.js";
import { mountAdjustmentsApi } from "./adjustments-api.js";
// Side-effect only: loads this host's errors.ts augmentation.
import "./errors.js";

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
  /** The venue's default UI locale, distinct from the fiscal `cfg.locale` the receipt uses. */
  venueLocale: string;
  /** The setup journey that created this installation, shown persistently by the till. */
  onboardingIntent?: OnboardingIntent;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
}

async function resolveHttpOrderZone(
  deps: TillApiDeps,
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return withTransaction(
    deps.db,
    async (tx) => (await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {})).zoneId,
  );
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
 * The provider a card on a reader is collected through: in practice mode the local simulator,
 * stamping no reader; otherwise the pooled provider of the requested reader, or of the device's.
 */
export async function resolveCardCollector(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ provider: PaymentProvider; reader?: { id: string; providerRef: string } }> {
  if (deps.cardProvider?.provider === "simulator") return { provider: deps.cardProvider };
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
  "pin.invalid": 401,
  // 429, not 401, so the till can tell "wait N seconds" apart from "wrong PIN".
  "pin.throttled": 429,
  "person.not_found": 401,
  // Authenticated device lacks the action capability or is excluded from the workflow.
  "device.forbidden_action": 403,
  // The same codes and statuses `device-api.ts`'s map assigns.
  "device.unauthorized": 401,
  "device.till_required": 400,
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
  "working_order.not_open": 409,
  "working_order.out_of_date": 409,
  "order.payment_in_flight": 409,
  "working_order.not_placed": 409,
  "working_order.not_settled": 409,
  "working_order.already_collected": 409,
  "ticket.not_fired": 409,
  "working_order.reason_required": 400,
  "ticket.already_fired": 409,
  "ticket.invalid_transition": 409,
  "ticket.item_held": 409,
  "ticket.already_started": 409,
  "course.not_found": 404,
  "station.no_default": 409,
  "station.not_found": 404,
  "kitchen_notice.not_found": 404,
  "service_zone.not_found": 404,
  "service_zone.default_missing": 409,
  "service_zone.offer_not_allowed": 400,
  "service_zone.mode_incompatible": 409,
  "service_zone.join_mismatch": 409,
  "order.service_context_missing": 409,
  "route.subject_not_found": 404,
  "route.missing": 409,
  "route.station_inactive": 409,
  "management.request_invalid": 400,
  "reader.not_found": 404,
  "reader.provider_disconnected": 409,
  "table.not_found": 404,
  "table.label_taken": 409,
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

/**
 * Where the till's override PINs count their wrong tries: one bucket per till, apart from sign-in's
 * per-device one. It is the requesting SESSION's till because that is fixed when the session opens:
 * the device cookie can be left off a request, and anyone can open a fresh session with their own
 * PIN, so keying on either would let a caller start the count again.
 */
export function overridePinAttempts(pinThrottle: PinThrottle, sessionTillId: string): PinAttempts {
  return { throttle: pinThrottle, slot: `override:${sessionTillId}` };
}

/**
 * The whole bound on `dining_tables.capacity`: it is a plain integer column with no check, so
 * nothing below this screen refuses an out-of-range value.
 */
function requireCapacity(capacity: number | undefined): void {
  if (capacity === undefined) return;
  if (!Number.isInteger(capacity) || capacity < 0 || capacity > 2_147_483_647) {
    throw new AppError("management.request_invalid", { field: "capacity" });
  }
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
function requirePartyParam(id: string): string {
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
 * `fire_control` venue setting decides which UI shows the button, not who may call it.
 */
function mountCourseVerb(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  suffix: string,
  verb: (
    tx: Transaction,
    cfg: TillConfig,
    orderId: string,
    courseId: string,
    operatorId: string,
  ) => Promise<void>,
): void {
  app.post(`/api/orders/:id/courses/:courseId/${suffix}`, (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const courseId = c.req.param("courseId");
      if (!isUuid(courseId)) throw new AppError("course.not_found", { courseId });
      await withTransaction(deps.db, async (tx) => {
        await verb(tx, deps.cfg, orderId, courseId, personId);
      });
      return c.body(null, 200);
    }),
  );
}

/**
 * Mount the till routes with the shared error boundary. Handhelds can take orders and settle cash
 * or manual-card sales. Integrated card payment, drawer opening and receipt printing require their
 * corresponding device-profile capabilities. Placement, collection and cancellation retain the
 * handheld restriction because they write the deferred-settlement or amendment workflow.
 */
export function mountTillApi(app: Hono, deps: TillApiDeps, log: Logger): void {
  // Built once per mount so its in-memory state persists across requests.
  const pinThrottle = deps.pinThrottle ?? createPinThrottle();
  // What a write that leaves a bill fully paid issues its invoice with (bill payments design §7).
  const fiscal = { db: deps.db, backend: deps.backend, clock: deps.clock, log };
  mountBillPaymentsApi(app, deps, log, run, pinThrottle);
  mountAdjustmentsApi(app, deps, log, run, pinThrottle);

  // Device-gated: the throttle keys on the authenticated device, so dropping the cookie cannot
  // evade it, and the shift records the device's own till rather than `cfg.tillId`.
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
      const device = await requireDevice(deps, c);
      // `sessions.till_id` is NOT NULL, and a till-less device (a kds display) holds no shift.
      if (device.tillId === null) throw new AppError("device.till_required", {});
      const deviceTillId = device.tillId;
      pinThrottle.check(device.deviceId, personId);
      let session;
      try {
        session = await withTransaction(deps.db, async (tx) => {
          return loginWithPin(tx, {
            tillId: deviceTillId,
            personId,
            pin,
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
      // Convenience only: every server gate re-checks the permission via `authorize`, so a tampered
      // client value grants nothing.
      const canConfigureTill = roleHasPermission(session.role, "venue.configure");
      return c.json({ personId: session.personId, canConfigureTill, locale: session.locale });
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

  // Deliberately unauthenticated: the lock screen's roster. No PIN material, role or status.
  app.get("/api/staff", (c) =>
    run(c, log, async () => {
      const staff = await withTransaction(deps.db, async (tx) => {
        return listActiveStaff(tx);
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
            receiptPrintMode: locations.receiptPrintMode,
          })
          .from(locations)
          .where(eq(locations.id, deps.cfg.locationId));
        const courses = (await listCourses(tx, deps.cfg)).map((course) => ({
          id: course.id,
          name: course.name,
          displayOrder: course.displayOrder,
        }));
        const receipt = await getReceipt(tx);
        let canvas: CanvasDef;
        let capabilities: CapabilityFlag[] = [];
        let inactivityTimeoutSeconds: number | null = null;
        if (device != null) {
          const profile =
            device.deviceProfileId != null
              ? await getDeviceProfile(tx, device.deviceProfileId)
              : undefined;
          capabilities = profile?.capabilities ?? [];
          inactivityTimeoutSeconds = profile?.inactivityTimeoutSeconds ?? null;
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
          issuer:
            taxpayer === null ? undefined : { venueName: taxpayer.legalName, nif: taxpayer.taxId },
          bumpMode: loc?.bumpMode,
          fireControl: loc?.fireControl,
          receiptPrintMode: loc?.receiptPrintMode,
          courses,
          receipt,
          canvas,
          capabilities,
          inactivityTimeoutSeconds,
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
        // The receipt's language, kept separate from the UI `locale`: the UI derivation drops
        // UI-unsupported codes, which must never reach the receipt.
        invoiceLocale: deps.cfg.locale,
        onboardingIntent: deps.onboardingIntent,
        venueName: boot.issuer.venueName,
        nif: boot.issuer.nif,
        orderFlow: deps.cfg.orderFlow,
        bumpMode: boot.bumpMode,
        fireControl: boot.fireControl,
        courses: boot.courses,
        cardProvider: (deps.cardProvider?.provider === "simulator"
          ? "simulator"
          : (boot.defaultReaderProvider ?? "none")) satisfies TillCardProvider,
        // A venue can have several active readers on one provider, so the till needs the row id.
        defaultReaderId:
          deps.cardProvider?.provider === "simulator" ? undefined : boot.defaultReaderId,
        activeReaders: boot.activeReaders,
        tipsEnabled: deps.cfg.tipsEnabled,
        receipt: boot.receipt,
        receiptPrintMode: boot.receiptPrintMode,
        canvas: boot.canvas,
        capabilities: boot.capabilities,
        inactivityTimeoutSeconds: boot.inactivityTimeoutSeconds,
        // The till polls each server's `GET /api/node` to follow the primary across a failover.
        nodeId: deps.cfg.nodeId,
        servers: routableServers(held),
      });
    }),
  );

  // Unauthenticated: the till fetches it before login.
  app.get("/api/locales", (c) =>
    run(c, log, async () => c.json({ locales: SUPPORTED_LOCALES, venueDefault: deps.venueLocale })),
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
      await requireSession(deps, c);
      const device = await tryReadDevice(deps, c);
      const result = await withTransaction(deps.db, async (tx) => {
        const context = await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {
          deviceId: device?.deviceId,
        });
        return {
          context,
          zones: (await VENUE_SERVICE.listServiceZones(tx, deps.cfg)).filter(
            (zone) => zone.serviceMode !== "table_tab",
          ),
          ...(await VENUE_SERVICE.listZoneOffers(tx, deps.cfg, context.zoneId, {
            deviceProfileId: device?.deviceProfileId,
          })),
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
      await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const device = await tryReadDevice(deps, c);
      const result = await withTransaction(deps.db, async (tx) => {
        const context = await VENUE_SERVICE.resolveZoneContext(tx, deps.cfg, zoneId);
        return {
          context,
          ...(await VENUE_SERVICE.listZoneOffers(tx, deps.cfg, zoneId, {
            deviceProfileId: device?.deviceProfileId,
          })),
        };
      });
      return c.json(result);
    }),
  );

  app.get("/api/menu-state", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const named = c.req.query("zoneId");
      const zoneId = named === undefined ? undefined : requireUuidParam(named, "ServiceZoneId");
      const device = await tryReadDevice(deps, c);
      const state = await withTransaction(deps.db, async (tx) => {
        const zone =
          zoneId === undefined
            ? (
                await VENUE_SERVICE.resolveNewOrderZone(tx, deps.cfg, {
                  deviceId: device?.deviceId,
                })
              ).zoneId
            : (await VENUE_SERVICE.resolveZoneContext(tx, deps.cfg, zoneId)).zoneId;
        return VENUE_SERVICE.menuState(tx, zone, { deviceProfileId: device?.deviceProfileId });
      });
      return c.json(state);
    }),
  );

  app.post("/api/sales", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Not fenced against a handheld: cash and manual-card sales file under the submitting node's
      // SIF, not the till, and a manual card is charged on a terminal the POS never talks to. Only
      // the integrated reader (`POST /api/pay`) is fenced, by capability.
      const body = await readJsonBody<TillSaleRequest>(c);
      if (body.workingOrderId !== undefined) {
        requireUuidParam(body.workingOrderId, "WorkingOrderId");
      }
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const zoneId = await resolveHttpOrderZone(deps, body.lines.length, body.zoneId);
      // The device supplies `tillId`; `nodeId`/`seriesId`, the SIF and chain key, stay `deps.cfg`.
      const device = await tryReadDevice(deps, c);
      const saleCfg: TillConfig = {
        ...deps.cfg,
        tillId: await requireSaleTillId(deps, c, device),
        allowCashDrawer: device === null || kindOfFormFactor(device.formFactor) === "till",
      };
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
      const { personId } = await requireSession(deps, c);
      // Resolved once for both device guards: `tryReadDevice` may run a scrypt verification.
      const device = await tryReadDevice(deps, c);
      // A cookie-less caller passes this guard but is refused `device.unauthorized` by
      // `requireSaleTillId` below.
      await assertDeviceCapability(deps, c, "integrated-card-payment", "pay", device);
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
      const zoneId = await resolveHttpOrderZone(deps, body.lines.length, body.zoneId);
      if (body.readerId !== undefined) {
        requireUuidParam(body.readerId, "CardReaderId");
      }
      // Resolved after the capability firewall so its refusal keeps its status.
      const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c, device) };

      const { provider, reader } = await resolveCardCollector(
        deps,
        device?.deviceId,
        body.readerId,
      );
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
      const { personId } = await requireSession(deps, c);
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
      const zoneId = await resolveHttpOrderZone(deps, body.lines.length, body.zoneId);
      const result = await parkOrder({ db: deps.db }, deps.cfg, {
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
      await requireSession(deps, c);
      const orders = await listHeldOrders({ db: deps.db }, deps.cfg);
      return c.json(orders);
    }),
  );

  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const order = await getHeldOrder({ db: deps.db }, deps.cfg, id);
      return c.json(order);
    }),
  );

  app.put("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
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
      const revision = await withSaleTillWhenIssuing(deps, c, (saleCfg) =>
        updateHeldOrder(
          { db: deps.db },
          deps.cfg,
          id,
          {
            lines: body.lines,
            label: body.label,
            revision: requireRevision(body.revision),
            operatorId: personId,
          },
          { fiscal, saleCfg },
        ),
      );
      return c.json({ revision });
    }),
  );

  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await abandonHeldOrder({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/place", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall: placing a Mode-I order files a deferred chained invoice, and a handheld
      // never settles through place.
      const device = await tryReadDevice(deps, c);
      await assertNotHandheld(deps, c, "place", device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      // The device's till reaches the fiscal record only; the `order_placed` amendment keeps the
      // box's configured `cfg.tillId`, matching `cancelPlacedOrder`.
      const saleTillId = await requireSaleTillId(deps, c, device);
      const result = await placeOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        deps.cfg,
        id,
        personId,
        saleTillId,
      );
      return c.json(result);
    }),
  );

  app.post("/api/working-orders/:id/prep", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      await sendToPrep({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  app.get("/api/stations", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const stations = await withTransaction(deps.db, async (tx) => {
        return listStations(tx, deps.cfg);
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
      }));
      return c.json(queue);
    }),
  );

  app.post("/api/kitchen-notices/:id/acknowledge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("ticket.invalid_transition", { ticketItemId: id });
      const body = await readJsonBody<{ to?: string }>(c);
      // `advanceTicketItem` refuses any target outside its transition table before the update runs.
      const to = body.to as TicketState;
      await withTransaction(deps.db, async (tx) => {
        await advanceTicketItem(tx, deps.cfg, id, to);
      });
      return c.body(null, 200);
    }),
  );

  // Unlike the per-line verb, `advanceTicket` does not validate `to` and no-ops on an empty match,
  // so the route screens `to`, and a malformed id gets the same no-op 200.
  app.post("/api/orders/:id/stations/:sid/advance", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
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
        await advanceTicket(tx, deps.cfg, orderId, stationId, to);
      });
      return c.body(null, 200);
    }),
  );

  mountCourseVerb(app, deps, log, "fire", fireCourse);

  app.get("/api/expo/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const queue = await withTransaction(deps.db, async (tx) => {
        return listExpoQueue(tx, deps.cfg);
      });
      return c.json(queue);
    }),
  );

  // Unlike `fire`/`away`, `bumpCourseReady` does not existence-check the course: an unknown one
  // updates zero rows and answers 200.
  mountCourseVerb(app, deps, log, "ready", bumpCourseReady);

  mountCourseVerb(app, deps, log, "away", markCourseAway);

  // The non-fiscal counter handover; the fiscal collect is `POST /api/working-orders/:id/collect`.
  app.post("/api/orders/:id/collect", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      await markCollected({ db: deps.db }, deps.cfg, id);
      return c.body(null, 200);
    }),
  );

  // Re-enqueues through the same outbox a fire uses, so a broken printer cannot make it hang.
  app.post("/api/orders/:id/reprint", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTransaction(deps.db, async (tx) => {
        await reprintOrderTickets(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  // Document actions use the working-order id and never enqueue drawer commands.
  // A filed but unpaid invoice renders without a payment block.
  for (const action of ["receipt", "payment-slip"] as const) {
    app.post(`/api/sales/:id/${action}`, (c) =>
      run(c, log, async () => {
        await requireSession(deps, c);
        await assertDeviceCapability(deps, c, "print-receipt", action);
        const id = requireUuidId(c.req.param("id"), "working_order.not_found");
        if (action === "receipt")
          await printSaleReceipt({ db: deps.db, backend: deps.backend }, deps.cfg, id, false);
        else await printSalePaymentSlip(deps.db, deps.cfg, id);
        return c.body(null, 200);
      }),
    );
  }

  app.post("/api/sales/:id/reprint", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint");
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await reprintSale({ db: deps.db, backend: deps.backend }, deps.cfg, id);
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

  // Audited: records a `drawer_opens('manual')` row beside a kick-only job to the till's receipt
  // printer. The `drawer_open_policy` gate runs before the printer lookup, so an unpermitted
  // operator is refused whatever the printer state.
  app.post("/api/drawer/open", (c) =>
    run(c, log, async () => {
      const { personId, sessionId, tillId } = await requireSession(deps, c);
      const device = await tryReadDevice(deps, c);
      await assertNotHandheld(deps, c, "drawer_open", device);
      await assertDeviceCapability(deps, c, "open-cash-drawer", "drawer_open", device);
      const body = await readJsonBody<{ override?: { personId?: unknown; pin?: unknown } }>(c);
      await withTransaction(deps.db, async (tx) => {
        const [loc] = await tx
          .select({ policy: locations.drawerOpenPolicy })
          .from(locations)
          .where(eq(locations.id, deps.cfg.locationId));
        // A missing location row falls back to the secure 'gated' default.
        /* v8 ignore start -- unreachable: the provisioned till's own location row exists */
        const policy = loc?.policy ?? "gated";
        /* v8 ignore stop */

        const { authorizedBy, viaOverride } =
          policy === "open"
            ? { authorizedBy: personId, viaOverride: false }
            : await authorize(
                tx,
                {
                  sessionId,
                  permission: "cash.drawer",
                  override: parseDrawerOverride(body.override),
                },
                overridePinAttempts(pinThrottle, tillId),
              );

        const printer = await resolveReceiptPrinter(tx, deps.cfg);
        if (printer === undefined) {
          throw new AppError("drawer.no_printer", { tillId: deps.cfg.tillId });
        }
        if (!printer.hasCashDrawer) {
          throw new AppError("drawer.not_attached", { printerId: printer.id });
        }
        await enqueueManualDrawerOpen(
          tx,
          deps.cfg,
          printer.id,
          personId,
          authorizedBy,
          viaOverride,
        );
      });
      return c.body(null, 200);
    }),
  );

  // `collectOrder` files the placed order's frozen composition, never a client basket, so the body
  // carries only the tender.
  app.post("/api/working-orders/:id/collect", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall: collecting settles the order, a chained fiscal write.
      const device = await tryReadDevice(deps, c);
      await assertNotHandheld(deps, c, "collect", device);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      const body = await readJsonBody<{ tender: TillTender }>(c);
      // The device supplies `tillId`; `nodeId`/`seriesId`, the SIF and chain key, stay `deps.cfg`.
      const saleCfg: TillConfig = { ...deps.cfg, tillId: await requireSaleTillId(deps, c, device) };
      const result = await collectOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        saleCfg,
        { id, lines: [], tender: body.tender },
        personId,
      );
      return c.json(result);
    }),
  );

  app.post("/api/working-orders/:id/cancel", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      // Handheld firewall: cancelling appends to the hash-chained amendment log.
      await assertNotHandheld(deps, c, "cancel");
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      const body = await readJsonBody<{ reason: string }>(c);
      await cancelPlacedOrder(
        { db: deps.db, backend: deps.backend, clock: deps.clock, log },
        deps.cfg,
        id,
        body.reason,
        personId,
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const body = await readJsonBody<{ label: string; zoneId?: string; capacity?: number }>(c);
      requireCapacity(body.capacity);
      // A malformed zoneId would otherwise be stored in `zone_id`; it gets the missing zone's code.
      if (body.zoneId !== undefined && !isUuid(body.zoneId))
        throw new AppError("zone.not_found", { zoneId: body.zoneId });
      const result = await withTransaction(deps.db, async (tx) => {
        return createTable(tx, deps.cfg, body);
      });
      return c.json(result);
    }),
  );

  app.get("/api/tables", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tables = await withTransaction(deps.db, async (tx) => {
        return listTables(tx, deps.cfg);
      });
      return c.json(tables);
    }),
  );

  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const state = await withTransaction(deps.db, async (tx) => {
        return listTablesWithState(tx, deps.cfg, deps.floorAnnotators ?? []);
      });
      return c.json(state);
    }),
  );

  app.get("/api/zones", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const zones = await withTransaction(deps.db, async (tx) => {
        return listZones(tx, deps.cfg);
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

  app.patch("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{ label?: string; zoneId?: string; capacity?: number }>(c);
      requireCapacity(body.capacity);
      // As on create: a malformed zoneId would otherwise be stored.
      if (body.zoneId !== undefined && !isUuid(body.zoneId))
        throw new AppError("zone.not_found", { zoneId: body.zoneId });
      await withTransaction(deps.db, async (tx) => {
        await updateTable(tx, deps.cfg, id, body);
      });
      return c.body(null, 200);
    }),
  );

  app.delete("/api/tables/:id", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await deactivateTable(tx, deps.cfg, id);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tables/:id/seat", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{ guestCount?: unknown }>(c);
      const guestCount = requireGuestCount(body.guestCount);
      const result = await withTransaction(deps.db, async (tx) => {
        return seatTable(tx, deps.cfg, { tableId: id, guestCount, operatorId: personId });
      });
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/finish", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = await readJsonBody<{ expectedPartyRevision?: unknown }>(c);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const result = await withTransaction(deps.db, async (tx) => {
        return finishTable(tx, { partyId, expectedPartyRevision, operatorId: personId });
      });
      return c.json(result);
    }),
  );

  app.post("/api/tables/:id/cleared", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, (tx) => markTableCleared(tx, id));
      return c.body(null, 204);
    }),
  );

  app.post("/api/parties/:id/bill-request", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      const { requested } = body;
      if (typeof requested !== "boolean") throw invalid("requested");
      const answer = await withTransaction(deps.db, (tx) =>
        requestBill(tx, partyId, requested, args),
      );
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/name", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      // The wire always carries a name; null or "" clears it.
      if (body.name === undefined) throw invalid("name");
      const named = await withTransaction(deps.db, (tx) =>
        setPartyName(tx, { partyId, name: body.name, expectedPartyRevision }),
      );
      return c.json(named);
    }),
  );

  for (const [path, act, field] of [
    ["move", moveGuests, "toTableId"],
    ["join", joinTables, "tableId"],
  ] as const) {
    app.post(`/api/parties/:id/${path}`, (c) =>
      run(c, log, async () => {
        const { personId } = await requireSession(deps, c);
        const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
        const body = asObject(await readRawJsonBody<unknown>(c));
        const tableId = requireTargetTable(body[field], field);
        const command = tableActionCommand(personId, body);
        const result = await withTransaction(deps.db, (tx) =>
          act(tx, deps.cfg, partyId, tableId, command),
        );
        return c.json(result);
      }),
    );
  }

  app.post("/api/parties/:id/split-table", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
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
      const result = await withTransaction(deps.db, (tx) =>
        splitTable(tx, deps.cfg, partyId, tableId.toLowerCase(), billId, {
          expectedPartyRevision,
          operatorId: personId,
        }),
      );
      return c.json(result);
    }),
  );

  app.get("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const bills = await withTransaction(deps.db, async (tx) => {
        return readPartyBills(tx, partyId);
      });
      return c.json(bills);
    }),
  );

  app.get("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groups = await withTransaction(deps.db, (tx) => listOrderGroups(tx, partyId));
      return c.json(groups);
    }),
  );

  app.get("/api/parties/:id/current-orders", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const current = await withTransaction(deps.db, (tx) => readCurrentOrders(tx, partyId));
      return c.json(current);
    }),
  );

  app.get("/api/parties/:id/print-problems", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const problems = await withTransaction(deps.db, (tx) => listPrintProblems(tx, partyId));
      return c.json({ problems });
    }),
  );

  app.post("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitGroupsInput = {
        ...groupCommand(personId, body),
        groups: parseSubmittedGroups(body.groups),
        ...joinGroupOf(body),
        ...billOf(body),
      };
      const submitted = await withTransaction(deps.db, (tx) =>
        submitGroups(tx, deps.cfg, partyId, input),
      );
      return c.json(submitted);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/fire", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const command = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const fired = await withTransaction(deps.db, (tx) =>
        fireGroup(tx, deps.cfg, partyId, groupId, command),
      );
      return c.json(fired);
    }),
  );

  for (const [step, command] of [
    ["ready", bumpGroupReady],
    ["away", markGroupAway],
  ] as const) {
    app.post(`/api/parties/:id/groups/:gid/${step}`, (c) =>
      run(c, log, async () => {
        const { personId } = await requireSession(deps, c);
        const partyId = requirePartyParam(c.req.param("id"));
        const groupId = c.req.param("gid");
        if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
        const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
        const answer = await withTransaction(deps.db, (tx) =>
          command(tx, deps.cfg, partyId, groupId, args),
        );
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
        const { personId } = await requireSession(deps, c);
        const partyId = requirePartyParam(c.req.param("id"));
        const body = asObject(await readRawJsonBody<unknown>(c));
        const args = groupCommand(personId, body);
        const items = parseLineQuantities(body.items, "items");
        const answer = await withTransaction(deps.db, (tx) =>
          command(tx, deps.cfg, partyId, items, args),
        );
        return c.json(answer);
      }),
    );
  }

  app.post("/api/parties/:id/groups/:gid/served", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, (tx) =>
        markGroupServed(tx, deps.cfg, partyId, groupId, args),
      );
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/snooze", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const args = groupCommand(personId, body);
      if (typeof body.minutes !== "number") throw invalid("minutes");
      const minutes = body.minutes;
      const answer = await withTransaction(deps.db, (tx) =>
        snoozeReminder(tx, deps.cfg, partyId, groupId, minutes, args),
      );
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/unsnooze", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
      const answer = await withTransaction(deps.db, (tx) =>
        unsnoozeReminder(tx, deps.cfg, partyId, groupId, args),
      );
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/groups/order", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const { heldGroupIds } = body;
      if (!Array.isArray(heldGroupIds) || !heldGroupIds.every((id) => typeof id === "string")) {
        throw invalid("heldGroupIds");
      }
      const reordered = await withTransaction(deps.db, (tx) =>
        reorderHeldGroups(tx, partyId, heldGroupIds as string[], command),
      );
      return c.json(reordered);
    }),
  );

  app.post("/api/parties/:id/groups/move", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const moves = parseLineQuantities(body.moves, "moves");
      const target = parseMoveTarget(body.target);
      const moved = await withTransaction(deps.db, (tx) =>
        moveLinesToGroup(tx, deps.cfg, partyId, moves, target, command),
      );
      return c.json(moved);
    }),
  );

  app.get("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const drafts = await withTransaction(deps.db, (tx) => readDrafts(tx, deps.cfg, partyId));
      return c.json({ drafts });
    }),
  );

  app.put("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const draftId = requireDraftId(body.draftId);
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, (tx) =>
        saveDraft(tx, deps.cfg, partyId, personId, { draftId, revision, lines: body.lines }),
      );
      return c.json(draft);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/take-over", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, (tx) =>
        takeOverDraft(tx, deps.cfg, partyId, draftId, personId, revision),
      );
      return c.json(draft);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/submit", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
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
      const submitted = await withTransaction(deps.db, (tx) =>
        submitDraft(tx, deps.cfg, partyId, draftId, input),
      );
      return c.json(submitted);
    }),
  );

  // A tab does not re-price: the stored locked gross rides back verbatim. The revision is read in
  // the same transaction, so it is the one these lines are at.
  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const tab = await withTransaction(deps.db, async (tx) => ({
        lines: await readTabLines(tx, deps.cfg, id),
        revision: await readOrderRevision(tx, id),
        editSentLines: await VENUE_SERVICE.readEditSentLines(tx),
      }));
      return c.json(tab);
    }),
  );

  // One line of any open order, edited from the copy at `revision` (plan D10).
  app.put("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const { revision, ...patch } = await readJsonBody<OrderLinePatch & { revision?: unknown }>(c);
      const copy = requireRevision(revision);
      const saved = await withSaleTillWhenIssuing(deps, c, (saleCfg) =>
        withTransaction(deps.db, async (tx) => {
          const revision = await updateOrderLine(tx, deps.cfg, id, lineNo, patch, copy, personId);
          await issueIfFullyPaid(tx, fiscal, saleCfg, id, personId);
          return { revision, party: await partyRevisionOfOrder(tx, id) };
        }),
      );
      return c.json(saved);
    }),
  );

  app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const body = await readJsonBody<{ courseId?: string | null }>(c);
      const courseId = body.courseId ?? null;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withTransaction(deps.db, async (tx) => {
        await setLineCourse(tx, deps.cfg, id, lineNo, courseId);
      });
      return c.body(null, 200);
    }),
  );

  // An omitted or empty `lineNos` releases every held line of the tab outside a held group.
  app.post("/api/working-orders/:id/lines/send", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ lineNos?: number[] }>(c);
      await withTransaction(deps.db, async (tx) => {
        await sendLines(tx, deps.cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/lines/recall", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ lineNos?: number[] }>(c);
      await withTransaction(deps.db, async (tx) => {
        await recallLines(tx, deps.cfg, id, body.lineNos ?? []);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tables/:id/status", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{ statusId: string | null }>(c);
      const statusId = body.statusId ?? null;
      if (statusId !== null && !isUuid(statusId))
        throw new AppError("status.not_found", { statusId });
      await withTransaction(deps.db, async (tx) => {
        await setTableStatus(tx, deps.cfg, id, statusId);
      });
      return c.body(null, 200);
    }),
  );

  // Unlike the sibling table routes, placement is a manager-level venue-config write: `authorize`
  // checks the operator's own `venue.configure`, with no supervisor override, before any write.
  app.put("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const { sessionId } = await requireSession(deps, c);
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
        await authorize(tx, { sessionId, permission: "venue.configure" });
        await setTablePlacement(tx, deps.cfg, id, { zoneId, posX, posY, shape, rotation });
      });
      return c.body(null, 204);
    }),
  );

  // The same gate as the PUT.
  app.delete("/api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const { sessionId } = await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await authorize(tx, { sessionId, permission: "venue.configure" });
        await clearPlacement(tx, deps.cfg, id);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/bills/:id/split", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const transfers = requireTransfers(body.transfers);
      const command = billCommand(personId, body);
      const result = await withSaleTillWhenIssuing(deps, c, (saleCfg) =>
        withTransaction(deps.db, async (tx) => {
          const split = await splitBill(tx, deps.cfg, billId, transfers, command);
          await issueIfFullyPaid(tx, fiscal, saleCfg, billId, personId);
          return split;
        }),
      );
      return c.json(result);
    }),
  );

  // The path is the bill merged INTO.
  app.post("/api/bills/:id/merge", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const intoBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const fromBillId = requireOtherBill(body.fromBillId, "fromBillId");
      const command = billCommand(personId, body);
      await withTransaction(deps.db, (tx) =>
        mergeBills(tx, deps.cfg, intoBillId, fromBillId, command),
      );
      return c.body(null, 204);
    }),
  );

  // The path is the bill the items leave.
  app.post("/api/bills/:id/transfer", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const fromBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const toBillId = requireOtherBill(body.toBillId, "toBillId");
      const transfers = requireTransfers(body.transfers);
      const command = billCommand(personId, body);
      await withTransaction(deps.db, (tx) =>
        transferItems(tx, deps.cfg, fromBillId, toBillId, transfers, command),
      );
      return c.body(null, 204);
    }),
  );

  // A move changes no amount, so nothing is invoiced here.
  app.post("/api/bills/:id/move", (c) =>
    run(c, log, async () => {
      const { personId } = await requireSession(deps, c);
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const to = requireMoveTarget(body.to);
      const command = moveCommand(personId, body);
      const result = await withTransaction(deps.db, (tx) =>
        moveBill(tx, deps.cfg, billId, to, command),
      );
      return c.json(result);
    }),
  );
}
