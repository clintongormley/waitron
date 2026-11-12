import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  deviceProfiles,
  devices,
  floorZones,
  persons,
  withTransaction,
  type Transaction,
} from "@waitron/db";
import { hashPin, hashSessionToken, sessions } from "@waitron/identity";
import type { ProfileAction } from "@waitron/layouts";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { markServed } from "./working-order.js";
import { inTx, placedCounterBillMovedTo, seatedWith, send } from "./testing/bill-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createTable } from "./testing/live-table.js";
import { moveGuests } from "./testing/table-action-fixture.js";
import { offerProducts } from "./testing/zone-offers.js";
import { BASIC_ACTIONS } from "./testing/session-device.js";
import { noteSessionPerson } from "./testing/tab-person.js";
import {
  fiscalWrites,
  transferCloseVenue,
  type TransferCloseKit,
} from "./testing/transfer-close-fixture.js";
import type { CloseByTransferRequest } from "./transfer-close-types.js";
import "./errors.js";

// The till's route to close a bill by transfer: who may call it, checked before the write queue
// and again inside the write, and what it answers. What the close itself does is Task 2's suites'.
let t: TransferCloseKit;

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    t = await transferCloseVenue(db);
  },
});

const ALLOWED: ProfileAction[] = [...BASIC_ACTIONS, "close-by-transfer"];

interface Till {
  profileId: string;
  deviceId: string;
  sessionId: string;
  personId: string;
  cookie: string;
}

/** A till of its own: a stored profile with `capabilities`, a device on it and a shift session. */
async function till(
  capabilities: readonly string[] = ALLOWED,
  personId = t.venue.operatorId,
): Promise<Till> {
  const db = suite.db;
  const [profile] = await seedDeviceProfiles(db, {
    name: `Till ${randomUUID().slice(0, 8)}`,
    formFactor: "till",
    capabilities,
  });
  const device = await enrolDeviceForTest(db, t.venue.cfg, {
    name: `Till ${randomUUID().slice(0, 8)}`,
    profileId: profile!.id,
  });
  const token = randomUUID();
  const [session] = await db
    .insert(sessions)
    .values({ deviceId: device.deviceId, personId, tokenHash: hashSessionToken(token) })
    .returning({ id: sessions.id });
  noteSessionPerson(token, personId);
  return {
    profileId: profile!.id,
    deviceId: device.deviceId,
    sessionId: session!.id,
    personId,
    cookie: `${SESSION_COOKIE}=${token}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
  };
}

function bodyOf(request: CloseByTransferRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { ...request };
  delete body.id;
  return body;
}

function close(cookie: string, billId: string, body: unknown) {
  return send(t.venue.app, cookie, "POST", `/api/working-orders/${billId}/close-by-transfer`, body);
}

/** What a close writes: the sale and its record, the series' next number, the closure, the outbox. */
function written(billId: string) {
  const db = t.venue.db;
  return {
    sales: db.all(sql`select id from sales where working_order_id = ${billId}`),
    series: db.all(sql`select id, next_number from invoice_series order by id`),
    ...fiscalWrites(db),
    closures: db.all(sql`select id from transfer_closures where working_order_id = ${billId}`),
    tenders: db.all(
      sql`select t.id from tenders t join sales s on s.id = t.sale_id where s.working_order_id = ${billId}`,
    ),
    order: db.all(sql`select status from working_orders where id = ${billId}`),
  };
}

async function counterBill(): Promise<{ billId: string; body: Record<string, unknown> }> {
  const billId = await t.counterOrder("open");
  return { billId, body: bodyOf(await t.requestFor(billId, "18.00", null)) };
}

/** Refused with `code`, writing nothing a close writes. */
async function expectRefused(
  answer: Promise<Awaited<ReturnType<typeof close>>>,
  billId: string,
  code: string,
  params?: Record<string, unknown>,
) {
  const before = written(billId);
  const refused = await answer;
  expect(refused.json.code).toBe(code);
  if (params !== undefined) expect(refused.json.params).toEqual(params);
  expect(written(billId)).toEqual(before);
  expect(before.sales).toEqual([]);
  expect(before.closures).toEqual([]);
}

async function expectClosed(cookie: string, billId: string, body: unknown) {
  const answer = await close(cookie, billId, body);
  expect(answer.status).toBe(200);
  expect(written(billId).closures).toHaveLength(1);
  return answer;
}

async function serveParty(partyId: string): Promise<void> {
  const lines = t.venue.db.all<{ id: string }>(
    sql`select l.id from working_order_lines l join working_orders o on o.id = l.working_order_id
        where o.party_id = ${partyId} and l.parent_line_id is null and o.status != 'abandoned'`,
  );
  const [row] = t.venue.db.all<{ revision: number }>(
    sql`select revision from parties where id = ${partyId}`,
  );
  await inTx(t.venue, (tx) =>
    markServed(
      tx,
      t.venue.cfg,
      partyId,
      lines.map((line) => ({ lineId: line.id, quantity: "1" })),
      {
        expectedPartyRevision: row!.revision,
        operatorId: t.venue.operatorId,
        submissionId: randomUUID(),
      },
    ),
  );
}

describe("POST /api/working-orders/:id/close-by-transfer, allowed", () => {
  it("closes a seated bill and a Counter bill, answering the closure", async () => {
    const allowed = await till();
    const party = await seatedWith(t.venue, "House salad");
    const seated = await t.requestFor(party.tabId, "12.00", party.partyId);
    const counter = await counterBill();

    const table = await expectClosed(allowed.cookie, party.tabId, bodyOf(seated));
    const atCounter = await expectClosed(allowed.cookie, counter.billId, counter.body);

    const shape = {
      saleId: expect.any(String),
      invoiceNumber: expect.any(String),
      classification: "to_be_paid_by_transfer",
      closedAt: expect.any(String),
      businessDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      currency: "EUR",
    };
    expect(table.json).toEqual({
      ...shape,
      submissionId: seated.submissionId,
      workingOrderId: party.tabId,
      total: "12.00",
      party: { state: "open", blockers: ["service"] },
    });
    expect(atCounter.json).toEqual({
      ...shape,
      submissionId: counter.body.submissionId,
      workingOrderId: counter.billId,
      total: "18.00",
      party: { state: "not_applicable", blockers: [] },
    });
    expect(
      t.venue.db.all(
        sql`select actor_id, device_id from transfer_closures where working_order_id in (${party.tabId}, ${counter.billId})`,
      ),
    ).toEqual([
      { actor_id: allowed.personId, device_id: allowed.deviceId },
      { actor_id: allowed.personId, device_id: allowed.deviceId },
    ]);
  });

  it("refuses another person sending the same submission id, and replays it to its sender", async () => {
    const first = await till();
    const other = await till(ALLOWED, t.venue.adminId);
    const { billId, body } = await counterBill();
    const closed = await expectClosed(first.cookie, billId, body);
    const after = written(billId);

    const reused = await close(other.cookie, billId, body);
    const replayed = await close(first.cookie, billId, body);

    expect(reused.status).toBe(409);
    expect(reused.json).toMatchObject({
      code: "submission.id_reused",
      params: { submissionId: body.submissionId },
    });
    expect(replayed).toEqual(closed);
    expect(written(billId)).toEqual(after);
  });
});

describe("POST /api/working-orders/:id/close-by-transfer, refusals", () => {
  it("refuses a suspended person whose session is still open, then closes for an active one", async () => {
    const [person] = await seedPersons(suite.db, {
      displayName: "Lewis",
      pinHash: hashPin("4444"),
      role: "staff",
    });
    const allowed = await till(ALLOWED, person!.id);
    const { billId, body } = await counterBill();
    await suite.db.update(persons).set({ status: "suspended" }).where(eq(persons.id, person!.id));

    await expectRefused(close(allowed.cookie, billId, body), billId, "device_profile.not_admitted");
    await suite.db.update(persons).set({ status: "active" }).where(eq(persons.id, person!.id));
    await expectClosed(allowed.cookie, billId, body);
  });

  it("refuses a device on a retired profile, then closes once the profile is back", async () => {
    const allowed = await till();
    const { billId, body } = await counterBill();
    await suite.db
      .update(deviceProfiles)
      .set({ retiredAt: new Date().toISOString() })
      .where(eq(deviceProfiles.id, allowed.profileId));

    await expectRefused(close(allowed.cookie, billId, body), billId, "device.unauthorized");
    await suite.db
      .update(deviceProfiles)
      .set({ retiredAt: null })
      .where(eq(deviceProfiles.id, allowed.profileId));
    await expectClosed(allowed.cookie, billId, body);
  });

  it("refuses a bill in a zone the profile does not cover, then closes once it does", async () => {
    const zoned = await till();
    const { billId, body } = await counterBill();
    const [policy] = await suite.db
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, t.counterZone));
    const coverOnly = (zones: string[]) =>
      inTx(t.venue, (tx) =>
        setProfileServiceAccess(tx, zoned.profileId, {
          departmentId: policy!.departmentId,
          allowedZoneIds: zones,
          startingZoneId: t.venue.zoneId,
        }),
      );
    await coverOnly([t.venue.zoneId]);

    await expectRefused(close(zoned.cookie, billId, body), billId, "service_zone.not_allowed");
    await coverOnly([t.venue.zoneId, t.counterZone]);
    await expectClosed(zoned.cookie, billId, body);
  });

  it("refuses a malformed body, an unknown field and null where a value is required, then closes the sound one", async () => {
    const allowed = await till();
    const { billId, body } = await counterBill();

    for (const [sent, field] of [
      [{ ...body, expectedRevision: "1" }, "expectedRevision"],
      [{ ...body, expectedTotal: "18.001" }, "expectedTotal"],
      [{ ...body, delivery: { medium: "pigeon" } }, "delivery.medium"],
      [{ ...body, operationId: body.submissionId }, "operationId"],
      [{ ...body, delivery: { medium: "receipt", extra: true } }, "delivery.extra"],
      [{ ...body, submissionId: null }, "submissionId"],
      [{ ...body, expectedTotal: null }, "expectedTotal"],
      [{ ...body, invoiceType: null }, "invoiceType"],
      [{ ...body, receiptLanguage: null }, "receiptLanguage"],
      [{ ...body, partyFinish: undefined }, "partyFinish"],
    ] as const) {
      await expectRefused(
        close(allowed.cookie, billId, sent),
        billId,
        "management.request_invalid",
        {
          field,
        },
      );
    }
    await expectClosed(allowed.cookie, billId, body);
  });
});

/** A request held after `requireSession` passed, while it reads its body. */
async function pausedClose(cookie: string, billId: string, body: unknown) {
  let reached!: () => void;
  let release!: () => void;
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reached();
        await hold;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const response = t.venue.app.request(
    new Request(`http://localhost/api/working-orders/${billId}/close-by-transfer`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: string }),
  );
  await reading;
  return { response, release };
}

const revocations = {
  "the person signs out": (tx: Transaction, till: Till) =>
    tx
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, till.sessionId)),
  "the device is switched off": (tx: Transaction, till: Till) =>
    tx.update(devices).set({ active: false }).where(eq(devices.id, till.deviceId)),
  "Close by transfer is taken off the profile": (tx: Transaction, till: Till) =>
    tx
      .update(deviceProfiles)
      .set({ capabilities: BASIC_ACTIONS })
      .where(eq(deviceProfiles.id, till.profileId)),
} as const;
const refusalOf = {
  "the person signs out": "session.required",
  "the device is switched off": "device.unauthorized",
  "Close by transfer is taken off the profile": "device.forbidden_action",
} as const;

describe("POST /api/working-orders/:id/close-by-transfer, revoked while queued", () => {
  it.each(Object.keys(revocations) as (keyof typeof revocations)[])(
    "refuses a close waiting behind the write in which %s, writing nothing",
    async (change) => {
      const queued = await till();
      const { billId, body } = await counterBill();
      const before = written(billId);
      const pending = await pausedClose(queued.cookie, billId, body);
      let entered!: () => void;
      let releaseWrite!: () => void;
      const inside = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const holdWrite = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });
      const revocation = withTransaction(suite.db, async (tx) => {
        await revocations[change](tx, queued);
        entered();
        await holdWrite;
      });
      await inside;
      const waits = vi.spyOn(suite.db, "withWriteLock");
      try {
        pending.release();
        await vi.waitFor(() => expect(waits).toHaveBeenCalled());
      } finally {
        waits.mockRestore();
        releaseWrite();
        pending.release();
      }
      await revocation;

      const answer = await (await pending.response).json();
      expect(answer).toMatchObject({ error: { code: refusalOf[change] } });
      expect(written(billId)).toEqual(before);
      expect(before.sales).toEqual([]);
      expect(before.closures).toEqual([]);
    },
  );
});

describe("POST /api/working-orders/:id/close-by-transfer, the party", () => {
  it("leaves the party open after its first bill and releases it with the second", async () => {
    const allowed = await till();
    const party = await seatedWith(t.venue, "House salad");
    const second = await placedCounterBillMovedTo(t.venue, t.counterZone, party);
    await serveParty(party.partyId);

    const first = await expectClosed(
      allowed.cookie,
      party.tabId,
      bodyOf(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );
    const last = await expectClosed(
      allowed.cookie,
      second,
      bodyOf(await t.requestFor(second, "18.00", party.partyId)),
    );

    expect(first.json.party).toEqual({ state: "open", blockers: ["other_bills"] });
    expect(last.json.party).toEqual({ state: "closed", blockers: [] });
    expect(t.venue.db.all(sql`select state from parties where id = ${party.partyId}`)).toEqual([
      { state: "closed" },
    ]);
  });

  it("closes the bill but keeps the party open for a device that does not take orders", async () => {
    const closesOnly = await till(["close-by-transfer"]);
    const party = await seatedWith(t.venue, "House salad");
    await serveParty(party.partyId);

    const closed = await expectClosed(
      closesOnly.cookie,
      party.tabId,
      bodyOf(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );

    expect(closed.json.party).toEqual({ state: "open", blockers: ["authority"] });
    expect(written(party.tabId).order).toEqual([{ status: "settled" }]);
    expect(t.venue.db.all(sql`select state from parties where id = ${party.partyId}`)).toEqual([
      { state: "open" },
    ]);
  });

  it("closes the bill but keeps the party open when a sibling bill is outside the profile's zones", async () => {
    const unscoped = await till();
    const zoned = await till();
    const party = await seatedWith(t.venue, "House salad");
    const moving = await placedCounterBillMovedTo(t.venue, t.counterZone, party);
    await serveParty(party.partyId);
    await expectClosed(
      unscoped.cookie,
      party.tabId,
      bodyOf(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );
    const terrace = await inTx(t.venue, async (tx) => {
      const [zone] = await tx
        .insert(floorZones)
        .values({ name: `Terrace ${randomUUID().slice(0, 8)}` })
        .returning({ id: floorZones.id });
      const zoneId = (
        await offerProducts(tx, t.venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "table" })
      ).zoneId;
      const table = await createTable(tx, t.venue.cfg, {
        label: `T ${randomUUID().slice(0, 8)}`,
        zoneId,
      });
      return { zoneId, tableId: table.id };
    });
    const [revision] = t.venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${party.partyId}`,
    );
    await inTx(t.venue, (tx) =>
      moveGuests(tx, t.venue.cfg, party.partyId, terrace.tableId, {
        expectedPartyRevision: revision!.revision,
        operatorId: t.venue.operatorId,
      }),
    );
    const [policy] = await suite.db
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, terrace.zoneId));
    await inTx(t.venue, (tx) =>
      setProfileServiceAccess(tx, zoned.profileId, {
        departmentId: policy!.departmentId,
        allowedZoneIds: [terrace.zoneId],
        startingZoneId: terrace.zoneId,
      }),
    );

    const closed = await expectClosed(
      zoned.cookie,
      moving,
      bodyOf(await t.requestFor(moving, "18.00", party.partyId)),
    );

    expect(closed.json.party).toEqual({ state: "open", blockers: ["scope"] });
    expect(written(moving).order).toEqual([{ status: "settled" }]);
    expect(t.venue.db.all(sql`select state from parties where id = ${party.partyId}`)).toEqual([
      { state: "open" },
    ]);
  });
});

function closure(cookie: string, billId: string) {
  return send(t.venue.app, cookie, "GET", `/api/working-orders/${billId}/transfer-closure`);
}

describe("GET /api/working-orders/:id/transfer-closure", () => {
  it("answers what the close answered, to another device without the action, null while open and not found for no bill", async () => {
    const closer = await till();
    const reader = await till(BASIC_ACTIONS, t.venue.adminId);
    const party = await seatedWith(t.venue, "House salad");
    const closed = await expectClosed(
      closer.cookie,
      party.tabId,
      bodyOf(await t.requestFor(party.tabId, "12.00", party.partyId)),
    );
    const open = await t.counterOrder("open");

    expect(await closure(closer.cookie, party.tabId)).toMatchObject({
      status: 200,
      json: { closure: closed.json },
    });
    expect(await closure(reader.cookie, party.tabId)).toMatchObject({
      status: 200,
      json: { closure: closed.json },
    });
    expect(await closure(reader.cookie, open)).toMatchObject({
      status: 200,
      json: { closure: null },
    });
    const none = randomUUID();
    expect(await closure(reader.cookie, none)).toMatchObject({
      status: 404,
      json: { code: "working_order.not_found", params: { workingOrderId: none } },
    });
  });

  it("adds no sale or closure and stamps no sighting of the device", async () => {
    const reader = await till(BASIC_ACTIONS);
    const { billId, body } = await counterBill();
    await expectClosed((await till()).cookie, billId, body);
    const seen = "2020-01-01T00:00:00.000Z";
    await suite.db.update(devices).set({ lastSeenAt: seen }).where(eq(devices.id, reader.deviceId));
    const before = written(billId);

    expect((await closure(reader.cookie, billId)).status).toBe(200);
    expect(written(billId)).toEqual(before);
    expect(
      t.venue.db.all(sql`select last_seen_at from devices where id = ${reader.deviceId}`),
    ).toEqual([{ last_seen_at: seen }]);
  });
});
