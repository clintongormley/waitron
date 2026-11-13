import { seedModuleSettings } from "../test/module-settings.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { emptyDrainResult } from "@waitron/fiscal";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { StartedServer } from "./boot.js";
import type { BoxHostClient } from "./box-host-client.js";
import type { clockCorrection } from "./clock-correction.js";
import type { StartClockState } from "./start-clock-check.js";
import { provisionBillVenue, fiscalRecordCount, type BillVenue } from "./testing/bill-venue.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePorts } from "./testing/free-ports.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { listener } from "./testing/ephemeral-listener.js";
import { clockServiceAnswer, synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// The real drain would skip a sale on this venue's missing AEAT credentials.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => ({
      ...actual.fiscalSlot(...args),
      drain: async () => emptyDrainResult(),
    }),
  };
});

/** The start's clock state and the clock correction boot builds, so a case can confirm the start by
 * devices and make a set itself. */
const built = vi.hoisted(() => ({
  start: undefined as StartClockState | undefined,
  correction: undefined as ReturnType<typeof clockCorrection> | undefined,
}));
vi.mock("./start-clock-check.js", async (original) => {
  const actual = await original<typeof import("./start-clock-check.js")>();
  return {
    ...actual,
    startClockState: () => (built.start = actual.startClockState()),
  };
});
vi.mock("./clock-correction.js", async (original) => {
  const actual = await original<typeof import("./clock-correction.js")>();
  return {
    ...actual,
    clockCorrection: (...args: Parameters<typeof actual.clockCorrection>) =>
      (built.correction = actual.clockCorrection(...args)),
  };
});

/** The `clockUnconfirmed` boot last handed `mountTillApi` and `mountPaymentsApi`. */
const mounted = vi.hoisted(() => ({
  till: undefined as (() => boolean) | undefined,
  payments: undefined as (() => boolean) | undefined,
}));
vi.mock("./till-api.js", async (original) => {
  const actual = await original<typeof import("./till-api.js")>();
  return {
    ...actual,
    mountTillApi: (...args: Parameters<typeof actual.mountTillApi>) => {
      mounted.till = args[1].clockUnconfirmed;
      actual.mountTillApi(...args);
    },
  };
});
vi.mock("./payments-api.js", async (original) => {
  const actual = await original<typeof import("./payments-api.js")>();
  return {
    ...actual,
    mountPaymentsApi: (...args: Parameters<typeof actual.mountPaymentsApi>) => {
      mounted.payments = args[1].clockUnconfirmed;
      actual.mountPaymentsApi(...args);
    },
  };
});

const { startServer, httpPort } = ephemeralServerFixture();
const migrations = migrationOptionsFor(manifestSets(), null);
let venue: BillVenue;
let counter: ZoneOffers;
const suite = useVenueDb({
  resetPerTest: false,
  migrations,
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await offerProducts(db, venue.cfg, { zone: "counter", orderStart: "counter" });
  },
});

const scratches: string[] = [];
afterEach(async () => {
  await Promise.all(scratches.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A host whose time service is not synchronised; it notes whether the listener was open at each
 * read, and every set it is asked for. */
function unsynchronisedHost() {
  const listeningAtRead: boolean[] = [];
  const sets: unknown[] = [];
  const host: BoxHostClient = {
    clockStatus: async () => {
      listeningAtRead.push(listener.current !== undefined);
      return clockServiceAnswer(false);
    },
    setClock: async (input) => {
      sets.push(input);
      return { available: false, reason: "missing" };
    },
  };
  return { host, listeningAtRead, sets };
}

async function tradingEnv(): Promise<Record<string, string>> {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-boot-start-clock-gate-"));
  scratches.push(scratch);
  const migrationsRoot = join(scratch, "migrations");
  await copyMigrationsRoot(migrationsRoot);
  await seedModuleSettings(suite.db, { "fiscal-none": false });
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  return {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: scratch,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
  };
}

function productIdOf(name: string): string {
  return venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`)[0]!.id;
}

function post(path: string, body: unknown) {
  return fetch(`http://127.0.0.1:${httpPort()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: venue.cookie },
    body: JSON.stringify(body),
  });
}

async function sell() {
  const workingOrderId = randomUUID();
  const answer = await post("/api/sales", {
    lines: [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }],
    tender: { method: "cash", amount: "20.00" },
    workingOrderId,
    zoneId: counter.zoneId,
  });
  return { status: answer.status, body: await answer.text(), workingOrderId };
}

/** Starts the server, runs `during`, and closes it. */
async function serving<T>(boxHost: BoxHostClient, during: () => Promise<T>): Promise<T> {
  const env = await tradingEnv();
  let server: StartedServer | undefined;
  try {
    // The tests' requests come from this machine, which the clock routes refuse as the box's own.
    server = await startServer(env, env, { boxHost, requestFromBox: () => false });
    return await during();
  } finally {
    if (server !== undefined) await server.close();
  }
}

/** Starts the server, sells once, and runs `after` before it closes. */
function sellOnce(boxHost: BoxHostClient, after?: () => Promise<void>) {
  return serving(boxHost, async () => {
    const sale = await sell();
    await after?.();
    return sale;
  });
}

describe("the start clock gate as boot wires it", () => {
  it("asks the time service before the listener opens and, not synchronised, sets nothing and refuses a sale with 409 clock.unconfirmed", async () => {
    const records = fiscalRecordCount(venue);
    const { host, listeningAtRead, sets } = unsynchronisedHost();

    const sale = await sellOnce(host, async () => {
      expect(sets).toEqual([]);
      // Control: a till's "This device" two days out reaches the same fake as a set.
      const asked = (await (await post("/api/box-clock/challenge", {})).json()) as {
        challengeId: string;
      };
      await post("/api/box-clock/confirm", {
        challengeId: asked.challengeId,
        deviceAt: Date.now() + 2 * 24 * 3_600_000,
      });
      expect(sets).toHaveLength(1);
    });

    expect(listeningAtRead[0]).toBe(false);
    expect(sale.status, sale.body).toBe(409);
    expect(JSON.parse(sale.body)).toEqual({
      error: { code: "clock.unconfirmed", params: {} },
    });
    expect(fiscalRecordCount(venue)).toBe(records);
  });

  it("hands the till and payments mounts a clockUnconfirmed that holds while the start waits and lets go once it is confirmed", async () => {
    mounted.till = mounted.payments = undefined;
    const seen = await serving(unsynchronisedHost().host, async () => {
      const waiting = [mounted.till?.(), mounted.payments?.()];
      built.start!.confirm("by_devices", {});
      return { waiting, confirmed: [mounted.till?.(), mounted.payments?.()] };
    });

    expect(seen).toEqual({ waiting: [true, true], confirmed: [false, false] });
  });

  it("sells and writes one record when the host's time service is synchronised", async () => {
    const sale = await sellOnce(synchronisedBoxHost());

    expect(sale.status, sale.body).toBe(200);
    expect(fiscalRecordCount(venue, sale.workingOrderId)).toBe(1);
  });

  it("refuses a sale with 409 clock.unconfirmed while a clock set is with the host on a start confirmed by devices, and sells once the host has answered", async () => {
    const records = fiscalRecordCount(venue);
    let reached!: () => void;
    const asked = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    const host: BoxHostClient = {
      clockStatus: async () => clockServiceAnswer(false),
      setClock: async () => {
        reached();
        await answered;
        return { available: false, reason: "refused", refusal: "set_failed" };
      },
    };

    const { during, after } = await serving(host, async () => {
      const start = built.start!;
      const correction = built.correction!;
      start.confirm("by_devices", {});
      const set = correction.set({
        reason: "start",
        source: "staff",
        offsetMs: 2 * 24 * 3_600_000,
        measuredAt: { wallMs: Date.now(), monoMs: performance.now() },
        stepsSeen: correction.steps(),
        witnesses: [],
        requester: { source: "staff", person: null, device: null },
      });
      await asked;
      const during = await sell();
      release();
      expect(await set).toEqual({ set: false, reason: "refused" });
      expect(start.status).toBe("by_devices");
      return { during, after: await sell() };
    });

    expect(during.status, during.body).toBe(409);
    expect(JSON.parse(during.body)).toEqual({
      error: { code: "clock.unconfirmed", params: {} },
    });
    expect(fiscalRecordCount(venue, during.workingOrderId)).toBe(0);
    expect(after.status, after.body).toBe(200);
    expect(fiscalRecordCount(venue, after.workingOrderId)).toBe(1);
    expect(fiscalRecordCount(venue)).toBe(records + 1);
  });

  it("refuses a record correction with 409 clock.unconfirmed while the start waits, and writes no record", async () => {
    const records = fiscalRecordCount(venue);
    const [admin] = await seedPersons(suite.db, {
      displayName: "Remedy administrator",
      role: "admin",
      status: "active",
    });
    const session = await withTransaction(suite.db, (tx) =>
      startManagementSession(tx, { personId: admin!.id }),
    );
    await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, session.token));
    const correct = async () => {
      const origin = `http://127.0.0.1:${httpPort()}`;
      const answer = await fetch(`${origin}/management-api/fiscal-records/remedy`, {
        method: "POST",
        headers: {
          origin,
          "content-type": "application/json",
          cookie: `waitron_management_session=${session.token}`,
        },
        body: JSON.stringify({
          kind: "record-correction",
          caseId: randomUUID(),
          registroId: randomUUID(),
          actionKey: "correct-facts",
          reason: "Correct the stored record facts",
          facts: { description: "Corrected restaurant service" },
        }),
      });
      return { status: answer.status, body: await answer.text() };
    };

    const { waiting, confirmed } = await serving(unsynchronisedHost().host, async () => {
      const waiting = await correct();
      built.start!.confirm("by_devices", {});
      return { waiting, confirmed: await correct() };
    });

    expect(waiting.status, waiting.body).toBe(409);
    expect(JSON.parse(waiting.body)).toEqual({ error: { code: "clock.unconfirmed", params: {} } });
    // Control: once confirmed, the same request reaches the remedy, which finds no such case.
    expect(confirmed.status, confirmed.body).toBe(400);
    expect(JSON.parse(confirmed.body)).toMatchObject({ error: { code: "fiscal.remedy_invalid" } });
    expect(fiscalRecordCount(venue)).toBe(records);
  });
});
