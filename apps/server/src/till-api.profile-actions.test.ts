import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { readBillEditState } from "./bill-editing.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { devices, kitchenStations, withTransaction, floorZones } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ADJUSTMENT_ACTIONS } from "@waitron/adjustments";
import { hashPin, type PersonRoleValue } from "@waitron/identity";
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
} from "@waitron/venue-service";
import { mountDeviceLiveApi } from "./device-live-api.js";
import { LiveEvents } from "./live-api.js";
import { clockStartUp } from "./clock-start-up.js";
import { mountScheduleApi } from "./schedule-api.js";
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

// ROUTES executes action refusals; the inventory below classifies its remaining mounted routes.

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
  const [row] = await seedPersons(suite.db, {
    displayName: `${role} ${randomUUID()}`,
    pinHash: hashPin("5555"),
    role,
  });
  people[role] = row!.id;
  return row!.id;
}

async function profile(capabilities: readonly string[], formFactor: FormFactor = "till") {
  const [row] = await seedDeviceProfiles(suite.db, {
    name: `Profile ${randomUUID()}`,
    formFactor,
    capabilities: [...capabilities],
  });
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
  return {
    cookie: `${login.headers.get("set-cookie")!.split(";")[0]!}; ${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    deviceId: device.deviceId,
  };
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

/** A kitchen display running a pass on every station and zone, whose profile lists `capabilities`. */
async function passDisplay(capabilities: readonly string[]): Promise<string> {
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Pass ${randomUUID()}`,
    profileId: await profile(capabilities, "kds"),
    kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
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
  ordering("PUT", `/api/service-zones/${id}/options/${id}/labels/${id}/availability`),
  ordering("PUT", `/api/service-zones/${id}/products/${id}/availability`),
  ["GET", `/api/device/stations/${id}/today`, "prepare-orders", forbidden("prepare-orders")],
  preparing("PUT", `/api/device/stations/${id}/today`),
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
  ordering("PUT", `/api/working-orders/${id}/receipt-language`),
  ordering("PUT", `/api/working-orders/${id}/label`),
  ordering("POST", `/api/working-orders/${id}/place`),
  ordering("POST", `/api/working-orders/${id}/prep`),
  ordering("POST", `/api/working-orders/${id}/cancel`),
  ordering("PUT", `/api/working-orders/${id}/make-at`),
  ordering("POST", `/api/working-orders/${id}/lines/move-station`),
  ordering("PUT", `/api/working-orders/${id}/lines/1`),
  ordering("PATCH", `/api/working-orders/${id}/lines/1/course`),
  ordering("POST", `/api/working-orders/${id}/lines/send`),
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
  preparing("POST", `/api/orders/${id}/courses/${id}/ready`),
  handingOver("POST", `/api/orders/${id}/collect`),
  ordering("POST", `/api/orders/${id}/reprint`),
  preparing("POST", `/api/ticket-items/${id}/advance`),
  preparing("POST", `/api/orders/${id}/stations/${id}/advance`),
  preparing("POST", `/api/kitchen-notices/${id}/acknowledge`),
  ["POST", `/api/sales/${id}/receipt/retry`, "print-receipt", forbidden("receipt_retry"), {}],
  ["POST", `/api/sales/${id}/deliveries`, "print-receipt", forbidden("invoice_delivery"), {}],
  [
    "POST",
    `/api/sales/${id}/deliveries/${id}/to-receipt`,
    "print-receipt",
    forbidden("invoice_delivery_to_receipt"),
    {},
  ],
  [
    "POST",
    `/api/sales/${id}/deliveries/${id}/retry`,
    "print-receipt",
    forbidden("invoice_delivery_retry"),
    {},
  ],
  ["POST", `/api/sales/${id}/receipt`, "print-receipt", forbidden("receipt"), {}],
  ["POST", `/api/sales/${id}/payment-slip`, "print-receipt", forbidden("payment-slip"), {}],
  [
    "POST",
    `/api/working-orders/${id}/payments/${id}/slip-copy`,
    "print-receipt",
    forbidden("slip-copy"),
    {},
  ],
  ["POST", `/api/sales/${id}/reprint`, "print-receipt", forbidden("reprint"), {}],
  ["POST", "/api/drawer/open", "open-cash-drawer", forbidden("drawer_open"), {}],
  [
    "POST",
    `/api/working-orders/${id}/close-by-transfer`,
    "close-by-transfer",
    forbidden("close-by-transfer"),
    {},
  ],
  ordering("POST", `/api/tables/${id}/seat`),
  ordering("POST", `/api/tables/${id}/today/move`),
  ordering("POST", `/api/tables/${id}/today/rotate`),
  ordering("POST", `/api/tables/${id}/today/take-off`),
  ordering("POST", `/api/tables/${id}/today/put-back`),
  ordering("POST", `/api/tables/${id}/today/place`),
  ordering("POST", `/api/tables/${id}/today/seats`),
  ordering("POST", `/api/tables/${id}/today/back`),
  ordering("POST", `/api/tables/${id}/today/mark-moved`),
  ordering("POST", `/api/tables/${id}/today/leave-here`),
  ordering("POST", `/api/tables/${id}/today/merge`),
  ordering("POST", `/api/tables/${id}/today/split-off`),
  ordering("POST", `/api/tables/${id}/today/name`),
  ordering("POST", `/api/zones/${id}/today/reset`),
  ordering("POST", `/api/zones/${id}/today/update-layout`),
  ordering("POST", `/api/parties/${id}/finish`),
  ordering("POST", `/api/parties/${id}/bill-request`),
  ordering("POST", `/api/parties/${id}/service-steps/${id}/done`),
  ordering("PUT", `/api/parties/${id}/name`),
  ordering("POST", `/api/parties/${id}/bills`),
  ordering("PUT", `/api/bills/${id}/name`),
  ordering("PUT", `/api/parties/${id}/guests`),
  ordering("POST", `/api/parties/${id}/move`),
  ordering("POST", `/api/parties/${id}/join`),
  ordering("POST", `/api/parties/${id}/split-table`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/split`),
  ordering("POST", `/api/parties/${id}/groups`),
  ordering("POST", `/api/parties/${id}/groups/move`),
  ordering("POST", `/api/parties/${id}/groups/split-line`),
  ordering("POST", `/api/parties/${id}/groups/fire-line`),
  ordering("PUT", `/api/parties/${id}/groups/order`),
  ordering("POST", `/api/parties/${id}/groups/${id}/fire`),
  ordering("POST", `/api/parties/${id}/groups/${id}/snooze`),
  ordering("POST", `/api/parties/${id}/groups/${id}/unsnooze`),
  preparing("POST", `/api/parties/${id}/groups/${id}/ready`),
  handingOver("POST", `/api/parties/${id}/groups/${id}/served`),
  handingOver("POST", `/api/parties/${id}/served`),
  handingOver("POST", `/api/parties/${id}/unserved`),
  ordering("PUT", `/api/parties/${id}/drafts`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/take-over`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/submit`),
  ordering("POST", `/api/parties/${id}/drafts/${id}/discard`),
  ordering("POST", `/api/parties/${id}/unpaid-departure`),
  ordering("POST", `/api/bills/${id}/merge`),
  ordering("POST", `/api/bills/${id}/move-dishes`),
  ordering("POST", `/api/bills/${id}/move`),
];

const sessions = new Map<ProfileAction, string>();
const displayCookies = new Map<ProfileAction, string>();

beforeAll(async () => {
  v = await setupPartyVenue(suite.db);
  app = new Hono();
  mountTillApi(
    app,
    {
      admission: testTradingAdmission(),
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
    .values({ name: `Grill ${randomUUID()}` })
    .returning({ id: kitchenStations.id });
  stationId = station!.id;
  for (const [, path, lacking] of ROUTES) {
    if (path.startsWith("/api/device/")) {
      if (!displayCookies.has(lacking)) displayCookies.set(lacking, await display(allBut(lacking)));
    } else if (!sessions.has(lacking)) {
      sessions.set(lacking, (await signIn(allBut(lacking))).cookie);
    }
  }
}, 120_000);

type DeviceProof =
  | "matching request (source)"
  | "device cookie (source)"
  | "session device (source)"
  | "public"
  | "matching request (tested)";
type RouteGroup = {
  proof: DeviceProof;
  actions: readonly ProfileAction[];
  basis: string;
  routes: readonly string[];
};

// Action cases name their behavioral receipt; the inventory walk checks the declared device proof.
const EXTERNAL_ACTION_ROUTES: readonly RouteGroup[] = [
  {
    proof: "matching request (source)",
    actions: ["clock-in"],
    basis: 'till-clock-api.test.ts: "rejects a profile without clock-in on"',
    routes: [
      "GET /api/clock/state",
      "POST /api/clock/in",
      "POST /api/clock/out",
      "POST /api/clock/break-start",
      "POST /api/clock/break-end",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["clock-in"],
    basis:
      'till-attendance-api.test.ts: "rejects a profile without clock-in on"; till-hours-api.test.ts: "refuses changed profile admission without revealing hours"',
    routes: [
      "GET /api/attendance/inbox",
      "GET /api/attendance/hours",
      "GET /api/attendance/day",
      "GET /api/attendance/commands/:commandId",
      "GET /api/attendance/items/:itemId/approvers",
      "POST /api/attendance/commands",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["take-orders"],
    basis:
      'till-api.kitchen-note.test.ts: "refuses profiles without take-orders for %s reads and writes"',
    routes: [
      "GET /api/working-orders/:id/kitchen-note",
      "PUT /api/working-orders/:id/kitchen-note",
      "GET /api/parties/:id/kitchen-note",
      "PUT /api/parties/:id/kitchen-note",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["take-orders"],
    basis: 'till-api.allergy.test.ts: "checks device, profile action and admission for"',
    routes: [
      "GET /api/parties/:id/allergy",
      "PUT /api/parties/:id/allergy",
      "POST /api/parties/:id/allergy/send-preview",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["take-orders"],
    basis: 'till-api.allergy-move.test.ts: "preview checks current action authority"',
    routes: ["POST /api/bills/:id/move/allergy-preview"],
  },
  {
    proof: "matching request (source)",
    actions: ["take-orders"],
    basis:
      'line-cancel-api.test.ts: "requires take-orders for %s and permits it once restored" and "checks Counter take-orders, admission and zone for %s before acting"',
    routes: [
      "GET /api/parties/:id/lines/:lineId/cancellation",
      "POST /api/parties/:id/lines/:lineId/cancel-item",
      "GET /api/working-orders/:id/lines/:lineId/cancellation",
      "POST /api/working-orders/:id/lines/:lineId/cancel-item",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["take-orders"],
    basis:
      'department-transfer-api.test.ts: "refuses ${action} without the take-orders profile action"; reads are source-only',
    routes: [
      "GET /api/department-transfers/destinations",
      "GET /api/department-transfers/incoming",
      "GET /api/department-transfers/sent",
      "GET /api/department-transfers/:id",
      "GET /api/working-orders/:id/department-transfers",
      "POST /api/working-orders/:id/department-transfers",
      "POST /api/department-transfers/:id/accept",
      "POST /api/department-transfers/:id/decline",
      "POST /api/department-transfers/:id/withdraw",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["print-receipt"],
    basis:
      'transaction-receipt-api.test.ts: "GET needs a session but no print action; POST requires print-receipt"; tender-refund-receipt-api.test.ts: "GET needs no payment or print capability while POST requires print-receipt"',
    routes: [
      "POST /api/transactions/:saleId/reprint",
      "POST /api/tender-refunds/:refundId/reprint",
    ],
  },
  {
    proof: "matching request (source)",
    actions: ["take-cash", "hand-keyed-card-payment", "integrated-card-payment"],
    basis:
      'Conditional on original tender, not all three at once. Own "a refund checks the action its payment was taken with"; tender-refund-api.test.ts: "%s creation and retry require the tender\'s current capability"',
    routes: [
      "POST /api/working-orders/:id/payments/:paymentId/refunds",
      "POST /api/transactions/:saleId/refunds",
      "POST /api/tender-refunds/:refundId/retry",
    ],
  },
  {
    proof: "device cookie (source)",
    actions: ["prepare-orders"],
    basis:
      "Own \"refuses the display's\" cases; device-api.ts / device-levers.ts; display work, not a person's session",
    routes: [
      "POST /api/device/kitchen-notices/:id/acknowledge",
      "POST /api/device/ticket-items/:id/advance",
      "POST /api/device/orders/:id/courses/:courseId/ready",
      "POST /api/device/parties/:id/groups/:gid/ready",
    ],
  },
  {
    proof: "device cookie (source)",
    actions: ["take-orders"],
    basis:
      "device-api.test.ts; requireKitchenDisplay in device-api.ts; station-screen scope also applies",
    routes: ["POST /api/device/working-orders/:id/lines/move-station"],
  },
  {
    proof: "device cookie (source)",
    actions: ["prepare-orders"],
    basis:
      "device-api.pass.test.ts; releasePassItems also checks the run-the-pass screen flag. Outside a shared display, the request also needs a session matching that device.",
    routes: ["POST /api/device/pass-screen/release"],
  },
];

const ACTIONLESS_ROUTES: readonly RouteGroup[] = [
  {
    proof: "public",
    actions: [],
    basis:
      "Bootstrap/lock-screen information: no selling action. till-api.ts; device-api.ts development-only switcher.",
    routes: ["GET /api/till", "GET /api/staff", "GET /api/locales", "GET /api/dev/devices"],
  },
  {
    proof: "public",
    actions: [],
    basis:
      "Join bootstrap checks pairing window/rate limit; status checks a pending join token, not an enrolled device. device-api.test.ts.",
    routes: ["POST /api/device/join", "GET /api/device/join/status"],
  },
  {
    proof: "public",
    actions: [],
    basis:
      "Logout clears even a missing/invalid session cookie; no device proof or action. till-api.test.ts.",
    routes: ["DELETE /api/session"],
  },
  {
    proof: "device cookie (source)",
    actions: [],
    basis:
      "PIN sign-in proves the device and checks admission; no selling action. till-api.ts POST /api/session.",
    routes: ["POST /api/session"],
  },
  {
    proof: "device cookie (source)",
    actions: [],
    basis:
      "Device identity, equipment and screen reads/housekeeping are not cooking or selling. device-api.ts; station/pass reads additionally check their screen and signed-in person where required.",
    routes: [
      "GET /api/live/events",
      "GET /api/device/me",
      "GET /api/device/equipment",
      "GET /api/device/pass-board",
      "GET /api/device/pass-monitor-board",
      "GET /api/device/station-screen",
      "GET /api/device/stations",
      "PUT /api/device/battery",
      "PUT /api/device/kitchen-screen-display",
    ],
  },
  {
    proof: "session device (source)",
    actions: [],
    basis:
      "Session reads/authorizer lists and non-writing previews; not ordering, payment, printing or drawer actions. Handler source, not universal request-device qualification.",
    routes: [
      "GET /api/adjustment-approvers",
      "GET /api/adjustment-reasons",
      "GET /api/bills",
      "GET /api/bills/:workingOrderId",
      "GET /api/bills/lookup",
      "GET /api/cancel-credit-authorizers",
      "GET /api/default-service-zone/offers",
      "GET /api/drawer/authorizers",
      "GET /api/expo/board",
      "GET /api/find-bill/options",
      "GET /api/invoice-delivery-options",
      "GET /api/invoices/lookup",
      "GET /api/menu-state",
      "GET /api/orders/counter-waiting",
      "GET /api/parties/:id/bills",
      "GET /api/parties/:id/current-orders",
      "GET /api/parties/:id/drafts",
      "GET /api/parties/:id/groups",
      "GET /api/parties/:id/split-sources",
      "GET /api/refund-authorizers",
      "GET /api/sales/:id",
      "GET /api/sales/:id/deliveries",
      "GET /api/sales/:id/receipt",
      "GET /api/schedule/absences",
      "GET /api/schedule/shifts",
      "GET /api/schedule/swaps",
      "GET /api/service-day/authorizers",
      "GET /api/service-zones/:zoneId/keep-open",
      "GET /api/service-zones/:zoneId/offers",
      "GET /api/stations",
      "GET /api/stations/:id/queue",
      "GET /api/stations/:stationId/today",
      "GET /api/tables",
      "GET /api/tables/state",
      "GET /api/tender-refunds/:refundId",
      "GET /api/tender-refunds/:refundId/receipt",
      "GET /api/transactions",
      "GET /api/transactions/:saleId/receipt",
      "GET /api/transactions/:saleId/refundable-tenders",
      "GET /api/unpaid-departure-authorizers",
      "GET /api/working-orders",
      "GET /api/working-orders/:id",
      "GET /api/working-orders/:id/lines",
      "GET /api/working-orders/:id/payments",
      "GET /api/working-orders/:id/placed",
      "GET /api/working-orders/:id/transfer-closure",
      "GET /api/zones",
      "GET /api/device/zones",
      "POST /api/dead-ends/draft",
      "POST /api/dead-ends/order",
      "POST /api/dead-ends/sale",
      "POST /api/transactions/:saleId/corrections/preview",
      "POST /api/working-orders/:id/adjustments/preview",
      "POST /api/working-orders/:id/payments/preview",
    ],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. Receipt handover and clearing record completion; neither orders food, takes payment nor opens the drawer.",
    routes: ["POST /api/sales/:id/receipt/handover", "POST /api/tables/:id/cleared"],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. Station and zone-extension choices govern the venue day; they require venue.configure or a permitted PIN, not an ordering or preparation action.",
    routes: ["PUT /api/service-zones/:zoneId/zone-extension", "PUT /api/stations/:stationId/today"],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. Choosing display zones, approved profiles or equipment does not use that equipment to print, pay or open the drawer.",
    routes: [
      "PUT /api/device/zones",
      "PUT /api/device/equipment",
      "POST /api/device/active-profile",
    ],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. Confirming the box time uses profile admission and the clock-specific staff/admin rules; it is not a selling action.",
    routes: ["POST /api/box-clock/challenge", "POST /api/box-clock/confirm"],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. Staff manage their own schedule requests through their session; no selling action applies.",
    routes: [
      "POST /api/schedule/absences",
      "POST /api/schedule/swaps",
      "POST /api/schedule/swaps/:swapId/accept",
    ],
  },
  {
    proof: "matching request (tested)",
    actions: [],
    basis:
      "Request proof: till-api.request-device.test.ts. A person changes only their own screen language; no selling action applies.",
    routes: ["PUT /api/session/locale"],
  },
];

function routeKey(method: string, path: string): string {
  return `${method} ${path
    .replaceAll(id, ":param")
    .replace(/:[^/]+/g, ":param")
    .replace(/\/lines\/1(?=\/|$)/g, "/lines/:param")}`;
}

it("classifies every mounted till, device and schedule route and checks its declared device proof", async () => {
  const inventory = new Hono();
  mountTillApi(
    inventory,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend: v.backend,
      clock: v.clock,
      cfg: v.cfg,
      secureCookies: false,
      venueLocale: v.cfg.locale,
      cardProvider: new SimulatorPaymentProvider(suite.db),
      workforceEnabled: true,
      liveEvents: new LiveEvents(),
      boxClock: {
        correction: {
          inTurn: async (fn) => fn(),
          set: async () => {
            throw new Error("unused clock setter");
          },
          steps: () => 0,
        },
        startUp: clockStartUp({ primaryAtStart: true }),
        witnesses: () => [],
        clearWitnesses: () => {},
        readBoot: () => ({ id: "inventory", ms: 0 }),
        steady: () => 0,
        filesRecords: () => true,
        requestFromBox: () => false,
      },
    },
    noopLog,
  );
  mountDeviceApi(
    inventory,
    {
      db: suite.db,
      cfg: v.cfg,
      secureCookies: false,
      pairingMode: createPairingMode(),
      devMode: true,
    },
    noopLog,
  );
  mountScheduleApi(inventory, { db: suite.db }, noopLog);
  mountDeviceLiveApi(
    inventory,
    { db: suite.db, bus: new LiveEvents(), resourceTypes: ["printers"] },
    noopLog,
  );
  const mounted = new Set(
    inventory.routes
      .filter(({ method, path }) => method !== "ALL" && path.startsWith("/api/"))
      .map(({ method, path }) => routeKey(method, path)),
  );
  const rows = [
    ...ROUTES.map(([method, path, action]) => ({
      key: routeKey(method, path),
      actions: [action],
      proof: path.startsWith("/api/device/")
        ? "device cookie (source)"
        : "matching request (source)",
      basis:
        "Own ROUTES action refusal; inventory walk checks absent proof and, for matching requests, foreign proof",
    })),
    ...[...EXTERNAL_ACTION_ROUTES, ...ACTIONLESS_ROUTES].flatMap(({ routes, ...entry }) =>
      routes.map((route) => {
        const space = route.indexOf(" ");
        return { ...entry, key: routeKey(route.slice(0, space), route.slice(space + 1)) };
      }),
    ),
  ];
  for (const row of rows) {
    expect(
      new Set(rows.filter(({ key }) => key === row.key).map(({ proof }) => proof)).size,
      row.key,
    ).toBe(1);
  }
  const classified = new Set(rows.map(({ key }) => key));
  expect([...mounted].sort()).toEqual([...classified].sort());

  const full = await signIn([...CAPABILITY_FLAGS]);
  const other = await signIn([...CAPABILITY_FLAGS]);
  const sessionCookie = full.cookie.split(";")[0]!;
  const foreignDeviceCookie = other.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${DEVICE_COOKIE}=`))!;
  const checked = new Set<string>();
  for (const { method, path } of inventory.routes) {
    const key = routeKey(method, path);
    if (checked.has(key)) continue;
    checked.add(key);
    const row = rows.find((entry) => entry.key === key);
    if (row === undefined) continue;
    const matchesSession = row.proof.startsWith("matching request");
    if (!matchesSession && row.proof !== "device cookie (source)") continue;
    for (const proof of matchesSession ? ["absent", "foreign"] : ["absent"]) {
      const controller = new AbortController();
      const response = await inventory.request(
        path.replace(/:([^/]+)/g, (_, name: string) => (name === "lineNo" ? "1" : id)),
        {
          method,
          headers: {
            "content-type": "application/json",
            cookie: proof === "absent" ? sessionCookie : `${sessionCookie}; ${foreignDeviceCookie}`,
          },
          ...(method === "GET"
            ? {}
            : {
                body:
                  key === "POST /api/session"
                    ? JSON.stringify({ personId: id, pin: "1234" })
                    : "{}",
              }),
          signal: controller.signal,
        },
      );
      try {
        expect([401, 403], `${key}: ${proof} device proof`).toContain(response.status);
        expect(await response.json(), `${key}: ${proof} device proof`).toEqual({
          error: { code: "device.unauthorized", params: {} },
        });
      } finally {
        controller.abort();
        if (!response.bodyUsed) await response.body?.cancel();
      }
    }
  }
});

describe("each till route checks the profile action it needs", () => {
  for (const [method, path, lacking, expected, body] of ROUTES) {
    it(`refuses ${method} ${path.replaceAll(id, ":id")} without ${lacking}`, async () => {
      const cookie = path.startsWith("/api/device/")
        ? displayCookies.get(lacking)!
        : sessions.get(lacking)!;
      const answer = await send(cookie, method, path, body);
      expect({ status: answer.status, error: answer.body.error }).toEqual(expected);
    });
  }
});

describe("A803 split: the panel's read", () => {
  it("is served to a session whose profile lacks take-orders", async () => {
    const answer = await send(
      sessions.get("take-orders")!,
      "GET",
      `/api/parties/${id}/split-sources`,
    );
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ partyRevision: 0, bills: [] });
  });
});

describe("A803 split: the route", () => {
  it("refuses a loose selection without take-orders", async () => {
    const answer = await send(
      sessions.get("take-orders")!,
      "POST",
      `/api/parties/${id}/split-table`,
      {
        tableId: id,
        selection: { wholeBillIds: [], loose: [{ billId: id, lineIds: [id] }] },
        expectedPartyRevision: 0,
        expectedEdits: [],
      },
    );
    expect({ status: answer.status, error: answer.body.error }).toEqual(forbidden("take-orders"));
  });
});

describe("screens and actions are separate", () => {
  it("lets a visible, read-only live-orders profile look at the station and the pass, and refuses it preparing, handing over and payment", async () => {
    const { cookie } = await signIn(["show-station", "show-expo", "take-orders"]);
    expect((await send(cookie, "GET", `/api/stations/${stationId}/queue`)).status).toBe(200);
    expect((await send(cookie, "GET", "/api/expo/board")).status).toBe(200);
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
      const department = await createDepartment(tx, {
        name: `Deli ${randomUUID()}`,
        orderStart: "counter",
      });
      return createServiceZone(tx, {
        name: `Deli ${randomUUID()}`,
        departmentId: department.id,
      });
    });
    const restaurantOnly = await profile(allBut("take-orders"));
    await withTransaction(suite.db, async (tx) => {
      const [policy] = await tx
        .select({ departmentId: floorZones.departmentId })
        .from(floorZones)
        .where(eq(floorZones.id, v.counter.zoneId));
      await setProfileServiceAccess(tx, restaurantOnly, {
        departmentId: policy!.departmentId,
        allowedZoneIds: null,
        startingZoneId: v.counter.zoneId,
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
  it("may take orders when its stored list names them, and is refused payment and the drawer even when named", async () => {
    const { cookie, deviceId } = await signIn(CAPABILITY_FLAGS);
    const kds = await profile(CAPABILITY_FLAGS, "kds");
    await suite.db.update(devices).set({ deviceProfileId: kds }).where(eq(devices.id, deviceId));
    const park = await send(cookie, "POST", "/api/working-orders", { id: randomUUID(), lines: [] });
    expect(park.body.error?.code).toBe("sale.empty_basket");
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

  it("is refused taking orders when its stored list lacks them", async () => {
    const { cookie, deviceId } = await signIn(CAPABILITY_FLAGS);
    const kds = await profile(
      CAPABILITY_FLAGS.filter((flag) => flag !== "take-orders"),
      "kds",
    );
    await suite.db.update(devices).set({ deviceProfileId: kds }).where(eq(devices.id, deviceId));
    const park = await send(cookie, "POST", "/api/working-orders", { id: randomUUID(), lines: [] });
    expect(park.body.error).toEqual(forbidden("take-orders").error);
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

  for (const [path, lacking] of [
    [`/api/device/orders/${id}/courses/${id}/ready`, "prepare-orders"],
    [`/api/device/parties/${id}/groups/${id}/ready`, "prepare-orders"],
    [`/api/device/working-orders/${id}/lines/move-station`, "take-orders"],
    ["/api/device/pass-screen/release", "prepare-orders"],
  ] as const) {
    it(`refuses the display's ${path.replaceAll(id, ":id")} without ${lacking}`, async () => {
      const cookie = await passDisplay(
        ["take-orders", "prepare-orders", "hand-over-orders"].filter((flag) => flag !== lacking),
      );
      const answer = await send(cookie, "POST", path, {
        submissionId: randomUUID(),
        expectedPartyRevision: 0,
      });
      expect({ status: answer.status, error: answer.body.error }).toEqual(forbidden(lacking));
    });
  }

  it("refuses the display's pass release with prepare-orders but without run-the-pass", async () => {
    const cookie = await passDisplay(["prepare-orders"]);
    const answer = await send(cookie, "POST", "/api/device/pass-screen/release", {
      submissionId: randomUUID(),
      target: { kind: "group", partyId: id, groupId: id },
      ticketItemIds: [id],
      expectedContext: "0".repeat(64),
    });
    expect({ status: answer.status, error: answer.body.error }).toEqual(forbidden("run-the-pass"));
  });

  it("lets a display that prepares reach the station's own refusal for an unknown item", async () => {
    const cookie = await display(["act-as-kds", "prepare-orders"]);
    const answer = await send(cookie, "POST", `/api/device/ticket-items/${id}/advance`, {
      to: "ready",
    });
    expect({ status: answer.status, code: answer.body.error?.code }).toEqual({
      status: 404,
      code: "ticket_item.not_found",
    });
  });
});

describe("the till's boot read", () => {
  it("names the active profile's starting screen, and none without a device", async () => {
    const [row] = await seedDeviceProfiles(suite.db, {
      name: `Pass ${randomUUID()}`,
      formFactor: "till",
      capabilities: ["show-expo", "take-orders"],
      startingScreen: "show-expo",
    });
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
        expectedEdit: await withTransaction(suite.db, (tx) => readBillEditState(tx, bill)),
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

it("lets admitted staff save display zones while their profile still refuses ordering", async () => {
  const { cookie } = await signIn([], "staff");
  const current = await send(cookie, "GET", "/api/device/zones");
  expect(current.status).toBe(200);
  expect(current.body.startingZoneId).toEqual(expect.any(String));
  expect((await send(cookie, "PUT", "/api/device/zones", current.body)).status).toBe(200);
  const order = await send(cookie, "POST", "/api/working-orders", { id: randomUUID(), lines: [] });
  expect({ status: order.status, error: order.body.error }).toEqual(forbidden("take-orders"));
});
