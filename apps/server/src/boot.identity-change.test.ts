import { seedModuleSettings } from "../test/module-settings.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stampDeployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { softwareVersion } from "@waitron/fiscal-verifactu/src/software-identity.js";
import { startManagementSession } from "@waitron/identity";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { applyHistoricalTestVenue } from "@waitron/provisioning/testing/allocated-venue";
import { isAppError } from "@waitron/shared";
import type { BoxHostClient } from "./box-host-client.js";
import type { ClockWatch } from "./clock-watch.js";
import type { StartClockState } from "./start-clock-check.js";
import { provisionBillVenue, fiscalRecordCount, type BillVenue } from "./testing/bill-venue.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { filedRecordOf, renameFixtureInstallation } from "./testing/fiscal-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { listener } from "./testing/ephemeral-listener.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { clockServiceAnswer, synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import { useTestProducer } from "./testing/test-producer.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";

useTestProducer();

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// `undici`'s `fetch` rejects, so no background dial reaches a real host.
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof import("undici")>()),
  fetch: vi.fn(() => Promise.reject(new Error("undici fetch disabled in this suite"))),
}));

// The real drain would file this production venue's sales.
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

// A bundle carries the release's date; a run from source carries none, and opens nothing.
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

const built = vi.hoisted(() => ({
  start: undefined as StartClockState | undefined,
  watch: undefined as ClockWatch | undefined,
}));
vi.mock("./start-clock-check.js", async (original) => {
  const actual = await original<typeof import("./start-clock-check.js")>();
  return {
    ...actual,
    startClockState: (...args: Parameters<typeof actual.startClockState>) =>
      (built.start = actual.startClockState(...args)),
  };
});
vi.mock("./clock-watch.js", async (original) => {
  const actual = await original<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    createClockWatch: (...args: Parameters<typeof actual.createClockWatch>) =>
      (built.watch = actual.createClockWatch(...args)),
  };
});

// One production venue whose chain is filed under FIRST, started in turn with a producer it has not
// filed under. The cases run in order: the first opening leaves the chain under SECOND.
const FIRST = "00000000T";
const SECOND = "12345678Z";
const INSTALLATION = "0CNN8";
const NOTE_FILE = "identity-change.json";

const { startServer, httpPort } = ephemeralServerFixture();
let venue: BillVenue;
let counter: ZoneOffers;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    // The opening reads a history of minute names, which the fixture's own identity is not.
    venue = await provisionBillVenue(db, {
      apply: (actions, deps) =>
        applyHistoricalTestVenue(
          actions.map((action) =>
            action.kind === "create-series"
              ? { ...action, code: `${action.code}-${INSTALLATION}` }
              : action,
          ),
          deps,
        ),
    });
    counter = await offerProducts(db, venue.cfg, { zone: "counter", orderStart: "counter" });
    renameFixtureInstallation(db, INSTALLATION);
    await stampDeployment(db, "production");
    await seedModuleSettings(db, { "fiscal-none": false });
  },
});

const scratches: string[] = [];
afterEach(async () => {
  await Promise.all(scratches.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function unsynchronisedHost(): BoxHostClient {
  return {
    clockStatus: async () => clockServiceAnswer(false),
    setClock: async () => ({ available: false, reason: "missing" }),
  };
}

async function newStateDir(): Promise<string> {
  const stateDir = await mkdtemp(join(tmpdir(), "waitron-boot-identity-change-"));
  scratches.push(stateDir);
  return stateDir;
}

const noteIn = (stateDir: string) => join(stateDir, NOTE_FILE);
const noteExists = (stateDir: string) =>
  readFile(noteIn(stateDir)).then(
    () => true,
    () => false,
  );

function writeNote(stateDir: string, overrides: Record<string, string> = {}) {
  return writeFile(
    noteIn(stateDir),
    JSON.stringify({
      version: 1,
      release: softwareVersion(),
      producerTaxId: SECOND,
      fromProducerTaxId: FIRST,
      ...overrides,
    }),
  );
}

/** Starts a production server filing under `producer`, runs `during`, and closes it. */
async function serving<T>(
  options: { producer: string; host: BoxHostClient; stateDir: string },
  during: () => Promise<T>,
): Promise<T> {
  const migrationsRoot = join(options.stateDir, "migrations");
  await copyMigrationsRoot(migrationsRoot);
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  const env = {
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
    WAITRON_STATE_DIR: options.stateDir,
    WAITRON_VENUE_DIR: dirname(database),
    WAITRON_NODE_ID: venue.cfg.nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "production",
    WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  };
  const before = process.env.WAITRON_PRODUCER_TAX_ID;
  process.env.WAITRON_PRODUCER_TAX_ID = options.producer;
  const server = await startServer(
    env,
    {},
    { boxHost: options.host, requestFromBox: () => false },
  ).finally(() => {
    process.env.WAITRON_PRODUCER_TAX_ID = before;
  });
  try {
    return await during();
  } finally {
    await server.close();
  }
}

function productIdOf(name: string): string {
  return venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`)[0]!.id;
}

async function sell() {
  const workingOrderId = randomUUID();
  const answer = await fetch(
    `http://127.0.0.1:${httpPort()}/api/working-orders/${workingOrderId}/payments`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie: venue.cookie },
      body: JSON.stringify({
        submissionId: randomUUID(),
        kind: "share",
        shareOf: 1,
        method: "cash",
        tendered: "20.00",
        dining: "eat_in",
        basket: {
          zoneId: counter.zoneId,
          lines: [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }],
        },
      }),
    },
  );
  return { status: answer.status, body: await answer.text(), workingOrderId };
}

const recordOf = (workingOrderId: string) => filedRecordOf(venue.db, workingOrderId);

const installations = () =>
  venue.db.all<{ n: number }>(sql`select count(*) as n from verifactu_identities`)[0]!.n;

async function alerts(): Promise<{ code: string; params: Record<string, unknown> }[]> {
  const [admin] = await seedPersons(suite.db, {
    displayName: "Alerts administrator",
    role: "admin",
    status: "active",
  });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { method: "password", personId: admin!.id }),
  );
  await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, session.token));
  const answer = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
    headers: { cookie: `waitron_management_session=${session.token}` },
  });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { alerts: never }).alerts;
}

describe("a production start whose chain is filed under another producer", () => {
  it("sells under its own producer, as the control and to give the chain its head", async () => {
    const stateDir = await newStateDir();
    const sale = await serving({ producer: FIRST, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
    expect(recordOf(sale.workingOrderId).producer).toBe(FIRST);
  });

  it.each([
    ["with no note", null],
    ["with a note naming another release", { release: "0.0.1" }],
    ["with a note naming another producer", { producerTaxId: "11111111H" }],
    ["with a note naming another earlier producer", { fromProducerTaxId: "11111111H" }],
  ])("refuses sif.producer_changed %s, and leaves the note", async (_label, overrides) => {
    const stateDir = await newStateDir();
    if (overrides !== null) await writeNote(stateDir, overrides);
    const caught = await serving(
      { producer: SECOND, host: synchronisedBoxHost(), stateDir },
      async () => undefined,
    ).catch((error: unknown) => error);
    expect(isAppError(caught) && caught.code).toBe("sif.producer_changed");
    expect(await noteExists(stateDir)).toBe(overrides !== null);
  });

  it("with a note and the time service unsynchronised, stays up and waits, selling and opening nothing", async () => {
    const stateDir = await newStateDir();
    await writeNote(stateDir);
    const records = fiscalRecordCount(venue);
    const before = installations();

    const seen = await serving(
      { producer: SECOND, host: unsynchronisedHost(), stateDir },
      async () => {
        const sale = await sell();
        // The clock watch's whole look: devices, the time service, the jump.
        await built.watch!.check();
        return {
          sale,
          health: (await fetch(`http://127.0.0.1:${httpPort()}/health`)).status,
          alert: (await alerts()).find(({ code }) => code === "clock.unconfirmed"),
          status: built.start!.status,
        };
      },
    );

    expect(seen.sale.status, seen.sale.body).toBe(409);
    expect(JSON.parse(seen.sale.body)).toEqual({
      error: { code: "clock.unconfirmed", params: {} },
    });
    expect(seen.health).toBe(200);
    expect(seen.alert?.params).toMatchObject({ cause: "identity_change" });
    expect(seen.status).toBe("waiting");
    expect(fiscalRecordCount(venue)).toBe(records);
    expect(installations()).toBe(before);
    expect(await noteExists(stateDir)).toBe(true);
  });

  it("with a note and the time service synchronised, opens a new installation before the listener, deletes the note and sells under it", async () => {
    const stateDir = await newStateDir();
    await writeNote(stateDir);
    const before = installations();
    const synchronised = synchronisedBoxHost();
    const listeningAtRead: boolean[] = [];
    const host: BoxHostClient = {
      ...synchronised,
      clockStatus: async () => {
        listeningAtRead.push(listener.current !== undefined);
        return synchronised.clockStatus();
      },
    };

    const seen = await serving({ producer: SECOND, host, stateDir }, async () => ({
      opened: installations(),
      note: await noteExists(stateDir),
      start: { status: built.start!.status, held: built.start!.heldConfirmation },
      first: await sell(),
      second: await sell(),
    }));

    // The start's look, then the opening's own read.
    expect(listeningAtRead.slice(0, 2)).toEqual([false, false]);
    expect(seen.opened).toBe(before + 1);
    expect(seen.note).toBe(false);
    expect(seen.start).toEqual({ status: "by_internet", held: null });
    expect(seen.first.status, seen.first.body).toBe(200);
    const first = recordOf(seen.first.workingOrderId);
    expect(first).toEqual({
      first: 1,
      producer: SECOND,
      installation: expect.stringMatching(/^[0-9A-Z]{5}$/),
    });
    expect(recordOf(seen.second.workingOrderId)).toEqual({ ...first, first: 0 });
  });

  it("deletes a note left over from an opening already made, and trades", async () => {
    const stateDir = await newStateDir();
    await writeNote(stateDir);
    const before = installations();
    const sale = await serving({ producer: SECOND, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
    expect(await noteExists(stateDir)).toBe(false);
    expect(installations()).toBe(before);
  });

  it.each([
    ["another release", { release: "0.0.1" }],
    ["another producer", { producerTaxId: "11111111H" }],
  ])("leaves a note naming %s alone, and trades", async (_label, overrides) => {
    const stateDir = await newStateDir();
    await writeNote(stateDir, overrides);
    const sale = await serving({ producer: SECOND, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
    expect(await noteExists(stateDir)).toBe(true);
  });

  it("trades when the note's name is a folder", async () => {
    const stateDir = await newStateDir();
    await mkdir(noteIn(stateDir));
    const sale = await serving({ producer: SECOND, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
  });
});
