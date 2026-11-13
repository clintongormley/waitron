import { seedDeviceProfiles } from "@waitron/db/testing/seed.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { kitchenStations, withTransaction } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin } from "@waitron/identity";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import type { DeviceKitchenScreen } from "@waitron/module";
import { SimulatorPaymentProvider } from "@waitron/payments";
import { PERSON_HEADER } from "@waitron/shared";
import { LiveEvents } from "./live-api.js";
import { clockStartUp } from "./clock-start-up.js";
import { mountScheduleApi } from "./schedule-api.js";
import { mountDeviceApi } from "./device-api.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { acceptDeviceJoinRequest, createJoinRequest } from "./join-requests.js";
import type { Logger } from "./logger.js";
import { createPairingMode } from "./pairing-mode.js";
import { mountTillApi } from "./till-api.js";
import { openSessionPerson, SESSION_COOKIE } from "./till-session.js";
import { offerOnProfile } from "./testing/enrol.js";
import { setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { leaveSessionAlone } from "./testing/tab-person.js";

// Weaker than its name: it walks only the routes the till, device and schedule mount functions add,
// compares status and error code (never bodies, so `GET /api/device/me` has its own tests), and
// sends `"{}"` to any route not in `BODIES`, so it sees nothing past a route's refusal of that body.

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 120_000,
});

const noopLog: Logger = () => {};
const id = randomUUID();

type Class = "public" | "device only";

/** Routes that answer Ben's cookies naming Anna exactly as Ben's device cookie alone, which is not
 * `session.required`: none of them acts as the signed-in person on these requests. */
const BLIND: readonly { route: string; class: Class; reason: string }[] = [
  { route: "POST /api/session", class: "public", reason: "the sign-in itself" },
  { route: "GET /api/staff", class: "public", reason: "the lock screen's roster" },
  { route: "GET /api/till", class: "public", reason: "the till's boot read, before sign-in" },
  { route: "GET /api/locales", class: "public", reason: "read before sign-in" },
  { route: "POST /api/device/join", class: "public", reason: "a device asking to join" },
  { route: "GET /api/device/join/status", class: "public", reason: "a joining device's own wait" },
  { route: "GET /api/dev/devices", class: "public", reason: "development mode's device picker" },
  {
    route: "GET /api/device/me",
    class: "device only",
    reason: "narrows by person only in its body, tested in device-api.test.ts",
  },
  {
    route: "GET /api/device/equipment",
    class: "device only",
    reason: "the device's own equipment",
  },
  { route: "PUT /api/device/battery", class: "device only", reason: "the device's own battery" },
  {
    route: "GET /api/device/stations/:stationId/today",
    class: "device only",
    reason: "the station screen's open-or-closed panel reads no sign-in",
  },
  {
    route: "PUT /api/device/stations/:stationId/today",
    class: "device only",
    reason: "authorised by a manager's PIN in the body, not the sign-in",
  },
  {
    route: "GET /api/device/stations",
    class: "device only",
    reason: "kitchen displays only, where nobody can sign in",
  },
  {
    route: "POST /api/device/working-orders/:id/lines/move-station",
    class: "device only",
    reason: "kitchen displays only, where nobody can sign in",
  },
  {
    route: "POST /api/device/orders/:id/courses/:courseId/ready",
    class: "device only",
    reason: "kitchen displays only, where nobody can sign in",
  },
  {
    route: "POST /api/device/parties/:id/groups/:gid/ready",
    class: "device only",
    reason: "kitchen displays only, where nobody can sign in",
  },
];

/** A valid body for each route that refuses `"{}"` before it reads the sign-in, so the walk reaches
 * that read; every walk sends the same one. */
const BODIES: Readonly<Record<string, () => unknown>> = {
  // A fresh person each time, so no two sign-in attempts share a PIN throttle entry.
  "POST /api/session": () => ({ personId: randomUUID(), pin: "1234" }),
  "PUT /api/device/kitchen-screen-display": () => ({ kind: "pass", showNonPassStations: null }),
};

/** The owner's named routes, and the kitchen screens, that must be among the refused. */
const NAMED_REFUSED = [
  "POST /api/working-orders/:id/payments/:paymentId/slip-copy",
  "POST /api/parties/:id/drafts/:did/discard",
  "POST /api/parties/:id/drafts/:did/submit",
  "PUT /api/parties/:id/drafts",
  "POST /api/working-orders/:id/adjustments",
  "POST /api/working-orders/:id/adjustments/preview",
  "GET /api/stations",
  "GET /api/stations/:id/queue",
  "GET /api/device/station-screen",
  "GET /api/device/pass-board",
  "POST /api/device/pass-screen/release",
  "GET /api/device/pass-monitor-board",
  "PUT /api/device/kitchen-screen-display",
  "DELETE /api/session",
];

let v: PartyVenue;
let app: Hono;
let ana: string;
let ben: string;
/** Two tills, since one device may not show both pass kinds: a route is walked on each. */
let tills: string[];

async function person(name: string, role: "staff" | "admin"): Promise<string> {
  const [row] = await seedPersons(suite.db, {
    displayName: `${name} ${randomUUID()}`,
    pinHash: hashPin("5555"),
    role,
  });
  return row!.id;
}

/** A till whose profile lists every capability flag and shows a station screen and `pass`, so each
 * kitchen route reaches its person check on one of them. */
async function kitchenTill(stationId: string, pass: "pass" | "pass_monitor"): Promise<string> {
  const [profile] = await seedDeviceProfiles(suite.db, {
    name: `Profile ${randomUUID()}`,
    formFactor: "till",
    capabilities: [...CAPABILITY_FLAGS],
  });
  const kitchenScreens: DeviceKitchenScreen[] = [
    { kind: "station", stationIds: [stationId], zoneIds: null },
    { kind: pass, stationIds: null, zoneIds: null },
  ];
  const label = `Till ${randomUUID()}`;
  const device = await withTransaction(suite.db, async (tx) => {
    for (const screen of kitchenScreens) await offerOnProfile(tx, profile!.id, screen);
    const made = await createJoinRequest(tx, v.cfg, { kind: "device", label });
    const accepted = await acceptDeviceJoinRequest(tx, v.cfg, made.joinId, {
      label,
      profileId: profile!.id,
      kitchenScreens,
    });
    return { deviceId: accepted.deviceId, token: made.token };
  });
  return `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
}

/** Signs Ben in on the till; the harness leaves the session's requests to the walk. */
async function signInBen(deviceCookie: string): Promise<string> {
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: ben, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  const pair = login.headers.getSetCookie()[0]!.split(";")[0]!;
  const token = pair.slice(pair.indexOf("=") + 1);
  leaveSessionAlone(token);
  return token;
}

type Answer = { status: number; code: string | null };
type Walk = "A" | "C" | "B" | "control";

function routes(): { method: string; path: string; key: string }[] {
  const distinct = new Map(
    app.routes
      .filter(({ method, path }) => method !== "ALL" && path.startsWith("/api/"))
      .map(({ method, path }) => [`${method} ${path}`, { method, path, key: `${method} ${path}` }]),
  );
  return [...distinct.values()].sort(
    (a, b) => Number(a.key === "DELETE /api/session") - Number(b.key === "DELETE /api/session"),
  );
}

async function send(
  walk: Walk,
  deviceCookie: string,
  token: string,
  method: string,
  path: string,
): Promise<Answer> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: walk === "B" ? deviceCookie : `${SESSION_COOKIE}=${token}; ${deviceCookie}`,
  };
  if (walk === "A") headers[PERSON_HEADER] = ana;
  if (walk === "control") headers[PERSON_HEADER] = ben;
  const controller = new AbortController();
  const response = await app.request(
    path.replace(/:([^/]+)/g, (_, name: string) => (name === "lineNo" ? "1" : id)),
    {
      method,
      headers,
      ...(method === "GET"
        ? {}
        : {
            body: JSON.stringify(BODIES[`${method} ${path}`]?.() ?? {}),
          }),
      signal: controller.signal,
    },
  );
  try {
    const json = response.headers.get("content-type")?.includes("application/json")
      ? ((await response.json()) as { error?: { code?: string } } | null)
      : null;
    return { status: response.status, code: json?.error?.code ?? null };
  } finally {
    controller.abort();
    if (!response.bodyUsed) await response.body?.cancel();
  }
}

/** Every route's answer on one walk of one till, each sent while Ben's session from that walk's own
 * sign-in is open; `DELETE /api/session` last. */
async function walk(kind: Walk, deviceCookie: string): Promise<Map<string, Answer>> {
  const token = await signInBen(deviceCookie);
  const answers = new Map<string, Answer>();
  for (const { method, path, key } of routes()) {
    expect(await openSessionPerson(suite.db, token), `${kind} walk, before ${key}`).toBe(ben);
    answers.set(key, await send(kind, deviceCookie, token, method, path));
  }
  if (kind !== "B")
    expect
      .soft(await openSessionPerson(suite.db, token), `${kind} walk, after its sign-out`)
      .toBe(kind === "control" ? null : ben);
  return answers;
}

const refused = (answer: Answer | undefined) =>
  answer?.status === 409 && answer.code === "session.person_not_signed_in";
const same = (a: Answer | undefined, b: Answer | undefined) =>
  a?.status === b?.status && a?.code === b?.code;

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
    app,
    {
      db: suite.db,
      cfg: v.cfg,
      secureCookies: false,
      pairingMode: createPairingMode(),
      devMode: true,
    },
    noopLog,
  );
  mountScheduleApi(app, { db: suite.db }, noopLog);
  ana = await person("Anna", "staff");
  ben = await person("Ben", "admin");
  const [station] = await suite.db
    .insert(kitchenStations)
    .values({ name: `Grill ${randomUUID()}` })
    .returning({ id: kitchenStations.id });
  tills = [await kitchenTill(station!.id, "pass"), await kitchenTill(station!.id, "pass_monitor")];
}, 120_000);

describe("every till, device and schedule route checks the person a request names", () => {
  it("refuses Ben's session naming Anna or nobody, or answers as if nobody were signed in", async () => {
    const failures: string[] = [];
    const blindOn: Set<string>[] = [];
    const refusedOn = new Set<string>();
    for (const till of tills) {
      const a = await walk("A", till);
      const c = await walk("C", till);
      const b = await walk("B", till);
      const blind = new Set<string>();
      for (const { key } of routes()) {
        for (const [name, answers] of [
          ["A", a],
          ["C", c],
        ] as const) {
          const answer = answers.get(key);
          if (!refused(answer) && !same(answer, b.get(key)))
            failures.push(
              `${key}: ${name} ${JSON.stringify(answer)}, B ${JSON.stringify(b.get(key))}`,
            );
        }
        if (refused(a.get(key))) refusedOn.add(key);
        if (same(a.get(key), b.get(key)) && b.get(key)?.code !== "session.required") blind.add(key);
      }
      blindOn.push(blind);
    }
    const blind = [...blindOn[0]!].filter((key) => blindOn.every((set) => set.has(key)));
    expect(failures).toEqual([]);
    expect(blind.sort()).toEqual(BLIND.map(({ route }) => route).sort());
    for (const key of NAMED_REFUSED) expect(refusedOn, key).toContain(key);
  }, 300_000);

  it("refuses nothing as the wrong person when the request names Ben", async () => {
    const refusedFor: string[] = [];
    for (const till of tills) {
      const answers = await walk("control", till);
      for (const [key, answer] of answers) if (refused(answer)) refusedFor.push(key);
      expect(answers.get("GET /api/stations")?.status, "served as Ben").toBe(200);
    }
    expect(refusedFor).toEqual([]);
  }, 300_000);
});

describe("the sign-in cookie's readers", () => {
  it("are till-session.ts and the sign-out handler alone", () => {
    // Weaker than it looks: it reads text, so a cookie name spelt out as a string is missed.
    const root = fileURLToPath(new URL(".", import.meta.url));
    const readers: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
      const file = relative(root, join(entry.parentPath, entry.name));
      if (!entry.isFile() || !file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      if (file.startsWith("testing/") || file === "till-session.ts") continue;
      let text = readFileSync(join(root, file), "utf8").replace(/^import[^;]*;/gm, "");
      if (file === "till-api.ts") {
        const start = text.indexOf('app.delete("/api/session"');
        const end = text.indexOf("\n  );\n", start);
        expect(start, "the sign-out handler's start").toBeGreaterThan(-1);
        expect(end, "the sign-out handler's end").toBeGreaterThan(start);
        expect(text.slice(start, end).match(/\breadSessionToken\b/g), "the handler").toHaveLength(
          1,
        );
        text = text.slice(0, start) + text.slice(end);
      }
      if (/\b(readSessionToken|SESSION_COOKIE)\b/.test(text)) readers.push(file);
    }
    expect(readers).toEqual([]);
  });
});
