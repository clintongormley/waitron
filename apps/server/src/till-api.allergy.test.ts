import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  devices,
  deviceProfiles,
  locations,
  parties,
  partyTables,
  serviceCommands,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  hashSessionToken,
  persons,
  sessions,
  deviceProfileAdmissionPersons,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId, nodeId } from "@waitron/shared";
import { listDepartments, readPartyAllergy, setProfileServiceAccess } from "@waitron/venue-service";
import type { PartyAllergyRead } from "@waitron/module";
import { mountTillApi, type TillApiDeps } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { SESSION_COOKIE } from "./till-session.js";
import { createZone } from "./testing/service-zone.js";
import { createTable } from "./testing/live-table.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let cfg: TillConfig;
let deviceId: string;
let profileId: string;
let tableZoneId: string;
let personId: string;
let sessionId: string;
let token: string;
let orderId: string;
let partyId: string;
let billId: string;
let lineId: string;

beforeEach(async () => {
  await seedTenant(suite.db);
  const [location] = await suite.db
    .insert(locations)
    .values({
      name: "Dining room",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning();
  const locationKey = locationId(location!.id);
  cfg = {
    locationId: locationKey,
    nodeId: nodeId(await seedNode(suite.db, locationKey)),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Ana", role: "staff" })
    .returning();
  personId = person!.id;
  ({ deviceId, profileId } = await seedDevice(suite.db, {
    locationId: locationKey,
    capabilities: ["take-orders"],
  }));
  token = randomUUID();
  const [session] = await suite.db
    .insert(sessions)
    .values({ deviceId, personId, tokenHash: hashSessionToken(token) })
    .returning();
  sessionId = session!.id;
  const [party] = await suite.db.insert(parties).values({ openedBy: personId }).returning();
  partyId = party!.id;
  const zone = await createZone(suite.db, cfg, { name: "Tables" });
  tableZoneId = zone.id;
  const table = await createTable(suite.db, cfg, { label: "Table 1", zoneId: zone.id });
  await suite.db.insert(partyTables).values({ partyId, tableId: table.id });
  const orders = await suite.db
    .insert(workingOrders)
    .values([
      { source: "dashboard", deviceId: null, locationId: locationKey, orderNumber: 1 },
      { source: "dashboard", deviceId: null, locationId: locationKey, orderNumber: 2, partyId },
    ])
    .returning();
  orderId = orders[0]!.id;
  billId = orders[1]!.id;
  const [line] = await suite.db
    .insert(workingOrderLines)
    .values({
      workingOrderId: billId,
      lineNo: 1,
      name: "Soup",
      descriptions: { "en-GB": "Soup" },
      quantity: 2000,
      unitPriceGross: 500,
      lineTotal: 1000,
      vatClass: "general",
    })
    .returning();
  lineId = line!.id;
});

function app() {
  const hono = new Hono();
  mountTillApi(
    hono,
    {
      db: suite.db,
      cfg,
      backend: {} as TillApiDeps["backend"],
      clock: {
        now: () => ({
          instant: new Date(),
          offsetMinutes: 0,
          confident: true,
          confidence: "anchored",
          anchorAgeSeconds: 0,
        }),
        anchor: () => {
          throw new Error("This fixture never anchors time");
        },
        currentAnchor: () => null,
      },
      secureCookies: false,
      venueLocale: "en-GB",
    } as TillApiDeps,
    () => {},
  );
  return hono;
}

function path() {
  return `/api/parties/${partyId}/allergy`;
}
function command(overrides: Record<string, unknown> = {}) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: 0,
    allergy: { party: { answer: "none", guests: [] }, ticks: [] },
    ...overrides,
  };
}
const guest = { who: "Window seat", allergens: { milk: {} }, note: "Keep separate" };
function request(method: string, url = path(), body?: unknown, cookie = true) {
  return app().request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}
async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}
function snapshot() {
  return withTransaction(suite.db, (tx) => readPartyAllergy(tx, partyId));
}
async function ticked() {
  const res = await request(
    "PUT",
    path(),
    command({
      allergy: {
        party: {
          answer: "allergies",
          guests: [guest, { who: "Guest two", allergens: { eggs: {} }, note: null }],
        },
        ticks: [{ line: { kind: "working", id: lineId }, guestIndex: 0 }],
      },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as PartyAllergyRead;
}
const verbs = ["GET", "PUT", "POST"] as const;
function route(verb: string) {
  return verb === "POST" ? `${path()}/send-preview` : path();
}
function bodyFor(verb: string) {
  return verb === "POST" ? { kind: "lines", orderId: billId, lineNos: [] } : command();
}

describe("A669 allergy routes", () => {
  it("keeps unanswered distinct from an explicit No allergies and saves once for ordinary staff", async () => {
    const res = await request("GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      partyId,
      snapshot: { answer: null, revision: 0 },
      dishes: [{ line: { kind: "working", id: lineId }, quantity: "2.000" }],
    });
    const saved = await request("PUT", path(), command());
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      partyId,
      snapshot: { answer: "none", guests: [], ticks: [], revision: 1, changedBy: personId },
    });
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(1);
  });
  it("previews only eligible dishes without changing allergy or party state", async () => {
    const before = await snapshot();
    const res = await request("POST", `${path()}/send-preview`, bodyFor("POST"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      partyId,
      snapshot: before,
      dishes: [{ line: { kind: "working", id: lineId } }],
    });
    expect(await snapshot()).toEqual(before);
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
  });
  it("resolves new and reordered stable guest indexes and bumps tick-only edits exactly once", async () => {
    const first = await ticked();
    const [a, b] = first.snapshot.guests;
    expect(first.snapshot).toMatchObject({
      revision: 1,
      ticks: [{ guestId: a!.id, workingLineId: lineId }],
    });
    const reorder = await request(
      "PUT",
      path(),
      command({
        expectedPartyRevision: 1,
        allergy: {
          party: { answer: "allergies", guests: [b, a, { ...guest, who: "New guest" }] },
          ticks: [{ line: { kind: "working", id: lineId }, guestIndex: 2 }],
        },
      }),
    );
    expect(reorder.status).toBe(200);
    const second = (await reorder.json()) as PartyAllergyRead;
    expect(second.snapshot.guests.map((g) => g.id)).toEqual([b!.id, a!.id, expect.any(String)]);
    expect(second.snapshot.ticks).toEqual([
      { guestId: second.snapshot.guests[2]!.id, workingLineId: lineId, draftLineId: null },
    ]);
    const only = await request(
      "PUT",
      path(),
      command({
        expectedPartyRevision: 2,
        allergy: {
          ticks: [{ line: { kind: "working", id: lineId }, guestIndex: 0 }],
        },
      }),
    );
    expect(only.status).toBe(200);
    expect(await only.json()).toMatchObject({
      snapshot: { revision: 3, ticks: [{ guestId: b!.id, workingLineId: lineId }] },
    });
  });
  it.each(["delete one", "delete last", "none"])(
    "clears assignments on %s without requiring a browser confirmation",
    async (kind) => {
      const first = await ticked();
      const guests = kind === "delete one" ? [first.snapshot.guests[1]] : [];
      const res = await request(
        "PUT",
        path(),
        command({
          expectedPartyRevision: 1,
          allergy: { party: { answer: kind === "none" ? "none" : "allergies", guests }, ticks: [] },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        snapshot: {
          answer: kind === "none" ? "none" : "allergies",
          guests: guests.map((g, position) => ({ ...g, position })),
          ticks: [],
          revision: 2,
        },
      });
    },
  );
  it("replays the original snapshot after a newer save, while changed payloads or actors refuse reuse", async () => {
    const original = command();
    const saved = await request("PUT", path(), original);
    expect(saved.status).toBe(200);
    const first = await saved.json();
    const later = await request(
      "PUT",
      path(),
      command({
        expectedPartyRevision: 1,
        allergy: { party: { answer: "allergies", guests: [guest] }, ticks: [] },
      }),
    );
    expect(later.status).toBe(200);
    const before = await snapshot();
    const replay = await request("PUT", path(), original);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(first);
    await expectError(
      await request("PUT", path(), { ...original, allergy: { ticks: [] } }),
      409,
      "submission.id_reused",
    );
    const [other] = await suite.db
      .insert(persons)
      .values({ displayName: "Other staff", role: "staff" })
      .returning();
    await suite.db.update(sessions).set({ personId: other!.id }).where(eq(sessions.id, sessionId));
    await expectError(await request("PUT", path(), original), 409, "submission.id_reused");
    expect(await snapshot()).toEqual(before);
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(2);
  });
  it("rolls back a stale edit and an invalid target after replacing guests", async () => {
    await ticked();
    const before = await snapshot();
    await expectError(await request("PUT", path(), command()), 409, "party.out_of_date");
    await expectError(
      await request(
        "PUT",
        path(),
        command({
          expectedPartyRevision: 1,
          allergy: {
            party: { answer: "none", guests: [] },
            ticks: [{ line: { kind: "working", id: randomUUID() }, guestIndex: null }],
          },
        }),
      ),
      400,
      "allergy.invalid",
    );
    expect(await snapshot()).toEqual(before);
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(1);
  });
  it.each([
    { allergy: null },
    { allergy: [] },
    { allergy: { party: null, ticks: [] } },
    { allergy: { ticks: null } },
    { allergy: { ticks: [{ line: null, guestIndex: null }] } },
    { allergy: { ticks: [{ line: { kind: "working", id: "bad" }, guestIndex: null }] } },
    { allergy: { party: { answer: ["none"], guests: [] }, ticks: [] } },
    { allergy: { party: { answer: "allergies", guests: [{ ...guest, who: " " }] }, ticks: [] } },
  ])("refuses malformed patches %# without changes", async (overrides) => {
    const before = await snapshot();
    await expectError(await request("PUT", path(), command(overrides)), 400, "allergy.invalid");
    expect(await snapshot()).toEqual(before);
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
  });
  it.each([
    null,
    [],
    {},
    { expectedPartyRevision: null },
    { expectedPartyRevision: -1 },
    { expectedPartyRevision: 0.5 },
    { submissionId: null },
    { submissionId: "bad" },
  ])("refuses malformed commands %#", async (overrides) => {
    const body =
      overrides === null || Array.isArray(overrides) || Object.keys(overrides).length === 0
        ? overrides
        : command(overrides);
    await expectError(await request("PUT", path(), body), 400, "management.request_invalid");
    expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
  });
  it.each(verbs)("requires an open session for %s", async (verb) => {
    await expectError(
      await request(verb, route(verb), bodyFor(verb), false),
      401,
      "session.required",
    );
    await suite.db
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
    await expectError(await request(verb, route(verb), bodyFor(verb)), 401, "session.required");
  });
  it.each(verbs)("checks device, profile action and admission for %s", async (verb) => {
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    await expectError(await request(verb, route(verb), bodyFor(verb)), 401, "device.unauthorized");
    await suite.db.update(devices).set({ active: true }).where(eq(devices.id, deviceId));
    await suite.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, profileId));
    await expectError(
      await request(verb, route(verb), bodyFor(verb)),
      403,
      "device.forbidden_action",
    );
    await suite.db
      .update(deviceProfiles)
      .set({ capabilities: ["take-orders"] })
      .where(eq(deviceProfiles.id, profileId));
    await suite.db
      .insert(deviceProfileAdmissionPersons)
      .values({ deviceProfileId: profileId, personId, admitted: false });
    await expectError(
      await request(verb, route(verb), bodyFor(verb)),
      403,
      "device_profile.not_admitted",
    );
    expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
  });
  it.each(verbs)("checks party zones for %s and serves an allowed control", async (verb) => {
    const elsewhere = await createZone(suite.db, cfg, { name: "Elsewhere" });
    const [department] = await listDepartments(suite.db, cfg);
    const restrict = (zoneId: string) =>
      setProfileServiceAccess(suite.db, cfg, profileId, {
        departmentId: department!.id,
        allowedZoneIds: [zoneId],
        startingZoneId: zoneId,
      });
    await restrict(elsewhere.id);
    await expectError(
      await request(verb, route(verb), bodyFor(verb)),
      403,
      "service_zone.not_allowed",
    );
    expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
    await restrict(tableZoneId);
    expect((await request(verb, route(verb), bodyFor(verb))).status).toBe(200);
  });
  it.each(verbs)("hides another location's party from %s", async (verb) => {
    const [other] = await suite.db
      .insert(locations)
      .values({
        name: "Other location",
        invoiceLocales: ["en-GB"],
        operationDescription: "Hospitality",
      })
      .returning();
    const otherCfg = { ...cfg, locationId: locationId(other!.id) };
    const zone = await createZone(suite.db, otherCfg, { name: "Other tables" });
    const table = await createTable(suite.db, otherCfg, { label: "Other table", zoneId: zone.id });
    await suite.db.delete(partyTables).where(eq(partyTables.partyId, partyId));
    await suite.db.insert(partyTables).values({ partyId, tableId: table.id });
    await suite.db
      .update(workingOrders)
      .set({ locationId: otherCfg.locationId })
      .where(eq(workingOrders.id, billId));
    await expectError(await request(verb, route(verb), bodyFor(verb)), 404, "party.not_found");
  });
  it("keeps automatic reads passive and explicit preview active", async () => {
    const seen = "2020-01-01T00:00:00.000Z";
    await suite.db.update(devices).set({ lastSeenAt: seen }).where(eq(devices.id, deviceId));
    expect((await request("GET")).status).toBe(200);
    const seenAt = async () =>
      (await suite.db.select().from(devices).where(eq(devices.id, deviceId)))[0]!.lastSeenAt;
    expect(await seenAt()).toBe(seen);
    expect((await request("POST", route("POST"), bodyFor("POST"))).status).toBe(200);
    expect(await seenAt()).not.toBe(seen);
  });
  it.each(["admission", "session", "action", "device"] as const)(
    "rechecks %s after the body is read",
    async (change) => {
      let release!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const raw = new Request(`http://localhost${path()}`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify(command()),
      });
      const text = raw.text.bind(raw);
      vi.spyOn(raw, "text").mockImplementation(async () => {
        await gate;
        return text();
      });
      const pending = app().request(raw);
      try {
        await vi.waitFor(() => expect(raw.text).toHaveBeenCalled());
        if (change === "admission")
          await suite.db
            .insert(deviceProfileAdmissionPersons)
            .values({ deviceProfileId: profileId, personId, admitted: false });
        if (change === "session")
          await suite.db
            .update(sessions)
            .set({ endedAt: new Date().toISOString() })
            .where(eq(sessions.id, sessionId));
        if (change === "action")
          await suite.db
            .update(deviceProfiles)
            .set({ capabilities: [] })
            .where(eq(deviceProfiles.id, profileId));
        if (change === "device")
          await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
      } finally {
        release();
      }
      const codes = {
        admission: [403, "device_profile.not_admitted"],
        session: [401, "session.required"],
        action: [403, "device.forbidden_action"],
        device: [401, "device.unauthorized"],
      } as const;
      const [status, code] = codes[change];
      await expectError(await pending, status, code);
      expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
      expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
    },
  );
});

describe("A669 allergy preview validation", () => {
  it("keeps a counter bill outside a party preview", async () => {
    await expectError(
      await request("POST", route("POST"), { kind: "lines", orderId, lineNos: [] }),
      400,
      "allergy.invalid",
    );
    expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
  });
  it.each([
    null,
    [],
    {},
    { kind: ["lines"] },
    { kind: "draft", draftId: "bad", lineIds: [] },
    { kind: "draft", draftId: randomUUID(), lineIds: null },
    { kind: "draft", draftId: randomUUID(), lineIds: [null] },
    { kind: "lines", orderId: randomUUID(), lineNos: null },
    { kind: "lines", orderId: randomUUID(), lineNos: [0] },
    { kind: "lines", orderId: randomUUID(), lineNos: [1.5] },
    { kind: "lines", orderId: randomUUID(), lineNos: ["1"] },
    { kind: "group", groupId: null },
    { kind: "held-line", lineId: [] },
    { kind: "course", orderId: randomUUID(), courseId: "bad" },
  ])("rejects malformed targets %# without changes", async (body) => {
    await expectError(
      await request("POST", route("POST"), body),
      400,
      "management.request_invalid",
    );
    expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
  });
  it("parses draft, group, held-line and course targets before resolving them", async () => {
    await expectError(
      await request("POST", route("POST"), {
        kind: "draft",
        draftId: randomUUID(),
        lineIds: [randomUUID()],
      }),
      400,
      "allergy.invalid",
    );
    for (const body of [
      { kind: "group", groupId: randomUUID() },
      { kind: "held-line", lineId: randomUUID() },
    ])
      await expectError(await request("POST", route("POST"), body), 404, "group.not_found");
    const result = await request("POST", route("POST"), {
      kind: "course",
      orderId: billId,
      courseId: randomUUID(),
    });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      partyId,
      snapshot: { answer: null, revision: 0 },
      dishes: [],
    });
  });
  it.each([-1, 0.5, 1, null, "0"])(
    "validates guest index %s against the post-edit guests",
    async (guestIndex) => {
      await ticked();
      const before = await snapshot();
      const response = await request(
        "PUT",
        path(),
        command({
          expectedPartyRevision: 1,
          allergy: {
            party: { answer: "allergies", guests: [before.guests[0]] },
            ticks: [{ line: { kind: "working", id: lineId }, guestIndex }],
          },
        }),
      );
      if (guestIndex === null) {
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ snapshot: { ticks: [], revision: 2 } });
      } else {
        await expectError(response, 400, "allergy.invalid");
        expect(await snapshot()).toEqual(before);
      }
    },
  );
  it("refuses duplicate targets after resolving their kind and id", async () => {
    await ticked();
    const before = await snapshot();
    const tick = { line: { kind: "working", id: lineId }, guestIndex: null };
    await expectError(
      await request(
        "PUT",
        path(),
        command({ expectedPartyRevision: 1, allergy: { ticks: [tick, tick] } }),
      ),
      400,
      "allergy.invalid",
    );
    expect(await snapshot()).toEqual(before);
  });
});

it.each(verbs)("A669 refuses a device relocated away from this process for %s", async (verb) => {
  const [other] = await suite.db
    .insert(locations)
    .values({
      name: "Other location",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    })
    .returning();
  await suite.db.update(devices).set({ locationId: other!.id }).where(eq(devices.id, deviceId));
  await expectError(await request(verb, route(verb), bodyFor(verb)), 401, "device.unauthorized");
  expect(await snapshot()).toMatchObject({ answer: null, revision: 0 });
});
it("A669 keeps the current answer when a command omits the optional patch", async () => {
  await ticked();
  const before = await snapshot();
  const packet = { submissionId: randomUUID(), expectedPartyRevision: 1 };
  const result = await request("PUT", path(), packet);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ snapshot: { ...before, revision: 2 } });
  expect((await snapshot()).revision).toBe(2);
});
it("A669 replays a saved answer after the party closes without reopening it", async () => {
  const packet = command();
  const saved = await request("PUT", path(), packet);
  expect(saved.status).toBe(200);
  const original = await saved.json();
  await suite.db
    .update(parties)
    .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: personId })
    .where(eq(parties.id, partyId));
  const replay = await request("PUT", path(), packet);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(original);
  await expectError(
    await request("PUT", path(), command({ expectedPartyRevision: 1 })),
    409,
    "party.not_open",
  );
  expect((await suite.db.select().from(parties).where(eq(parties.id, partyId)))[0]!.state).toBe(
    "closed",
  );
  expect(await snapshot()).toMatchObject({ answer: "none", revision: 1 });
});
