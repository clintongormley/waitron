import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  orderGroupEvents,
  orderGroups,
  products,
  serviceCommands,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashPin, persons } from "@waitron/identity";
import type { DeviceKitchenScreen } from "@waitron/module";
import { LEVER_STATUS, mountDeviceApi } from "./device-api.js";
import { STATUS as TILL_STATUS, mountTillApi } from "./till-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { VENUE_SERVICE } from "./modules.js";
import { readBillEditState } from "./bill-editing.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";

import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  counterOrder,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
} from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
const log = () => {};

const EVERY_PASS: DeviceKitchenScreen = { kind: "pass", stationIds: null, zoneIds: null };
const RUNS_THE_PASS = ["take-orders", "prepare-orders", "hand-over-orders"] as const;

async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const mains = await inTx(v, async (tx) => {
    const starters = await createCourse(tx, v.cfg, { name: "Starters", displayOrder: 0 });
    await setProductCourse(tx, v.cfg, v.productId("Caña"), starters.id);
    const course = await createCourse(tx, v.cfg, { name: "Mains", displayOrder: 1 });
    await setProductCourse(tx, v.cfg, v.productId("Burger"), course.id);
    return course.id;
  });
  const profile = async (formFactor: "kds" | "till", capabilities: readonly string[]) => {
    const [row] = await suite.db
      .insert(deviceProfiles)
      .values({ name: `Profile ${randomUUID()}`, formFactor, capabilities: [...capabilities] })
      .returning({ id: deviceProfiles.id });
    return row!.id;
  };
  const device = async (
    name: string,
    profileId: string,
    choice: { kitchenScreen?: DeviceKitchenScreen; stationId?: string },
  ) => {
    const joined = await enrolDeviceForTest(suite.db, v.cfg, { name, profileId, ...choice });
    return { id: joined.deviceId, cookie: `${DEVICE_COOKIE}=${joined.deviceId}.${joined.token}` };
  };
  const runner = await profile("kds", RUNS_THE_PASS);
  const pass = await device("Pantalla Pase", runner, { kitchenScreen: EVERY_PASS });
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
    },
    log,
  );
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    log,
  );
  const [ana] = await suite.db
    .insert(persons)
    .values({ displayName: "Ana", pinHash: hashPin("5555"), role: "admin" })
    .returning({ id: persons.id });
  /** A seated party with one Burger held in a group of its own. */
  const heldBurger = async () => {
    const seated = await seat(v, await v.table(`T${randomUUID().slice(0, 4)}`));
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(tx, seated.partyId, { answer: "none", guests: [] }, OPERATOR),
    );
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, seated.partyId, {
        groups: [
          {
            lines: [{ menuItemId: v.item("Burger"), quantity: "1" }],
            release: "hold",
          },
        ],
        operatorId: OPERATOR,
        billId: seated.tabId,
      }),
    );
    return { ...seated, groupId: placed.groups[0]!.id };
  };
  const signIn = async (deviceCookie: string) => {
    const login = await app.request("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: deviceCookie },
      body: JSON.stringify({ personId: ana!.id, pin: "5555" }),
    });
    expect(login.status).toBe(200);
    return `${deviceCookie}; ${login.headers.get("set-cookie")!.split(";")[0]!}`;
  };
  return { v, app, mains, profile, device, runner, pass, heldBurger, signIn, ana: ana!.id };
}

async function send(app: Hono, cookie: string, path: string, body: unknown = {}) {
  const response = await app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as {
      error?: { code: string; params?: unknown };
    } & Record<string, unknown>,
  };
}

const coursePath = (orderId: string, courseId: string, verb: string) =>
  `/api/device/orders/${orderId}/courses/${courseId}/${verb}`;
const groupPath = (partyId: string, groupId: string, verb: string) =>
  `/api/device/parties/${partyId}/groups/${groupId}/${verb}`;

async function groupRow(groupId: string) {
  const [row] = await suite.db.select().from(orderGroups).where(eq(orderGroups.id, groupId));
  return row!;
}

async function firedEvent(groupId: string) {
  const [row] = await suite.db
    .select()
    .from(orderGroupEvents)
    .where(and(eq(orderGroupEvents.groupId, groupId), eq(orderGroupEvents.kind, "fired")));
  return row;
}

async function itemsOf(orderId: string) {
  return suite.db
    .select({ state: ticketItems.state, firedAt: ticketItems.firedAt, awayAt: ticketItems.awayAt })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, orderId));
}

describe("waiter cooking authority", () => {
  it.each([
    ["device course Fire", 0],
    ["device course Away", 1],
    ["device group Fire", 2],
    ["device group Away", 3],
    ["session course Fire", 4],
    ["session course Away", 5],
    ["session group Away", 6],
  ] as const)(
    "A773 waiter authority: retired %s cannot mutate held or ready food",
    async (_name, pathIndex) => {
      const f = await fixture();
      const held = await f.heldBurger();
      const cookie = await tillCookie(f);
      const snapshot = async () => ({
        groups: await suite.db.select().from(orderGroups),
        events: await suite.db.select().from(orderGroupEvents),
        commands: await suite.db.select().from(serviceCommands),
        items: await suite.db.select().from(ticketItems),
        lines: await suite.db.select().from(workingOrderLines),
        orders: await suite.db.select().from(workingOrders),
      });
      for (const state of ["held", "ready"]) {
        if (state === "ready") {
          const fired = await send(
            f.app,
            cookie,
            `/api/parties/${held.partyId}/groups/${held.groupId}/fire`,
            {
              submissionId: randomUUID(),
              expectedPartyRevision: await revisionOf(f.v, held.partyId),
            },
          );
          expect(fired.status).toBe(200);
          const ready = await send(
            f.app,
            f.pass.cookie,
            groupPath(held.partyId, held.groupId, "ready"),
            {
              submissionId: randomUUID(),
              expectedPartyRevision: await revisionOf(f.v, held.partyId),
            },
          );
          expect(ready.status).toBe(200);
        }
        const before = await snapshot();
        for (const path of [
          [
            coursePath(held.tabId, f.mains, "fire"),
            coursePath(held.tabId, f.mains, "away"),
            groupPath(held.partyId, held.groupId, "fire"),
            groupPath(held.partyId, held.groupId, "away"),
            `/api/orders/${held.tabId}/courses/${f.mains}/fire`,
            `/api/orders/${held.tabId}/courses/${f.mains}/away`,
            `/api/parties/${held.partyId}/groups/${held.groupId}/away`,
          ][pathIndex]!,
        ]) {
          for (const auth of [f.pass.cookie, cookie, ""]) {
            const response = await f.app.request(path, {
              method: "POST",
              headers: { cookie: auth, "content-type": "application/json" },
              body: JSON.stringify({
                submissionId: randomUUID(),
                expectedPartyRevision: await revisionOf(f.v, held.partyId),
              }),
            });
            expect(response.status, `${state}: ${path}`).toBe(404);
            expect(await snapshot()).toEqual(before);
          }
        }
      }
    },
  );

  it("waiter group preflight and release roll back every bill when the later dish is unavailable", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    await inTx(f.v, (tx) =>
      placeGroups(tx, f.v.cfg, held.partyId, {
        operatorId: OPERATOR,
        billId: held.tabId,
        groups: [
          {
            release: "hold",
            joinGroupId: held.groupId,
            lines: [{ menuItemId: f.v.item("Flan"), quantity: "1" }],
          },
        ],
      }),
    );
    const other = await split(f.v, held.partyId, held.tabId, [2]);
    await suite.db
      .update(products)
      .set({ available: false })
      .where(eq(products.id, f.v.productId("Flan")));
    const before = [await itemsOf(held.tabId), await itemsOf(other)];
    const revision = await revisionOf(f.v, held.partyId);
    const result = await send(
      f.app,
      await tillCookie(f),
      `/api/parties/${held.partyId}/groups/${held.groupId}/fire`,
      {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
      },
    );
    expect(result.status).toBe(409);
    expect(result.body.error?.code).toBe("product.unavailable");
    expect([await itemsOf(held.tabId), await itemsOf(other)]).toEqual(before);
    expect((await groupRow(held.groupId)).state).toBe("held");
    expect(await firedEvent(held.groupId)).toBeUndefined();
    expect(await revisionOf(f.v, held.partyId)).toBe(revision);
  });
  for (const path of ["group", "line", "held-line"] as const) {
    it(`${path} rechecks current profile authority after reading a queued Fire body`, async () => {
      const f = await fixture();
      const held = await f.heldBurger();
      const [line] = await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, held.tabId));
      if (path === "line")
        await suite.db
          .update(workingOrderLines)
          .set({ groupId: null })
          .where(eq(workingOrderLines.id, line!.id));
      const profile = await f.profile("till", ["take-orders"]);
      const till = await f.device("Queued allergy till", profile, {});
      const cookie = await f.signIn(till.cookie);
      const revision = await revisionOf(f.v, held.partyId);
      const body = {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        expectedEdit: await inTx(f.v, (tx) => readBillEditState(tx, held.tabId)),
        lineId: line!.id,
        lineNos: [line!.lineNo],
      };
      const url =
        path === "group"
          ? `/api/parties/${held.partyId}/groups/${held.groupId}/fire`
          : path === "held-line"
            ? `/api/parties/${held.partyId}/groups/fire-line`
            : `/api/working-orders/${held.tabId}/lines/send`;
      let unblock!: () => void;
      let notifyRead!: () => void;
      const blocked = new Promise<void>((resolve) => {
        unblock = resolve;
      });
      const reading = new Promise<void>((resolve) => {
        notifyRead = resolve;
      });
      const request = new Request(`http://localhost${url}`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      request.text = async () => {
        notifyRead();
        await blocked;
        return JSON.stringify(body);
      };
      const pending = f.app.fetch(request);
      await reading;
      await suite.db
        .update(deviceProfiles)
        .set({ capabilities: [] })
        .where(eq(deviceProfiles.id, profile));
      const before = await itemsOf(held.tabId);
      unblock();
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "device.forbidden_action" } });
      expect(await itemsOf(held.tabId)).toEqual(before);
      expect(await revisionOf(f.v, held.partyId)).toBe(revision);
    });
  }
  for (const path of ["group", "line", "held-line"] as const) {
    it(`signed-in ${path} saves its first allergy answer with Fire and replays exactly`, async () => {
      const f = await fixture();
      const held = await f.heldBurger();
      await suite.db.run(sql`delete from party_allergy where party_id = ${held.partyId}`);
      const [line] = await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, held.tabId));
      if (path === "line")
        await suite.db
          .update(workingOrderLines)
          .set({ groupId: null })
          .where(eq(workingOrderLines.id, line!.id));
      const profile = await f.profile("till", ["take-orders"]);
      const till = await f.device("Allergy till", profile, {});
      const cookie = await f.signIn(till.cookie);
      const body = {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(f.v, held.partyId),
        expectedEdit: await inTx(f.v, (tx) => readBillEditState(tx, held.tabId)),
        lineId: line!.id,
        lineNos: [line!.lineNo],
        allergy: {
          party: {
            answer: "allergies",
            guests: [{ who: "Alex", allergens: { milk: {} }, note: null }],
          },
          ticks: [{ line: { kind: "working", id: line!.id }, guestIndex: 0 }],
        },
      };
      const url =
        path === "group"
          ? `/api/parties/${held.partyId}/groups/${held.groupId}/fire`
          : path === "held-line"
            ? `/api/parties/${held.partyId}/groups/fire-line`
            : `/api/working-orders/${held.tabId}/lines/send`;
      const fired = await send(f.app, cookie, url, body);
      expect(fired.status).toBe(200);
      const snapshot = await inTx(f.v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, held.partyId));
      expect(snapshot.answer).toBe("allergies");
      expect(snapshot.ticks.map((tick) => tick.workingLineId)).toEqual([line!.id]);
      expect(await revisionOf(f.v, held.partyId)).toBe(body.expectedPartyRevision + 1);
      const after = await itemsOf(held.tabId);
      expect((await send(f.app, cookie, url, body)).status).toBe(200);
      expect(await itemsOf(held.tabId)).toEqual(after);
      expect(await revisionOf(f.v, held.partyId)).toBe(body.expectedPartyRevision + 1);
    });
  }
});

async function fireAsWaiter(
  f: Awaited<ReturnType<typeof fixture>>,
  held: { partyId: string; groupId: string },
) {
  const answer = await send(
    f.app,
    await tillCookie(f),
    `/api/parties/${held.partyId}/groups/${held.groupId}/fire`,
    {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    },
  );
  expect(answer.status).toBe(200);
}

const readyPaths = (
  held: { tabId: string; partyId: string; groupId: string },
  courseId: string,
) => [coursePath(held.tabId, courseId, "ready"), groupPath(held.partyId, held.groupId, "ready")];

describe("a kitchen display's retained Ready actions", () => {
  it("readies an actually released course while leaving a held course unchanged", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const before = await itemsOf(held.tabId);
    expect(
      (await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "ready"))).status,
    ).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual(before);
    await fireAsWaiter(f, held);
    expect(
      (await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "ready"))).status,
    ).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual([
      expect.objectContaining({ state: "ready", firedAt: expect.any(String), awayAt: null }),
    ]);
  });

  it("readies the counter's released course on a pass limited to the counter zone", async () => {
    const f = await fixture();
    const display = await f.device("Counter pass", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.counter.zoneId] },
    });
    const counter = await counterOrder(f.v, "Burger");
    const placed = await f.app.request(`/api/working-orders/${counter}/place`, {
      method: "POST",
      headers: { cookie: await tillCookie(f) },
    });
    expect(placed.status).toBe(200);
    expect((await itemsOf(counter)).every((item) => item.firedAt !== null)).toBe(true);
    expect((await send(f.app, display.cookie, coursePath(counter, f.mains, "ready"))).status).toBe(
      200,
    );
    expect(await itemsOf(counter)).toEqual([
      expect.objectContaining({ state: "ready", firedAt: expect.any(String), awayAt: null }),
    ]);
  });

  it("readies a group, replays the same command and refuses another device's reuse", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    await fireAsWaiter(f, held);
    const body = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    };
    const path = groupPath(held.partyId, held.groupId, "ready");
    const first = await send(f.app, f.pass.cookie, path, body);
    expect(first.status).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual([
      expect.objectContaining({ state: "ready", awayAt: null }),
    ]);
    const revision = await revisionOf(f.v, held.partyId);
    expect(await send(f.app, f.pass.cookie, path, body)).toEqual(first);
    expect(await revisionOf(f.v, held.partyId)).toBe(revision);
    const other = await f.device("Other pass", f.runner, { kitchenScreen: EVERY_PASS });
    const reused = await send(f.app, other.cookie, path, body);
    expect({ status: reused.status, code: reused.body.error?.code }).toEqual({
      status: 409,
      code: "submission.id_reused",
    });
    expect(await revisionOf(f.v, held.partyId)).toBe(revision);
  });

  it("requires prepare-orders for both Ready routes", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const display = await f.device(
      "No preparation",
      await f.profile("kds", ["take-orders", "hand-over-orders"]),
      { kitchenScreen: EVERY_PASS },
    );
    const before = await itemsOf(held.tabId);
    for (const path of readyPaths(held, f.mains)) {
      const answer = await send(f.app, display.cookie, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(f.v, held.partyId),
      });
      expect({ status: answer.status, error: answer.body.error }).toEqual({
        status: 403,
        error: { code: "device.forbidden_action", params: { action: "prepare-orders" } },
      });
    }
    expect(await itemsOf(held.tabId)).toEqual(before);
  });

  it("refuses a till cookie on both device Ready routes, with or without a session", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const till = await f.device("Till", await f.profile("till", RUNS_THE_PASS), {
      kitchenScreen: EVERY_PASS,
    });
    for (const cookie of [till.cookie, await f.signIn(till.cookie)]) {
      for (const path of readyPaths(held, f.mains)) {
        const answer = await send(f.app, cookie, path, {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(f.v, held.partyId),
        });
        expect({ status: answer.status, code: answer.body.error?.code }).toEqual({
          status: 401,
          code: "device.unauthorized",
        });
      }
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("requires an effective pass screen for Ready, excluding station and monitor screens", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const grill = await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Grill" }));
    for (const choice of [
      { stationId: grill.id },
      { kitchenScreen: { kind: "pass_monitor" as const, stationIds: null, zoneIds: null } },
    ]) {
      const display = await f.device(`Other screen ${randomUUID()}`, f.runner, choice);
      for (const path of readyPaths(held, f.mains)) {
        const answer = await send(f.app, display.cookie, path, {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(f.v, held.partyId),
        });
        expect({ status: answer.status, error: answer.body.error }).toEqual({
          status: 400,
          error: { code: "kitchen_screen.not_allowed", params: { screen: "pass" } },
        });
      }
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("refuses both Ready routes outside the pass's zones", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const display = await f.device("Counter pass", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.counter.zoneId] },
    });
    for (const path of readyPaths(held, f.mains)) {
      const answer = await send(f.app, display.cookie, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(f.v, held.partyId),
      });
      expect({ status: answer.status, error: answer.body.error }).toEqual({
        status: 403,
        error: { code: "kitchen_screen.zone_not_allowed", params: { zoneId: f.v.tables.zoneId } },
      });
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("requires every-zone scope for an order with no zone", async () => {
    const f = await fixture();
    const [order] = await suite.db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        deviceId: null,
        locationId: f.v.cfg.locationId,
        nodeId: f.v.cfg.nodeId,
        orderNumber: 999001,
        status: "open",
      })
      .returning({ id: workingOrders.id });
    const display = await f.device("Table pass", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.tables.zoneId] },
    });
    const path = coursePath(order!.id, f.mains, "ready");
    const refused = await send(f.app, display.cookie, path);
    expect({ status: refused.status, error: refused.body.error }).toEqual({
      status: 403,
      error: { code: "kitchen_screen.zone_not_allowed", params: { zoneId: null } },
    });
    expect((await send(f.app, f.pass.cookie, path)).status).toBe(200);
  });

  it("keeps Ready's missing-id, malformed-id and command checks", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const command = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    };
    for (const [path, body, status, code] of [
      [coursePath(randomUUID(), f.mains, "ready"), {}, 404, "working_order.not_found"],
      [coursePath("nope", f.mains, "ready"), {}, 404, "working_order.not_found"],
      [coursePath(held.tabId, "nope", "ready"), {}, 404, "course.not_found"],
      [groupPath(randomUUID(), randomUUID(), "ready"), command, 409, "party.not_open"],
      [groupPath(held.partyId, randomUUID(), "ready"), command, 404, "group.not_found"],
      [groupPath("nope", held.groupId, "ready"), command, 409, "party.not_open"],
      [groupPath(held.partyId, "nope", "ready"), command, 404, "group.not_found"],
      [groupPath(held.partyId, held.groupId, "ready"), {}, 400, "management.request_invalid"],
    ] as const) {
      const answer = await send(f.app, f.pass.cookie, path, body);
      expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
        path,
        status,
        code,
      });
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("answers every till refusal code at the same status", () => {
    for (const [code, status] of Object.entries(TILL_STATUS))
      expect({ code, status: LEVER_STATUS[code] }).toEqual({ code, status });
  });
});

describe("a till's session Fire", () => {
  it("records the signed-in person on the group, event and current-order sender", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    await fireAsWaiter(f, held);
    expect(await groupRow(held.groupId)).toMatchObject({
      state: "fired",
      firedBy: f.ana,
      firedByDeviceId: null,
    });
    expect(await firedEvent(held.groupId)).toMatchObject({ actorId: f.ana, actorDeviceId: null });
    expect((await itemsOf(held.tabId)).every((item) => item.firedAt !== null)).toBe(true);
    const current = await f.app.request(`/api/parties/${held.partyId}/current-orders`, {
      headers: { cookie: await tillCookie(f) },
    });
    expect(current.status).toBe(200);
    const read = (await current.json()) as { groups: { id: string; sentBy: string | null }[] };
    expect(read.groups.find((group) => group.id === held.groupId)?.sentBy).toBe("Ana");
  });
});

/** A till's device cookie; signing it in gives a session. */
async function tillCookie(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const till = await f.device(`Till ${randomUUID()}`, await f.profile("till", RUNS_THE_PASS), {});
  return f.signIn(till.cookie);
}
