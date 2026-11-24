import { printReceivedPaymentSlip } from "./payment-slip-print.js";
import { setOptionLabelAvailability, updateProduct } from "@waitron/menu";
import type { ModuleTimeRecordExport } from "@waitron/module";
import type { RecipientIdentifierType } from "@waitron/country-packs";
import { withIssuanceTransaction } from "@waitron/core";
import { requireEconomicWrite, type TradingAdmission } from "./trading-admission.js";
import { currentZoneDevice } from "./device-zones.js";
import type { LiveEvents } from "./live-api.js";
import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  AppError,
  deviceOrigin,
  int4InRange,
  isAppError,
  isValidEmail,
  isValidGuestCount,
  JOIN_SIDES,
  type JoinSide,
  type DishMove,
  PERSON_HEADER,
  SUPPORTED_LOCALES,
  thousandthsToDecimal,
} from "@waitron/shared";
import type { FloorAnnotator, TableRemoval } from "@waitron/module";
import {
  newId,
  parties,
  readNodeMembership,
  sales,
  ticketItems,
  workingOrderLines,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import {
  authorize,
  canUseDeviceProfile,
  createPinThrottle,
  endSession,
  listActivePersonsWithPermission,
  listActiveStaff,
  listStaffAdmittedTo,
  loginWithPin,
  setPersonLocale,
  tillSessions,
} from "@waitron/identity";
import type { PinAttempts, PinThrottle } from "@waitron/identity";
import { isSharedDisplay } from "@waitron/layouts";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { CardProviderContribution, PaymentProvider } from "@waitron/payments";
import {
  assertReaderStartable,
  cardProviderById,
  cardReaders,
  readReaderRole,
} from "@waitron/payments";
import { resendInvoicePrintJob } from "./invoice-print.js";
import { expireInvoiceDeliveryClaims, invoiceDeliveryClaimsDue } from "./invoice-delivery.js";
import { venueCredentials } from "@waitron/credentials";
import { routableServers } from "@waitron/membership";
import { codeOf, createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { OnboardingIntent } from "./trading-config.js";
import { VENUE_SERVICE } from "./modules.js";
import { mountTillClockApi } from "./till-clock-api.js";
import { mountTillAttendanceApi } from "./till-attendance-api.js";
import type { TradingContext } from "./trading-context.js";
import {
  inPinTurn,
  overrideToCheck,
  withCheck,
  withCheckUnder,
  withPinCheckAhead,
} from "./pin-check-ahead.js";
import { mountTillBoxClockApi, type TillBoxClockDeps } from "./till-box-clock-api.js";
import { moveDishesToStation, type StationMoveRequest } from "./station-move.js";
import { madeHereAnswer, sendingCfg } from "./made-here.js";
import { requestCfg } from "./request-config.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import type { DiskFullState } from "./disk-full-state.js";
import { readSettledTicket, reprintSale, printSaleReceipt } from "./till-sale.js";
import { tillReceiptPreview } from "./till-receipt-preview.js";
import {
  enqueueManualDrawerOpen,
  confirmReceiptHandover,
  readOriginalReceiptPrint,
  resolveDrawerPrinter,
  resolveInvoicePrinter,
  saleReceiptLayout,
  type OriginalReceiptPrint,
} from "./receipt-print.js";
import { listZones } from "./tables.js";
import { listTablesWithState } from "./working-order-table-state.js";
import { getHeldOrder, getPlacedCounterOrder, listHeldOrders } from "./working-order-held-read.js";
import {
  cancelPlacedOrder,
  listCounterWaiting,
  handOverOrder,
  placeOrder,
} from "./working-order-counter.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { setOrderInvoiceChoice, setOrderReceiptLanguage } from "./working-order-invoice.js";
import {
  abandonHeldOrder,
  updateHeldOrder,
  setWorkingOrderLabel,
  updateOrderLine,
} from "./working-order-held-write.js";
import {
  advanceTicketItem,
  bumpBillReady,
  sendLines,
  setLineCourse,
} from "./working-order-kitchen-service.js";
import { bumpRevisionKeepingPayment } from "./working-order-edit-state.js";
import { parkOrder } from "./working-order-open.js";
import { priceOrderLines } from "./working-order-pricing.js";
import { unsentDishLines } from "./working-order-kitchen-fire.js";
import { assertTabOpen, readBillLines, readTabLines } from "./stored-order-lines.js";
import { markGroupServed, markServed, unmarkServed } from "./working-order-serving.js";
import {
  captureOrderService,
  readOrderRevision,
  paysAfterSending,
} from "./working-order-context.js";
import { passReleaseRefusal } from "./pass-release.js";
import { readScopedPassBoard } from "./pass-board.js";
import type { TicketState } from "./kitchen-print.js";
import type { OrderLinePatch } from "./working-order-edit-state.js";
import type { LineExtras } from "./working-order-pricing.js";
import type { OrderAttendance } from "./working-order-context.js";
import { listStationsToday } from "./kitchen.js";
import {
  createPartyBill,
  partyFamily,
  holderOf,
  markTableCleared,
  memberTables,
  readBillsOfParties,
  readPartyBills,
  seatTable,
  setPartyName,
  setPartyGuestCount,
  checkAndBumpParty,
  partyOfOrder,
  partyRevision,
  partyRevisionOfOrder,
  partyZone,
} from "./parties.js";
import { finishPartyService } from "./finish-party-service.js";
import { parseFinishCancellations } from "./finish-party-input.js";
import { mergeBills, moveDishes } from "./bill-actions.js";
import { moveSetMenuDishes } from "./set-menu-moves.js";
import { readBillSetMenus, refuseUnlessSetMenuBill, SET_MENU_DRAFT_LINE } from "./set-menu-bill.js";
import { removeSetMenuLines, setSetMenuCount } from "./set-menu-count.js";
import type { BillCommand } from "./bill-actions.js";
import { billNameZoneSubject, setBillName } from "./bill-identities.js";
import { moveBill, moveWouldSend, previewBillMoveAllergy } from "./move-bill.js";
import type { MoveBillOptions, MoveTarget, OtherPartyRead } from "./move-bill.js";
import {
  joinTables,
  moveGuests,
  splitTable,
  type SplitGuestCounts,
  type SplitSelection,
} from "./table-actions.js";
import { joinMergeMembers, writeMerge } from "./floor-today-merges.js";
import { withMovedSlips, type SlipsLater } from "./moved-slips.js";
import type { TableActionOptions } from "./table-actions.js";
import {
  bumpGroupReady,
  fireGroup,
  fireHeldLine,
  listOrderGroups,
  moveLinesToGroup,
  splitHeldLineIntoUnits,
  readCurrentOrders,
  reorderHeldGroups,
  snoozeReminder,
  submitGroups,
  unsnoozeReminder,
} from "./order-groups.js";
import type { GroupLine, SubmitGroupsInput, PartyCommandArgs } from "./order-groups.js";
import { RETAINED_COURSE } from "./retained-course.js";
import { readDrafts, saveDraft, splitDraft, submitDraft, takeOverDraft } from "./order-drafts.js";
import type { BillEditState, BillEditExpected } from "./order-drafts.js";
import {
  requireOrderBillEditor,
  parseBillEditExpected,
  parseBillEditExpecteds,
  readBillEditState,
} from "./bill-editing.js";
import { availableStations, findDeadEnds, requireMakeAtStation } from "./dead-ends.js";
import { ensureToday, todayReconciliationDue } from "./floor-today-store.js";
import { layoutOffer, zoneLayouts } from "./floor-layout-due.js";
import { refuseTakenOff, zoneOfTable } from "./floor-today-table.js";
import {
  moveChangedRooms,
  refuseStale,
  requiredRevision,
  roomPrints,
  roomRevisions,
  sentRevision,
  zonesOf,
} from "./floor-revision.js";
import type { SubmitDraftInput } from "./order-drafts.js";
import { captureKitchenActivity, type AttendanceRecorder } from "./attendance-capture.js";
import { invalid } from "./bill-allocation.js";
import { issueIfFullyPaid, readBillBalance, type CounterPaymentBasket } from "./bill-payments.js";
import { asObject, mountBillPaymentsApi, submissionIdOf } from "./bill-payments-api.js";
import { listPrintProblems, reprintOrderTickets } from "./kitchen-print.js";
import {
  canonicaliseUuid,
  clearSessionCookie,
  isUuid,
  openSessionPerson,
  personRefusal,
  readSessionToken,
  assertRequestDevice,
  requireSession,
  assertStillSignedIn,
  SESSION_STATUS,
  setSessionCookie,
} from "./till-session.js";
import {
  DEV_DEVICE_HEADER,
  assertDeviceCapability,
  assertProfileAction,
  assertDeviceStillProven,
  requireDeviceProof,
  tryReadDevice,
} from "./device-session.js";
import { requireBodyUuid, requireString, requireUuidParam } from "@waitron/server-kit";
import { requestBill } from "./bill-request.js";
import { markServiceStepDone } from "./service-step-done.js";
import { mountAdjustmentsApi } from "./adjustments-api.js";
import { mountLineCancelApi } from "./line-cancel-api.js";
import { splitAfterPrint } from "./split-after-print.js";
import { mountDepartmentTransferApi } from "./department-transfer-api.js";
import { mountFloorTodayApi, requireTargetTable, whole } from "./floor-today-api.js";
import { mountKeepOpenApi } from "./keep-open-api.js";
import { mountStationTodayApi } from "./station-today-api.js";
import { mountPartyAllergyApi } from "./party-allergy-api.js";
import type { AllergyCommand } from "@waitron/module";
import { mountOrderKitchenNoteApi } from "./order-kitchen-note-api.js";
import { mountMealEndApi } from "./meal-end-api.js";
import { mountUnpaidDepartureApi } from "./unpaid-departure-api.js";
import { mountBillLookupApi } from "./bill-lookup-api.js";
import { mountInvoiceLookupApi } from "./invoice-lookup-api.js";
import { mountFindBillApi } from "./find-bill-api.js";
import { mountTransactionReceiptApi } from "./transaction-receipt-api.js";
import { mountTenderRefundApi } from "./tender-refund-api.js";
import { mountGiveBackApi } from "./give-back-api.js";
import { mountInvoiceCorrectionApi } from "./invoice-correction-api.js";
import { mountDrawerApi } from "./drawer-api.js";
import { mountDeferredCloseApi } from "./deferred-close-api.js";
import {
  readInvoiceDeliveries,
  readInvoiceDeliveryState,
  readReceiptEmailDeliveries,
  type OfferedPrinter,
} from "./invoice-delivery-status.js";
import {
  requestPrintDelivery,
  requestEmailDelivery,
  retryEmailDelivery,
  switchToReceipt,
} from "./invoice-delivery-actions.js";
import { canEmailInvoice } from "./invoice-email-contact.js";
import { completeTillSetup, readTillSetup, setupRevisionOf } from "./till-setup.js";
import { resolveLoginLocale } from "./login-locale.js";
// Side-effect only: loads this host's errors.ts augmentation.
import "./errors.js";
import { stationPrintersDown } from "./station-outputs-down.js";
import { mountGatedWhileDiskFull } from "./disk-full-gate.js";
import { requireDining, switchOrderDining } from "./order-dining.js";
import { parseLateSend, withLateSendCheck } from "./late-send.js";
import {
  checkZones,
  gateZones,
  inScope,
  readZoneScope,
  visibleOrders,
  type ZoneSubject,
} from "./zone-access.js";

export interface TillApiDeps {
  cloudEmergency?: () => { address: string } | null;
  paymentsEnabled?: boolean;
  exporter?: ModuleTimeRecordExport;
  admission: TradingAdmission;
  attendance?: AttendanceRecorder;
  liveEvents?: LiveEvents;
  db: Database;
  backend: FiscalBackend;
  clock: TrustedClock;
  cfg: TradingContext;
  floorAnnotators?: readonly FloorAnnotator[];
  tableRemovals?: readonly TableRemoval[];
  secureCookies: boolean;
  /**
   * Only ever the practice-mode local simulator; a real card sale routes through {@link pool} by
   * its reader's `provider`.
   */
  cardProvider?: PaymentProvider;
  refundSimulator?: PaymentProvider;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  pool?: CardProviderPool;
  /**
   * Read by the full-disk gate, the reader payments and, through the deps they pass, the cash and
   * manual-card sale, collect and bill-payment routes. Unset, nothing is refused for a full disk; a live boot always
   * supplies it.
   */
  disk?: DiskFullState;
  /**
   * The start clock gate, read by `clockStopsRefund` when the tender refund and bill refund routes
   * check again after a provider wait. Unset, that check ignores the gate; a live boot always
   * supplies it.
   */
  clockUnconfirmed?: () => boolean;
  /**
   * Optional only for suites that never reach the reader-pay path; a live boot always supplies it.
   */
  providers?: readonly CardProviderContribution[];
  devMode?: boolean;
  deviceChooserEnabled?: boolean;
  /** The venue's default UI locale, distinct from its receipt language. */
  venueLocale: string;
  onboardingIntent?: OnboardingIntent;
  /** Injected by tests; production gets one `createPinThrottle()` per mount. */
  pinThrottle?: PinThrottle;
  /** "Check the time": mounts the till's clock check when the seat can confirm a stop. */
  boxClock?: TillBoxClockDeps;
  invoiceEmailAvailable?: (tx: Transaction) => Promise<boolean>;
  testPages?: Pick<import("./page-test-pages.js").PageTestPages, "holdOn">;
  workforceEnabled?: boolean;
  attendanceResponsesEnabled?: boolean;
}

export async function resolveHttpOrderZone(
  deps: TillApiDeps,
  session: { device: { deviceProfileId: string } },
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return withTransaction(deps.db, (tx) => newOrderZoneIn(tx, session, lineCount, requestedZoneId));
}

/** {@link resolveHttpOrderZone} for a route already inside its transaction. */
async function newOrderZoneIn(
  tx: Transaction,
  session: { device: { deviceProfileId: string } },
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return (
    await VENUE_SERVICE.resolveNewOrderZone(tx, {
      profileId: session.device.deviceProfileId,
    })
  ).zoneId;
}

/** The subjects that are named: a request's optional body ids leave out what they do not carry. */
function named(...subjects: (ZoneSubject | false)[]): ZoneSubject[] {
  return subjects.filter((subject): subject is ZoneSubject => subject !== false);
}

/**
 * The reader a card is charged on: the one the request names, else the device's own. It must be
 * switched on, held by this device, and free of another device's payment in progress. The payment's
 * start checks the last two again in the transaction that writes its first row.
 */
async function resolvePayReader(
  deps: TillApiDeps,
  deviceId: string | undefined,
  requestedReaderId: string | undefined,
): Promise<{ id: string; provider: string; providerRef: string }> {
  return withTransaction(deps.db, async (tx) => {
    let readerId = requestedReaderId;
    if (readerId === undefined && deviceId !== undefined) {
      const role = await readReaderRole(tx, deviceId);
      readerId = role?.chosenId ?? role?.defaultId ?? undefined;
    }
    if (readerId === undefined) throw new AppError("reader.not_found", { id: "" });
    const [reader] = await tx
      .select({
        id: cardReaders.id,
        provider: cardReaders.provider,
        providerRef: cardReaders.providerRef,
      })
      .from(cardReaders)
      .where(and(eq(cardReaders.id, readerId), isNull(cardReaders.disabledAt)));
    if (reader === undefined) throw new AppError("reader.not_found", { id: readerId });
    if (deviceId === undefined) throw new AppError("reader.not_held", { readerId: reader.id });
    await assertReaderStartable(tx, deviceOrigin(deviceId), reader.id);
    // Refuse a disconnected provider here with the actionable `reader.provider_disconnected`,
    // before an adapter meets the missing credential mid-charge.
    if (deps.providers !== undefined) {
      const purpose = cardProviderById(deps.providers, reader.provider).credentialPurpose;
      const [cred] = await tx
        .select({ purpose: venueCredentials.purpose })
        .from(venueCredentials)
        .where(eq(venueCredentials.purpose, purpose));
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
  if (deps.paymentsEnabled === false) throw new AppError("module.disabled", { module: "payments" });
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
export const STATUS: Record<string, ContentfulStatusCode> = {
  "settings.invalid": 500,
  "set_menu.holds_dishes": 409,
  "set_menu.needed_by_draft": 409,
  "set_menu.not_selling": 409,
  "set_menu.no_place": 409,
  "set_menu.no_place_on_target": 409,
  "set_menu.place_taken": 409,
  "set_menu.move_adjusted": 409,
  "set_menu.remove_from_summary": 409,
  "set_menu.dish_sold_by_measure": 409,
  "set_menu.not_seated": 409,
  "set_menu.payment_not_ready": 409,
  "module.disabled": 409,
  "venue.time_zone_not_ready": 409,
  "print_job.not_found": 404,
  "print_job.not_resendable": 409,
  "print_job.sale_payload_expired": 409,
  "receipt.not_printed": 409,
  "receipt.no_printer": 409,
  "pin.invalid": 401,
  // 429, not 401, so the till can tell "wait N seconds" apart from "wrong PIN".
  "pin.throttled": 429,
  "person.not_found": 401,
  // Authenticated device lacks the action capability or is excluded from the workflow.
  "device.forbidden_action": 403,
  "device.cash_not_allowed": 403,
  "session.not_open": 401,
  // The same codes and statuses `device-api.ts`'s map assigns.
  "device.unauthorized": 401,
  ...SESSION_STATUS,
  "locale.unsupported": 400,
  "sale.empty_basket": 400,
  "sale.charged_not_recorded": 507,
  "product.variant_required": 400,
  "product.unavailable": 409,
  "product.not_sold_separately": 409,
  // A confirmation from the kitchen settles it, so it is a conflict rather than a bad request.
  "menu_period.ended": 409,
  // A basket priced against a menu version that is no longer live: nothing was priced or written.
  "menu.version_changed": 409,
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
  "fiscal.fingerprint_mismatch": 409,
  "fiscal.chain_handed_over": 409,
  "clock.unusable": 409,
  "clock.unconfirmed": 409,
  "fiscal.foreign_recipient_unsupported": 409,
  // Adding a line refuses a classification snapshot the menu's data cannot make valid:
  // permanent until the menu is fixed, and not the till's fault.
  "sale_classification.invalid": 409,
  "person.suspended": 403,
  "device_profile.not_admitted": 403,
  "department.not_found": 404,
  "department_transfer.not_allowed": 403,
  "department_transfer.desk_unavailable": 409,
  "department_transfer.pending": 409,
  "department_transfer.not_found": 404,
  "department_transfer.not_pending": 409,
  "department_transfer.tab_unavailable": 409,
  "department_transfer.structure_unsupported": 409,
  "department_transfer.destination_invalid": 400,
  "department_transfer.reason_required": 400,
  "working_order.not_found": 404,
  "working_order.not_open": 409,
  "working_order.out_of_date": 409,
  "order.dining_fixed": 409,
  "order.dining_locked": 409,
  "order.dining_differs": 409,
  "kitchen_note.out_of_date": 409,
  "allergy.invalid": 400,
  "allergy.out_of_date": 409,
  "allergy.unanswered": 409,
  "order.payment_in_flight": 409,
  "device.profile_changed": 409,
  "working_order.not_placed": 409,
  "series.no_corrective_for_node": 409,
  // The series handed out a number a sale already holds: the server's state, not the request.
  "sale.number_reused": 409,
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
  "invoice_delivery.active": 409,
  "invoice_delivery.receipt_invalid": 409,
  "invoice_delivery.email_unavailable": 409,
  "invoice_delivery.printer_invalid": 409,
  "invoice_delivery.full_invoice_required": 409,
  "invoice_delivery.receipt_unavailable": 409,
  "invoice_delivery.not_found": 404,
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
  "ticket_item.not_found": 404,
  "ticket.item_held": 409,
  "ticket.already_started": 409,
  "ticket.already_served": 409,
  "ticket.already_sent": 409,
  "course.not_found": 404,
  "station.no_default": 409,
  "station.no_replacement": 409,
  "station.not_found": 404,
  "station.destination_invalid": 409,
  "station.always_open": 409,
  "time_zone.unreadable": 500,
  "menu.reset_required": 500,
  "device.forbidden_station": 403,
  "kitchen_notice.not_found": 404,
  "zone_extension.invalid": 400,
  "zone_extension.not_allowed": 409,
  "service_zone.not_found": 404,
  // The request is sound; the device's profile may not work in that zone.
  "service_zone.not_allowed": 403,
  "service_zone.closed": 409,
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
  "reader.not_held": 409,
  "reader.payment_in_progress": 409,
  "table.not_found": 404,
  "table.inactive": 409,
  "table.not_on_today_plan": 409,
  "table.taken_off": 409,
  "table.fixed": 409,
  "table.merged": 409,
  "table.delivery_pending": 409,
  "table.open_delivery_order": 409,
  "table.label_taken": 409,
  "floor_plan.invalid": 400,
  "merge.seats_required": 400,
  "merge.member_invalid": 400,
  "merge.split_all": 409,
  "merge.strands_party": 409,
  "floor_today.out_of_date": 409,
  "floor_today.layout_changed": 409,
  "zone.not_found": 404,
  "tab.already_open": 409,
  "tab.not_open": 409,
  "tab.line_not_found": 404,
  "table.needs_clearing": 409,
  "table.needs_moving": 409,
  "table.already_in_party": 409,
  "tab.merge_self": 400,
  "tab.transfer_self": 400,
  "tab.transfer_quantity_invalid": 400,
  "tab.serve_quantity_invalid": 400,
  "tab.transfer_duplicate_line": 400,
  "table.not_joined": 409,
  "table.not_shared": 409,
  "tab.transfer_modifier_line": 400,
  "tab.portions_too_many": 400,
  "party.not_open": 409,
  "party.not_found": 404,
  "service_step.not_found": 404,
  "party.out_of_date": 409,
  "tab.cancel_context_changed": 409,
  "tab.free_item_with_dish": 409,
  "party.bill_outstanding": 409,
  "party.unserved_dishes": 409,
  "unpaid_departure.nothing_outstanding": 409,
  "unpaid_departure.unfired_dishes": 409,
  "meal_end.already_issued": 409,
  "meal_end.no_printer": 409,
  "meal_end.delivery_unavailable": 409,
  "meal_end.unserved_dishes": 409,
  "submission.id_reused": 409,
  "deferred_close.ineligible": 409,
  "deferred_close.conflict": 409,
  "draft.taken_over": 409,
  "draft.already_submitted": 409,
  "draft.out_of_date": 409,
  "draft.not_found": 404,
  "group.not_held": 409,
  "group.line_cancelled": 409,
  "group.not_waiting": 409,
  "group.not_found": 404,
  "group.held_leaves_party": 409,
  "group.line_held": 409,
  "bill.nothing_outstanding": 409,
  "advance.exceeds_bill": 409,
  "advance.full_invoice_unsupported": 409,
  "advance.taken_off_final_invoice": 409,
  "advance.correction_open": 409,
  "bill.unsent_dishes": 409,
  "bill.tip_not_allowed": 422,
  "bill.allocation_changed": 409,
  "bill.line_paid": 409,
  "bill.received_exceeds_total": 409,
  "bill.below_advances": 409,
  "bill.all_items_chosen": 409,
  "bill.not_overpaid": 409,
  "bill.tip_not_allowed_on_excess": 409,
  "bill.payments_received": 409,
  "bill.presented": 409,
  "bill.paid": 409,
  "bill.other_party": 409,
  "bill.not_at_table": 409,
  "bill.left_unpaid": 409,
  "bill.not_issued": 409,
  "bill.unserved_dishes": 409,
  "bill.merge_invoice_choice_required": 409,
  "bill.payment_not_found": 404,
  "bill.refund_exceeds_payment": 422,
  "bill.refund_not_whole": 422,
  "bill.refund_of_advance": 409,
  "bill.refund_unsupported": 422,
  "bill.manual_refund_pin_required": 403,
  "bill.refund_in_progress": 409,
  "payment.not_refundable": 409,
  "payment.refund_exceeds_capture": 409,
  "drawer.no_printer": 400,
  "drawer.not_attached": 400,
  "drawer.close_not_found": 404,
  "drawer.close_changed": 409,
  "drawer.assignment_changed": 409,
  "drawer.recount_unavailable": 409,
  // No till address holds a reason id: only a request body can name a missing one.
  "adjustment_reason.not_found": 400,
  // 403, as `authorization.not_permitted` answers: the request is sound, the person may not alone.
  "adjustment.approval_required": 403,
  // The rest follow their nearest siblings: a refusal that depends on the bill or the reason as they
  // stand is 409, like `bill.received_exceeds_total`; one about the request's own fields is 400,
  // like `tab.transfer_quantity_invalid` and `tab.transfer_modifier_line`.
  "adjustment.exceeds_amount": 409,
  "adjustment.action_not_allowed": 409,
  "adjustment.weighed_partial": 409,
  "adjustment.no_reduction": 409,
  "adjustment.free_not_allowed": 409,
  "adjustment.note_required": 400,
  "adjustment.quantity_invalid": 400,
};

export const run = createErrorBoundary(STATUS, "till.failed");
const runAvailability = createErrorBoundary(
  { ...STATUS, "product.not_found": 404, "options.not_found": 404 },
  "till.failed",
);
/** `run`, for a route whose address holds none of these codes' ids: they answer 400
 * (docs/developers/conventions-data.md, "A refusal's HTTP status says what was wrong"). */
export const runBodyIds = (...codes: string[]): Run =>
  createErrorBoundary(
    { ...STATUS, ...Object.fromEntries(codes.map((code) => [code, 400] as const)) },
    "till.failed",
  );
const runBodyGroup = runBodyIds("group.not_found");
const runBodyCourse = runBodyIds("course.not_found");
const runBodyLines = runBodyIds("tab.line_not_found");
const runMoveStation = runBodyIds("tab.line_not_found", "station.not_found");
const runSubmitGroups = runBodyIds("group.not_found", "course.not_found");
const runSaveDraft = runBodyIds("group.not_found", "draft.not_found", "course.not_found");
const runDeadEndsDraft = runBodyIds("draft.not_found");
const runDeadEndsOrder = runBodyIds("working_order.not_found");

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

/** The body of a move-station request on order `orderId`. */
export function stationMoveRequest(
  orderId: string,
  body: Record<string, unknown>,
): StationMoveRequest {
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
    if (!isUuid(lineId)) throw new AppError("tab.line_not_found", { tabId: orderId, lineId });
  if (typeof body.stationId !== "string" || !isUuid(body.stationId))
    throw new AppError("station.not_found", { stationId: String(body.stationId) });
  return { submissionId, lineIds, stationId: body.stationId };
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
    throw new AppError("pin.invalid", {}, { reason: "malformed" });
  }
  if (typeof raw.pin !== "string") {
    throw new AppError("pin.invalid", {}, { reason: "malformed" });
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
    | "expectedBillRevision"
    | "expectedPartyRevision"
    | "expectedOtherPartyRevision" = "revision",
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("management.request_invalid", { field });
  }
  return value;
}

function requireRecipient(value: unknown): string {
  if (typeof value !== "string" || !isValidEmail(value)) {
    throw new AppError("management.request_invalid", { field: "recipient" });
  }
  return value.trim();
}

/** A non-UUID names no party, so it gets the absent party's `party.not_open`. */
export function requirePartyParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("party.not_open", { partyId: id });
  }
  return id;
}

/** An optional guest count: absent or null records none, otherwise a whole number from 1. */
function requireGuestCount(value: unknown, field = "guestCount"): number | null {
  if (value === undefined || value === null) return null;
  if (!isValidGuestCount(value)) throw invalid(field);
  return value;
}

/** A guest count the wire must carry: null clears it, an absent key is refused. */
function requireGuestCountOrNull(value: unknown, field = "guestCount"): number | null {
  if (value === undefined) throw invalid(field);
  return requireGuestCount(value, field);
}

function requireSplitGuestCounts(value: unknown): SplitGuestCounts | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw invalid("guestCounts");
  const { staying, leaving } = value as Record<string, unknown>;
  return {
    staying: requireGuestCountOrNull(staying, "guestCounts.staying"),
    leaving: requireGuestCountOrNull(leaving, "guestCounts.leaving"),
  };
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
 * A move's command: {@link billCommand}'s, with `partyId: null` for a bill read with no party, and
 * the party read at the target table.
 */
function moveCommand(personId: string, body: Record<string, unknown>): MoveBillOptions {
  const { partyId, ...rest } = body;
  const command: MoveBillOptions = {
    ...billCommand(personId, partyId === null ? rest : body),
    expectedEdits: parseBillEditExpecteds(body.expectedEdits),
  };
  if (partyId === null) command.partyId = null;
  if (body.submissionId !== undefined || body.allergy !== undefined) {
    if (body.submissionId === undefined || body.allergy === undefined) throw invalid("allergy");
    command.submissionId = requireBodyUuid(body.submissionId, "submissionId").toLowerCase();
    command.allergy = body.allergy as MoveBillOptions["allergy"];
  }
  return { ...command, ...otherPartyRead(body) };
}

/**
 * A table action's command: the path party's revision and the party read at the target table.
 */
function tableActionCommand(personId: string, body: Record<string, unknown>): TableActionOptions {
  return {
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId: personId,
    ...otherPartyRead(body),
    expectedEdits: parseBillEditExpecteds(body.expectedEdits),
  };
}

/** The other tables a seat names, absent for none; none may be the path table. */
function requireOtherTables(value: unknown, pathId: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid("withTableIds");
  const ids = value.map((item: unknown) => requireTargetTable(item, "withTableIds"));
  if (ids.includes(pathId.toLowerCase())) throw invalid("withTableIds");
  return [...new Set(ids)];
}

interface JoinMerge {
  moving: string;
  target: string;
  side: JoinSide;
  seats: number | null;
}

function requireMerge(value: unknown, tableId: string): JoinMerge | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw invalid("merge");
  const { moving, target, side, seats } = value as Record<string, unknown>;
  const movingId = requireTargetTable(moving, "merge.moving");
  const targetId = requireTargetTable(target, "merge.target");
  if (!JOIN_SIDES.includes(side as JoinSide)) throw invalid("merge.side");
  const merge = {
    moving: movingId,
    target: targetId,
    side: side as JoinSide,
    seats: seats === undefined ? null : whole(seats, "merge.seats", 1, 999),
  };
  if ((merge.moving === tableId) === (merge.target === tableId)) throw invalid("merge");
  return merge;
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

/** What Split a table takes, every id lower-cased; a bad shape is the request's fault. */
function requireSplitSelection(value: unknown): SplitSelection {
  const { wholeBillIds, loose } = selectionObject(value);
  if (!Array.isArray(wholeBillIds) || !Array.isArray(loose)) throw invalid("selection");
  return {
    wholeBillIds: wholeBillIds.map(selectionId),
    loose: loose.map((entry: unknown) => {
      const { billId, lineIds } = selectionObject(entry);
      if (!Array.isArray(lineIds)) throw invalid("selection");
      return { billId: selectionId(billId), lineIds: lineIds.map(selectionId) };
    }),
  };
}

function selectionObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw invalid("selection");
  return value as Record<string, unknown>;
}

function selectionId(value: unknown): string {
  return requireBodyUuid(value, "selection").toLowerCase();
}

function requireSetMenuMoves(value: unknown): DishMove[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid("moves");
  return value.map((entry: unknown) => {
    const { lineId, to } = asObject(entry);
    const { setMenuLineId, place } = asObject(to);
    if (!int4InRange(place, 0)) throw invalid("moves");
    return {
      lineId: requireBodyUuid(lineId, "moves").toLowerCase(),
      to: { setMenuLineId: requireBodyUuid(setMenuLineId, "moves").toLowerCase(), place },
    };
  });
}

/** A list of line ids: a non-UUID is the request's fault, not a line the bill lacks. */
function requireLineIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw invalid("lineIds");
  return value.map((id) => requireBodyUuid(id, "lineIds").toLowerCase());
}

/** What every group command carries: its submission id, the party revision read, and who acts —
 *  the signed-in person or the kitchen display. */
export function groupCommand(operatorId: string, body: Record<string, unknown>): PartyCommandArgs {
  return {
    submissionId: submissionIdOf(body),
    expectedPartyRevision: requireRevision(body.expectedPartyRevision, "expectedPartyRevision"),
    operatorId,
  };
}

export function allergyCommand(body: Record<string, unknown>): AllergyCommand | undefined {
  if (
    body.submissionId === undefined &&
    body.expectedPartyRevision === undefined &&
    body.allergy === undefined
  )
    return undefined;
  const { submissionId, expectedPartyRevision } = groupCommand("", body);
  return {
    submissionId,
    expectedPartyRevision,
    ...(body.allergy === undefined ? {} : { allergy: body.allergy as AllergyCommand["allergy"] }),
  };
}

async function recheckFireSession(
  tx: Transaction,
  session: Awaited<ReturnType<typeof requireSession>>,
) {
  await assertStillSignedIn(tx, session);
  const device = await assertDeviceStillProven(tx, { device: session.device, tokenHash: null });
  assertProfileAction(device, "take-orders");
  if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
    throw new AppError("device_profile.not_admitted", {});
  return { ...session, device };
}

/** A submission's held group to add to, when it names one. */
function joinGroupOf(body: Record<string, unknown>): { joinGroupId?: string } {
  const { joinGroupId } = body;
  if (joinGroupId === undefined) return {};
  if (typeof joinGroupId !== "string") throw invalid("joinGroupId");
  return { joinGroupId };
}

function groupDestinationOf(body: Record<string, unknown>): {
  joinGroupId?: string;
  afterGroupId?: string;
} {
  const result: { joinGroupId?: string; afterGroupId?: string } = {};
  for (const field of ["joinGroupId", "afterGroupId"] as const) {
    if (body[field] !== undefined)
      result[field] = requireBodyUuid(body[field], field).toLowerCase();
  }
  return result;
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
    return {
      lines: lines as GroupLine[],
      release,
      ...groupDestinationOf(entry as Record<string, unknown>),
    };
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

/** A step route's step, in lower case as ids are stored: an id that is no UUID names none. */
function requireStepParam(stepId: string): string {
  if (!isUuid(stepId)) throw new AppError("service_step.not_found", { stepId });
  return stepId.toLowerCase();
}

/** When the till showed a step as due, as the floor read sent it, in milliseconds. */
function requireShownDueAt(value: unknown): number {
  const at = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(at) || new Date(at).toISOString() !== value) throw invalid("dueAt");
  return at;
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
    return {
      lineIds: lineIds as string[],
      release,
      ...groupDestinationOf(entry as Record<string, unknown>),
    };
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
  if (!int4InRange(lineNo, 1)) {
    throw new AppError("tab.line_not_found", { tabId, lineNo });
  }
  return lineNo;
}

function mountBillReady(app: Hono, deps: TillApiDeps, log: Logger): void {
  app.post("/api/orders/:id/ready", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const refused = passReleaseRefusal(session.device);
      if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
      const { personId } = session;
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId }]);
        await bumpBillReady(
          tx,
          orderId,
          { personId },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.body(null, 200);
    }),
  );
}

/**
 * `write`, moving by one each room of `tableIds` it changed; refused before it when `check` names a
 * table whose room is no longer at the revision sent.
 */
async function movingRooms<T extends object>(
  tx: Transaction,
  tableIds: readonly string[],
  check: { tableId: string; sent: number } | undefined,
  write: () => Promise<T>,
): Promise<T | (T & { zoneRevisions: Record<string, number> })> {
  const rooms = await zonesOf(tx, tableIds);
  const revisions = await roomRevisions(tx, rooms);
  if (check !== undefined) {
    const zoneId = await zoneOfTable(tx, check.tableId);
    refuseStale(zoneId, check.sent, revisions.get(zoneId)!);
  }
  const before = await roomPrints(tx, rooms);
  const result = await write();
  const after = await roomPrints(tx, rooms);
  const moved = await moveChangedRooms(tx, revisions, before, after);
  return moved.size === 0 ? result : { ...result, zoneRevisions: Object.fromEntries(moved) };
}

/** Open while a full-disk stop holds; each still fails by itself if its own save does not fit. */
const TILL_OPEN_WHILE_DISK_FULL: ReadonlySet<string> = new Set([
  // A refused sign-out keeps someone signed in on a shared till; a refused sign-in, the next shift out.
  "POST /api/session",
  "DELETE /api/session",
  "PUT /api/session/locale",
  // Refused inside, after their replay checks, the one place a resend is told from a new sale.
  "POST /api/working-orders/:id/payments",
  "POST /api/working-orders/:id/item-payments",
  // Save nothing of their own; a refused send-preview would hide the kitchen send's own refusal.
  "POST /api/dead-ends/sale",
  "POST /api/dead-ends/draft",
  "POST /api/dead-ends/order",
  "POST /api/working-orders/:id/payments/preview",
  "POST /api/working-orders/:id/item-payments/preview",
  "POST /api/working-orders/:id/payments/:submissionId/cancel",
  "POST /api/working-orders/:id/adjustments/preview",
  "POST /api/parties/:id/allergy/send-preview",
  "POST /api/bills/:id/move/allergy-preview",
]);

/** Mount the till routes with the shared error boundary. */
export function mountTillApi(root: Hono, deps: TillApiDeps, log: Logger): void {
  const app = new Hono();
  const pinThrottle = deps.pinThrottle ?? createPinThrottle();
  const catchUpFloor = (tx: Transaction) =>
    ensureToday(tx, deps.tableRemovals ?? [], deps.clock.now().instant);
  app.use("/api/*", madeHereAnswer(deps.db));
  if (deps.boxClock !== undefined)
    mountTillBoxClockApi(
      app,
      {
        db: deps.db,
        backend: deps.backend,
        clock: deps.clock,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        attemptsFor: (deviceId) => overridePinAttempts(pinThrottle, deviceId),
        boxClock: deps.boxClock,
      },
      log,
    );
  if (deps.workforceEnabled === true)
    mountTillClockApi(
      app,
      {
        db: deps.db,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        cfg: deps.cfg,
        now: () => deps.clock.now().instant,
      },
      log,
    );
  if (deps.workforceEnabled === true && deps.attendanceResponsesEnabled !== false)
    mountTillAttendanceApi(
      app,
      {
        db: deps.db,
        devMode: deps.devMode === true,
        deviceChooserEnabled: deps.deviceChooserEnabled,
        cfg: deps.cfg,
        now: () => deps.clock.now().instant,
        attemptsFor: (deviceId) => overridePinAttempts(pinThrottle, deviceId),
        exporter: deps.exporter,
      },
      log,
    );
  // What a write that leaves a bill fully paid issues its invoice with (bill payments design §7).
  const fiscal = {
    db: deps.db,
    backend: deps.backend,
    admission: deps.admission,
    clock: deps.clock,
    log,
  };
  mountBillPaymentsApi(app, deps, log, run, pinThrottle);
  mountAdjustmentsApi(app, deps, log, run, pinThrottle);
  mountLineCancelApi(app, deps, log, run, pinThrottle);
  mountUnpaidDepartureApi(app, deps, log, run, pinThrottle);
  mountMealEndApi(app, deps, log, run);
  mountStationTodayApi(app, deps, log, run, pinThrottle);
  mountOrderKitchenNoteApi(app, deps, log, run);
  mountPartyAllergyApi(app, deps, log, run);
  mountKeepOpenApi(app, deps, log, run, pinThrottle);
  mountDepartmentTransferApi(app, deps, log, run);
  mountFloorTodayApi(app, deps, log, run);
  mountBillLookupApi(app, deps, log, run);
  mountInvoiceLookupApi(app, deps, log, run);
  mountFindBillApi(app, deps, log, run);
  mountTransactionReceiptApi(app, deps, log, run);
  mountTenderRefundApi(app, deps, log, pinThrottle);
  mountInvoiceCorrectionApi(app, deps, log, pinThrottle);
  mountGiveBackApi(app, deps, log);
  mountDeferredCloseApi(app, deps, log, run);
  mountDrawerApi(app, deps, log, run);

  // Device-gated: the throttle keys on the authenticated device, so dropping the cookie cannot
  // evade it.
  app.post("/api/session", (c) =>
    run(c, log, async () => {
      const { personId: rawPersonId, pin } = await readJsonBody<{
        personId: string;
        pin?: unknown;
      }>(c);
      // Canonicalised before it keys the throttle and the lookup: the throttle keys on the string,
      // and the `text` id column folds no spellings (`canonicaliseUuid`).
      const personId = canonicaliseUuid(rawPersonId);
      // Not throttled: this id never reaches the lookup, so no PIN is being tried against anyone.
      if (personId === null) throw new AppError("pin.invalid", {}, { reason: "malformed" });
      const proof = await requireDeviceProof(deps, c);
      const { device } = proof;
      pinThrottle.check(device.deviceId, personId);
      const attempts = { throttle: pinThrottle, slot: device.deviceId };
      if (typeof pin !== "string") {
        // In turn, so it is counted after the attempts already being checked, not before them.
        return inPinTurn(attempts, personId, async () => {
          pinThrottle.check(device.deviceId, personId);
          pinThrottle.recordFailure(device.deviceId, personId);
          throw new AppError("pin.invalid", {}, { reason: "malformed" });
        });
      }
      const session = await withPinCheckAhead(
        deps.db,
        { personId, pin },
        attempts,
        async (checked) => {
          pinThrottle.check(device.deviceId, personId);
          try {
            const opened = await withTransaction(deps.db, async (tx) => {
              const current = await assertDeviceStillProven(tx, proof);
              if (isSharedDisplay(device.formFactor) !== isSharedDisplay(current.formFactor))
                throw new AppError("device.forbidden_action", { action: "sign_in" });
              const opened = await loginWithPin(tx, {
                deviceId: device.deviceId,
                personId,
                pin,
                checked,
              });
              if (deps.attendance !== undefined) {
                const [stored] = await tx
                  .select({ openedAt: tillSessions.openedAt })
                  .from(tillSessions)
                  .where(eq(tillSessions.id, opened.id));
                await deps.attendance(tx, {
                  source: "session",
                  key: opened.id,
                  personId: opened.personId,
                  kind: "sign-in",
                  at: stored!.openedAt,
                  offsetMinutes: 0,
                  outcome: "qualified",
                });
              }
              return opened;
            });
            pinThrottle.clear(device.deviceId, personId);
            return opened;
          } catch (err) {
            if (isAppError(err) && err.code === "pin.invalid") {
              pinThrottle.recordFailure(device.deviceId, personId);
            }
            throw err;
          }
        },
      );
      setSessionCookie(c, session.token, deps.secureCookies);
      // Display only: the server checks each permission itself, so a tampered client list grants
      // nothing.
      return c.json({
        personId: session.personId,
        permissions: [...session.authority.permissions],
        locale: session.locale,
      });
    }),
  );

  // A sign-out carrying the person header never clears the cookie: its answer can reach the browser after the
  // next person's sign-in has replaced it.
  app.delete("/api/session", (c) =>
    run(c, log, async () => {
      const carriesPersonHeader = c.req.header(PERSON_HEADER) !== undefined;
      const chosen =
        c.req.header(DEV_DEVICE_HEADER) === undefined
          ? null
          : await requireDeviceProof(deps, c, { passive: true });
      const token = readSessionToken(c);
      if (token !== null)
        await withTransaction(deps.db, async (tx) => {
          const holder = await openSessionPerson(tx, token, chosen?.device.deviceId);
          if (holder === null) return;
          const refusal = personRefusal(c, holder);
          if (refusal !== null) throw refusal;
          await endSession(tx, token);
        });
      if (!carriesPersonHeader) clearSessionCookie(c);
      return c.json({ ok: true });
    }),
  );

  // The session, not the body, names the person, so an operator can set only their own locale. A
  // missing or non-string `locale` becomes "", refused as `locale.unsupported`.
  app.put("/api/session/locale", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const { personId } = session;
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      await withTransaction(deps.db, async (tx) => {
        await setPersonLocale(tx, { personId, locale });
      });
      return c.body(null, 204);
    }),
  );

  // Deliberately unauthenticated: the lock screen's roster. No PIN material, role or status. A
  // request that identifies a device lists only the people its profile admits, unless it asks for
  // `everyone`, as a roster of colleagues does: that is the list a request with no device gets.
  app.get("/api/staff", (c) =>
    run(c, log, async () => {
      // Resolve the device before this turn: a due sighting takes a turn of its own.
      const device = c.req.query("everyone") === "true" ? null : await tryReadDevice(deps, c);
      const staff = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
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
      // Resolve the device before this turn: a due sighting takes a turn of its own.
      const device = await tryReadDevice(deps, c);
      const held = await readNodeMembership(deps.db);
      const setup = completeTillSetup(
        await deps.db.withWriteLock(() => readTillSetup(deps.db, deps, device)),
        deps.cloudEmergency?.() ?? null,
      );
      return c.json({
        ...setup,
        setupRevision: setupRevisionOf(setup),
        servers: routableServers(held),
        membership: held,
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

  app.get("/api/default-service-zone/offers", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const device = await currentZoneDevice(tx, session);
        const selection = await VENUE_SERVICE.readDeviceZoneSelection(tx, device.deviceId);
        const counters = selection.zones.filter(
          (zone) =>
            zone.serviceMode !== "table_tab" &&
            (device.formFactor !== "till" || selection.selectedZoneIds.includes(zone.id)),
        );
        let context: Awaited<ReturnType<typeof VENUE_SERVICE.resolveZoneContext>>;
        if (device.formFactor === "till") {
          const zoneId =
            counters.find((zone) => zone.id === selection.startingZoneId)?.id ?? counters[0]?.id;
          if (zoneId === undefined)
            throw new AppError("device_profile.no_service_zone", {
              profileId: device.deviceProfileId,
            });
          context = await VENUE_SERVICE.resolveZoneContext(tx, zoneId);
        } else {
          context = await VENUE_SERVICE.resolveNewOrderZone(tx, {
            profileId: device.deviceProfileId,
          });
        }
        const policy = await VENUE_SERVICE.resolveSalePolicy(tx, context.zoneId);
        const takeawayVat = await VENUE_SERVICE.venueChargesTakeawayVat(tx);
        return {
          context: { ...context, dining: VENUE_SERVICE.diningStartOf(policy, takeawayVat) },
          zones: (await VENUE_SERVICE.listServiceZones(tx)).filter((zone) =>
            counters.some((counter) => counter.id === zone.id),
          ),
          ...(await VENUE_SERVICE.listZoneOffers(tx, context.zoneId)),
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
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ zoneId }]);
        const context = await VENUE_SERVICE.resolveZoneContext(tx, zoneId);
        const policy = await VENUE_SERVICE.resolveSalePolicy(tx, zoneId);
        const takeawayVat = await VENUE_SERVICE.venueChargesTakeawayVat(tx);
        return {
          context: { ...context, dining: VENUE_SERVICE.diningStartOf(policy, takeawayVat) },
          ...(await VENUE_SERVICE.listZoneOffers(tx, zoneId)),
        };
      });
      return c.json(result);
    }),
  );

  app.put("/api/service-zones/:zoneId/products/:productId/availability", (c) =>
    runAvailability(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const productId = requireUuidParam(c.req.param("productId"), "ProductId");
      const body = await readJsonBody<{ available: unknown }>(c);
      if (typeof body.available !== "boolean")
        throw new AppError("product.invalid", { field: "available" });
      const available = body.available;
      await withTransaction(deps.db, async (tx) => {
        const device = await currentZoneDevice(tx, session);
        assertProfileAction(device, "take-orders");
        await checkZones(tx, { device }, [{ zoneId }]);
        const { offers, setMenus } = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
          withDefault: false,
        });
        const listed = [...offers, ...setMenus.flatMap((menu) => menu.offers)];
        if (
          !listed.some(
            (offer) =>
              offer.productId === productId ||
              offer.variants.some((variant) => variant.id === productId) ||
              offer.offeredModifiers.some(
                (modifier) =>
                  modifier.kind === "extras" &&
                  modifier.items.some((item) => item.productId === productId),
              ),
          )
        )
          throw new AppError("product.not_found", { productId });
        await updateProduct(tx, productId, { available });
      });
      return c.json({ available });
    }),
  );

  app.put("/api/service-zones/:zoneId/options/:listId/labels/:labelId/availability", (c) =>
    runAvailability(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const optionListId = requireUuidParam(c.req.param("listId"), "OptionListId");
      const labelId = requireUuidParam(c.req.param("labelId"), "OptionLabelId");
      const body = await readJsonBody<{ available: unknown }>(c);
      if (typeof body.available !== "boolean")
        throw new AppError("options.invalid", { field: "available" });
      const available = body.available;
      await withTransaction(deps.db, async (tx) => {
        const device = await currentZoneDevice(tx, session);
        assertProfileAction(device, "take-orders");
        await checkZones(tx, { device }, [{ zoneId }]);
        const { offers, setMenus } = await VENUE_SERVICE.listZoneOffers(tx, zoneId, {
          withDefault: false,
        });
        const listed = [...offers, ...setMenus.flatMap((menu) => menu.offers)];
        if (
          !listed.some((offer) =>
            offer.offeredModifiers.some(
              (modifier) =>
                modifier.kind === "options" &&
                modifier.id === optionListId &&
                modifier.labels.some((label) => label.id === labelId),
            ),
          )
        )
          throw new AppError("options.not_found", { optionListId });
        await setOptionLabelAvailability(tx, optionListId, labelId, available);
      });
      return c.json({ available });
    }),
  );

  app.get("/api/menu-state", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const { device } = session;
      const asked = c.req.query("zoneId");
      const zoneId = asked === undefined ? undefined : requireUuidParam(asked, "ServiceZoneId");
      const { state, setupRead } = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        if (zoneId !== undefined) await checkZones(tx, session, [{ zoneId }]);
        const zone =
          zoneId === undefined
            ? (
                await VENUE_SERVICE.resolveNewOrderZone(tx, {
                  profileId: device.deviceProfileId,
                })
              ).zoneId
            : (await VENUE_SERVICE.resolveZoneContext(tx, zoneId)).zoneId;
        const at = new Date();
        const menuState = await VENUE_SERVICE.menuState(tx, zone, at);
        const defaultMenuId = await VENUE_SERVICE.resolveDefaultMenu(
          tx,
          zone,
          at,
          menuState.menus.map((menu) => menu.menuId),
        );
        const setupRead = await readTillSetup(tx, deps, device);
        const dining = VENUE_SERVICE.diningStartOf(
          await VENUE_SERVICE.resolveSalePolicy(tx, zone),
          setupRead.setup.takeawayVat,
        );
        return { state: { ...menuState, defaultMenuId, dining }, setupRead };
      });
      return c.json({
        ...state,
        setupRevision: setupRevisionOf(
          completeTillSetup(setupRead, deps.cloudEmergency?.() ?? null),
        ),
      });
    }),
  );

  app.post("/api/dead-ends/sale", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{
        step: "pay" | "place" | "edit";
        lines: (CounterPaymentBasket["lines"][number] & { workingOrderLineId?: string })[];
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
          order === undefined ? null : await VENUE_SERVICE.findOrderContext(tx, order.id);
        const zoneId =
          order === undefined
            ? await newOrderZoneIn(tx, session, body.lines.length, body.zoneId)
            : context?.zoneId;
        const mode =
          context?.serviceMode ??
          (zoneId === undefined
            ? "prepay"
            : (await VENUE_SERVICE.resolveZoneContext(tx, zoneId)).serviceMode);
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
                "none",
              )
            : null;
        const parents = priced?.lineRows.filter((line) => line.parentLineId === null) ?? [];
        return {
          sends,
          deadEnds: sends
            ? await findDeadEnds(
                tx,
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
          stations: await availableStations(tx, at),
        };
      });
      return c.json(answer);
    }),
  );

  // Idempotent on the client-minted `body.id`: a re-sent park collides on the primary key and
  // replays the existing open order's `{ id, orderNumber }`.
  app.post("/api/working-orders", (c) =>
    runBodyCourse(c, log, async () => {
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
        kitchenNote?: string | null;
        lateSend?: unknown;
        dining?: unknown;
        firstSetMenuId?: unknown;
      }>(c);
      // The client mints `body.id`, which becomes the stored primary key; this screen is the only
      // refusal of a malformed one.
      requireUuidParam(body.id, "WorkingOrderId");
      if (body.zoneId !== undefined) {
        requireUuidParam(body.zoneId, "ServiceZoneId");
      }
      const firstSetMenu =
        body.firstSetMenuId === undefined
          ? undefined
          : {
              menuId: requireBodyUuid(body.firstSetMenuId, "firstSetMenuId").toLowerCase(),
              personId,
            };
      if (firstSetMenu !== undefined && body.zoneId === undefined)
        throw new AppError("management.request_invalid", { field: "zoneId" });
      const lateSend = parseLateSend(body.lateSend);
      const dining = requireDining(body.dining);
      const zoneId = await resolveHttpOrderZone(deps, session, body.lines.length, body.zoneId);
      await gateZones(
        deps,
        session,
        named(zoneId !== undefined && { zoneId }, { orderId: body.id }),
      );
      const result = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        parkOrder(
          { db: deps.db },
          cfg,
          {
            id: body.id,
            lines: body.lines,
            zoneId,
            label: body.label,
            kitchenNote: body.kitchenNote,
            operatorId: personId,
            lateSend: late,
            dining,
            firstSetMenu,
          },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        ),
      );
      return c.json(result);
    }),
  );

  app.get("/api/working-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const orders = await listHeldOrders({ db: deps.db });
      return c.json(await visibleOrders(deps, session, orders));
    }),
  );

  app.get("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const order = await getHeldOrder({ db: deps.db }, id);
      return c.json(order);
    }),
  );

  app.get("/api/working-orders/:id/placed", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      return c.json(await getPlacedCounterOrder({ db: deps.db }, id));
    }),
  );

  app.put("/api/working-orders/:id", (c) =>
    runBodyCourse(c, log, async () => {
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
          setMenuId?: unknown;
          setMenuReservedLineId?: unknown;
          setMenuReservedPlace?: unknown;
        } & LineExtras)[];
        label?: string;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
        lateSend?: unknown;
        dining?: unknown;
      }>(c);
      const expected = requireRevision(body.revision);
      const lines = body.lines.map((line, position) => {
        const { setMenuId, setMenuReservedLineId, setMenuReservedPlace, ...dish } = line;
        if (
          setMenuId === undefined &&
          setMenuReservedLineId === undefined &&
          setMenuReservedPlace === undefined
        )
          return dish;
        const field = (name: string) => `lines[${position}].${name}`;
        const menuId = requireBodyUuid(setMenuId, field("setMenuId")).toLowerCase();
        const menuVersionId = requireBodyUuid(
          dish.menuVersionId,
          field("menuVersionId"),
        ).toLowerCase();
        if (typeof dish.quantity !== "string" || !/^1(?:\.0{1,3})?$/.test(dish.quantity))
          throw new AppError("management.request_invalid", { field: field("quantity") });
        const place = setMenuReservedPlace;
        let reserved = null;
        if (setMenuReservedLineId !== undefined || place !== undefined) {
          const setMenuLineId = requireBodyUuid(
            setMenuReservedLineId,
            field("setMenuReservedLineId"),
          ).toLowerCase();
          if (typeof place !== "number" || !Number.isSafeInteger(place) || place < 0)
            throw new AppError("management.request_invalid", {
              field: field("setMenuReservedPlace"),
            });
          reserved = { setMenuLineId, place };
        }
        return {
          ...dish,
          menuVersionId,
          [SET_MENU_DRAFT_LINE]: {
            setMenuId: menuId,
            position,
            held: false,
            reserved,
          },
        };
      });
      const lateSend = parseLateSend(body.lateSend);
      const dining = requireDining(body.dining);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const saved = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        updateHeldOrder(
          { db: deps.db, admission: deps.admission },
          sendCfg,
          id,
          {
            lines,
            label: body.label,
            revision: expected,
            operatorId: personId,
            expectedEdit: body.expectedEdit,
            lateSend: late,
            dining,
          },
          { fiscal, saleCfg: sendCfg },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        ),
      );
      return c.json(saved);
    }),
  );

  app.put("/api/working-orders/:id/label", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        label?: unknown;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const revision = await setWorkingOrderLabel(
        deps.db,
        id,
        {
          label: requireString(body.label, "label"),
          revision: requireRevision(body.revision),
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  app.put("/api/working-orders/:id/dining", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        dining?: unknown;
        revision?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const dining = requireDining(body.dining);
      const revision = await withTransaction(deps.db, (tx) =>
        switchOrderDining(
          tx,
          id,
          dining,
          requireRevision(body.revision),
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        ),
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
        expectedEdit: BillEditExpected | null;
        delivery?: unknown;
        recipient: {
          identifierType?: RecipientIdentifierType;
          identifierCountryCode?: string;
          taxId: string;
          legalName: string;
          address: string;
          countryCode: string;
        } | null;
      }>(c);
      const delivery = body.delivery;
      const emailAvailable =
        delivery !== null &&
        typeof delivery === "object" &&
        "medium" in delivery &&
        delivery.medium === "email"
          ? (await withTransaction(deps.db, async (tx) => deps.invoiceEmailAvailable?.(tx))) ===
            true
          : false;
      const revision = await setOrderInvoiceChoice(
        deps.db,
        deps.backend,
        cfg,
        id,
        {
          revision: requireRevision(body.revision),
          invoiceType: body.invoiceType,
          recipient: body.recipient,
          delivery,
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        { personId: session.personId, emailAvailable },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  /** For a read: a failed check reads as no mail. */
  const readEmailTransport = async (tx: Transaction): Promise<boolean> =>
    (await deps.invoiceEmailAvailable?.(tx).catch((error: unknown) => {
      log("warn", "invoice_delivery.email_check_failed", { errorCode: codeOf(error) });
      return false;
    })) === true;

  app.get("/api/invoice-delivery-options", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const orderId = requireUuidId(
        requireString(c.req.query("orderId"), "orderId"),
        "working_order.not_found",
      );
      const asked = c.req.query("zoneId");
      const zoneId = asked === undefined ? undefined : requireUuidParam(asked, "ServiceZoneId");
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const [saved] = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(eq(workingOrders.id, orderId));
        // The till sends its service zone even for a saved bill; a saved bill's own zone is checked
        // through orderId.
        await checkZones(
          tx,
          session,
          named({ orderId }, saved === undefined && zoneId !== undefined && { zoneId }),
        );
        const printer = await resolveInvoicePrinter(tx, requestCfg(deps.cfg, session).origin);
        const transport = await readEmailTransport(tx);
        const emailAvailable = await canEmailInvoice(
          tx,
          saved === undefined
            ? { kind: "new-order", zoneId, profileId: session.device.deviceProfileId }
            : { kind: "order", orderId },
          transport,
        );
        return {
          // Only an A4 invoice printer is offered at payment; a receipt one is reached from the sale.
          invoicePrinter: printer?.kind === "a4" ? { id: printer.id, name: printer.name } : null,
          emailAvailable,
          emailNeedsReceiptContact: transport && !emailAvailable,
        };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/working-orders/:id/receipt-language", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{
        revision?: unknown;
        language?: unknown;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const revision = await setOrderReceiptLanguage(
        deps.db,
        id,
        {
          revision: requireRevision(body.revision),
          language: body.language,
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
      return c.json({ revision });
    }),
  );

  app.delete("/api/working-orders/:id", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ expectedEdit: BillEditExpected | null }>(c);
      await abandonHeldOrder(
        { db: deps.db },
        cfg,
        id,
        { operatorId: session.personId, expectedEdit: body.expectedEdit },
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
      );
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
      const body = await readJsonBody<{
        expectedEdit: BillEditExpected | null;
        lateSend?: unknown;
      }>(c);
      const lateSend = parseLateSend(body.lateSend);
      const result = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        placeOrder(
          {
            db: deps.db,
            backend: deps.backend,
            admission: deps.admission,
            clock: deps.clock,
            log,
            attendance: deps.attendance,
          },
          sendingCfg(cfg, c, session.device),
          id,
          personId,
          body.expectedEdit,
          late,
        ),
      );
      return c.json(result);
    }),
  );

  app.get("/api/stations", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(await deps.db.withWriteLock(() => listStationsToday(deps.db)));
    }),
  );

  // The station's work, and the corrections to it (recalls, voids) a cook has not acknowledged.
  app.get("/api/stations/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
      const queue = await deps.db.withWriteLock(async () => ({
        items: await listStationQueue(deps.db, id),
        notices: await VENUE_SERVICE.listStationNotices(deps.db, id),
        printersDown: (await stationPrintersDown(deps.db, new Date(), [id])).map(
          ({ printerId, printerName, since }) => ({ printerId, printerName, since }),
        ),
      }));
      return c.json(queue);
    }),
  );

  app.post("/api/kitchen-notices/:id/acknowledge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c, { action: "prepare-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("kitchen_notice.not_found", { noticeId: id });
      await withTransaction(deps.db, async (tx) => {
        await VENUE_SERVICE.acknowledgeKitchenNotice(tx, id);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/ticket-items/:id/advance", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "prepare-orders" });
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("ticket_item.not_found", { ticketItemId: id });
      const body = await readJsonBody<{ to?: string; stationId?: unknown }>(c);
      const stationId = requireBodyUuid(body.stationId, "stationId").toLowerCase();
      // `advanceTicketItem` refuses any target outside its transition table before the update runs.
      const to = body.to as TicketState;
      await withTransaction(deps.db, async (tx) => {
        // `advanceTicketItem` never checks the station, and a view can still show a dish another
        // station has since taken. An unknown item is left to the verb.
        const [item] = await tx
          .select({ stationId: ticketItems.stationId })
          .from(ticketItems)
          .where(eq(ticketItems.id, id));
        if (item !== undefined && item.stationId !== stationId) {
          throw new AppError("device.forbidden_station", { stationId: item.stationId });
        }
        await advanceTicketItem(
          tx,
          id,
          to,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
      });
      return c.body(null, 200);
    }),
  );

  app.get("/api/expo/board", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const board = await deps.db.withWriteLock(() =>
        readScopedPassBoard(deps.db, { stationIds: null, zoneIds: null }, { release: false }),
      );
      return c.json({ board });
    }),
  );

  mountBillReady(app, deps, log);

  app.get("/api/orders/counter-waiting", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const waiting = await listCounterWaiting({ db: deps.db });
      return c.json(await visibleOrders(deps, session, waiting));
    }),
  );

  app.post("/api/orders/:id/collect", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "hand-over-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_settled");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const submissionId = body.submissionId === undefined ? undefined : submissionIdOf(body);
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        return handOverOrder(
          tx,
          cfg,
          id,
          submissionId,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
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
        await checkZones(tx, session, [{ orderId: id }]);
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
      const ticket = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const ticket = await readSettledTicket(deps.backend, tx, cfg, id);
        if (c.req.query("receiptPreview") !== "1") return ticket;
        return tillReceiptPreview(tx, sale.id, ticket, cfg.practiceMode === true);
      });
      return c.json(ticket);
    }),
  );

  app.get("/api/sales/:id/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id, recipient: sales.counterpartyTaxId })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        const { receipt, withdrawn } = await tillReceiptOriginal(tx, session, sale);
        // Named only where it is the reason the retry route refuses.
        return withdrawn && receipt.status !== "not_queued" && receipt.canRetry
          ? { ...receipt, printerWithdrawn: true }
          : receipt;
      });
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/receipt/handover", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const status = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
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

  app.post("/api/working-orders/:id/payment-slip", (c) =>
    runBodyIds("bill.payment_not_found")(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "payment_slip", session.device);
      await assertRequestDevice(deps, c, session);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<{ paymentId?: unknown }>(c);
      const paymentId = requireBodyUuid(body.paymentId, "paymentId").toLowerCase();
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId }]);
        await printReceivedPaymentSlip(tx, requestCfg(deps.cfg, session), orderId, paymentId);
      });
      return c.json({});
    }),
  );

  app.post("/api/sales/:id/receipt/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt_retry", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        const [sale] = await tx
          .select({ id: sales.id, recipient: sales.counterpartyTaxId })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        if (sale === undefined)
          throw new AppError("working_order.not_found", { workingOrderId: id });
        await expireInvoiceDeliveryClaims(tx);
        const { receipt: original, withdrawn } = await tillReceiptOriginal(tx, session, sale);
        if (original.status === "not_queued") throw new AppError("print_job.not_found", { id });
        if (!original.canRetry)
          throw new AppError("print_job.not_resendable", { id: original.jobId });
        if (withdrawn) throw new AppError("invoice_delivery.printer_invalid", {});
        return resendInvoicePrintJob(
          tx,
          saleReceiptLayout(deps.backend, deps.cfg),
          original.jobId,
          session.personId,
        );
      });
      return c.json(result);
    }),
  );

  /**
   * The sale's receipt original, read once; for a full invoice, also whether a print request sent
   * it to a printer that is not this till's invoice printer (`receiptPrinterWithdrawn`).
   */
  async function tillReceiptOriginal(
    tx: Transaction,
    session: { deviceId: string },
    sale: { id: string; recipient: string | null },
  ): Promise<{ receipt: OriginalReceiptPrint; withdrawn: boolean }> {
    if (sale.recipient === null) {
      return { receipt: await readOriginalReceiptPrint(tx, sale.id), withdrawn: false };
    }
    const state = (await readInvoiceDeliveryState(tx, sale.id, {
      emailAvailable: false,
      printers: () => tillInvoicePrinters(tx, session),
    }))!;
    return { receipt: state.receipt, withdrawn: state.receiptPrinterWithdrawn };
  }

  /** The sale filed for working order `id`, once its zone is checked. */
  async function zonedSale(
    tx: Transaction,
    session: Parameters<typeof checkZones>[1],
    id: string,
  ): Promise<string> {
    await checkZones(tx, session, [{ orderId: id }]);
    const [sale] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.workingOrderId, id));
    if (sale === undefined) throw new AppError("working_order.not_found", { workingOrderId: id });
    return sale.id;
  }

  /** The one printer the till may print a full invoice on: its own invoice printer. */
  async function tillInvoicePrinters(
    tx: Transaction,
    session: { deviceId: string },
  ): Promise<OfferedPrinter[]> {
    const printer = await resolveInvoicePrinter(tx, requestCfg(deps.cfg, session).origin);
    return printer === undefined ? [] : [printer];
  }

  app.get("/api/sales/:id/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const read = async (tx: Transaction, saleId: string) => {
        const transport = await readEmailTransport(tx);
        if (c.req.query("medium") === "email") {
          return readReceiptEmailDeliveries(tx, saleId, {
            emailAvailable: await canEmailInvoice(tx, { kind: "sale", saleId }, transport),
          });
        }
        return readInvoiceDeliveries(tx, saleId, {
          emailAvailable: (sale) =>
            canEmailInvoice(tx, { kind: "sale", saleId: sale.id }, transport),
          printers: () => tillInvoicePrinters(tx, session),
          testPages: deps.testPages,
        });
      };
      const current = await deps.db.withWriteLock(async () => {
        const saleId = await zonedSale(deps.db, session, id);
        if (await invoiceDeliveryClaimsDue(deps.db, new Date())) return null;
        return { status: await read(deps.db, saleId) };
      });
      const status =
        current === null
          ? await withTransaction(deps.db, async (tx) => {
              const saleId = await zonedSale(tx, session, id);
              await expireInvoiceDeliveryClaims(tx, new Date());
              return read(tx, saleId);
            })
          : current.status;
      return c.json(status);
    }),
  );

  app.post("/api/sales/:id/deliveries", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(deps, c, "print-receipt", "invoice_delivery", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<{
        medium?: unknown;
        requestKey?: unknown;
        printerId?: unknown;
        recipient?: unknown;
      }>(c);
      if (body.medium !== "print" && body.medium !== "email")
        throw new AppError("management.request_invalid", { field: "medium" });
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const request = { requestKey, personId: session.personId };
      if (body.medium === "print") {
        const printerId = requireBodyUuid(body.printerId, "printerId");
        const attempt = await withTransaction(deps.db, async (tx) =>
          requestPrintDelivery(
            tx,
            { backend: deps.backend, cfg: requestCfg(deps.cfg, session) },
            { id: await zonedSale(tx, session, id), workingOrderId: id },
            () => tillInvoicePrinters(tx, session),
            { ...request, printerId },
          ),
        );
        return c.json(attempt);
      }
      const recipient = requireRecipient(body.recipient);
      const attempt = await withTransaction(deps.db, async (tx) => {
        const transport = (await deps.invoiceEmailAvailable?.(tx)) === true;
        return requestEmailDelivery(tx, await zonedSale(tx, session, id), {
          ...request,
          recipient,
          transport,
        });
      });
      return c.json(attempt);
    }),
  );

  app.post("/api/sales/:id/deliveries/:deliveryId/to-receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(
        deps,
        c,
        "print-receipt",
        "invoice_delivery_to_receipt",
        session.device,
      );
      await assertRequestDevice(deps, c, session);
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const deliveryId = c.req.param("deliveryId");
      const body = await readJsonBody<{ requestKey?: unknown }>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const attempt = await withTransaction(deps.db, async (tx) => {
        const saleId = await zonedSale(tx, session, id);
        return switchToReceipt(
          tx,
          { backend: deps.backend, cfg },
          { id: saleId, workingOrderId: id },
          () => tillInvoicePrinters(tx, session),
          deliveryId,
          { requestKey, personId: session.personId },
        );
      });
      return c.json(attempt);
    }),
  );

  app.post("/api/sales/:id/deliveries/:deliveryId/retry", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertDeviceCapability(
        deps,
        c,
        "print-receipt",
        "invoice_delivery_retry",
        session.device,
      );
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const deliveryId = c.req.param("deliveryId");
      const body = await readJsonBody<{ requestKey?: unknown }>(c);
      const requestKey = requireBodyUuid(body.requestKey, "requestKey");
      const attempt = await withTransaction(deps.db, async (tx) => {
        const transport = (await deps.invoiceEmailAvailable?.(tx)) === true;
        return retryEmailDelivery(tx, await zonedSale(tx, session, id), deliveryId, {
          requestKey,
          personId: session.personId,
          transport,
        });
      });
      return c.json(attempt);
    }),
  );

  // Document actions use the working-order id and never enqueue drawer commands.
  // A filed but unpaid invoice renders without a payment block.
  app.post("/api/sales/:id/receipt", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      await assertDeviceCapability(deps, c, "print-receipt", "receipt", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const { ifOwed } = await readJsonBody<{ ifOwed?: unknown }>(c);
      if (ifOwed !== undefined && typeof ifOwed !== "boolean")
        throw new AppError("management.request_invalid", { field: "ifOwed" });
      await printSaleReceipt(
        { db: deps.db, backend: deps.backend },
        cfg,
        id,
        ifOwed === true ? "owed" : "original",
        { personId: session.personId },
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/sales/:id/reprint", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      await assertDeviceCapability(deps, c, "print-receipt", "reprint", session.device);
      await assertRequestDevice(deps, c, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      await gateZones(deps, session, [{ orderId: id }]);
      const { language } = await readJsonBody<{ language?: unknown }>(c);
      if (language !== undefined && typeof language !== "string") {
        throw new AppError("management.request_invalid", { field: "language" });
      }
      await reprintSale(
        { db: deps.db, backend: deps.backend },
        cfg,
        id,
        language,
        session.personId,
      );
      return c.body(null, 200);
    }),
  );

  // Session-gated, not permission-gated: any operator may list who could authorize an override.
  app.get("/api/drawer/authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const authorizers = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
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
      await assertRequestDevice(deps, c, session);
      const body = await readJsonBody<{
        override?: { personId?: unknown; pin?: unknown };
        expectedPrinterId?: unknown;
      }>(c);
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

          const printer = await resolveDrawerPrinter(tx, cfg.origin);
          if (printer === undefined) {
            throw new AppError("drawer.no_printer", { deviceId: session.deviceId });
          }
          if (
            body.expectedPrinterId !== undefined &&
            canonicaliseUuid(body.expectedPrinterId) !== printer.id
          ) {
            throw new AppError("drawer.assignment_changed", {});
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

  // Like the refund's list: any operator may see who could approve their cancel and credit.
  app.get("/api/cancel-credit-authorizers", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      return c.json(
        await deps.db.withWriteLock(() => listActivePersonsWithPermission(deps.db, "sale.rectify")),
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
      if (typeof body.reason !== "string")
        throw new AppError("working_order.reason_required", { workingOrderId: id });
      const override = parseOverrideField(body.override);
      await cancelPlacedOrder(
        {
          db: deps.db,
          backend: deps.backend,
          admission: deps.admission,
          clock: deps.clock,
          log,
          attendance: deps.attendance,
        },
        cfg,
        id,
        body.reason,
        { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
        override,
      );
      return c.body(null, 200);
    }),
  );

  app.post("/api/working-orders/:id/split-after-print", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId, sessionId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_placed");
      await gateZones(deps, session, [{ orderId: id }]);
      const body = await readJsonBody<{ override?: unknown }>(c);
      const override = parseOverrideField(body.override);
      return c.json(
        await splitAfterPrint(
          {
            db: deps.db,
            backend: deps.backend,
            admission: deps.admission,
            clock: deps.clock,
            log,
            attendance: deps.attendance,
          },
          cfg,
          id,
          { personId, sessionId, attempts: overridePinAttempts(pinThrottle, session.deviceId) },
          override,
        ),
      );
    }),
  );

  app.get("/api/tables/state", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const read = async (tx: Transaction) => {
        const scope = await readZoneScope(tx, device.deviceProfileId);
        return (await listTablesWithState(tx, deps.floorAnnotators ?? [], undefined, log)).filter(
          (table) => inScope(scope, table.zoneId),
        );
      };
      const current = await deps.db.withWriteLock(async () => {
        if (await todayReconciliationDue(deps.db, deps.clock.now().instant)) return null;
        return read(deps.db);
      });
      const state =
        current === null
          ? await withTransaction(deps.db, async (tx) => {
              await catchUpFloor(tx);
              return read(tx);
            })
          : current;
      return c.json(state);
    }),
  );

  app.get("/api/zones", (c) =>
    run(c, log, async () => {
      const { device } = await requireSession(deps, c);
      const zones = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        const scope = await readZoneScope(tx, device.deviceProfileId);
        const visible = (await listZones(tx)).filter((zone) => inScope(scope, zone.id));
        const ids = visible.map((zone) => zone.id);
        if (ids.length === 0) return [];
        const at = deps.clock.now().instant;
        const modes = new Map(
          (await VENUE_SERVICE.listServiceZones(tx)).map((zone) => [zone.id, zone.serviceMode]),
        );
        const day = await VENUE_SERVICE.readServiceDay(tx, at);
        const states = await VENUE_SERVICE.readZoneClosingStates(tx, ids, at, day);
        const layouts = await zoneLayouts(tx, ids, at, day);
        return visible.map((zone) => {
          const state = states.get(zone.id)!;
          const layout = layouts.get(zone.id)!;
          return {
            ...zone,
            closed: state.closed,
            closesAt: modes.has(zone.id) ? (state.keepOpen?.closesAt ?? null) : null,
            hasPlan: layout.planned,
            layoutSetName: layout.recordedSetName,
            layoutDue: layoutOffer(layout),
            serviceMode: modes.get(zone.id) ?? null,
          };
        });
      });
      return c.json(zones);
    }),
  );

  app.post("/api/tables/:id/seat", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{
        guestCount?: unknown;
        withTableIds?: unknown;
        kitchenNote?: unknown;
      }>(c);
      const guestCount = requireGuestCount(body.guestCount);
      const initialNote = body.kitchenNote;
      if (initialNote !== undefined && initialNote !== null && typeof initialNote !== "string")
        throw new AppError("kitchen_note.invalid", { field: "note" });
      const withTableIds = requireOtherTables(body.withTableIds, id);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const result = await withTransaction(deps.db, async (tx) => {
        await catchUpFloor(tx);
        await checkZones(tx, session, [
          { tableId: id },
          ...withTableIds.map((tableId) => ({ tableId })),
        ]);
        const seated = await seatTable(tx, cfg, { tableId: id, guestCount, operatorId: personId });
        const kitchenNote =
          initialNote === undefined
            ? undefined
            : await VENUE_SERVICE.writeKitchenNote(tx, { partyId: seated.partyId }, 0, initialNote);
        for (const otherId of withTableIds) {
          if ((await holderOf(tx, otherId)) === seated.partyId) continue;
          await joinTables(tx, sendCfg, seated.partyId, otherId, {
            expectedEdits: [
              { billId: seated.tabId, editorVersion: 0, draftId: null, draftRevision: null },
            ],
            expectedPartyRevision: await partyRevision(tx, seated.partyId),
            operatorId: personId,
            otherPartyId: null,
          });
          await joinMergeMembers(tx, sendCfg, seated.partyId, otherId, personId);
        }
        // After the writes, so a seat's and a join's own refusals answer first, as on the join route.
        await refuseTakenOff(tx, [id, ...withTableIds]);
        const revision =
          withTableIds.length === 0 ? seated.revision : await partyRevision(tx, seated.partyId);
        return {
          ...seated,
          revision,
          ...(kitchenNote === undefined
            ? {}
            : {
                kitchenNote: {
                  ...kitchenNote,
                  scope: { partyId: seated.partyId },
                  ownerRevision: revision,
                },
              }),
        };
      });
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/finish", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const body = await readJsonBody<{
        expectedPartyRevision?: unknown;
        expectedEdits?: unknown;
        submissionId?: unknown;
        cancellations?: unknown;
        collect?: unknown;
        approver?: { personId?: unknown; pin?: unknown };
      }>(c);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const resolution = parseFinishCancellations(body);
      const approver = parseDrawerOverride(body.approver);
      const refundHandoff =
        resolution.cancellations?.some((item) => item.refundHandoff === true) === true;
      const attempts = overridePinAttempts(pinThrottle, session.deviceId);
      const toCheck = refundHandoff
        ? await overrideToCheck(
            deps.db,
            { sessionId: session.sessionId, permission: "sale.refund" },
            approver,
          )
        : undefined;
      const result = await withPinCheckAhead(deps.db, toCheck, attempts, (checked) =>
        withTransaction(deps.db, async (tx) => {
          await assertStillSignedIn(tx, session);
          const device = await assertDeviceStillProven(tx, {
            device: session.device,
            tokenHash: null,
          });
          assertProfileAction(device, "take-orders");
          if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
            throw new AppError("device_profile.not_admitted", {});
          const current = { ...session, device };
          await catchUpFloor(tx);
          await checkZones(tx, current, [
            { partyId },
            ...(resolution.collect?.bills ?? []).map((bill) => ({ orderId: bill.billId })),
          ]);
          const refund = refundHandoff
            ? await authorize(
                tx,
                {
                  sessionId: session.sessionId,
                  permission: "sale.refund",
                  override: withCheck(approver, checked),
                },
                attempts,
              )
            : undefined;
          return finishPartyService(
            tx,
            sendingCfg(requestCfg(deps.cfg, current), c, device),
            {
              ...resolution,
              admission: deps.admission,
              approver: withCheckUnder(approver, checked, attempts),
              refundApprovedBy: refund?.viaOverride === true ? refund.authorizedBy : null,
              partyId,
              expectedPartyRevision,
              operatorId: personId,
              expectedEdits: body.expectedEdits as BillEditExpected[],
            },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(result);
    }),
  );

  app.post("/api/tables/:id/cleared", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ tableId: id }]);
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
        await checkZones(tx, session, [{ partyId }]);
        return requestBill(tx, partyId, requested, args);
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/service-steps/:stepId/done", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const stepId = requireStepParam(c.req.param("stepId"));
      const dueAt = requireShownDueAt(asObject(await readRawJsonBody<unknown>(c)).dueAt);
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return markServiceStepDone(tx, {
          deviceProfileId: session.device.deviceProfileId,
          partyId,
          stepId,
          dueAt,
          personId: session.personId,
          nowMs: Date.now(),
        });
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
        await checkZones(tx, session, [{ partyId }]);
        return setPartyName(tx, { partyId, name: body.name, expectedPartyRevision });
      });
      return c.json(named);
    }),
  );

  app.put("/api/parties/:id/guests", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const guestCount = requireGuestCountOrNull(body.guestCount);
      const counted = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return setPartyGuestCount(tx, { partyId, guestCount, expectedPartyRevision });
      });
      return c.json(counted);
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
        const merge = path === "join" ? requireMerge(body.merge, tableId) : null;
        const sent =
          path === "join" ? (merge === null ? sentRevision : requiredRevision)(body) : undefined;
        const sendCfg = sendingCfg(cfg, c, session.device);
        const result = await withTransaction(deps.db, async (tx) => {
          await catchUpFloor(tx);
          await checkZones(tx, session, [{ partyId }, { tableId }]);
          const heldBefore = await memberTables(tx, partyId);
          const check = sent === undefined ? undefined : { tableId, sent };
          return movingRooms(tx, [...heldBefore, tableId], check, async () => {
            const actAndMerge = async (slipsLater?: SlipsLater) => {
              const acted = await act(tx, sendCfg, partyId, tableId, { ...command, slipsLater });
              await joinMergeMembers(tx, sendCfg, acted.partyId, tableId, personId, slipsLater);
              if (merge !== null) {
                const held = merge.moving === tableId ? merge.target : merge.moving;
                if (!heldBefore.includes(held)) throw invalid("merge");
                await writeMerge(tx, {
                  movingId: merge.moving,
                  targetId: merge.target,
                  side: merge.side,
                  seats: merge.seats,
                  free: false,
                });
              }
              return acted;
            };
            let acted: Awaited<ReturnType<typeof actAndMerge>>;
            if (merge === null) {
              acted = await actAndMerge();
            } else {
              // A merge can pass guests on after the join, so the kitchen is told once, at the end.
              acted = await withMovedSlips(
                tx,
                sendCfg,
                { tables: [merge.moving, merge.target], targetGroupOf: merge.target },
                actAndMerge,
              );
            }
            // Last, so the route's own refusals answer first.
            await refuseTakenOff(tx, [tableId]);
            return acted;
          });
        });
        return c.json(result);
      }),
    );
  }

  app.post("/api/parties/:id/split-table", (c) =>
    runBodyLines(c, log, async () => {
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
      const selection = requireSplitSelection(body.selection);
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const guestCounts = requireSplitGuestCounts(body.guestCounts);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const attendance =
        deps.attendance === undefined
          ? undefined
          : { recorder: deps.attendance, clock: deps.clock };
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await catchUpFloor(tx);
          await checkZones(tx, session, [
            { partyId },
            ...selection.wholeBillIds.map((orderId) => ({ orderId })),
            ...selection.loose.map(({ billId: orderId }) => ({ orderId })),
          ]);
          const held = [...(await memberTables(tx, partyId)), tableId.toLowerCase()];
          return movingRooms(tx, held, undefined, async () => {
            const split = await splitTable(
              tx,
              sendCfg,
              partyId,
              tableId.toLowerCase(),
              selection,
              {
                expectedPartyRevision,
                operatorId: personId,
                guestCounts,
                expectedEdits: parseBillEditExpecteds(body.expectedEdits),
              },
              attendance,
            );
            for (const source of split.looseSourceIds)
              await issueIfFullyPaid(tx, fiscal, sendCfg, source, personId);
            if (split.looseSourceIds.length > 0)
              await captureKitchenActivity(tx, attendance, personId, [
                ...split.looseSourceIds,
                split.billIds.at(-1)!,
              ]);
            return { partyId: split.partyId, billIds: split.billIds };
          });
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expectedPartyRevision = requireRevision(
        body.expectedPartyRevision,
        "expectedPartyRevision",
      );
      const created = await withTransaction(deps.db, async (tx) => {
        await catchUpFloor(tx);
        await checkZones(tx, session, [{ partyId }]);
        return createPartyBill(tx, cfg, partyId, { expectedPartyRevision });
      });
      return c.json(created);
    }),
  );

  app.get("/api/parties/:id/bills", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const bills = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return readPartyBills(tx, partyId, log);
      });
      return c.json(bills);
    }),
  );

  app.get("/api/bills/:id/set-menus", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const result = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: billId }]);
        const revision = await assertTabOpen(tx, billId);
        const partyId = await partyOfOrder(tx, billId);
        return {
          setMenus: await readBillSetMenus(tx, billId),
          partyRevision: partyId === null ? revision : await partyRevision(tx, partyId),
        };
      });
      return c.json(result);
    }),
  );

  function changeSetMenus(
    session: Awaited<ReturnType<typeof requireSession>>,
    billId: string,
    expected: number,
    expectedEdit: BillEditExpected | null,
    change: (tx: Transaction) => Promise<Awaited<ReturnType<typeof readBillSetMenus>>>,
  ) {
    return withTransaction(deps.db, async (tx) => {
      await requireEconomicWrite(tx, deps.cfg, deps.admission);
      await checkZones(tx, session, [{ orderId: billId }]);
      const revision = await assertTabOpen(tx, billId);
      const partyId = await partyOfOrder(tx, billId);
      await requireOrderBillEditor(tx, billId, { operatorId: session.personId, expectedEdit });
      if (partyId === null && revision !== expected)
        throw new AppError("working_order.out_of_date", { workingOrderId: billId, revision });
      const next =
        partyId === null ? revision + 1 : await checkAndBumpParty(tx, partyId, expected, "open");
      return { setMenus: await change(tx), partyRevision: next };
    });
  }

  app.put("/api/bills/:id/set-menus/:setMenuId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const menuId = requireBodyUuid(c.req.param("setMenuId"), "setMenuId").toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expected = requireRevision(body.expectedPartyRevision, "expectedPartyRevision");
      const count = body.count;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 99)
        throw new AppError("management.request_invalid", { field: "count" });
      const result = await changeSetMenus(
        session,
        billId,
        expected,
        body.expectedEdit as BillEditExpected | null,
        (tx) => setSetMenuCount(tx, cfg, billId, menuId, count, session.personId),
      );
      return c.json(result);
    }),
  );

  app.delete("/api/bills/:id/set-menu-lines/:lineId", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const lineId = requireBodyUuid(c.req.param("lineId"), "lineId").toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const expected = requireRevision(body.expectedPartyRevision, "expectedPartyRevision");
      const result = await changeSetMenus(
        session,
        billId,
        expected,
        body.expectedEdit as BillEditExpected | null,
        (tx) => removeSetMenuLines(tx, billId, [lineId]),
      );
      return c.json(result);
    }),
  );

  app.get("/api/parties/:id/groups", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const groups = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return {
          ...(await listOrderGroups(tx, partyId)),
          printProblems: await listPrintProblems(tx, partyId),
        };
      });
      return c.json(groups);
    }),
  );

  app.get("/api/parties/:id/current-orders", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const partyId = requirePartyParam(c.req.param("id"));
      const current = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        return readCurrentOrders(tx, partyId);
      });
      return c.json(current);
    }),
  );

  app.post("/api/parties/:id/groups", (c) =>
    runSubmitGroups(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitGroupsInput = {
        ...groupCommand(personId, body),
        ...allergyCommand(body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
        groups: parseSubmittedGroups(body.groups),
        ...joinGroupOf(body),
        ...billOf(body),
      };
      const lateSend = parseLateSend(body.lateSend);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return submitGroups(
            tx,
            sendCfg,
            partyId,
            { ...input, lateSend: late },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(submitted);
    }),
  );

  app.post("/api/parties/:id/groups/:gid/fire", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requirePartyParam(c.req.param("id"));
      const groupId = c.req.param("gid");
      if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lateSend = parseLateSend(body.lateSend);
      const command = { ...groupCommand(personId, body), ...allergyCommand(body) };
      const fired = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withTransaction(deps.db, async (tx) => {
          const current = await recheckFireSession(tx, session);
          await checkZones(tx, current, [{ partyId }]);
          return fireGroup(
            tx,
            requestCfg(deps.cfg, current),
            partyId,
            groupId,
            { ...command, lateSend: late },
            undefined,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(fired);
    }),
  );

  for (const [step, command, action] of [["ready", bumpGroupReady, "prepare-orders"]] as const) {
    app.post(`/api/parties/:id/groups/:gid/${step}`, (c) =>
      run(c, log, async () => {
        const session = await requireSession(deps, c, { action });
        const refused = passReleaseRefusal(session.device);
        if (refused !== null) throw new AppError("device.forbidden_action", { action: refused });
        const { personId } = session;
        const partyId = requirePartyParam(c.req.param("id"));
        const groupId = c.req.param("gid");
        if (!isUuid(groupId)) throw new AppError("group.not_found", { groupId });
        const args = groupCommand(personId, asObject(await readRawJsonBody<unknown>(c)));
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return command(
            tx,
            partyId,
            groupId,
            args,
            { personId },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
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
      runBodyGroup(c, log, async () => {
        const session = await requireSession(deps, c, { action: "hand-over-orders" });
        const { personId } = session;
        const cfg = requestCfg(deps.cfg, session);
        const partyId = requirePartyParam(c.req.param("id"));
        const body = asObject(await readRawJsonBody<unknown>(c));
        const args = groupCommand(personId, body);
        const items = parseLineQuantities(body.items, "items");
        const answer = await withTransaction(deps.db, async (tx) => {
          await checkZones(tx, session, [{ partyId }]);
          return command(
            tx,
            cfg,
            partyId,
            items,
            args,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
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
        await checkZones(tx, session, [{ partyId }]);
        return markGroupServed(
          tx,
          cfg,
          partyId,
          groupId,
          args,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
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
        await checkZones(tx, session, [{ partyId }]);
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
        await checkZones(tx, session, [{ partyId }]);
        return unsnoozeReminder(tx, cfg, partyId, groupId, args);
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/groups/order", (c) =>
    runBodyGroup(c, log, async () => {
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
        await checkZones(tx, session, [{ partyId }]);
        return reorderHeldGroups(
          tx,
          partyId,
          heldGroupIds as string[],
          command,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(reordered);
    }),
  );

  app.post("/api/parties/:id/groups/fire-line", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lateSend = parseLateSend(body.lateSend);
      const command = { ...groupCommand(session.personId, body), ...allergyCommand(body) };
      if (typeof body.lineId !== "string" || !isUuid(body.lineId)) throw invalid("lineId");
      const lineId = body.lineId.toLowerCase();
      const answer = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withTransaction(deps.db, async (tx) => {
          await assertStillSignedIn(tx, session);
          const device = await assertDeviceStillProven(tx, {
            device: session.device,
            tokenHash: null,
          });
          assertProfileAction(device, "take-orders");
          if (!(await canUseDeviceProfile(tx, device.deviceProfileId, session.personId)))
            throw new AppError("device_profile.not_admitted", {});
          const current = { ...session, device };
          const cfg = requestCfg(deps.cfg, current);
          await checkZones(tx, current, [{ partyId }]);
          return fireHeldLine(
            tx,
            cfg,
            partyId,
            lineId,
            { ...command, lateSend: late },
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
          );
        }),
      );
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/split-line", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(session.personId, body);
      if (typeof body.lineId !== "string" || !isUuid(body.lineId)) throw invalid("lineId");
      const lineId = body.lineId.toLowerCase();
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return splitHeldLineIntoUnits(
          tx,
          cfg,
          partyId,
          lineId,
          { ...command, expectedEdit: parseBillEditExpected(body.expectedEdit) },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/groups/move", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requirePartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(personId, body);
      const moves = parseLineQuantities(body.moves, "moves");
      const target = parseMoveTarget(body.target);
      const moved = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return moveLinesToGroup(
          tx,
          cfg,
          partyId,
          moves,
          target,
          { ...command, expectedEdits: parseBillEditExpecteds(body.expectedEdits) },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
      });
      return c.json(moved);
    }),
  );

  app.get("/api/parties/:id/drafts", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        const drafts = await readDrafts(tx, partyId);
        const family = await partyFamily(tx, partyId);
        const bills = await tx
          .select({ id: workingOrders.id })
          .from(workingOrders)
          .where(inArray(workingOrders.partyId, family))
          .orderBy(
            asc(workingOrders.openedAt),
            asc(workingOrders.orderNumber),
            asc(workingOrders.id),
          );
        const billEdits: BillEditState[] = [];
        for (const bill of bills) billEdits.push(await readBillEditState(tx, bill.id));
        return { drafts, billEdits };
      });
      return c.json(answer);
    }),
  );

  app.get("/api/parties/:id/split-sources", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { passive: true });
      const partyId = requirePartyParam(c.req.param("id")).toLowerCase();
      const answer = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ partyId }]);
        const family = (await readBillsOfParties(tx, [partyId], log)).get(partyId)!;
        const bills = [];
        for (const bill of family) {
          if (bill.partyId !== partyId) continue;
          if (bill.status !== "open" && bill.status !== "placed") continue;
          bills.push({
            billId: bill.workingOrderId,
            lines: await readBillLines(tx, bill.workingOrderId),
            balance: await readBillBalance(tx, bill.workingOrderId),
          });
        }
        const [party] = await tx
          .select({ revision: parties.revision })
          .from(parties)
          .where(eq(parties.id, partyId));
        // A press sends this revision with these rows, so it is read in their transaction. An id
        // naming no party has no rows, and a split sent for it is refused whatever its revision.
        return { partyRevision: party?.revision ?? 0, bills };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/parties/:id/drafts", (c) =>
    runSaveDraft(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const draftId = requireDraftId(body.draftId);
      const revision = requireRevision(body.revision);
      const draft = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [{ partyId }]);
          const result = await saveDraft(
            tx,
            partyId,
            personId,
            {
              billId: body.billId,
              draftId,
              revision,
              lines: body.lines,
              expectedEdit: parseBillEditExpected(body.expectedEdit),
            },
            deps.attendance,
          );
          const invoice = await issueIfFullyPaid(
            tx,
            fiscal,
            sendingCfg(cfg, c, session.device),
            result.edit.billId,
            personId,
          );
          return { ...result, ...(invoice === null ? {} : { invoice }) };
        },
        log,
      );
      return c.json(draft);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/split", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const command = groupCommand(session.personId, body);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [{ partyId }]);
          const split = await splitDraft(
            tx,
            cfg,
            partyId,
            draftId,
            {
              ...command,
              expectedEdit: parseBillEditExpected(body.expectedEdit),
              lineIds: body.lineIds,
            },
            deps.attendance,
          );
          await issueIfFullyPaid(
            tx,
            fiscal,
            sendingCfg(cfg, c, session.device),
            split.source.edit.billId,
            session.personId,
          );
          return split;
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/take-over", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const revision = requireRevision(body.revision);
      const draft = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        return takeOverDraft(
          tx,
          partyId,
          draftId,
          personId,
          {
            revision,
            expectedEdit: parseBillEditExpected(body.expectedEdit),
            submissionId: submissionIdOf(body),
          },
          deps.attendance,
        );
      });
      return c.json(draft);
    }),
  );

  app.post("/api/dead-ends/draft", (c) =>
    runDeadEndsDraft(c, log, async () => {
      const session = await requireSession(deps, c);
      const cfg = requestCfg(deps.cfg, session);
      const body = await readJsonBody<{ partyId: string; draftId: string; lineIds: string[] }>(c);
      const partyId = requireDraftPartyParam(body.partyId);
      const draftId = requireDraftParam(body.draftId);
      if (!Array.isArray(body.lineIds)) throw invalid("lineIds");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ partyId }]);
        const at = new Date();
        const draft = (await readDrafts(tx, partyId)).find((entry) => entry.id === draftId);
        if (draft === undefined) throw new AppError("draft.not_found", { draftId });
        const ids = new Set(body.lineIds);
        const selected = draft.lines.filter((line) => ids.has(line.id));
        if (selected.length !== ids.size || selected.some((line) => line.sourceLineId !== null))
          throw invalid("lineIds");
        const lines = selected.filter((line) => line.sourceLineId === null);
        const zoneId = await partyZone(tx, partyId);
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
            [RETAINED_COURSE]: true,
            makeAt: line.makeAt,
          })),
          zoneId ?? undefined,
          undefined,
          "ignore",
          "none",
        );
        const parents = priced.lineRows.filter((line) => line.parentLineId === null);
        return {
          sends: true,
          deadEnds: await findDeadEnds(
            tx,
            zoneId,
            lines.map((line, index) => ({
              key: line.id,
              productId: parents[index]!.productId!,
              quantity: line.quantity,
              makeAt: line.makeAt ?? null,
            })),
            at,
          ),
          stations: await availableStations(tx, at),
        };
      });
      return c.json(answer);
    }),
  );

  app.post("/api/parties/:id/drafts/:did/submit", (c) =>
    runBodyGroup(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const partyId = requireDraftPartyParam(c.req.param("id"));
      const draftId = requireDraftParam(c.req.param("did"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const input: SubmitDraftInput = {
        ...groupCommand(personId, body),
        ...allergyCommand(body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
        draftRevision: requireRevision(body.draftRevision, "draftRevision"),
        groups: parseDraftGroups(body.groups),
        ...joinGroupOf(body),
        dining: requireDining(body.dining),
      };
      const lateSend = parseLateSend(body.lateSend);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const submitted = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            await requireEconomicWrite(tx, deps.cfg, deps.admission);
            await checkZones(tx, session, [{ partyId }]);
            const result = await submitDraft(
              tx,
              sendCfg,
              partyId,
              draftId,
              { ...input, lateSend: late },
              deps.attendance,
              (billId) => issueIfFullyPaid(tx, fiscal, sendCfg, billId, personId),
            );
            return result;
          },
          log,
        ),
      );
      return c.json(submitted);
    }),
  );

  // A tab does not re-price: the stored locked gross rides back verbatim. The revision is read in
  // the same transaction, so it is the one these lines are at.
  app.post("/api/dead-ends/order", (c) =>
    runDeadEndsOrder(c, log, async () => {
      const session = await requireSession(deps, c);
      const body = await readJsonBody<{ workingOrderId: string; toZoneId?: string }>(c);
      const id = requireUuidParam(body.workingOrderId, "WorkingOrderId");
      if (body.toZoneId !== undefined) requireUuidParam(body.toZoneId, "ServiceZoneId");
      const answer = await withTransaction(deps.db, async (tx) => {
        await checkZones(
          tx,
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
        const context = await VENUE_SERVICE.findOrderContext(tx, id);
        const zoneId = body.toZoneId ?? context?.zoneId ?? null;
        const unsent = await unsentDishLines(tx, id);
        const sends =
          unsent.length > 0 &&
          (body.toZoneId === undefined
            ? (context?.serviceMode ?? "prepay") === "prepay" ||
              (order.partyId === null && paysAfterSending(context?.serviceMode))
            : await moveWouldSend(tx, id, body.toZoneId));
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
          stations: await availableStations(tx, at),
          revision: order.revision,
        };
      });
      return c.json(answer);
    }),
  );

  app.put("/api/working-orders/:id/make-at", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const body = await readJsonBody<{
        revision: unknown;
        lines: Record<string, string | null>;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const copy = requireRevision(body.revision);
      if (body.lines === null || typeof body.lines !== "object" || Array.isArray(body.lines))
        throw invalid("lines");
      const revision = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
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
        await requireOrderBillEditor(tx, id, {
          operatorId: session.personId,
          expectedEdit: body.expectedEdit,
        });
        const entries = Object.entries(body.lines);
        const unsent = new Set((await unsentDishLines(tx, id)).map((line) => line.id));
        for (const [lineId, stationId] of entries) {
          if (!unsent.has(lineId)) throw invalid("lines");
          if (stationId !== null) {
            if (typeof stationId !== "string") throw invalid("lines");
            await requireMakeAtStation(tx, stationId);
          }
        }
        const previousChoices =
          deps.attendance === undefined
            ? []
            : await tx
                .select({ id: workingOrderLines.id, stationId: workingOrderLines.makeAtStationId })
                .from(workingOrderLines)
                .where(eq(workingOrderLines.workingOrderId, id));
        for (const [lineId, stationId] of entries)
          await tx
            .update(workingOrderLines)
            .set({ makeAtStationId: stationId })
            .where(eq(workingOrderLines.id, lineId));
        if (entries.length > 0) await bumpRevisionKeepingPayment(tx, [id]);
        if (
          entries.some(([lineId, stationId]) =>
            previousChoices.some((line) => line.id === lineId && line.stationId !== stationId),
          )
        )
          await captureOrderService(
            tx,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
            id,
            "make-at",
          );
        return copy + (entries.length > 0 ? 1 : 0);
      });
      return c.json({ revision });
    }),
  );

  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const tab = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        await checkZones(tx, session, [{ orderId: id }]);
        return {
          lines: await readTabLines(tx, id),
          revision: await readOrderRevision(tx, id),
        };
      });
      return c.json(tab);
    }),
  );

  app.post("/api/working-orders/:id/lines/move-station", (c) =>
    runMoveStation(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const id = requireUuidId(c.req.param("id"), "working_order.not_found");
      const body = await readJsonBody<Record<string, unknown>>(c);
      const request = stationMoveRequest(id, body);
      const result = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        return moveDishesToStation(
          tx,
          cfg,
          id,
          request,
          {
            deviceId: session.deviceId,
            personId: session.personId,
            kind: "order",
            expectedEdit: body.expectedEdit as BillEditExpected | null,
          },
          {
            attendance:
              deps.attendance === undefined
                ? undefined
                : { recorder: deps.attendance, clock: deps.clock },
          },
        );
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
      const {
        revision,
        expectedEdit,
        lateSend: lateSendBody,
        ...patch
      } = await readJsonBody<
        OrderLinePatch & {
          revision?: unknown;
          expectedEdit: BillEditExpected | null;
          lateSend?: unknown;
        }
      >(c);
      const copy = requireRevision(revision);
      const lateSend = parseLateSend(lateSendBody);
      const sendCfg = sendingCfg(cfg, c, session.device);
      const saved = await withLateSendCheck(deps.db, session, pinThrottle, lateSend, (late) =>
        withIssuanceTransaction(
          deps.db,
          async (tx) => {
            await requireEconomicWrite(tx, deps.cfg, deps.admission);
            await checkZones(tx, session, [{ orderId: id }]);
            const revision = await updateOrderLine(
              tx,
              sendCfg,
              id,
              lineNo,
              patch,
              copy,
              { operatorId: personId, expectedEdit, admission: deps.admission },
              deps.attendance === undefined
                ? undefined
                : { recorder: deps.attendance, clock: deps.clock },
              late,
            );
            const invoice = await issueIfFullyPaid(tx, fiscal, sendCfg, id, personId);
            return {
              revision,
              party: await partyRevisionOfOrder(tx, id),
              ...(invoice === null ? {} : { invoice }),
            };
          },
          log,
        ),
      );
      return c.json(saved);
    }),
  );

  app.patch("/api/working-orders/:id/lines/:lineNo/course", (c) =>
    runBodyCourse(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      const body = await readJsonBody<{
        courseId?: string | null;
        expectedEdit: BillEditExpected | null;
      }>(c);
      const courseId = body.courseId ?? null;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [{ orderId: id }]);
        await setLineCourse(
          tx,
          id,
          lineNo,
          courseId,
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
        );
      });
      return c.body(null, 200);
    }),
  );

  // An omitted or empty `lineNos` releases every held line of the tab outside a held group.
  app.post("/api/working-orders/:id/lines/send", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const id = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{
        lineNos?: number[];
        expectedEdit: BillEditExpected | null;
        submissionId?: string;
        expectedPartyRevision?: number;
        allergy?: AllergyCommand["allergy"];
      }>(c);
      await withTransaction(deps.db, async (tx) => {
        const current = await recheckFireSession(tx, session);
        await checkZones(tx, current, [{ orderId: id }]);
        await sendLines(
          tx,
          requestCfg(deps.cfg, current),
          id,
          body.lineNos ?? [],
          { operatorId: session.personId, expectedEdit: body.expectedEdit },
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock, personId: session.personId },
          allergyCommand(body),
        );
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/bills/:id/set-menu-moves", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const cfg = requestCfg(deps.cfg, session);
      const billId = requireTabParam(c.req.param("id")).toLowerCase();
      const body = asObject(await readRawJsonBody<unknown>(c));
      const moves = requireSetMenuMoves(body.moves);
      const expected = requireRevision(body.expectedPartyRevision, "expectedPartyRevision");
      const result = await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        await checkZones(tx, session, [{ orderId: billId }]);
        const revision = await assertTabOpen(tx, billId);
        await refuseUnlessSetMenuBill(tx, billId);
        const partyId = await partyOfOrder(tx, billId);
        await requireOrderBillEditor(tx, billId, {
          operatorId: session.personId,
          expectedEdit: body.expectedEdit as BillEditExpected | null,
        });
        // A takeaway without a party uses its bill revision in the same request field.
        if (partyId === null && revision !== expected)
          throw new AppError("working_order.out_of_date", { workingOrderId: billId, revision });
        const partyRevision =
          partyId === null ? revision + 1 : await checkAndBumpParty(tx, partyId, expected, "open");
        const setMenus = await moveSetMenuDishes(tx, cfg, billId, moves);
        return { setMenus, partyRevision };
      });
      return c.json(result);
    }),
  );

  // The path is the bill the dishes leave.
  app.post("/api/bills/:id/move-dishes", (c) =>
    runBodyLines(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const { personId } = session;
      const cfg = requestCfg(deps.cfg, session);
      const fromBillId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const lineIds = requireLineIds(body.lineIds);
      const toBillId = body.toBillId === null ? null : requireOtherBill(body.toBillId, "toBillId");
      const command = billCommand(personId, body);
      const saleCfg = sendingCfg(cfg, c, session.device);
      const result = await withIssuanceTransaction(
        deps.db,
        async (tx) => {
          await requireEconomicWrite(tx, deps.cfg, deps.admission);
          await checkZones(tx, session, [
            { orderId: fromBillId },
            ...(toBillId === null ? [] : [{ orderId: toBillId }]),
          ]);
          const moved = await moveDishes(tx, cfg, fromBillId, toBillId, lineIds, {
            admission: deps.admission,
            ...command,
            expectedEdits: parseBillEditExpecteds(body.expectedEdits),
            invoiceChoice: body.invoiceChoice,
          });
          const invoice = await issueIfFullyPaid(tx, fiscal, saleCfg, fromBillId, personId);
          await captureKitchenActivity(
            tx,
            deps.attendance === undefined
              ? undefined
              : { recorder: deps.attendance, clock: deps.clock },
            personId,
            [fromBillId, moved.billId],
          );
          return { ...moved, ...(invoice === null ? {} : { invoice }) };
        },
        log,
      );
      return c.json(result);
    }),
  );

  app.put("/api/bills/:id/name", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      // The wire always carries a name; null or "" clears it.
      if (body.name === undefined) throw invalid("name");
      const command = {
        ...billCommand(session.personId, body),
        expectedEdit: parseBillEditExpected(body.expectedEdit),
      };
      const named = await withTransaction(deps.db, async (tx) => {
        await checkZones(tx, session, [await billNameZoneSubject(tx, billId)]);
        return setBillName(tx, billId, body.name, command);
      });
      return c.json(named);
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
      const command = { ...billCommand(personId, body), invoiceChoice: body.invoiceChoice };
      await withTransaction(deps.db, async (tx) => {
        await requireEconomicWrite(tx, deps.cfg, deps.admission);
        await checkZones(tx, session, [{ orderId: intoBillId }, { orderId: fromBillId }]);
        let attendance: OrderAttendance | undefined;
        if (deps.attendance !== undefined) {
          const reading = deps.clock.now();
          attendance = {
            recorder: deps.attendance,
            clock: {
              now: () => reading,
              anchor: (trusted) => deps.clock.anchor(trusted),
              currentAnchor: () => deps.clock.currentAnchor(),
            },
          };
        }
        await mergeBills(
          tx,
          cfg,
          intoBillId,
          fromBillId,
          {
            admission: deps.admission,
            ...command,
            expectedEdits: parseBillEditExpecteds(body.expectedEdits),
          },
          attendance,
        );
        await captureKitchenActivity(tx, attendance, personId, [intoBillId, fromBillId]);
      });
      return c.body(null, 204);
    }),
  );

  app.post("/api/bills/:id/move/allergy-preview", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c, { action: "take-orders" });
      const billId = requireTabParam(c.req.param("id"));
      const body = asObject(await readRawJsonBody<unknown>(c));
      const to = requireMoveTarget(body.to);
      if (!("tableId" in to)) throw invalid("to");
      const command = moveCommand(session.personId, body);
      return c.json(
        await withTransaction(deps.db, async (tx) => {
          const current = await recheckFireSession(tx, session);
          await checkZones(tx, current, [{ orderId: billId }, { tableId: to.tableId }]);
          return previewBillMoveAllergy(tx, billId, to.tableId, command);
        }),
      );
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
        const current =
          command.allergy === undefined ? session : await recheckFireSession(tx, session);
        await checkZones(tx, current, [
          { orderId: billId },
          ...named(
            "tableId" in to && { tableId: to.tableId },
            "counter" in to && to.counter.zoneId !== null && { zoneId: to.counter.zoneId },
          ),
        ]);
        const moved = await moveBill(
          tx,
          sendCfg,
          billId,
          to,
          command,
          deps.attendance === undefined
            ? undefined
            : { recorder: deps.attendance, clock: deps.clock },
        );
        if ("tableId" in to) await refuseTakenOff(tx, [to.tableId]);
        return moved;
      });
      return c.json(result);
    }),
  );
  mountGatedWhileDiskFull(root, app, { disk: deps.disk, log, open: TILL_OPEN_WHILE_DISK_FULL });
}
