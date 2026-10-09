import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  orderGroupEvents,
  orderGroups,
  products,
  ticketItems,
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
import { enrolDeviceForTest } from "./testing/enrol.js";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { placeGroups } from "./order-groups.js";
import {
  OPERATOR,
  counterOrder,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
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

async function label(deviceId: string) {
  const [row] = await suite.db
    .select({ label: devices.label })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return row!.label;
}

describe("a kitchen display's pass fires as the device", () => {
  it("fires a course, recording the device on its group and its event, and shows the device as the sender", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const fired = await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "fire"));
    expect(fired.status).toBe(200);
    expect(await groupRow(held.groupId)).toMatchObject({
      state: "fired",
      firedBy: null,
      firedByDeviceId: f.pass.id,
    });
    expect(await firedEvent(held.groupId)).toMatchObject({
      actorId: null,
      actorDeviceId: f.pass.id,
    });
    expect((await itemsOf(held.tabId)).every((item) => item.firedAt !== null)).toBe(true);
    const current = await f.app.request(`/api/parties/${held.partyId}/current-orders`, {
      headers: { cookie: await tillCookie(f) },
    });
    expect(current.status).toBe(200);
    const read = (await current.json()) as { groups: { id: string; sentBy: string | null }[] };
    expect(read.groups.find((group) => group.id === held.groupId)?.sentBy).toBe(
      await label(f.pass.id),
    );
  });

  it("fires a group with the session route's body, recording the device", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const fired = await send(f.app, f.pass.cookie, groupPath(held.partyId, held.groupId, "fire"), {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    });
    expect(fired.status).toBe(200);
    expect(fired.body).toEqual({ revision: await revisionOf(f.v, held.partyId) });
    expect(await groupRow(held.groupId)).toMatchObject({
      state: "fired",
      firedBy: null,
      firedByDeviceId: f.pass.id,
    });
    expect(await firedEvent(held.groupId)).toMatchObject({
      actorId: null,
      actorDeviceId: f.pass.id,
    });
  });

  it("moves a course's dishes to ready and away, as the session routes do", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    expect((await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "fire"))).status).toBe(
      200,
    );
    expect(
      (await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "ready"))).status,
    ).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual([
      expect.objectContaining({ state: "ready", awayAt: null }),
    ]);
    expect((await send(f.app, f.pass.cookie, coursePath(held.tabId, f.mains, "away"))).status).toBe(
      200,
    );
    expect(await itemsOf(held.tabId)).toEqual([
      expect.objectContaining({ state: "ready", awayAt: expect.any(String) }),
    ]);
  });

  it("moves a group's dishes to ready and away, replays a retried Ready, and refuses its id from another device", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const command = async () => ({
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    });
    expect(
      (
        await send(
          f.app,
          f.pass.cookie,
          groupPath(held.partyId, held.groupId, "fire"),
          await command(),
        )
      ).status,
    ).toBe(200);
    const ready = await command();
    const first = await send(
      f.app,
      f.pass.cookie,
      groupPath(held.partyId, held.groupId, "ready"),
      ready,
    );
    expect(first.status).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual([expect.objectContaining({ state: "ready" })]);
    const revision = await revisionOf(f.v, held.partyId);
    const retried = await send(
      f.app,
      f.pass.cookie,
      groupPath(held.partyId, held.groupId, "ready"),
      ready,
    );
    expect(retried).toEqual(first);
    expect(await revisionOf(f.v, held.partyId)).toBe(revision);
    const other = await f.device("Pase 2", f.runner, { kitchenScreen: EVERY_PASS });
    const reused = await send(
      f.app,
      other.cookie,
      groupPath(held.partyId, held.groupId, "ready"),
      ready,
    );
    expect({ status: reused.status, code: reused.body.error?.code }).toEqual({
      status: 409,
      code: "submission.id_reused",
    });
    expect(
      (
        await send(
          f.app,
          f.pass.cookie,
          groupPath(held.partyId, held.groupId, "away"),
          await command(),
        )
      ).status,
    ).toBe(200);
    expect(await itemsOf(held.tabId)).toEqual([
      expect.objectContaining({ state: "ready", awayAt: expect.any(String) }),
    ]);
  });
});

describe("what a kitchen display's lever refuses", () => {
  it("refuses each lever without its profile action", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    for (const [verb, action] of [
      ["fire", "take-orders"],
      ["ready", "prepare-orders"],
      ["away", "hand-over-orders"],
    ] as const) {
      const lacking = await f.profile(
        "kds",
        RUNS_THE_PASS.filter((flag) => flag !== action),
      );
      const display = await f.device(`Pase ${verb}`, lacking, { kitchenScreen: EVERY_PASS });
      for (const path of [
        coursePath(held.tabId, f.mains, verb),
        groupPath(held.partyId, held.groupId, verb),
      ]) {
        const answer = await send(f.app, display.cookie, path, {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(f.v, held.partyId),
        });
        expect({ path, status: answer.status, error: answer.body.error }).toEqual({
          path,
          status: 403,
          error: { code: "device.forbidden_action", params: { action } },
        });
      }
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("refuses a till's cookie on every lever, even with a pass screen and a session", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const till = await f.device("Caja", await f.profile("till", RUNS_THE_PASS), {
      kitchenScreen: EVERY_PASS,
    });
    const signedIn = await f.signIn(till.cookie);
    for (const verb of ["fire", "ready", "away"]) {
      for (const path of [
        coursePath(held.tabId, f.mains, verb),
        groupPath(held.partyId, held.groupId, verb),
      ]) {
        for (const cookie of [till.cookie, signedIn]) {
          const answer = await send(f.app, cookie, path, {
            submissionId: randomUUID(),
            expectedPartyRevision: await revisionOf(f.v, held.partyId),
          });
          expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
            path,
            status: 401,
            code: "device.unauthorized",
          });
        }
      }
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("refuses a kitchen display running a station screen", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const grill = await inTx(f.v, (tx) => createStation(tx, f.v.cfg, { name: "Grill" }));
    const station = await f.device("Grill screen", f.runner, { stationId: grill.id });
    for (const path of [
      coursePath(held.tabId, f.mains, "fire"),
      groupPath(held.partyId, held.groupId, "fire"),
    ]) {
      const answer = await send(f.app, station.cookie, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(f.v, held.partyId),
      });
      expect({ path, status: answer.status, error: answer.body.error }).toEqual({
        path,
        status: 403,
        error: { code: "kitchen_screen.not_allowed", params: { screen: "pass" } },
      });
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("refuses an order or a party in a zone outside the pass's zones", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const counterPass = await f.device("Pase barra", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.counter.zoneId] },
    });
    for (const path of [
      coursePath(held.tabId, f.mains, "fire"),
      groupPath(held.partyId, held.groupId, "fire"),
      coursePath(held.tabId, f.mains, "ready"),
      groupPath(held.partyId, held.groupId, "away"),
    ]) {
      const answer = await send(f.app, counterPass.cookie, path, {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(f.v, held.partyId),
      });
      expect({ path, status: answer.status, error: answer.body.error }).toEqual({
        path,
        status: 403,
        error: {
          code: "kitchen_screen.zone_not_allowed",
          params: { zoneId: f.v.tables.zoneId },
        },
      });
    }
    expect((await groupRow(held.groupId)).state).toBe("held");

    const tablesPass = await f.device("Pase sala", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.tables.zoneId] },
    });
    const counter = await counterOrder(f.v, "Burger");
    const refused = await send(f.app, tablesPass.cookie, coursePath(counter, f.mains, "fire"));
    expect({ status: refused.status, error: refused.body.error }).toEqual({
      status: 403,
      error: {
        code: "kitchen_screen.zone_not_allowed",
        params: { zoneId: f.v.counter.zoneId },
      },
    });
    expect(
      (await send(f.app, tablesPass.cookie, coursePath(held.tabId, f.mains, "fire"))).status,
    ).toBe(200);
  });

  it("refuses an order in no zone on an explicit zone list, and an every-zone pass serves it and a counter order", async () => {
    const f = await fixture();
    const [zoneless] = await suite.db
      .insert(workingOrders)
      .values({
        source: "dashboard",
        deviceId: null,
        locationId: f.v.cfg.locationId,
        nodeId: f.v.cfg.nodeId,
        orderNumber: 999_001,
        status: "open",
      })
      .returning({ id: workingOrders.id });
    const tablesPass = await f.device("Pase sala", f.runner, {
      kitchenScreen: { kind: "pass", stationIds: null, zoneIds: [f.v.tables.zoneId] },
    });
    const refused = await send(
      f.app,
      tablesPass.cookie,
      coursePath(zoneless!.id, f.mains, "ready"),
    );
    expect({ status: refused.status, error: refused.body.error }).toEqual({
      status: 403,
      error: { code: "kitchen_screen.zone_not_allowed", params: { zoneId: null } },
    });
    expect(
      (await send(f.app, f.pass.cookie, coursePath(zoneless!.id, f.mains, "ready"))).status,
    ).toBe(200);

    const counter = await counterOrder(f.v, "Caña", "Burger");
    const placed = await f.app.request(`/api/working-orders/${counter}/place`, {
      method: "POST",
      headers: { cookie: await tillCookie(f) },
    });
    expect(placed.status).toBe(200);
    expect((await itemsOf(counter)).filter((item) => item.firedAt === null)).toHaveLength(1);
    expect((await send(f.app, f.pass.cookie, coursePath(counter, f.mains, "fire"))).status).toBe(
      200,
    );
    expect((await itemsOf(counter)).every((item) => item.firedAt !== null)).toBe(true);
  });

  it("answers an unknown order or party as the session routes do", async () => {
    const f = await fixture();
    const unknownOrder = await send(
      f.app,
      f.pass.cookie,
      coursePath(randomUUID(), f.mains, "fire"),
    );
    expect({ status: unknownOrder.status, code: unknownOrder.body.error?.code }).toEqual({
      status: 404,
      code: "working_order.not_found",
    });
    const unknownParty = await send(
      f.app,
      f.pass.cookie,
      groupPath(randomUUID(), randomUUID(), "fire"),
      {
        submissionId: randomUUID(),
        expectedPartyRevision: 0,
      },
    );
    expect({ status: unknownParty.status, code: unknownParty.body.error?.code }).toEqual({
      status: 409,
      code: "party.not_open",
    });
    const held = await f.heldBurger();
    const command = { submissionId: randomUUID(), expectedPartyRevision: 0 };
    for (const [path, body, status, code] of [
      [coursePath("nope", f.mains, "fire"), {}, 404, "working_order.not_found"],
      [coursePath(held.tabId, "nope", "fire"), {}, 404, "course.not_found"],
      [groupPath("nope", held.groupId, "fire"), command, 409, "party.not_open"],
      [groupPath(held.partyId, "nope", "fire"), command, 404, "group.not_found"],
      [
        groupPath(held.partyId, held.groupId, "fire"),
        { submissionId: randomUUID() },
        400,
        "management.request_invalid",
      ],
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
  it("refuses a Fire holding a sold-out dish with the till's status, firing nothing", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    await suite.db
      .update(products)
      .set({ available: false })
      .where(eq(products.id, f.v.productId("Burger")));
    const command = async () => ({
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(f.v, held.partyId),
    });
    const till = await tillCookie(f);
    for (const [cookie, path, body] of [
      [f.pass.cookie, coursePath(held.tabId, f.mains, "fire"), {}],
      [f.pass.cookie, groupPath(held.partyId, held.groupId, "fire"), await command()],
      [till, `/api/orders/${held.tabId}/courses/${f.mains}/fire`, {}],
      [till, `/api/parties/${held.partyId}/groups/${held.groupId}/fire`, await command()],
    ] as const) {
      const answer = await send(f.app, cookie, path, body);
      expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
        path,
        status: 409,
        code: "product.unavailable",
      });
    }
    expect((await groupRow(held.groupId)).state).toBe("held");
  });

  it("answers every code the till's session routes answer at the till's status", () => {
    for (const [code, status] of Object.entries(TILL_STATUS)) {
      expect({ code, status: LEVER_STATUS[code] }).toEqual({ code, status });
    }
  });
});

describe("a till's session Fire", () => {
  it("still records the signed-in person", async () => {
    const f = await fixture();
    const held = await f.heldBurger();
    const cookie = await tillCookie(f);
    const fired = await f.app.request(`/api/orders/${held.tabId}/courses/${f.mains}/fire`, {
      method: "POST",
      headers: { cookie },
    });
    expect(fired.status).toBe(200);
    expect(await groupRow(held.groupId)).toMatchObject({
      firedBy: f.ana,
      firedByDeviceId: null,
    });
    expect(await firedEvent(held.groupId)).toMatchObject({ actorId: f.ana, actorDeviceId: null });
  });
});

/** A till's device cookie; signing it in gives a session. */
async function tillCookie(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const till = await f.device(`Caja ${randomUUID()}`, await f.profile("till", RUNS_THE_PASS), {});
  return f.signIn(till.cookie);
}
