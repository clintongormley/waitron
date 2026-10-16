import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  deviceProfiles,
  devices,
  floorZones,
  invoiceSeries,
  locations,
  saleSettlements,
  sales,
  saleSubstitutions,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createPinThrottle,
  deviceProfileAdmissionPersons,
  hashPin,
  hashSessionToken,
  persons,
  sessions,
  type PinAttempts,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { AppError, deviceOrigin, locationId } from "@waitron/shared";
import {
  departments,
  orderServiceContexts,
  setProfileServiceAccess,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { withTenderRefundAuthorization } from "./tender-refund-authorization.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";
import type { DeviceRequestConfig } from "./till-config.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import {
  watchDerivationsAndLock,
  watchedDerivationCount,
  watchedOrder,
  whileChangingOnLockRequest,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const AT = "2026-10-16T09:00:00.000Z";
const PIN = "4567";
const PIN_HASH = hashPin(PIN);
const CAPS = ["take-cash", "hand-keyed-card-payment", "integrated-card-payment"];
const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let cfg: DeviceRequestConfig;
let profileId: string;
let personId: string;
let managerId: string;
let sessionId: string;
let attempts: PinAttempts;
let seriesId: string;
let departmentId: string;
let zones: string[];
let counter: number;

beforeEach(async () => {
  const db = store.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({ name: "Returns", invoiceLocales: ["en-GB"], operationDescription: "Meals" })
    .returning();
  const placeId = locationId(place!.id);
  const nodeId = await seedNode(db, placeId);
  const device = await seedDevice(db, { locationId: placeId, capabilities: CAPS });
  profileId = device.profileId;
  cfg = {
    nodeId,
    locationId: placeId,
    origin: deviceOrigin(device.deviceId),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: true,
    simplifiedInvoiceLimit: null,
  };
  const people = await db
    .insert(persons)
    .values([
      { displayName: "Requester", role: "supervisor", pinHash: PIN_HASH },
      { displayName: "Approver", role: "manager", pinHash: PIN_HASH },
    ])
    .returning();
  personId = people[0]!.id;
  managerId = people[1]!.id;
  const [session] = await db
    .insert(sessions)
    .values({
      personId,
      deviceId: device.deviceId,
      tokenHash: hashSessionToken(randomUUID()),
    })
    .returning();
  sessionId = session!.id;
  attempts = { throttle: createPinThrottle(), slot: `override:${device.deviceId}` };
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "TR", purpose: "standard" })
    .returning();
  seriesId = series!.id;
  const [department] = await db
    .insert(departments)
    .values({ locationId: placeId, name: "Dining", tradingName: "Dining" })
    .returning();
  departmentId = department!.id;
  zones = (
    await db
      .insert(floorZones)
      .values([
        { locationId: placeId, name: "Inside" },
        { locationId: placeId, name: "Outside" },
      ])
      .returning()
  ).map((row) => row.id);
  await db
    .insert(zoneServicePolicies)
    .values(zones.map((zoneId) => ({ locationId: placeId, zoneId, departmentId })));
  counter = 0;
});
afterEach(async () => {
  await watchedOrder();
  vi.restoreAllMocks();
});

async function target(
  method: "cash" | "card" = "cash",
  provider = "fake",
  zoneId: string | null = zones[0]!,
) {
  const db = store.db;
  const orderId = randomUUID();
  await db.insert(workingOrders).values({
    id: orderId,
    source: "device",
    deviceId: cfg.origin.deviceId,
    nodeId: cfg.nodeId,
    locationId: cfg.locationId,
    orderNumber: ++counter,
  });
  if (zoneId !== null)
    await db.insert(orderServiceContexts).values({
      workingOrderId: orderId,
      locationId: cfg.locationId,
      departmentId,
      zoneId,
      serviceMode: "ticket_then_pay",
    });
  const [sale] = await db
    .insert(sales)
    .values({
      source: "device",
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      seriesId,
      invoiceNumber: counter,
      workingOrderId: orderId,
      issuedAt: AT,
      issuedOffsetMinutes: 0,
      total: 1000,
      vatBreakdown: [],
      locale: "en-GB",
      invoiceLocales: ["en-GB"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  const [tender] = await db
    .insert(tenders)
    .values({ saleId: sale!.id, method, amount: 1000, settledAt: AT })
    .returning();
  await db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
  if (method === "card")
    await db.insert(payments).values({
      saleId: sale!.id,
      workingOrderId: orderId,
      source: "device",
      deviceId: cfg.origin.deviceId,
      provider,
      paymentRef: randomUUID(),
      state: "captured",
      amount: 1000,
    });
  return { saleId: sale!.id, tenderId: tender!.id, orderId };
}
type Target = Awaited<ReturnType<typeof target>>;
function request(tenderId: string, patch: Partial<TenderRefundRequest> = {}): TenderRefundRequest {
  return {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: "2.00",
    tipAmount: "0.00",
    reason: "Goodwill",
    cashConfirmed: true,
    ...patch,
  };
}
const operator = () => ({ personId, sessionId, attempts });
const override = () => ({ personId: managerId, pin: PIN });
async function reserve(t: Target, req = request(t.tenderId), config = cfg, op = operator()) {
  return withTenderRefundAuthorization(
    store.db,
    config,
    t.saleId,
    req,
    op,
    async (tx, authorization) => {
      const held = await reserveTenderRefund(
        tx,
        config,
        t.saleId,
        req,
        { requestedBy: op.personId, authorizedBy: authorization.authorizedBy },
        AT,
      );
      return { ...held, authorization };
    },
  );
}
const rows = () => store.db.select().from(tenderRefunds);
async function refused(
  t: Target,
  code: string,
  req = request(t.tenderId),
  config = cfg,
  op = operator(),
) {
  await expect(reserve(t, req, config, op)).rejects.toMatchObject({ code });
  expect(await rows()).toEqual([]);
}
const role = (value: "staff" | "supervisor") =>
  store.db.update(persons).set({ role: value }).where(eq(persons.id, personId));
const capabilities = (value: string[]) =>
  store.db
    .update(deviceProfiles)
    .set({ capabilities: value })
    .where(eq(deviceProfiles.id, profileId));
async function scope(allowed: string[]) {
  await withTransaction(store.db, (tx) =>
    setProfileServiceAccess(tx, cfg, profileId, {
      departmentId,
      allowedZoneIds: allowed,
      startingZoneId: allowed[0]!,
    }),
  );
}

describe("settled-tender refund authorization before reservation", () => {
  it("does not reserve after the session ended", async () => {
    const t = await target();
    await store.db.update(sessions).set({ endedAt: AT }).where(eq(sessions.id, sessionId));
    await refused(t, "session.required");
  });
  it("records the operator's own authority before a cash reservation", async () => {
    const t = await target();
    const originals = await store.db.select().from(sales);
    const paid = await store.db.select().from(tenders);
    expect(await reserve(t)).toMatchObject({
      authorization: { authorizedBy: personId, viaOverride: false },
      refund: { state: "pending", requestedBy: personId, authorizedBy: personId },
    });
    expect(await store.db.select().from(sales)).toEqual(originals);
    expect(await store.db.select().from(tenders)).toEqual(paid);
  });
  it.each(["session", "person", "device"] as const)(
    "rejects a mismatched %s identity",
    async (part) => {
      const t = await target();
      const op = {
        ...operator(),
        ...(part === "session"
          ? { sessionId: randomUUID() }
          : part === "person"
            ? { personId: managerId }
            : {}),
      };
      const config =
        part === "device"
          ? {
              ...cfg,
              origin: deviceOrigin(
                (await seedDevice(store.db, { locationId: cfg.locationId })).deviceId,
              ),
            }
          : cfg;
      await refused(t, "session.required", request(t.tenderId), config, op);
    },
  );
  it.each(["disabled", "deleted"] as const)("rejects a %s device", async (kind) => {
    const t = await target();
    await store.db
      .update(devices)
      .set(kind === "disabled" ? { active: false } : { deletedAt: AT })
      .where(eq(devices.id, cfg.origin.deviceId));
    await refused(t, "device.unauthorized");
  });
  it("rejects a device moved to a different location", async () => {
    const t = await target();
    const [place] = await store.db
      .insert(locations)
      .values({ name: "Elsewhere", invoiceLocales: ["en-GB"], operationDescription: "Meals" })
      .returning();
    await store.db
      .update(devices)
      .set({ locationId: place!.id })
      .where(eq(devices.id, cfg.origin.deviceId));
    await refused(t, "device.unauthorized");
  });
  it("rejects a retired profile", async () => {
    const t = await target();
    await store.db
      .update(deviceProfiles)
      .set({ retiredAt: AT })
      .where(eq(deviceProfiles.id, profileId));
    await refused(t, "device.unauthorized");
  });
  it.each(["suspended", "pending"] as const)(
    "rejects a %s operator with a surviving session",
    async (status) => {
      const t = await target();
      await store.db.update(persons).set({ status }).where(eq(persons.id, personId));
      await refused(t, "device_profile.not_admitted");
    },
  );
  it("rechecks the current profile's operator admission", async () => {
    const t = await target();
    await store.db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profileId, personId, admitted: false });
    await refused(t, "device_profile.not_admitted");
  });
  it("requires sale.refund even when the device takes cash", async () => {
    const t = await target();
    await role("staff");
    await refused(t, "authorization.not_permitted");
  });
  it("uses an authorized PIN when the operator lacks sale.refund", async () => {
    const t = await target();
    await role("staff");
    expect(await reserve(t, request(t.tenderId, { override: override() }))).toMatchObject({
      refund: { requestedBy: personId, authorizedBy: managerId },
      authorization: { viaOverride: true },
    });
  });
  it("ignores an unused wrong PIN for an operator with sale.refund", async () => {
    const t = await target();
    for (let n = 0; n < 4; n++) attempts.throttle.recordFailure(attempts.slot, managerId);
    watchDerivationsAndLock(store.db, "wrong");
    const result = await reserve(
      t,
      request(t.tenderId, { override: { personId: managerId, pin: "wrong" } }),
    );
    expect(result.refund.authorizedBy).toBe(personId);
    expect(watchedDerivationCount()).toBe(0);
    expect(await watchedOrder()).toEqual([]);
    expect(attempts.throttle.wouldRefuse(attempts.slot, managerId)).toBe(true);
  });
  it.each(["wrong", "suspended", "no-permission"] as const)(
    "rejects a %s approving PIN without a reservation",
    async (kind) => {
      const t = await target();
      await role("staff");
      if (kind !== "wrong")
        await store.db
          .update(persons)
          .set(kind === "suspended" ? { status: "suspended" } : { role: "staff" })
          .where(eq(persons.id, managerId));
      await refused(
        t,
        kind === "no-permission" ? "authorization.not_permitted" : "pin.invalid",
        request(t.tenderId, {
          override: { personId: managerId, pin: kind === "wrong" ? "wrong" : PIN },
        }),
      );
    },
  );
  it("enforces the shared PIN throttle", async () => {
    const t = await target();
    await role("staff");
    for (let n = 0; n < 4; n++) attempts.throttle.recordFailure(attempts.slot, managerId);
    await refused(t, "pin.throttled", request(t.tenderId, { override: override() }));
  });
  it.each(["cash", "manual", "connected"] as const)(
    "requires the current device's %s tender capability",
    async (kind) => {
      const t = await target(
        kind === "cash" ? "cash" : "card",
        kind === "manual" ? "manual" : "fake",
      );
      const cap =
        kind === "cash"
          ? "take-cash"
          : kind === "manual"
            ? "hand-keyed-card-payment"
            : "integrated-card-payment";
      await capabilities(CAPS.filter((entry) => entry !== cap));
      await refused(
        t,
        kind === "cash" ? "device.cash_not_allowed" : "device.forbidden_action",
        request(t.tenderId, { manualConfirmed: true, override: override() }),
      );
    },
  );
  it("does not turn a shared kitchen display into a refund terminal", async () => {
    const t = await target();
    const [shared] = await store.db
      .insert(deviceProfiles)
      .values({
        name: "Shared display",
        formFactor: "kds",
        capabilities: CAPS,
      })
      .returning();
    await store.db
      .update(devices)
      .set({ deviceProfileId: shared!.id })
      .where(eq(devices.id, cfg.origin.deviceId));
    await refused(t, "device.forbidden_action");
  });
  it("a standalone terminal needs an authorized PIN even for an authorized operator", async () => {
    const t = await target("card", "manual");
    await refused(
      t,
      "tender.manual_refund_pin_required",
      request(t.tenderId, { manualConfirmed: true }),
    );
  });
  it("a standalone terminal needs handover confirmation", async () => {
    const t = await target("card", "manual");
    await refused(t, "management.request_invalid", request(t.tenderId, { override: override() }));
  });
  it.each(["wrong", "suspended", "no-permission"] as const)(
    "a standalone-terminal confirmer with %s credentials cannot approve",
    async (kind) => {
      const t = await target("card", "manual");
      if (kind !== "wrong")
        await store.db
          .update(persons)
          .set(kind === "suspended" ? { status: "suspended" } : { role: "staff" })
          .where(eq(persons.id, managerId));
      await refused(
        t,
        kind === "no-permission" ? "authorization.not_permitted" : "pin.invalid",
        request(t.tenderId, {
          manualConfirmed: true,
          override: { personId: managerId, pin: kind === "wrong" ? "wrong" : PIN },
        }),
      );
    },
  );
  it("one standalone-terminal approving PIN is checked once outside the write lock", async () => {
    const t = await target("card", "manual");
    watchDerivationsAndLock(store.db, PIN, () =>
      withTransaction(store.db, async (tx) => {
        await tx.update(persons).set({ locale: "es" }).where(eq(persons.id, managerId));
      }),
    );
    expect(
      await reserve(t, request(t.tenderId, { manualConfirmed: true, override: override() })),
    ).toMatchObject({
      refund: { authorizedBy: managerId, manual: true },
      authorization: { viaOverride: true },
    });
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });
  it("a fallback standalone-terminal PIN is not checked a second time", async () => {
    const t = await target("card", "manual");
    await role("staff");
    watchDerivationsAndLock(store.db, PIN, () =>
      withTransaction(store.db, async (tx) => {
        await tx.update(persons).set({ locale: "es" }).where(eq(persons.id, managerId));
      }),
    );
    expect(
      (await reserve(t, request(t.tenderId, { manualConfirmed: true, override: override() })))
        .refund.authorizedBy,
    ).toBe(managerId);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });
  it("a connected refund does not require a PIN for an authorized operator", async () => {
    const t = await target("card");
    expect((await reserve(t)).refund).toMatchObject({
      authorizedBy: personId,
      manual: false,
      provider: "fake",
    });
  });
  it("rejects a disallowed original sale zone", async () => {
    const t = await target("cash", "fake", zones[1]!);
    await scope([zones[0]!]);
    await refused(t, "service_zone.not_allowed");
  });
  it("allows a permitted zone and a genuinely zone-less source", async () => {
    await scope([zones[0]!]);
    expect((await reserve(await target())).refund.state).toBe("pending");
    expect((await reserve(await target("cash", "fake", null))).refund.state).toBe("pending");
  });
  it("checks every source zone of a substituted invoice", async () => {
    const first = await target();
    const second = await target("cash", "fake", zones[1]!);
    const combined = await target();
    await store.db.insert(saleSubstitutions).values([
      { substitutionSaleId: combined.saleId, substitutedSaleId: first.saleId },
      { substitutionSaleId: combined.saleId, substitutedSaleId: second.saleId },
    ]);
    await scope([zones[0]!]);
    await refused(combined, "service_zone.not_allowed");
  });
  it("rechecks the device binding when waiting for the transaction", async () => {
    const t = await target();
    await expect(
      whileChangingOnLockRequest(
        store.db,
        async (tx) => {
          await tx
            .update(devices)
            .set({ active: false })
            .where(eq(devices.id, cfg.origin.deviceId));
        },
        () => reserve(t),
      ),
    ).rejects.toMatchObject({ code: "device.unauthorized" });
    expect(await rows()).toEqual([]);
  });
  it("rechecks the zone scope while the PIN is derived", async () => {
    const t = await target("cash", "fake", zones[1]!);
    await role("staff");
    watchDerivationsAndLock(store.db, PIN, () => scope([zones[0]!]));
    await refused(t, "service_zone.not_allowed", request(t.tenderId, { override: override() }));
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });
  it("rolls authorization and reservation back when the remaining command fails", async () => {
    const t = await target();
    await expect(
      withTenderRefundAuthorization(
        store.db,
        cfg,
        t.saleId,
        request(t.tenderId),
        operator(),
        async (tx, authorization) => {
          await reserveTenderRefund(
            tx,
            cfg,
            t.saleId,
            request(t.tenderId),
            { requestedBy: personId, authorizedBy: authorization.authorizedBy },
            AT,
          );
          throw new AppError("payment.provider_unknown", { providerId: "unavailable" });
        },
      ),
    ).rejects.toMatchObject({ code: "payment.provider_unknown" });
    expect(await rows()).toEqual([]);
  });
  it("does not require an approver to sign in on the requesting profile", async () => {
    const t = await target();
    await role("staff");
    await store.db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profileId, personId: managerId, admitted: false });
    expect(
      (await reserve(t, request(t.tenderId, { override: override() }))).refund.authorizedBy,
    ).toBe(managerId);
  });
  it("shares the PIN attempt turn across simultaneous refund requests", async () => {
    const t = await target();
    await role("staff");
    for (let n = 0; n < 3; n++) attempts.throttle.recordFailure(attempts.slot, managerId);
    watchDerivationsAndLock(store.db, "wrong");
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        reserve(t, request(t.tenderId, { override: { personId: managerId, pin: "wrong" } })),
      ),
    );
    expect(results).toEqual([
      { status: "rejected", reason: expect.objectContaining({ code: "pin.invalid" }) },
      { status: "rejected", reason: expect.objectContaining({ code: "pin.throttled" }) },
    ]);
    expect(watchedDerivationCount()).toBe(1);
    expect(await watchedOrder()).toEqual([]);
    expect(await rows()).toEqual([]);
  });
  it.each(["session", "operator", "approver", "permission", "profile"] as const)(
    "rechecks %s authority after the PIN check",
    async (change) => {
      const t = await target();
      await role("staff");
      watchDerivationsAndLock(store.db, PIN, () =>
        withTransaction(store.db, async (tx) => {
          if (change === "session")
            await tx.update(sessions).set({ endedAt: AT }).where(eq(sessions.id, sessionId));
          if (change === "operator")
            await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, personId));
          if (change === "approver")
            await tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, managerId));
          if (change === "permission")
            await tx.update(persons).set({ role: "staff" }).where(eq(persons.id, managerId));
          if (change === "profile") {
            const [replacement] = await tx
              .insert(deviceProfiles)
              .values({ name: "Cash refused", formFactor: "till", capabilities: [] })
              .returning();
            await tx
              .update(devices)
              .set({ deviceProfileId: replacement!.id })
              .where(eq(devices.id, cfg.origin.deviceId));
          }
        }),
      );
      const codes = {
        session: "session.required",
        operator: "device_profile.not_admitted",
        approver: "pin.invalid",
        permission: "authorization.not_permitted",
        profile: "device.cash_not_allowed",
      };
      await refused(t, codes[change], request(t.tenderId, { override: override() }));
      const order = await watchedOrder();
      expect(order.slice(0, 2)).toEqual(["writer", "derived"]);
    },
  );
  it("reads the current source zone after a PIN check", async () => {
    const t = await target();
    await role("staff");
    await scope([zones[0]!]);
    watchDerivationsAndLock(store.db, PIN, () =>
      withTransaction(store.db, async (tx) => {
        await tx
          .update(orderServiceContexts)
          .set({ zoneId: zones[1]! })
          .where(eq(orderServiceContexts.workingOrderId, t.orderId));
      }),
    );
    await refused(t, "service_zone.not_allowed", request(t.tenderId, { override: override() }));
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
  });
  it("allows every permitted source in a substituted invoice", async () => {
    const first = await target();
    const second = await target("cash", "fake", zones[1]!);
    const combined = await target();
    await store.db.insert(saleSubstitutions).values([
      { substitutionSaleId: combined.saleId, substitutedSaleId: first.saleId },
      { substitutionSaleId: combined.saleId, substitutedSaleId: second.saleId },
    ]);
    await scope(zones);
    expect((await reserve(combined)).refund.state).toBe("pending");
  });
  it("rechecks authority on a fully refunded cash replay", async () => {
    const t = await target();
    const req = request(t.tenderId, { appliedAmount: "10.00" });
    const original = await reserve(t, req);
    await store.db
      .update(tenderRefunds)
      .set({ state: "completed", completedAt: AT })
      .where(eq(tenderRefunds.id, original.refund.id));
    expect(await reserve(t, req)).toMatchObject({
      replayed: true,
      refund: { id: original.refund.id, state: "completed" },
    });
    await role("staff");
    await expect(reserve(t, req)).rejects.toMatchObject({ code: "authorization.not_permitted" });
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({
      id: original.refund.id,
      state: "completed",
      appliedAmount: 1000,
    });
  });
});
