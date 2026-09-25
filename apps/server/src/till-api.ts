import type { ExtraSelection, OptionSelection } from "@waitron/shared";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { and, eq } from "drizzle-orm";
import { AppError, isAppError, SUPPORTED_LOCALES } from "@waitron/shared";
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
import type { PinThrottle } from "@waitron/identity";
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
  addTabRound,
  advanceTicket,
  advanceTicketItem,
  bumpCourseReady,
  cancelPlacedOrder,
  fireCourse,
  getHeldOrder,
  joinTable,
  listExpoQueue,
  listHeldOrders,
  listStationQueue,
  listTablesWithState,
  markCollected,
  markCourseAway,
  markLineServed,
  mergeTabs,
  moveTab,
  openTab,
  parkOrder,
  placeOrder,
  readTabLines,
  recallLines,
  sendLines,
  sendToPrep,
  setLineCourse,
  splitOffCheck,
  transferLines,
  unjoinTable,
  unmarkLineServed,
  updateHeldOrder,
  voidTabLine,
} from "./working-order.js";
import type { LineExtras, TicketState } from "./working-order.js";
import { listCourses, listStations } from "./kitchen.js";
import { printSalePaymentSlip } from "./payment-slip-print.js";
import { reprintOrderTickets } from "./kitchen-print.js";
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
import { requireUuidParam } from "@waitron/server-kit";
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

/** Every AppError code the till API answers, and its HTTP status; an unlisted code answers 400. */
const STATUS: Record<string, ContentfulStatusCode> = {
  "pin.invalid": 401,
  // 429, not 401, so the till can tell "wait N seconds" apart from "wrong PIN".
  "pin.throttled": 429,
  "person.not_found": 401,
  "person.suspended": 403,
  // Authenticated device lacks the action capability or is excluded from the workflow.
  "device.forbidden_action": 403,
  // The same codes and statuses `device-api.ts`'s map assigns.
  "device.unauthorized": 401,
  "device.till_required": 400,
  "session.not_open": 401,
  "session.required": 401,
  "locale.unsupported": 400,
  "sale.empty_basket": 400,
  "sale.unknown_product": 400,
  "product.variant_required": 400,
  "modifier.invalid": 400,
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
  "working_order.not_found": 404,
  "working_order.not_open": 409,
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
  "table.occupied": 409,
  "tab.merge_self": 400,
  "tab.transfer_self": 400,
  "tab.transfer_quantity_invalid": 400,
  "tab.transfer_duplicate_line": 400,
  "table.not_joined": 409,
  "table.not_shared": 409,
  "tab.transfer_modifier_line": 400,
  "status.not_found": 404,
  "status.inactive": 409,
  "drawer.no_printer": 400,
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
 * An absent override leaves the operator's own role to decide. A malformed one gets the codes the
 * credential gate gives a bad credential: `person.not_found` for a non-UUID id, `pin.invalid` for a
 * non-string PIN.
 */
function parseDrawerOverride(
  raw: { personId?: unknown; pin?: unknown } | undefined | null,
): { personId: string; pin: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    throw new AppError("person.not_found", { personId: String(raw.personId) });
  }
  if (typeof raw.pin !== "string") {
    throw new AppError("pin.invalid", {});
  }
  return { personId: raw.personId, pin: raw.pin };
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
function requireTabParam(id: string): string {
  if (!isUuid(id)) {
    throw new AppError("tab.not_open", { tabId: id });
  }
  return id;
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
  verb: (tx: Transaction, cfg: TillConfig, orderId: string, courseId: string) => Promise<void>,
): void {
  app.post(`/api/orders/:id/courses/:courseId/${suffix}`, (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const orderId = requireUuidId(c.req.param("id"), "working_order.not_found");
      const courseId = c.req.param("courseId");
      if (!isUuid(courseId)) throw new AppError("course.not_found", { courseId });
      await withTransaction(deps.db, async (tx) => {
        await verb(tx, deps.cfg, orderId, courseId);
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
      if (personId === null)
        throw new AppError("person.not_found", { personId: String(rawPersonId) });
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
      // Resolved before the boot transaction because `tryReadDevice` opens its own.
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
      await requireSession(deps, c);
      const zoneId = requireUuidParam(c.req.param("zoneId"), "ServiceZoneId");
      const result = await withTransaction(deps.db, async (tx) => {
        const context = await VENUE_SERVICE.resolveZoneContext(tx, deps.cfg, zoneId);
        return { context, ...(await VENUE_SERVICE.listZoneOffers(tx, deps.cfg, zoneId)) };
      });
      return c.json(result);
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
        { db: deps.db, backend: deps.backend, clock: deps.clock },
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
      // Resolved once for both device guards: `tryReadDevice` runs a scrypt verification.
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

      // Practice mode: the local simulator, stamping no reader.
      if (deps.cardProvider?.provider === "simulator") {
        const outcome = await payWorkingOrderIntegrated(
          { db: deps.db, backend: deps.backend, clock: deps.clock, provider: deps.cardProvider },
          saleCfg,
          { ...body, zoneId },
          personId,
        );
        return c.json(outcome); // 200 with the discriminated outcome — even a decline.
      }

      const reader = await resolvePayReader(deps, device?.deviceId, body.readerId);
      // A live boot always supplies the pool; a missing one is a boot misconfiguration.
      /* v8 ignore start */
      if (deps.pool === undefined) {
        throw new Error("/api/pay: card provider pool not configured");
      }
      /* v8 ignore stop */
      // The provider carries no reader: the chosen one travels per collect as `readerRef`, so one
      // cached provider serves every reader on the same vendor.
      const provider = await deps.pool.get(reader.provider);
      const outcome = await payWorkingOrderIntegrated(
        {
          db: deps.db,
          backend: deps.backend,
          clock: deps.clock,
          provider,
          readerRef: reader.providerRef,
          readerId: reader.id,
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

  // Returns the pricing inputs only, never a stored price: the till re-prices on retrieve.
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
      await requireSession(deps, c);
      const id = requireUuidId(c.req.param("id"), "working_order.not_open");
      const body = await readJsonBody<{
        lines: ({
          menuItemId: string;
          quantity: string;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
        } & LineExtras)[];
        label?: string;
      }>(c);
      await updateHeldOrder({ db: deps.db }, deps.cfg, id, {
        lines: body.lines,
        label: body.label,
      });
      return c.body(null, 200);
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
        { db: deps.db, backend: deps.backend, clock: deps.clock },
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

  app.get("/api/stations/:id/queue", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
      const queue = await withTransaction(deps.db, async (tx) => {
        return listStationQueue(tx, id);
      });
      return c.json(queue);
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
      const { personId, sessionId } = await requireSession(deps, c);
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
            : await authorize(tx, {
                sessionId,
                permission: "cash.drawer",
                override: parseDrawerOverride(body.override),
              });

        const printer = await resolveReceiptPrinter(tx, deps.cfg);
        if (printer === undefined) {
          throw new AppError("drawer.no_printer", { tillId: deps.cfg.tillId });
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
        { db: deps.db, backend: deps.backend, clock: deps.clock },
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
        { db: deps.db, backend: deps.backend, clock: deps.clock },
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

  // DELETE deactivates; `deactivateTable` is the only thing keeping it a deactivation.
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

  app.post("/api/tables/:id/tab", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
      const body = await readJsonBody<{
        lines?: { menuItemId: string; quantity: string }[];
      }>(c);
      const result = await withTransaction(deps.db, async (tx) => {
        return openTab(tx, deps.cfg, { tableId: id, lines: body.lines });
      });
      return c.json(result);
    }),
  );

  app.post("/api/working-orders/:id/round", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const body = await readJsonBody<{
        lines: ({
          menuItemId: string;
          quantity: string;
          courseId?: string | null;
          extras?: ExtraSelection[];
          options?: OptionSelection[];
          hold?: boolean;
        } & LineExtras)[];
      }>(c);
      await withTransaction(deps.db, async (tx) => {
        await addTabRound(tx, deps.cfg, id, body.lines);
      });
      return c.body(null, 200);
    }),
  );

  app.delete("/api/working-orders/:id/lines/:lineNo", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = c.req.param("id");
      if (!isUuid(id)) throw new AppError("tab.not_open", { tabId: id });
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTransaction(deps.db, async (tx) => {
        await voidTabLine(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );

  // A tab does not re-price: the stored locked gross rides back verbatim.
  app.get("/api/working-orders/:id/lines", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lines = await withTransaction(deps.db, async (tx) => {
        return readTabLines(tx, deps.cfg, id);
      });
      return c.json(lines);
    }),
  );

  // Pre-fiscal: `served_at` never enters a filed record.
  app.post("/api/working-orders/:id/lines/:lineNo/served", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTransaction(deps.db, async (tx) => {
        await markLineServed(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
    }),
  );

  app.delete("/api/working-orders/:id/lines/:lineNo/served", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const id = requireTabParam(c.req.param("id"));
      const lineNo = requireLineNo(id, c.req.param("lineNo"));
      await withTransaction(deps.db, async (tx) => {
        await unmarkLineServed(tx, deps.cfg, id, lineNo);
      });
      return c.body(null, 200);
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

  // An omitted or empty `lineNos` releases every held line of the tab.
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

  app.post("/api/tabs/:id/move", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ toTableId: string }>(c);
      if (!isUuid(body.toTableId))
        throw new AppError("table.not_found", { tableId: body.toTableId });
      await withTransaction(deps.db, async (tx) => {
        await moveTab(tx, deps.cfg, tabId, body.toTableId);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tabs/:id/join", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ tableId: string }>(c);
      if (!isUuid(body.tableId)) throw new AppError("table.not_found", { tableId: body.tableId });
      await withTransaction(deps.db, async (tx) => {
        await joinTable(tx, deps.cfg, tabId, body.tableId);
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tabs/:id/merge", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const intoTabId = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{ fromTabId: string; freeSourceTable: boolean }>(c);
      if (!isUuid(body.fromTabId)) throw new AppError("tab.not_open", { tabId: body.fromTabId });
      await withTransaction(deps.db, async (tx) => {
        await mergeTabs(tx, deps.cfg, intoTabId, body.fromTabId, {
          freeSourceTable: body.freeSourceTable,
        });
      });
      return c.body(null, 200);
    }),
  );

  app.post("/api/tabs/:id/transfer", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const fromTabId = requireTabParam(c.req.param("id"));
      const body = await readJsonBody<{
        toTabId: string;
        transfers: { lineNo: number; quantity?: string }[];
      }>(c);
      if (!isUuid(body.toTabId)) throw new AppError("tab.not_open", { tabId: body.toTabId });
      await withTransaction(deps.db, async (tx) => {
        await transferLines(tx, deps.cfg, fromTabId, body.toTabId, body.transfers);
      });
      return c.body(null, 200);
    }),
  );

  // Spins selected items off into a new table-less check; nothing files until it is paid.
  app.post("/api/tabs/:id/split", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const fromTabId = requireTabParam(c.req.param("id"));
      // `readRawJsonBody`, not `readJsonBody`: a null, empty or malformed body must be refused as
      // field "body", not coalesced to `{}`.
      const body = await readRawJsonBody<{ transfers: { lineNo: number; quantity?: string }[] }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      // Only the array shape is screened; the verb raises the domain errors for bad contents.
      if (!Array.isArray(body.transfers)) {
        throw new AppError("management.request_invalid", { field: "transfers" });
      }
      const result = await withTransaction(deps.db, async (tx) => {
        return splitOffCheck(tx, deps.cfg, fromTabId, body.transfers);
      });
      return c.json(result);
    }),
  );

  app.post("/api/tabs/:id/unjoin", (c) =>
    run(c, log, async () => {
      await requireSession(deps, c);
      const tabId = requireTabParam(c.req.param("id"));
      // Raw parse, as in `/split`.
      const body = await readRawJsonBody<{
        tableId: string;
        transfers?: { lineNo: number; quantity?: string }[];
      }>(c);
      // Body shape first: a missing body is a request-shape fault, not `table.not_joined`.
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (!isUuid(body.tableId))
        throw new AppError("table.not_joined", { tableId: body.tableId, tabId });
      // Optional (absent frees the table); only a present non-array is refused.
      if (body.transfers !== undefined && !Array.isArray(body.transfers)) {
        throw new AppError("management.request_invalid", { field: "transfers" });
      }
      const result = await withTransaction(deps.db, async (tx) => {
        return unjoinTable(tx, deps.cfg, tabId, body.tableId, body.transfers);
      });
      return c.json(result);
    }),
  );
}
