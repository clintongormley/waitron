import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
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
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { locationId, nodeId } from "@waitron/shared";
import {
  listDepartments,
  readKitchenNotes,
  recordOrderServiceContext,
  setProfileServiceAccess,
  writeKitchenNote,
} from "@waitron/venue-service";
import type { KitchenNoteSnapshot } from "@waitron/module";
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
});

function app() {
  const hono = new Hono();
  mountTillApi(
    hono,
    { db: suite.db, cfg, secureCookies: false, venueLocale: "en-GB" } as TillApiDeps,
    () => {},
  );
  return hono;
}

function path(party = false) {
  return party
    ? `/api/parties/${partyId}/kitchen-note`
    : `/api/working-orders/${orderId}/kitchen-note`;
}

function request(method: "GET" | "PUT", url: string, body?: unknown, cookie = true) {
  return app().request(url, {
    method,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

function command(party = false, overrides: Record<string, unknown> = {}) {
  return {
    submissionId: randomUUID(),
    expectedNoteRevision: 0,
    note: "All together; train at 14:30",
    ...(party ? { expectedPartyRevision: 0 } : { expectedOrderRevision: 0, partyId: null }),
    ...overrides,
  };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: { code } });
}

describe("whole-order kitchen note routes", () => {
  it.each([false, true])("reads and saves the %s scope for admitted staff", async (party) => {
    const scope = party ? { partyId } : { workingOrderId: orderId };
    const empty = await request("GET", path(party));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ scope, ownerRevision: 0, note: null, revision: 0 });
    const saved = await request("PUT", path(party), command(party));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({
      scope,
      ownerRevision: party ? 1 : 0,
      note: "All together; train at 14:30",
      revision: 1,
    });
  });

  it("reads a party bill through the canonical party scope", async () => {
    await withTransaction(suite.db, (tx) => writeKitchenNote(tx, { partyId }, 0, "Serve together"));
    const res = await request("GET", `/api/working-orders/${billId}/kitchen-note`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scope: { partyId },
      ownerRevision: 0,
      note: "Serve together",
      revision: 1,
    });
  });

  it.each([false, true])("refuses unsigned reads and writes of %s", async (party) => {
    await expectError(await request("GET", path(party), undefined, false), 401, "session.required");
    await expectError(
      await request("PUT", path(party), command(party), false),
      401,
      "session.required",
    );
  });

  it("normalises, clears and retains the note revision without replacing order lines", async () => {
    const [line] = await suite.db
      .insert(workingOrderLines)
      .values({
        workingOrderId: orderId,
        lineNo: 1,
        name: "Soup",
        kitchenName: "SOUP",
        descriptions: { "en-GB": "House soup" },
        quantity: 1000,
        unitPriceGross: 800,
        lineTotal: 800,
        vatClass: "reduced",
        note: "No croutons",
      })
      .returning();
    const first = await request(
      "PUT",
      path(),
      command(false, { note: "  Send\u001b\n together\t " }),
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ note: "Send  together", revision: 1 });
    const clear = await request(
      "PUT",
      path(),
      command(false, { expectedNoteRevision: 1, note: null }),
    );
    expect(clear.status).toBe(200);
    expect(await clear.json()).toMatchObject({ note: null, revision: 2 });
    await expectError(await request("PUT", path(), command()), 409, "kitchen_note.out_of_date");
    expect(
      await withTransaction(suite.db, (tx) => readKitchenNotes(tx, [{ workingOrderId: orderId }])),
    ).toEqual(new Map([[`order:${orderId}`, { note: null, revision: 2 }]]));
    expect(await suite.db.select().from(workingOrderLines)).toEqual([line]);
  });

  it("replays the original result without replacing a later note", async () => {
    const original = command(true);
    const first = await request("PUT", path(true), original);
    expect(first.status).toBe(200);
    const answer = (await first.json()) as KitchenNoteSnapshot;
    const later = await request(
      "PUT",
      path(true),
      command(true, { expectedPartyRevision: 1, expectedNoteRevision: 1, note: "Dessert later" }),
    );
    expect(later.status).toBe(200);
    const replay = await request("PUT", path(true), original);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(answer);
    expect(await (await request("GET", path(true))).json()).toMatchObject({
      note: "Dessert later",
      revision: 2,
      ownerRevision: 2,
    });
    await expectError(
      await request("PUT", path(true), { ...original, note: "Different" }),
      409,
      "submission.id_reused",
    );
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(2);
  });

  it.each([false, true])(
    "checks owner revisions even when the %s text is unchanged",
    async (party) => {
      const body = command(party, {
        note: null,
        ...(party ? { expectedPartyRevision: 1 } : { expectedOrderRevision: 1 }),
      });
      await expectError(
        await request("PUT", path(party), body),
        409,
        party ? "party.out_of_date" : "working_order.out_of_date",
      );
      expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
    },
  );

  it("leaves party and note revisions unchanged for equal normalised text", async () => {
    const res = await request("PUT", path(true), command(true, { note: " \n " }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scope: { partyId },
      note: null,
      revision: 0,
      ownerRevision: 0,
    });
  });

  it.each([{}, { note: [] }, { note: false }, { note: 123 }, { note: "x".repeat(2001) }])(
    "refuses malformed note input %# without writing",
    async (overrides) => {
      const body = command();
      delete (body as Record<string, unknown>).note;
      await expectError(
        await request("PUT", path(), { ...body, ...overrides }),
        400,
        typeof overrides.note === "string" ? "kitchen_note.too_long" : "kitchen_note.invalid",
      );
      expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
    },
  );

  it("refuses a counter write after the order joins a party", async () => {
    await suite.db.update(workingOrders).set({ partyId }).where(eq(workingOrders.id, orderId));
    await expectError(await request("PUT", path(), command()), 409, "working_order.out_of_date");
  });

  it.each([false, true])("refuses a revoked device on %s reads and writes", async (party) => {
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
    await expectError(await request("GET", path(party)), 401, "device.unauthorized");
    await expectError(
      await request("PUT", path(party), command(party)),
      401,
      "device.unauthorized",
    );
  });

  it("refuses a signed-out session", async () => {
    await suite.db
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, sessionId));
    await expectError(await request("PUT", path(), command()), 401, "session.required");
  });

  it.each([false, true])(
    "refuses profiles without take-orders for %s reads and writes",
    async (party) => {
      await suite.db
        .update(deviceProfiles)
        .set({ capabilities: [] })
        .where(eq(deviceProfiles.id, profileId));
      await expectError(await request("GET", path(party)), 403, "device.forbidden_action");
      await expectError(
        await request("PUT", path(party), command(party)),
        403,
        "device.forbidden_action",
      );
    },
  );

  it.each([false, true])(
    "refuses the %s scope outside profile zones and serves it once allowed",
    async (party) => {
      const elsewhere = await createZone(suite.db, cfg, { name: "Elsewhere" });
      const [department] = await listDepartments(suite.db, cfg);
      await recordOrderServiceContext(suite.db, cfg, orderId, tableZoneId);
      await setProfileServiceAccess(suite.db, cfg, profileId, {
        departmentId: department!.id,
        allowedZoneIds: [elsewhere.id],
        startingZoneId: elsewhere.id,
      });
      await expectError(await request("GET", path(party)), 403, "service_zone.not_allowed");
      await expectError(
        await request("PUT", path(party), command(party)),
        403,
        "service_zone.not_allowed",
      );
      expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
      await setProfileServiceAccess(suite.db, cfg, profileId, {
        departmentId: department!.id,
        allowedZoneIds: [tableZoneId],
        startingZoneId: tableZoneId,
      });
      expect((await request("GET", path(party))).status).toBe(200);
      expect((await request("PUT", path(party), command(party))).status).toBe(200);
    },
  );

  it("checks the survivor party zone when a retained bill resolves to that party's note", async () => {
    const elsewhere = await createZone(suite.db, cfg, { name: "Elsewhere" });
    const [department] = await listDepartments(suite.db, cfg);
    const [absorbed] = await suite.db
      .insert(parties)
      .values({
        openedBy: personId,
        state: "closed",
        closedAt: new Date().toISOString(),
        mergedIntoPartyId: partyId,
      })
      .returning();
    await suite.db
      .update(workingOrders)
      .set({ partyId: absorbed!.id })
      .where(eq(workingOrders.id, billId));
    await writeKitchenNote(suite.db, { partyId }, 0, "Private dining instructions");
    await setProfileServiceAccess(suite.db, cfg, profileId, {
      departmentId: department!.id,
      allowedZoneIds: [elsewhere.id],
      startingZoneId: elsewhere.id,
    });
    await expectError(
      await request("GET", `/api/working-orders/${billId}/kitchen-note`),
      403,
      "service_zone.not_allowed",
    );
    await setProfileServiceAccess(suite.db, cfg, profileId, {
      departmentId: department!.id,
      allowedZoneIds: [tableZoneId],
      startingZoneId: tableZoneId,
    });
    expect(
      await (await request("GET", `/api/working-orders/${billId}/kitchen-note`)).json(),
    ).toEqual({
      scope: { partyId },
      note: "Private dining instructions",
      revision: 1,
      ownerRevision: 0,
    });
  });

  it.each([false, true])("keeps %s reads passive", async (party) => {
    const seenAt = "2020-01-01T00:00:00.000Z";
    await suite.db.update(devices).set({ lastSeenAt: seenAt }).where(eq(devices.id, deviceId));
    expect((await request("GET", path(party))).status).toBe(200);
    const [device] = await suite.db
      .select({ at: devices.lastSeenAt })
      .from(devices)
      .where(eq(devices.id, deviceId));
    expect(device!.at).toBe(seenAt);
  });

  it.each([false, true])("hides a %s scope belonging to another location", async (party) => {
    const [location] = await suite.db
      .insert(locations)
      .values({
        name: "Other venue",
        invoiceLocales: ["en-GB"],
        operationDescription: "Restaurant",
      })
      .returning();
    const otherCfg = { ...cfg, locationId: locationId(location!.id) };
    const otherZone = await createZone(suite.db, otherCfg, { name: "Other zone" });
    const otherTable = await createTable(suite.db, otherCfg, {
      label: "Other table",
      zoneId: otherZone.id,
    });
    const [otherParty] = await suite.db.insert(parties).values({ openedBy: personId }).returning();
    await suite.db.insert(partyTables).values({ partyId: otherParty!.id, tableId: otherTable.id });
    const [otherOrder] = await suite.db
      .insert(workingOrders)
      .values({ source: "dashboard", locationId: location!.id, orderNumber: 3 })
      .returning();
    const url = party
      ? `/api/parties/${otherParty!.id}/kitchen-note`
      : `/api/working-orders/${otherOrder!.id}/kitchen-note`;
    await expectError(
      await request("GET", url),
      404,
      party ? "party.not_found" : "working_order.not_found",
    );
    await expectError(
      await request("PUT", url, command(party)),
      404,
      party ? "party.not_found" : "working_order.not_found",
    );
  });

  it.each(["abandoned", "collected", "payment"])("refuses %s counter writes", async (state) => {
    await suite.db
      .update(workingOrders)
      .set(
        state === "abandoned"
          ? { status: "abandoned" }
          : state === "collected"
            ? { collectedAt: new Date().toISOString() }
            : { paymentAttemptAt: new Date().toISOString() },
      )
      .where(eq(workingOrders.id, orderId));
    await expectError(
      await request("PUT", path(), command()),
      409,
      state === "payment" ? "order.payment_in_flight" : "working_order.not_open",
    );
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
  });

  it.each(["logout", "revoke", "profile", "zone"])(
    "rechecks %s after reading a delayed request body",
    async (change) => {
      let begin!: () => void;
      let resume!: () => void;
      const entered = new Promise<void>((done) => {
        begin = done;
      });
      const released = new Promise<void>((done) => {
        resume = done;
      });
      const raw = new Request(`http://localhost${path(true)}`, {
        method: "PUT",
        headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
        body: JSON.stringify(command(true)),
      });
      const readText = raw.text.bind(raw);
      raw.text = async () => {
        const text = await readText();
        begin();
        await released;
        return text;
      };
      const pending = app().fetch(raw);
      await entered;
      try {
        if (change === "logout")
          await suite.db
            .update(sessions)
            .set({ endedAt: new Date().toISOString() })
            .where(eq(sessions.id, sessionId));
        else if (change === "revoke")
          await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
        else if (change === "profile")
          await suite.db
            .update(deviceProfiles)
            .set({ capabilities: [] })
            .where(eq(deviceProfiles.id, profileId));
        else {
          const elsewhere = await createZone(suite.db, cfg, { name: "Elsewhere" });
          const [department] = await listDepartments(suite.db, cfg);
          await setProfileServiceAccess(suite.db, cfg, profileId, {
            departmentId: department!.id,
            allowedZoneIds: [elsewhere.id],
            startingZoneId: elsewhere.id,
          });
        }
      } finally {
        resume();
      }
      await expectError(
        await pending,
        change === "logout" || change === "revoke" ? 401 : 403,
        change === "logout"
          ? "session.required"
          : change === "revoke"
            ? "device.unauthorized"
            : change === "profile"
              ? "device.forbidden_action"
              : "service_zone.not_allowed",
      );
      expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
      expect((await readKitchenNotes(suite.db, [{ partyId }])).get(`party:${partyId}`)).toEqual({
        note: null,
        revision: 0,
      });
    },
  );

  it("saves a party note without a main bill and refuses a closed party", async () => {
    await suite.db.delete(workingOrders).where(eq(workingOrders.id, billId));
    expect((await request("PUT", path(true), command(true))).status).toBe(200);
    const bills = await suite.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.partyId, partyId));
    expect(bills).toEqual([]);
    await suite.db
      .update(parties)
      .set({ state: "closed", closedAt: new Date().toISOString() })
      .where(eq(parties.id, partyId));
    await expectError(
      await request(
        "PUT",
        path(true),
        command(true, { expectedPartyRevision: 1, expectedNoteRevision: 1, note: null }),
      ),
      409,
      "party.not_open",
    );
  });

  it.each([false, true])("answers 404 for missing or malformed %s scope ids", async (party) => {
    for (const id of ["missing", randomUUID()]) {
      const url = party
        ? `/api/parties/${id}/kitchen-note`
        : `/api/working-orders/${id}/kitchen-note`;
      for (const method of ["GET", "PUT"] as const)
        await expectError(
          await request(method, url, command(party)),
          404,
          party ? "party.not_found" : "working_order.not_found",
        );
    }
  });

  it.each([
    { submissionId: null },
    { submissionId: "missing" },
    { expectedNoteRevision: -1 },
    { expectedNoteRevision: 0.5 },
    { expectedOrderRevision: null },
    { expectedOrderRevision: "0" },
    { partyId: undefined },
    { partyId: randomUUID() },
  ])("refuses malformed counter commands %#", async (overrides) => {
    await expectError(
      await request("PUT", path(), command(false, overrides)),
      400,
      "management.request_invalid",
    );
    expect(await suite.db.select().from(serviceCommands)).toHaveLength(0);
    expect(
      (await readKitchenNotes(suite.db, [{ workingOrderId: orderId }])).get(`order:${orderId}`),
    ).toEqual({ note: null, revision: 0 });
  });

  it("accepts exactly 2000 characters from an admitted handheld", async () => {
    const handheld = await seedDevice(suite.db, {
      locationId: cfg.locationId,
      formFactor: "phone-portrait",
      capabilities: ["take-orders"],
    });
    await suite.db
      .update(sessions)
      .set({ deviceId: handheld.deviceId })
      .where(eq(sessions.id, sessionId));
    const res = await request("PUT", path(true), command(true, { note: "n".repeat(2000) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      scope: { partyId },
      ownerRevision: 1,
      revision: 1,
      note: "n".repeat(2000),
    });
  });
});
