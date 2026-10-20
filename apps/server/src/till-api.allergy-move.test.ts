import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import {
  devices,
  deviceProfiles,
  lineServiceCancellations,
  locations,
  products,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import {
  deviceProfileAdmissionPersons,
  hashSessionToken,
  persons,
  sessions,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { AllergyMoveRead } from "@waitron/module";
import {
  listDepartments,
  readPartyAllergy,
  setProfileServiceAccess,
  writePartyAllergy,
} from "@waitron/venue-service";
import { readBillEditState, readPartyBillIds } from "./bill-editing.js";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import {
  OPERATOR,
  counterOrder,
  inTx,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
    await db.insert(persons).values({ id: OPERATOR, displayName: "Test operator", role: "staff" });
  },
});
afterEach(() => vi.restoreAllMocks());

async function fixture(existing = false) {
  const tableId = await v.table(`Allergy move ${randomUUID().slice(0, 8)}`);
  const destination = existing ? await seat(v, tableId) : null;
  if (destination !== null)
    await inTx(v, (tx) =>
      writePartyAllergy(
        tx,
        destination.partyId,
        {
          answer: "allergies",
          guests: [{ who: "Seated guest", allergens: { eggs: {} }, note: "Separate utensils" }],
        },
        OPERATOR,
      ),
    );
  await v.db
    .update(products)
    .set({ allergens: {} })
    .where(eq(products.id, v.productId("Burger")));
  const billId = await counterOrder(v, "Burger");
  const [line] = await v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, billId));
  const { deviceId, profileId } = await seedDevice(v.db, {
    locationId: v.cfg.locationId,
    capabilities: ["take-orders"],
  });
  await v.db
    .update(devices)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(devices.id, deviceId));
  const token = randomUUID();
  const [session] = await v.db
    .insert(sessions)
    .values({ deviceId, personId: OPERATOR, tokenHash: hashSessionToken(token) })
    .returning();
  const expectedEdits = await inTx(v, async (tx) => {
    const ids = [
      billId,
      ...(destination === null ? [] : await readPartyBillIds(tx, [destination.partyId])),
    ].sort();
    const result = [];
    for (const id of ids) result.push(await readBillEditState(tx, id));
    return result;
  });
  const body: Record<string, unknown> = {
    to: { tableId },
    bills: "separate",
    partyId: null,
    otherPartyId: destination?.partyId ?? null,
    ...(destination === null ? {} : { expectedOtherPartyRevision: destination.revision }),
    expectedEdits,
  };
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      secureCookies: false,
      venueLocale: "en-GB",
    } as TillApiDeps,
    () => {},
  );
  const url = `/api/bills/${billId}/move`;
  const headers = { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` };
  const request = (suffix = "/allergy-preview", packet: unknown = body, authenticated = true) =>
    app.request(url + suffix, {
      method: "POST",
      headers: authenticated ? headers : { "content-type": "application/json" },
      body: JSON.stringify(packet),
    });
  return {
    tableId,
    destination,
    billId,
    line: line!,
    deviceId,
    profileId,
    sessionId: session!.id,
    body,
    app,
    url,
    headers,
    request,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function frozen() {
  return Object.fromEntries(
    v.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        v.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
      ]),
  );
}
async function refused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
function adoption(f: Fixture) {
  return {
    ...f.body,
    submissionId: randomUUID(),
    allergy: {
      party: {
        answer: "allergies",
        guests: [{ who: "Arriving guest", allergens: { milk: {} }, note: "Keep separate" }],
      },
      ticks: [{ line: { kind: "working", id: f.line.id }, guestIndex: 0 }],
    },
  };
}

it.each([false, true])(
  "previews counter adoption into an existing party %s without changing any row",
  async (existing) => {
    const f = await fixture(existing);
    const before = frozen();
    const response = await f.request();
    expect(response.status).toBe(200);
    const view = (await response.json()) as AllergyMoveRead;
    expect(view).toEqual({
      billId: f.billId,
      tableId: f.tableId,
      partyId: f.destination?.partyId ?? null,
      snapshot:
        f.destination === null
          ? null
          : expect.objectContaining({
              answer: "allergies",
              revision: f.destination.revision,
              guests: [expect.objectContaining({ who: "Seated guest", allergens: { eggs: {} } })],
            }),
      dishes: [
        {
          line: { kind: "working", id: f.line.id },
          billId: f.billId,
          name: "Burger",
          quantity: "1.000",
          allergens: {},
          extras: [],
          sentAt: null,
          offeredBefore: false,
        },
      ],
    });
    expect(frozen()).toEqual(before);
  },
);

it("transports answer and ticks through the move route and replays the original result", async () => {
  const f = await fixture();
  const packet = adoption(f);
  const response = await f.request("", packet);
  expect(response.status).toBe(200);
  const result = (await response.json()) as { partyId: string; billId: string; merged: boolean };
  expect(result).toEqual({ partyId: expect.any(String), billId: f.billId, merged: false });
  const state = await inTx(v, (tx) => readPartyAllergy(tx, result.partyId));
  expect(state).toMatchObject({
    answer: "allergies",
    guests: [{ who: "Arriving guest", allergens: { milk: {} }, note: "Keep separate" }],
    ticks: [{ guestId: state.guests[0]!.id, workingLineId: f.line.id, draftLineId: null }],
  });
  const after = frozen();
  const replay = await f.request("", packet);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(result);
  expect(frozen()).toEqual(after);
  await refused(
    await f.request("", {
      ...packet,
      allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    }),
    409,
    "submission.id_reused",
  );
  const [other] = await v.db
    .insert(persons)
    .values({ displayName: "Other operator", role: "staff" })
    .returning();
  await v.db.update(sessions).set({ personId: other!.id }).where(eq(sessions.id, f.sessionId));
  const changedActor = frozen();
  await refused(await f.request("", packet), 409, "submission.id_reused");
  expect(frozen()).toEqual(changedActor);
});

it.each(["submissionId", "allergy"] as const)(
  "rejects a move with unpaired %s without writes",
  async (missing) => {
    const f = await fixture();
    const packet: Record<string, unknown> = adoption(f);
    delete packet[missing];
    const before = frozen();
    await refused(await f.request("", packet), 400, "management.request_invalid");
    expect(frozen()).toEqual(before);
  },
);

it.each([false, true])(
  "rejects a changed destination after preview (originally occupied %s)",
  async (existing) => {
    const f = await fixture(existing);
    expect((await f.request()).status).toBe(200);
    if (f.destination === null) await seat(v, f.tableId);
    else
      await inTx(v, async (tx) => {
        await tx.run(
          sql`update parties set revision = revision + 1 where id = ${f.destination!.partyId}`,
        );
      });
    const before = frozen();
    await refused(await f.request(), 409, "party.out_of_date");
    await refused(await f.request("", adoption(f)), 409, "party.out_of_date");
    expect(frozen()).toEqual(before);
  },
);

it.each(["preview", "move"])("requires an open session for %s", async (action) => {
  const f = await fixture();
  const suffix = action === "preview" ? "/allergy-preview" : "";
  const body = action === "preview" ? f.body : adoption(f);
  await refused(await f.request(suffix, body, false), 401, "session.required");
  await v.db
    .update(sessions)
    .set({ endedAt: new Date().toISOString() })
    .where(eq(sessions.id, f.sessionId));
  const before = frozen();
  await refused(await f.request(suffix, body), 401, "session.required");
  expect(frozen()).toEqual(before);
});

const authority = {
  device: [401, "device.unauthorized"],
  action: [403, "device.forbidden_action"],
  admission: [403, "device_profile.not_admitted"],
  session: [401, "session.required"],
} as const;
async function revoke(f: Fixture, what: keyof typeof authority) {
  if (what === "device")
    await v.db.update(devices).set({ active: false }).where(eq(devices.id, f.deviceId));
  if (what === "action")
    await v.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, f.profileId));
  if (what === "admission")
    await v.db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: f.profileId, personId: OPERATOR, admitted: false });
  if (what === "session")
    await v.db
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, f.sessionId));
}
for (const action of ["preview", "move"] as const) {
  it.each(["device", "action", "admission"] as const)(
    `${action} checks current %s authority`,
    async (what) => {
      const f = await fixture();
      await revoke(f, what);
      const before = frozen();
      const [status, code] = authority[what];
      await refused(
        await f.request(
          action === "preview" ? "/allergy-preview" : "",
          action === "preview" ? f.body : adoption(f),
        ),
        status,
        code,
      );
      expect(frozen()).toEqual(before);
    },
  );
  it.each(["device", "action", "admission", "session"] as const)(
    `${action} rechecks %s after reading the body`,
    async (what) => {
      const f = await fixture();
      const raw = new Request(
        `http://localhost${f.url}${action === "preview" ? "/allergy-preview" : ""}`,
        {
          method: "POST",
          headers: f.headers,
          body: JSON.stringify(action === "preview" ? f.body : adoption(f)),
        },
      );
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const text = raw.text.bind(raw);
      vi.spyOn(raw, "text").mockImplementation(async () => {
        await gate;
        return text();
      });
      const pending = f.app.request(raw);
      let before;
      try {
        await vi.waitFor(() => expect(raw.text).toHaveBeenCalled());
        await revoke(f, what);
        before = frozen();
      } finally {
        release();
      }
      const [status, code] = authority[what];
      await refused(await pending, status, code);
      expect(frozen()).toEqual(before);
    },
  );
}

it("treats an explicit move preview as active session activity", async () => {
  const f = await fixture();
  const before = "2020-01-01T00:00:00.000Z";
  await v.db.update(devices).set({ lastSeenAt: before }).where(eq(devices.id, f.deviceId));
  expect((await f.request()).status).toBe(200);
  expect(
    (await v.db.select().from(devices).where(eq(devices.id, f.deviceId)))[0]!.lastSeenAt,
  ).not.toBe(before);
});

for (const action of ["preview", "move"] as const) {
  it.each(["source", "destination"] as const)(
    `${action} checks the %s zone and admits an allowed control`,
    async (which) => {
      const f = await fixture();
      const [department] = await listDepartments(v.db, v.cfg);
      const restrict = (allowedZoneIds: string[]) =>
        setProfileServiceAccess(v.db, v.cfg, f.profileId, {
          departmentId: department!.id,
          allowedZoneIds,
          startingZoneId: allowedZoneIds[0]!,
        });
      await restrict([which === "source" ? v.tables.zoneId : v.counter.zoneId]);
      const before = frozen();
      const suffix = action === "preview" ? "/allergy-preview" : "";
      const body = action === "preview" ? f.body : adoption(f);
      await refused(await f.request(suffix, body), 403, "service_zone.not_allowed");
      expect(frozen()).toEqual(before);
      await restrict([v.tables.zoneId, v.counter.zoneId]);
      expect((await f.request(suffix, body)).status).toBe(200);
    },
  );
  it(`${action} refuses a source bill from another location`, async () => {
    const f = await fixture();
    const [other] = await v.db
      .insert(locations)
      .values({
        name: "Other location",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    await v.db
      .update(workingOrders)
      .set({ locationId: other!.id })
      .where(eq(workingOrders.id, f.billId));
    const before = frozen();
    await refused(
      await f.request(
        action === "preview" ? "/allergy-preview" : "",
        action === "preview" ? f.body : adoption(f),
      ),
      409,
      "tab.not_open",
    );
    expect(frozen()).toEqual(before);
  });
}

it("previews parent nutrition and distinct extras, retaining unknown versus reviewed empty", async () => {
  const f = await fixture();
  await v.db
    .update(products)
    .set({ allergens: { milk: {} } })
    .where(eq(products.id, v.productId("Burger")));
  await v.db
    .update(products)
    .set({ allergens: {} })
    .where(eq(products.id, v.productId("Flan")));
  for (const [name, productId, lineNo, quantity] of [
    ["Reviewed extra", v.productId("Flan"), 2, 1500],
    ["Unknown extra", null, 3, 500],
  ] as const)
    await v.db.insert(workingOrderLines).values({
      workingOrderId: f.billId,
      parentLineId: f.line.id,
      productId,
      lineNo,
      name,
      descriptions: { [v.cfg.locale]: name },
      quantity,
      unitPriceGross: 0,
      lineTotal: 0,
      vatClass: "general",
    });
  const before = frozen();
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(((await response.json()) as AllergyMoveRead).dishes).toEqual([
    {
      line: { kind: "working", id: f.line.id },
      billId: f.billId,
      name: "Burger",
      quantity: "1.000",
      allergens: { milk: {} },
      extras: [
        { name: "Reviewed extra", quantity: "1.500", allergens: {} },
        { name: "Unknown extra", quantity: "0.500", allergens: null },
      ],
      sentAt: null,
      offeredBefore: false,
    },
  ]);
  expect(frozen()).toEqual(before);
});

it("offers a previously sent counter dish and excludes completely cancelled parents", async () => {
  const f = await fixture();
  await v.db
    .update(workingOrderLines)
    .set({ sentAt: "2026-10-20T01:00:00.000Z" })
    .where(eq(workingOrderLines.id, f.line.id));
  const response = await f.request();
  expect(response.status).toBe(200);
  expect(((await response.json()) as AllergyMoveRead).dishes).toEqual([
    expect.objectContaining({ offeredBefore: false, sentAt: "2026-10-20T01:00:00.000Z" }),
  ]);
  await v.db.insert(lineServiceCancellations).values({
    lineId: f.line.id,
    quantity: 1000,
    cancelledAt: new Date().toISOString(),
    actorId: OPERATOR,
    wasStarted: false,
  });
  const before = frozen();
  const cancelled = await f.request();
  expect(cancelled.status).toBe(200);
  expect(((await cancelled.json()) as AllergyMoveRead).dishes).toEqual([]);
  expect(frozen()).toEqual(before);
});

it.each(["partyId", "otherPartyId", "expectedOtherPartyRevision", "expectedEdits"] as const)(
  "requires the preview's observed %s",
  async (missing) => {
    const f = await fixture(true);
    const packet = { ...f.body };
    delete packet[missing];
    const before = frozen();
    await refused(await f.request("/allergy-preview", packet), 400, "management.request_invalid");
    expect(frozen()).toEqual(before);
  },
);

it("rejects a stale bill editor without changing either party or bill", async () => {
  const f = await fixture(true);
  const packet = {
    ...f.body,
    expectedEdits: (f.body.expectedEdits as { billId: string; editorVersion: number }[]).map(
      (edit) => ({ ...edit, editorVersion: edit.editorVersion + 1 }),
    ),
  };
  const before = frozen();
  await refused(await f.request("/allergy-preview", packet), 409, "draft.out_of_date");
  expect(frozen()).toEqual(before);
});

it.each([null, [], {}, { counter: { zoneId: null } }])(
  "rejects a preview target %j without writes",
  async (to) => {
    const f = await fixture();
    const before = frozen();
    await refused(
      await f.request("/allergy-preview", { ...f.body, to }),
      400,
      "management.request_invalid",
    );
    expect(frozen()).toEqual(before);
  },
);

it.each(["partyId", "otherPartyId"] as const)(
  "requires the adoption command's explicit %s",
  async (missing) => {
    const f = await fixture();
    const packet: Record<string, unknown> = adoption(f);
    delete packet[missing];
    const before = frozen();
    await refused(await f.request("", packet), 400, "management.request_invalid");
    expect(frozen()).toEqual(before);
  },
);

it.each(["merge", "separate"] as const)(
  "keeps the destination's guests and arriving line ids when bills stay %s",
  async (bills) => {
    const f = await fixture(true);
    const before = await inTx(v, (tx) => readPartyAllergy(tx, f.destination!.partyId));
    const packet = {
      ...f.body,
      bills,
      submissionId: randomUUID(),
      allergy: { ticks: [{ line: { kind: "working", id: f.line.id }, guestIndex: 0 }] },
    };
    const response = await f.request("", packet);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      partyId: f.destination!.partyId,
      billId: bills === "merge" ? f.destination!.tabId : f.billId,
      merged: bills === "merge",
    });
    const after = await inTx(v, (tx) => readPartyAllergy(tx, f.destination!.partyId));
    expect(after.guests).toEqual(before.guests);
    expect(after.ticks).toEqual([
      { guestId: before.guests[0]!.id, draftLineId: null, workingLineId: f.line.id },
    ]);
    expect(after.revision).toBe(before.revision + 1);
  },
);
