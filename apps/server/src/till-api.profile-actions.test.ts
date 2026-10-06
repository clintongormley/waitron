import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { deviceProfiles, devices, kitchenStations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ADJUSTMENT_ACTIONS } from "@waitron/adjustments";
import { hashPin, persons, type PersonRoleValue } from "@waitron/identity";
import {
  CAPABILITY_FLAGS,
  type CapabilityFlag,
  type FormFactor,
  type ProfileAction,
} from "@waitron/layouts";
import { SimulatorPaymentProvider } from "@waitron/payments";
import {
  createDepartment,
  createServiceZone,
  setProfileServiceAccess,
  zoneServicePolicies,
} from "@waitron/venue-service";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import type { Logger } from "./logger.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountTillApi } from "./till-api.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import {
  counterOrder,
  order,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

/*
 * Route-to-action map. Each row is the profile action a till or kitchen-display route needs, besides
 * whatever person permission it already checked; a refusal is `device.forbidden_action` naming the
 * `action` shown (cash is `device.cash_not_allowed`). The case that fails without each gate is the
 * row's own `refuses <METHOD> <path> ...` case in ROUTES below, or for refunds in "a refund checks
 * the action its payment was taken with".
 *
 * | Route                                                     | Action                     | `action` param        |
 * | --------------------------------------------------------- | -------------------------- | --------------------- |
 * | POST /api/sales (tender checked first)                    | take-cash / hand-keyed-card-payment, then take-orders | (cash code) / hand-keyed-card-payment, take-orders |
 * | POST /api/pay                                             | integrated-card-payment, then take-orders | pay, take-orders |
 * | POST /api/working-orders                                  | take-orders                | take-orders           |
 * | PUT, DELETE /api/working-orders/:id                       | take-orders                | take-orders           |
 * | PUT /api/working-orders/:id/invoice-choice                | take-orders                | take-orders           |
 * | POST /api/working-orders/:id/place, /prep                 | take-orders                | take-orders           |
 * | POST /api/working-orders/:id/cancel                       | take-orders                | take-orders           |
 * | PUT /api/working-orders/:id/make-at                       | take-orders                | take-orders           |
 * | POST /api/working-orders/:id/lines/move-station, /send, /recall | take-orders          | take-orders           |
 * | PUT /api/working-orders/:id/lines/:lineNo                 | take-orders                | take-orders           |
 * | PATCH /api/working-orders/:id/lines/:lineNo/course        | take-orders                | take-orders           |
 * | POST /api/working-orders/:id/adjustments                  | take-orders                | take-orders           |
 * | POST /api/working-orders/:id/collect, tender cash / card  | take-cash / hand-keyed-card-payment | (cash code) / hand-keyed-card-payment |
 * | POST /api/working-orders/:id/payments, cash / manual card / reader | take-cash / hand-keyed-card-payment / integrated-card-payment | (cash code) / hand-keyed-card-payment / pay |
 * | POST /api/working-orders/:id/payments/:paymentId/refunds, by how the payment was taken | take-cash / hand-keyed-card-payment / integrated-card-payment | (cash code) / hand-keyed-card-payment / pay |
 * | POST /api/orders/:id/courses/:courseId/fire               | take-orders                | take-orders           |
 * | POST /api/orders/:id/courses/:courseId/ready              | prepare-orders             | prepare-orders        |
 * | POST /api/orders/:id/courses/:courseId/away               | hand-over-orders           | hand-over-orders      |
 * | POST /api/orders/:id/collect                              | hand-over-orders           | hand-over-orders      |
 * | POST /api/orders/:id/reprint (kitchen tickets)            | take-orders                | take-orders           |
 * | POST /api/ticket-items/:id/advance                        | prepare-orders             | prepare-orders        |
 * | POST /api/orders/:id/stations/:sid/advance                | prepare-orders             | prepare-orders        |
 * | POST /api/kitchen-notices/:id/acknowledge                 | prepare-orders             | prepare-orders        |
 * | POST /api/sales/:id/receipt/retry                         | print-receipt              | receipt_retry         |
 * | POST /api/sales/:id/receipt, /payment-slip                | print-receipt              | receipt, payment-slip |
 * | POST /api/sales/:id/reprint                               | print-receipt              | reprint               |
 * | POST /api/drawer/open                                     | open-cash-drawer           | drawer_open           |
 * | POST /api/tables/:id/seat                                 | take-orders                | take-orders           |
 * | POST /api/parties/:id/finish, /bill-request, /move, /join, /split-table | take-orders  | take-orders           |
 * | PUT /api/parties/:id/name                                 | take-orders                | take-orders           |
 * | POST /api/parties/:id/groups, /groups/move; PUT /groups/order | take-orders            | take-orders           |
 * | POST /api/parties/:id/groups/:gid/fire, /snooze, /unsnooze | take-orders               | take-orders           |
 * | POST /api/parties/:id/groups/:gid/ready                   | prepare-orders             | prepare-orders        |
 * | POST /api/parties/:id/groups/:gid/away, /served           | hand-over-orders           | hand-over-orders      |
 * | POST /api/parties/:id/served, /unserved                   | hand-over-orders           | hand-over-orders      |
 * | PUT /api/parties/:id/drafts; POST /drafts/:did/take-over, /submit | take-orders        | take-orders           |
 * | POST /api/parties/:id/unpaid-departure                    | take-orders                | take-orders           |
 * | POST /api/bills/:id/split, /merge, /transfer, /move       | take-orders                | take-orders           |
 * | POST /api/device/ticket-items/:id/advance (display)       | prepare-orders             | prepare-orders        |
 * | POST /api/device/kitchen-notices/:id/acknowledge (display)| prepare-orders             | prepare-orders        |
 *
 * A management reprint (`POST /management-api/orders/:id/reprint`) checks `print-receipt` on the
 * device cookie it carries, if any (`orders-reprint.test.ts`).
 *
 * Not action-gated, so a signed-in person (or, for a display's reads, the device) is enough: every
 * read, including the POST previews (`/payments/preview`, `/adjustments/preview`) and the dead-end
 * checks (`/api/dead-ends/*`); the session, locale, schedule, profile-switch and device-printer
 * routes; and table placement, which needs `venue.configure`. Left ungated by decision, each with
 * its reason:
 * - the watcher "done" marks: each is the watcher's own record of what it has seen, not preparing
 *   or handing over. `/api/device/watcher/done` is made by the watcher's own display, which is
 *   allowed only `prepare-orders`; `/api/watchers/:id/done` by a person signed in on a till that
 *   shows the watcher, so the session is its only check;
 * - the table status and cleared marks, and `/api/sales/:id/receipt/handover` (a printed receipt
 *   handed over): none is an ordering, payment or drawer write;
 * - `/api/demo-reader/cancel`: mounted only when the card provider is the simulator.
 *
 * A shared display (`kds`) may only prepare, whatever its stored list says (`profileAllows`); on its
 * own cookie, with nobody signed in, every till route answers `session.required`.
 */

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

const noopLog: Logger = () => {};

let v: PartyVenue;
let app: Hono;
let stationId: string;
const people: Partial<Record<PersonRoleValue, string>> = {};

async function person(role: PersonRoleValue): Promise<string> {
  const known = people[role];
  if (known !== undefined) return known;
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: `${role} ${randomUUID()}`, pinHash: hashPin("5555"), role })
    .returning({ id: persons.id });
  people[role] = row!.id;
  return row!.id;
}

async function profile(capabilities: readonly string[], formFactor: FormFactor = "till") {
  const [row] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Profile ${randomUUID()}`, formFactor, capabilities: [...capabilities] })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** The session cookie of `role` signed in on a till whose profile lists `capabilities`, and the
 * device's id. */
async function signIn(
  capabilities: readonly string[],
  role: PersonRoleValue = "admin",
): Promise<{ cookie: string; deviceId: string }> {
  return signInOn(await profile(capabilities), role);
}

async function signInOn(
  profileId: string,
  role: PersonRoleValue = "admin",
): Promise<{ cookie: string; deviceId: string }> {
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Till ${randomUUID()}`,
    profileId,
  });
  const login = await app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
    body: JSON.stringify({ personId: await person(role), pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return { cookie: login.headers.get("set-cookie")!.split(";")[0]!, deviceId: device.deviceId };
}

/** A kitchen display bound to the station, whose profile lists `capabilities`. */
async function display(capabilities: readonly string[]): Promise<string> {
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Display ${randomUUID()}`,
    profileId: await profile(capabilities, "kds"),
    stationId,
  });
  return `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
}

const allBut = (flag: CapabilityFlag) => CAPABILITY_FLAGS.filter((f) => f !== flag);

async function send(cookie: string, method: string, path: string, body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === "" ? {} : JSON.parse(text)) as {
      error?: { code: string; params?: unknown };
    } & Record<string, unknown>,
  };
}

const forbidden = (action: string) => ({
  status: 403,
  error: { code: "device.forbidden_action", params: { action } },
});

const id = randomUUID();
const card = { method: "card", amount: "1.00" };
const cash = { method: "cash", amount: "1.00" };
const billPayment = (method: "cash" | "card", entry?: "manual" | "reader") => ({
  kind: "contribution",
  method,
  ...(entry === undefined ? {} : { entry }),
  amount: "1.00",
  ...(method === "cash" ? { tendered: "1.00" } : {}),
  submissionId: randomUUID(),
  applied: "1.00",
  tip: "0.00",
});

type Row = readonly [
  method: string,
  path: string,
  /** The flag the session's profile lacks; it lists every other one. */
  lacking: ProfileAction,
  expected: { status: number; error: { code: string; params: unknown } },
  body?: unknown,
];

const ordering = (method: string, path: string): Row => [
  method,
  path,
  "take-orders",
  forbidden("take-orders"),
  method === "DELETE" ? undefined : {},
];
const preparing = (method: string, path: string): Row => [
  method,
  path,
  "prepare-orders",
  forbidden("prepare-orders"),
  {},
];
const handingOver = (method: string, path: string): Row => [
  method,
  path,
  "hand-over-orders",
  forbidden("hand-over-orders"),
  {},
];

const ROUTES: readonly Row[] = [
  ["POST", "/api/sales", "take-orders", forbidden("take-orders"), { lines: [] }],
  [
    "POST",
    "/api/sales",
    "take-cash",
    { status: 403, error: { code: "device.cash_not_allowed", params: {} } },
    { lines: [], tender: cash },
  ],
  [
    "POST",
    "/api/sales",
    "hand-keyed-card-payment",
    forbidden("hand-keyed-card-payment"),
    { lines: [], tender: card },
  ],
  ordering("POST", "/api/pay"),
  ["POST", "/api/pay", "integrated-card-payment", forbidden("pay"), {}],
  ordering("POST", "/api/working-orders"),
  ordering("PUT", `/api/working-orders/${id}`),
  ordering("DELETE", `/api/working-orders/${id}`),
  ordering("PUT", `/api/working-orders/${id}/invoice-choice`),
  ordering("POST", `/api/working-orders/${id}/place`),
  ordering("POST", `/api/working-orders/${id}/prep`),
  ordering("POST", `/api/working-orders/${id}/cancel`),
  ordering("PUT", `/api/working-orders/${id}/make-at`),
  ordering("POST", `/api/working-orders/${id}/lines/move-station`),
  ordering("PUT", `/api/working-orders/${id}/lines/1`),
  ordering("PATCH", `/api/working-orders/${id}/lines/1/course`),
  ordering("POST", `/api/working-orders/${id}/lines/send`),
  ordering("POST", `/api/working-orders/${id}/lines/recall`),
  [
    "POST",
    `/api/working-orders/${id}/adjustments`,
    "take-orders",
    forbidden("take-orders"),
    {
      submissionId: randomUUID(),
      expectedRevision: 0,
      action: ADJUSTMENT_ACTIONS[0],
      lineId: null,
      reasonId: randomUUID(),
    },
  ],
  [
    "POST",
    `/api/working-orders/${id}/collect`,
    "take-cash",
    { status: 403, error: { code: "device.cash_not_allowed", params: {} } },
    { tender: cash },
  ],
  [
    "POST",
    `/api/working-orders/${id}/collect`,
    "hand-keyed-card-payment",
    forbidden("hand-keyed-card-payment"),
    { tender: card },
  ],
  [
    "POST",
    `/api/working-orders/${id}/payments`,
    "take-cash",
    { status: 403, error: { code: "device.cash_not_allowed", params: {} } },
    billPayment("cash"),
  ],
  [
    "POST",
    `/api/working-orders/${id}/payments`,
    "hand-keyed-card-payment",
    forbidden("hand-keyed-card-payment"),
    billPayment("card", "manual"),
  ],
  [
    "POST",
    `/api/working-orders/${id}/payments`,
    "integrated-card-payment",
    forbidden("pay"),
    billPayment("card", "reader"),
  ],
  ordering("POST", `/api/orders/${id}/courses/${id}/fire`),
  preparing("POST", `/api/orders/${id}/courses/${id}/ready`),
  handingOver("POST", `/api/orders/${id}/courses/${id}/away`),
  handingOver("POST", `/api/orders/${id}/collect`),
  ordering("POST", `/api/orders/${id}/reprint`),
  preparing("POST", `/api/ticket-items/${id}/advance`),
  preparing("POST", `/api/orders/${id}/stations/${id}/advance`),
  preparing("POST", `/api/kitchen-notices/${id}/acknowledge`),
  ["POST", `/api/sales/${id}/receipt/retry`, "print-receipt", forbidden("receipt_retry"), {}],
  ["POST", `/api/sales/${id}/receipt`, "print-receipt", forbidden("receipt"), {}],
  ["POST", `/api/sales/${id}/payment-slip`, "print-receipt", forbidden("payment-slip"), {}],
  ["POST", `/api/sales/${id}/reprint`, "print-receipt", forbidden("reprint"), {}],
  ["POST", "/api/drawer/open", "open-cash-drawer", forbidden("drawer_open"), {}],
  ordering("POST", `/api/tables/${id}/seat`),
  ordering("POST", `/api/parties/${id}/finish`),
  ordering("POST", `/api/parties/${id}/bill-request`),
  ordering("PUT", `/api/parties/${id}/name`),
  ordering("POST", `/api/parties/${id}/move`),
  ordering("POST", `/api/parties/${id}/join`),
  ordering("POST", `/api/parties/${id}/split-table`),
  ordering("POST", `/api/parties/${id}/groups`),
  ordering("POST", `/api/parties/${id}/groups/move`),
  ordering("PUT", `/api/parties/${id}/groups/order`),
  ordering("POST", `/api/parties/${id}/groups/${id}/fire`),
  ordering("POST", `/api/parties/${id}/groups/${id}/snooze`),
  ordering("POST", `/api/parties/${id}/groups/${id}/unsnooze`),
  preparing("POST", `/api/parties/${id}/groups/${id}/ready`),
  handingOver("POST", `/api/parties/${id}/groups/${id}/away`),
  handingOver("POST", `/api/parties/${id}/groups/${id}/served`),
  handingOver("POST", `/api/parties/${id}/served`),
  handingOver("POST", `/api/parties/${id}/unserved`),
  ordering("PUT", `/api/parties/${id}/drafts`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/take-over`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/submit`),
  ordering("POST", `/api/parties/${id}/unpaid-departure`),
  ordering("POST", `/api/bills/${id}/split`),
  ordering("POST", `/api/bills/${id}/merge`),
  ordering("POST", `/api/bills/${id}/transfer`),
  ordering("POST", `/api/bills/${id}/move`),
];

const sessions = new Map<ProfileAction, string>();

beforeAll(async () => {
  v = await setupPartyVenue(suite.db);
  app = new Hono();
  mountTillApi(
    app,
    {
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      cardProvider: new SimulatorPaymentProvider(suite.db),
    },
    noopLog,
  );
  mountDeviceApi(
    app,
    { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    noopLog,
  );
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ locationId: v.cfg.locationId, name: `Grill ${randomUUID()}` })
    .returning({ id: kitchenStations.id });
  stationId = station!.id;
  for (const [, , lacking] of ROUTES) {
    if (!sessions.has(lacking)) sessions.set(lacking, (await signIn(allBut(lacking))).cookie);
  }
}, 120_000);

describe("each till route checks the profile action it needs", () => {
  for (const [method, path, lacking, expected, body] of ROUTES) {
    it(`refuses ${method} ${path.replaceAll(id, ":id")} without ${lacking}`, async () => {
      const answer = await send(sessions.get(lacking)!, method, path, body);
      expect({ status: answer.status, error: answer.body.error }).toEqual(expected);
    });
  }
});

describe("screens and actions are separate", () => {
  it("lets a visible, read-only live-orders profile look at the station and the pass, and refuses it preparing, handing over and payment", async () => {
    const { cookie } = await signIn(["show-station", "show-expo", "take-orders"]);
    expect((await send(cookie, "GET", `/api/stations/${stationId}/queue`)).status).toBe(200);
    expect((await send(cookie, "GET", "/api/expo/queue")).status).toBe(200);
    const advance = await send(cookie, "POST", `/api/ticket-items/${id}/advance`, {
      to: "ready",
    });
    expect(advance.body.error).toEqual(forbidden("prepare-orders").error);
    const collect = await send(cookie, "POST", `/api/orders/${id}/collect`, {});
    expect(collect.body.error).toEqual(forbidden("hand-over-orders").error);
    const pay = await send(cookie, "POST", "/api/sales", { lines: [], tender: cash });
    expect(pay.body.error?.code).toBe("device.cash_not_allowed");
  });

  it("refuses a direct request to an action whose screen is hidden, and serves a permitted neighbouring one", async () => {
    // No `show-station`, no `prepare-orders`: the till offers no station screen, and the route
    // behind it still refuses.
    const { cookie } = await signIn(["take-orders"]);
    const advance = await send(cookie, "POST", `/api/orders/${id}/stations/${stationId}/advance`, {
      to: "ready",
    });
    expect({ status: advance.status, error: advance.body.error }).toEqual(
      forbidden("prepare-orders"),
    );
    const park = await send(cookie, "POST", "/api/working-orders", {
      id: randomUUID(),
      lines: [{ menuItemId: v.counterItem("Caña"), quantity: "1" }],
    });
    expect(park.status).toBe(200);
  });

  it("lets a profile prepare without showing the station screen: a screen is not the permission", async () => {
    const { cookie } = await signIn(["prepare-orders"]);
    const advance = await send(cookie, "POST", `/api/orders/${id}/stations/${stationId}/advance`, {
      to: "ready",
    });
    expect(advance.status).toBe(200);
  });
});

describe("the order of a sale's refusals", () => {
  it("refuses a profile that takes no orders for that, before checking the zone it names", async () => {
    const deli = await withTransaction(suite.db, async (tx) => {
      const department = await createDepartment(tx, v.cfg, {
        name: `Deli ${randomUUID()}`,
        defaultServiceMode: "prepay",
      });
      return createServiceZone(tx, v.cfg, {
        name: `Deli ${randomUUID()}`,
        departmentId: department.id,
      });
    });
    const restaurantOnly = await profile(allBut("take-orders"));
    await withTransaction(suite.db, async (tx) => {
      const [policy] = await tx
        .select({ departmentId: zoneServicePolicies.departmentId })
        .from(zoneServicePolicies)
        .where(eq(zoneServicePolicies.zoneId, v.counter.zoneId));
      await setProfileServiceAccess(tx, v.cfg, restaurantOnly, {
        departmentId: policy!.departmentId,
        allowedZoneIds: null,
        startingZoneId: v.counter.zoneId,
        stationIds: [],
        watcherIds: [],
      });
    });
    const { cookie } = await signInOn(restaurantOnly);
    const sale = await send(cookie, "POST", "/api/sales", {
      lines: [{ menuItemId: v.counterItem("Caña"), quantity: "1" }],
      zoneId: deli.id,
    });
    expect({ status: sale.status, error: sale.body.error }).toEqual(forbidden("take-orders"));
  });
});

describe("the person's permission and the profile's action are both needed", () => {
  it("refuses a staff member the drawer on a profile that opens it, for want of cash.drawer", async () => {
    const { cookie } = await signIn(CAPABILITY_FLAGS, "staff");
    const open = await send(cookie, "POST", "/api/drawer/open", {});
    expect(open.status).toBe(403);
    expect(open.body.error?.code).toBe("authorization.not_permitted");
  });

  it("refuses an admin, who holds cash.drawer, the drawer on a profile that does not open it", async () => {
    const { cookie } = await signIn(allBut("open-cash-drawer"), "admin");
    const open = await send(cookie, "POST", "/api/drawer/open", {});
    expect({ status: open.status, error: open.body.error }).toEqual(forbidden("drawer_open"));
  });

  it("serves an action with no person permission to any signed-in staff member on a profile that permits it", async () => {
    const { cookie } = await signIn(["take-orders"], "staff");
    const park = await send(cookie, "POST", "/api/working-orders", {
      id: randomUUID(),
      lines: [{ menuItemId: v.counterItem("Caña"), quantity: "1" }],
    });
    expect(park.status).toBe(200);
  });

  it("refuses the same staff member the same order on a profile that does not take orders", async () => {
    const { cookie } = await signIn(allBut("take-orders"), "staff");
    const park = await send(cookie, "POST", "/api/working-orders", {
      id: randomUUID(),
      lines: [{ menuItemId: v.counterItem("Caña"), quantity: "1" }],
    });
    expect({ status: park.status, error: park.body.error }).toEqual(forbidden("take-orders"));
  });
});

describe("a shared kitchen display", () => {
  it("is refused ordering, payment and the drawer even when its stored list names them", async () => {
    const { cookie, deviceId } = await signIn(CAPABILITY_FLAGS);
    const kds = await profile(CAPABILITY_FLAGS, "kds");
    await suite.db
      .update(devices)
      .set({ deviceProfileId: kds, stationId })
      .where(eq(devices.id, deviceId));
    const park = await send(cookie, "POST", "/api/working-orders", { id: randomUUID(), lines: [] });
    expect(park.body.error).toEqual(forbidden("take-orders").error);
    const order = await counterOrder(v, "Caña");
    const collect = await send(cookie, "POST", `/api/working-orders/${order}/collect`, {
      tender: cash,
    });
    expect(collect.body.error?.code).toBe("device.cash_not_allowed");
    const pay = await send(cookie, "POST", "/api/pay", {});
    expect(pay.body.error).toEqual(forbidden("pay").error);
    const open = await send(cookie, "POST", "/api/drawer/open", {});
    expect(open.body.error).toEqual(forbidden("drawer_open").error);
    const advance = await send(cookie, "POST", `/api/orders/${id}/stations/${stationId}/advance`, {
      to: "ready",
    });
    expect(advance.status).toBe(200);
  });

  it("reaches no ordering, payment or drawer route on its own cookie, with nobody signed in", async () => {
    const cookie = await display(CAPABILITY_FLAGS);
    const order = await counterOrder(v, "Caña");
    for (const [path, body] of [
      ["/api/working-orders", { id: randomUUID(), lines: [] }],
      ["/api/sales", { lines: [], tender: cash }],
      ["/api/pay", {}],
      [`/api/working-orders/${order}/collect`, { tender: cash }],
      [`/api/working-orders/${order}/payments`, cash],
      ["/api/drawer/open", {}],
    ] as const) {
      const answer = await send(cookie, "POST", path, body);
      expect({ path, status: answer.status, code: answer.body.error?.code }).toEqual({
        path,
        status: 401,
        code: "session.required",
      });
    }
  });

  it("refuses preparing from a display whose profile does not prepare, on both display routes", async () => {
    const cookie = await display(["act-as-kds"]);
    for (const path of [
      `/api/device/ticket-items/${id}/advance`,
      `/api/device/kitchen-notices/${id}/acknowledge`,
    ]) {
      const answer = await send(cookie, "POST", path, { to: "ready" });
      expect({ path, status: answer.status, error: answer.body.error }).toEqual({
        path,
        ...forbidden("prepare-orders"),
      });
    }
  });

  it("lets a display that prepares reach the station's own refusal for an unknown item", async () => {
    const cookie = await display(["act-as-kds", "prepare-orders"]);
    const answer = await send(cookie, "POST", `/api/device/ticket-items/${id}/advance`, {
      to: "ready",
    });
    expect(answer.body.error?.code).toBe("ticket.invalid_transition");
  });
});

describe("the till's boot read", () => {
  it("names the active profile's starting screen, and none without a device", async () => {
    const [row] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `Pass ${randomUUID()}`,
        formFactor: "till",
        capabilities: ["show-expo", "take-orders"],
        startingScreen: "show-expo",
      })
      .returning({ id: deviceProfiles.id });
    const device = await enrolDeviceForTest(suite.db, v.cfg, {
      name: `Till ${randomUUID()}`,
      profileId: row!.id,
    });
    const boot = await send(
      `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
      "GET",
      "/api/till",
    );
    expect(boot.body.startingScreen).toBe("show-expo");
    const cookieless = await app.request("/api/till");
    expect(await cookieless.json()).not.toHaveProperty("startingScreen");
  });
});

describe("a refund checks the action its payment was taken with", () => {
  let bill: string;
  const paid: Partial<Record<"cash" | "manual" | "reader", string>> = {};

  beforeAll(async () => {
    const { cookie } = await signIn(CAPABILITY_FLAGS);
    const { tabId } = await seat(v, await v.table(`R ${randomUUID()}`));
    bill = tabId;
    await order(v, bill, "Paella", "Paella", "Paella");
    const take = async (body: Record<string, unknown>) => {
      const answer = await send(cookie, "POST", `/api/working-orders/${bill}/payments`, {
        kind: "contribution",
        amount: "1.00",
        submissionId: randomUUID(),
        applied: "1.00",
        tip: "0.00",
        ...body,
      });
      expect(answer.status).toBe(200);
      return (answer.body as { payment: { id: string } }).payment.id;
    };
    paid.cash = await take({ method: "cash", tendered: "1.00" });
    paid.manual = await take({ method: "card", entry: "manual" });
    paid.reader = await take({ method: "card", entry: "reader", simulationOutcome: "captured" });
  }, 120_000);

  for (const [kind, lacking, expected] of [
    ["cash", "take-cash", { status: 403, error: { code: "device.cash_not_allowed", params: {} } }],
    ["manual", "hand-keyed-card-payment", forbidden("hand-keyed-card-payment")],
    ["reader", "integrated-card-payment", forbidden("pay")],
  ] as const) {
    it(`refuses POST /api/working-orders/:id/payments/:paymentId/refunds of a ${kind} payment without ${lacking}`, async () => {
      const { cookie } = await signIn(allBut(lacking));
      const answer = await send(
        cookie,
        "POST",
        `/api/working-orders/${bill}/payments/${paid[kind]}/refunds`,
        {},
      );
      expect({ status: answer.status, error: answer.body.error }).toEqual(expected);
    });

    it(`reaches the refund's own checks for a ${kind} payment on a profile with ${lacking}`, async () => {
      const { cookie } = await signIn(CAPABILITY_FLAGS);
      const answer = await send(
        cookie,
        "POST",
        `/api/working-orders/${bill}/payments/${paid[kind]}/refunds`,
        {},
      );
      expect(answer.body.error?.code).toBe("management.request_invalid");
    });
  }
});
