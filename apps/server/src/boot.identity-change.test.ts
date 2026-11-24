import { seedModuleSettings } from "../test/module-settings.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  stampDeployment,
  withTransaction,
  writeNodeMembership,
  writeNodeMembershipTx,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { emptyDrainResult } from "@waitron/fiscal";
import { softwareVersion } from "@waitron/fiscal-verifactu/src/software-identity.js";
import { startManagementSession } from "@waitron/identity";
import type { MembershipNode } from "@waitron/membership";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { setSingletonRole } from "@waitron/node-db";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { isAppError } from "@waitron/shared";
import { installBenchClock, type BenchClock } from "../scripts/bench/bench-clock.js";
import type { BoxHostClient } from "./box-host-client.js";
import type { ClockWatch, createClockWatch } from "./clock-watch.js";
import type { ClockWitnessStore } from "./clock-witnesses.js";
import type { StartClockState } from "./start-clock-check.js";
import {
  applyVenueUnderInstallation,
  fiscalRecordCount,
  provisionBillVenue,
  type BillVenue,
} from "./testing/bill-venue.js";
import { copyMigrationsRoot } from "./testing/boot-harness.js";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import {
  filedRecordOf,
  lastFiledProducer,
  renameFixtureInstallation,
} from "./testing/fiscal-fixtures.js";
import { freePorts } from "./testing/free-ports.js";
import { listener } from "./testing/ephemeral-listener.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
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
  witnesses: undefined as ClockWitnessStore | undefined,
  /** Boot's `read`: a transaction on the server's own handle, under its write lock. */
  inServerTransaction: undefined as Parameters<typeof createClockWatch>[0]["read"] | undefined,
}));
vi.mock("./clock-witnesses.js", async (original) => {
  const actual = await original<typeof import("./clock-witnesses.js")>();
  return {
    ...actual,
    createClockWitnessStore: (...args: Parameters<typeof actual.createClockWitnessStore>) =>
      (built.witnesses = actual.createClockWitnessStore(...args)),
  };
});
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
    createClockWatch: (...args: Parameters<typeof actual.createClockWatch>) => {
      built.inServerTransaction = args[0].read;
      return (built.watch = actual.createClockWatch(...args));
    },
  };
});

const opening = vi.hoisted(() => ({ attempts: 0, failure: null as Error | null }));
vi.mock("@waitron/fiscal-verifactu/src/identity-change.js", async (original) => {
  const actual =
    await original<typeof import("@waitron/fiscal-verifactu/src/identity-change.js")>();
  return {
    ...actual,
    openIdentityChange: async (...args: Parameters<typeof actual.openIdentityChange>) => {
      opening.attempts++;
      if (opening.failure !== null) throw opening.failure;
      return actual.openIdentityChange(...args);
    },
  };
});

// One production venue whose chain is first filed under FIRST, started in turn with a producer it has
// not filed under. Each opening moves the chain to the other one, so a case reads the chain's latest.
const FIRST = "00000000T";
const SECOND = "12345678Z";
const INSTALLATION = "0CNN8";
const NOTE_FILE = "identity-change.json";

const { startServer, httpPort, beforeServerStarts } = ephemeralServerFixture();
let venue: BillVenue;
let counter: ZoneOffers;
const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    // The opening reads a history of minute names, which the fixture's own identity is not.
    venue = await provisionBillVenue(db, { apply: applyVenueUnderInstallation(INSTALLATION) });
    counter = await offerProducts(db, venue.cfg, { zone: "counter", orderStart: "counter" });
    renameFixtureInstallation(db, INSTALLATION);
    await stampDeployment(db, "production");
    await seedModuleSettings(db, { "fiscal-none": false });
    await writeNodeMembership(db, chart(0, "serving-primary", []));
  },
});

type Standing = MembershipNode["standing"];
/** A chart giving this venue's box `own` standing, beside `others`. */
function chart(term: number, own: Standing, others: MembershipNode[]) {
  const { nodeId } = venue.cfg;
  return signedMembershipDoc(term, {
    signerNodeId: nodeId,
    nodes: [{ nodeId, contactUrl: "", standing: own }, ...others],
  });
}

const scratches: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  opening.failure = null;
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

const producerAtHead = () => lastFiledProducer(venue.db);
const otherThan = (producer: string) => (producer === FIRST ? SECOND : FIRST);

type NoteFields = Partial<Record<"release" | "producerTaxId" | "fromProducerTaxId", string>>;
async function writeNote(stateDir: string, producer: string, overrides: NoteFields) {
  const note = {
    version: 1,
    release: softwareVersion(),
    producerTaxId: producer,
    fromProducerTaxId: otherThan(producer),
    ...overrides,
  };
  await writeFile(noteIn(stateDir), JSON.stringify(note));
  return producer;
}

/** A start of a release that files under the other producer, with the note naming the change. */
const noteTheOtherProducer = (stateDir: string, overrides: NoteFields = {}) =>
  writeNote(stateDir, otherThan(producerAtHead()), overrides);

/** A start after that release's opening, with the note naming the change still there. */
const noteLeftOver = (stateDir: string, overrides: NoteFields = {}) =>
  writeNote(stateDir, producerAtHead(), overrides);

/** The administrator's freshly proved session, as `serving` last made it. */
let adminCookie: string;
async function administratorCookie(): Promise<string> {
  beforeServerStarts();
  const token = await withTransaction(suite.db, async (tx) => {
    const session = await startManagementSession(tx, {
      method: "password",
      personId: venue.adminId,
    });
    await setFreshManagementSignIn(tx, session.token);
    return session.token;
  });
  return `${MANAGEMENT_COOKIE}=${token}`;
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
  adminCookie = await administratorCookie();
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

async function alerts(
  cookie = adminCookie,
): Promise<{ code: string; params: Record<string, unknown> }[]> {
  const answer = await fetch(`http://127.0.0.1:${httpPort()}/management-api/alerts`, {
    headers: { cookie },
  });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { alerts: never }).alerts;
}

let firstSale: Awaited<ReturnType<typeof sell>>;
beforeAll(async () => {
  const stateDir = await newStateDir();
  firstSale = await serving({ producer: FIRST, host: synchronisedBoxHost(), stateDir }, sell);
});

describe("a production start whose chain is filed under another producer", () => {
  it("sold under its own producer before, the control", () => {
    expect(firstSale.status, firstSale.body).toBe(200);
    expect(recordOf(firstSale.workingOrderId).producer).toBe(FIRST);
  });

  it.each([
    ["with no note", null],
    ["with a note naming another release", { release: "0.0.1" }],
    ["with a note naming another producer", { producerTaxId: "11111111H" }],
    ["with a note naming another earlier producer", { fromProducerTaxId: "11111111H" }],
  ])("refuses sif.producer_changed %s, and leaves the note", async (_label, overrides) => {
    const stateDir = await newStateDir();
    const producer = otherThan(producerAtHead());
    if (overrides !== null) await noteTheOtherProducer(stateDir, overrides);
    const caught = await serving(
      { producer, host: synchronisedBoxHost(), stateDir },
      async () => undefined,
    ).catch((error: unknown) => error);
    expect(isAppError(caught) && caught.code).toBe("sif.producer_changed");
    expect(await noteExists(stateDir)).toBe(overrides !== null);
  });

  it("refuses sif.producer_changed with a matching note on a box that files no records, and leaves the note", async () => {
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const records = fiscalRecordCount(venue);
    beforeServerStarts();
    const handles = { venue: suite.db, node: suite.node };
    const { nodeId } = venue.cfg;
    await setSingletonRole(handles, nodeId, "secondary", "fenced");
    let outcome: unknown;
    try {
      outcome = await serving({ producer, host: unsynchronisedHost(), stateDir }, async () => {
        const { status, workingOrderId } = await sell();
        return { sale: status, record: recordOf(workingOrderId) };
      }).catch((error: unknown) => isAppError(error) && error.code);
    } finally {
      await setSingletonRole(handles, nodeId, "primary", "promote");
    }
    expect(outcome).toBe("sif.producer_changed");
    expect(fiscalRecordCount(venue)).toBe(records);
    expect(await noteExists(stateDir)).toBe(true);
  });

  it("with a note and the time service unsynchronised, stays up and waits, selling and opening nothing", async () => {
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const records = fiscalRecordCount(venue);
    const before = installations();

    const seen = await serving({ producer, host: unsynchronisedHost(), stateDir }, async () => {
      const sale = await sell();
      // The clock watch's whole look: devices, the time service, the jump.
      await built.watch!.check();
      return {
        sale,
        health: (await fetch(`http://127.0.0.1:${httpPort()}/health`)).status,
        alert: (await alerts()).find(({ code }) => code === "clock.unconfirmed"),
        status: built.start!.status,
      };
    });

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
    const producer = await noteTheOtherProducer(stateDir);
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

    const seen = await serving({ producer, host, stateDir }, async () => ({
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
      producer,
      installation: expect.stringMatching(/^[0-9A-Z]{5}$/),
    });
    expect(recordOf(seen.second.workingOrderId)).toEqual({ ...first, first: 0 });
  });

  it("deletes a note left over from an opening already made, and trades", async () => {
    const stateDir = await newStateDir();
    const producer = await noteLeftOver(stateDir);
    const before = installations();
    const sale = await serving({ producer, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
    expect(await noteExists(stateDir)).toBe(false);
    expect(installations()).toBe(before);
  });

  it("deletes a left-over note with the time service unsynchronised too, waiting for the time alone", async () => {
    const stateDir = await newStateDir();
    const producer = await noteLeftOver(stateDir);
    const seen = await serving({ producer, host: unsynchronisedHost(), stateDir }, async () => ({
      note: await noteExists(stateDir),
      cause: built.start!.cause,
    }));
    expect(seen).toEqual({ note: false, cause: "start" });
  });

  it.each([
    ["another release", { release: "0.0.1" }],
    ["another producer", { producerTaxId: "11111111H" }],
  ])("leaves a note naming %s alone, and trades", async (_label, overrides) => {
    const stateDir = await newStateDir();
    const producer = await noteLeftOver(stateDir, overrides);
    const sale = await serving({ producer, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
    expect(await noteExists(stateDir)).toBe(true);
  });

  it("trades when the note's name is a folder", async () => {
    const stateDir = await newStateDir();
    await mkdir(noteIn(stateDir));
    const producer = producerAtHead();
    const sale = await serving({ producer, host: synchronisedBoxHost(), stateDir }, sell);
    expect(sale.status, sale.body).toBe(200);
  });
});

/** Puts the box's clock in the middle of the `nth` minute after this file's first, where no two
 * cases open an installation on the same one. The steady clock is left alone. */
const firstMinute = Math.floor(Date.now() / 60_000);
const middleOfMinute = (nth: number) => (firstMinute + nth) * 60_000 + 30_000;
function inMinute(nth: number): void {
  readClockAs(middleOfMinute(nth));
}

let boxClock: BenchClock | undefined;
afterEach(() => {
  boxClock?.uninstall();
  boxClock = undefined;
});
/** Puts the box's clock at `wallMs`, for every reader of `Date`. */
function readClockAs(wallMs: number): void {
  boxClock?.uninstall();
  boxClock = installBenchClock(new Date(wallMs));
}

const clockAlerts = async (cookie?: string) =>
  (await alerts(cookie))
    .map(({ code }) => code)
    .filter((code) => code === "clock.unconfirmed" || code === "sif.identity_change_blocked");

const refusedUnconfirmed = { error: { code: "clock.unconfirmed", params: {} } };

describe("an opening refused at the start", () => {
  it("on a minute already used, keeps refusing sales, and opens at the clock watch's look in the next minute", async () => {
    inMinute(2);
    const earlier = await newStateDir();
    const before = installations();
    const first = await serving(
      {
        producer: await noteTheOtherProducer(earlier),
        host: synchronisedBoxHost(),
        stateDir: earlier,
      },
      sell,
    );
    expect(first.status, first.body).toBe(200);
    expect(installations()).toBe(before + 1);

    inMinute(2);
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const seen = await serving({ producer, host: synchronisedBoxHost(), stateDir }, async () => {
      const refused = await sell();
      const waiting = { alerts: await clockAlerts(), note: await noteExists(stateDir) };
      inMinute(3);
      await built.watch!.check();
      return { refused, waiting, sale: await sell(), alerts: await clockAlerts() };
    });

    expect(seen.refused.status, seen.refused.body).toBe(409);
    expect(JSON.parse(seen.refused.body)).toEqual(refusedUnconfirmed);
    expect(seen.waiting).toEqual({ alerts: ["clock.unconfirmed"], note: true });
    expect(seen.sale.status, seen.sale.body).toBe(200);
    expect(recordOf(seen.sale.workingOrderId)).toMatchObject({ first: 1, producer });
    expect(seen.alerts).toEqual([]);
    expect(await noteExists(stateDir)).toBe(false);
  });

  it("by an error, finishes the start, alerts, keeps Check the time open, and opens at the look after the error ends", async () => {
    inMinute(4);
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    opening.failure = Object.assign(new Error("disk I/O error"), { code: "EIO" });
    const before = installations();
    const seen = await serving({ producer, host: synchronisedBoxHost(), stateDir }, async () => {
      const refused = await sell();
      const started = await clockAlerts();
      opening.attempts = 0;
      await built.watch!.check();
      const challenge = await fetch(`http://127.0.0.1:${httpPort()}/api/box-clock/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: venue.cookie },
        body: "{}",
      });
      const waiting = {
        attempts: opening.attempts,
        alerts: await clockAlerts(),
        installations: installations(),
        challenge: { status: challenge.status, body: await challenge.json() },
      };
      opening.failure = null;
      await built.watch!.check();
      return { refused, started, waiting, sale: await sell(), alerts: await clockAlerts() };
    });

    expect(seen.refused.status, seen.refused.body).toBe(409);
    expect(JSON.parse(seen.refused.body)).toEqual(refusedUnconfirmed);
    expect(seen.started).toEqual(["sif.identity_change_blocked"]);
    expect(seen.waiting).toEqual({
      attempts: 1,
      alerts: ["sif.identity_change_blocked"],
      installations: before,
      challenge: {
        status: 200,
        body: expect.objectContaining({ challengeId: expect.any(String) }),
      },
    });
    expect(seen.sale.status, seen.sale.body).toBe(200);
    expect(recordOf(seen.sale.workingOrderId)).toMatchObject({ first: 1, producer });
    expect(seen.alerts).toEqual([]);
  });
});

describe("a chart that changes while the box waits to open its new installation", () => {
  const onServer = (write: (tx: Transaction) => Promise<void>) => built.inServerTransaction!(write);

  it.each<[string, [own: Standing, other: Standing] | null, number]>([
    ["the chart lists a spare that joined", ["serving-primary", "serving-secondary"], 6],
    [
      "the chart lists a main box it replaced, not yet removed",
      ["serving-primary", "sell-only"],
      8,
    ],
    ["the chart evicts it in favour of another", ["evicted", "serving-primary"], 10],
    ["no chart is saved", null, 12],
  ])(
    "keeps it from opening, with an alert, while %s, and lets it open once it serves alone",
    async (_label, standings, minute) => {
      inMinute(minute);
      const stateDir = await newStateDir();
      const producer = await noteTheOtherProducer(stateDir);
      const box = { nodeId: randomUUID(), contactUrl: "https://spare.example.com" };
      const before = installations();
      let synchronised = false;
      const host: BoxHostClient = {
        ...synchronisedBoxHost(),
        clockStatus: async () => clockServiceAnswer(synchronised),
      };
      const seen = await serving({ producer, host, stateDir }, async () => {
        await onServer(async (tx) => {
          if (standings === null) await tx.run(sql`delete from node_membership`);
          else
            await writeNodeMembershipTx(
              tx,
              chart(1, standings[0], [{ ...box, standing: standings[1] }]),
            );
        });
        synchronised = true;
        await built.watch!.check();
        const blocked = {
          sale: (await sell()).status,
          alerts: await clockAlerts(),
          installations: installations(),
          note: await noteExists(stateDir),
        };
        await onServer((tx) =>
          writeNodeMembershipTx(tx, chart(2, "serving-primary", [{ ...box, standing: "evicted" }])),
        );
        await built.watch!.check();
        return { blocked, sale: await sell(), alerts: await clockAlerts() };
      });

      expect(seen.blocked).toEqual({
        sale: 409,
        alerts: ["sif.identity_change_blocked"],
        installations: before,
        note: true,
      });
      expect(seen.sale.status, seen.sale.body).toBe(200);
      expect(recordOf(seen.sale.workingOrderId)).toMatchObject({ first: 1, producer });
      expect(installations()).toBe(before + 1);
      expect(seen.alerts).toEqual([]);
    },
  );
});

describe("a clock watch halted while the opening reads the time service", () => {
  it.each([
    ["opens nothing, and keeps the note and the confirmation without an alert", true, 26],
    ["opens and trades when it is not halted, the control", false, 28],
  ])("%s", async (_label, halts, minute) => {
    inMinute(minute);
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const before = installations();
    const records = fiscalRecordCount(venue);
    const pass: string[] = [];
    let synchronised = false;
    const host: BoxHostClient = {
      ...synchronisedBoxHost(),
      clockStatus: async () => {
        if (synchronised) {
          const inOpening = opening.attempts === 1 && built.start!.heldConfirmation !== null;
          pass.push(inOpening ? "the opening's" : "the look's");
          if (inOpening && halts) built.watch!.halt();
        }
        return clockServiceAnswer(synchronised);
      },
    };
    const seen = await serving({ producer, host, stateDir }, async () => {
      opening.attempts = 0;
      synchronised = true;
      await built.watch!.check();
      return {
        pass: [...pass],
        attempts: opening.attempts,
        status: built.start!.status,
        held: built.start!.heldConfirmation?.by,
        sale: (await sell()).status,
        alerts: await clockAlerts(),
        records: fiscalRecordCount(venue) - records,
        opened: installations() - before,
        note: await noteExists(stateDir),
      };
    });

    const reads = { pass: ["the look's", "the opening's"], attempts: 1 };
    expect(seen).toEqual(
      halts
        ? {
            ...reads,
            status: "waiting",
            held: "by_internet",
            sale: 409,
            alerts: ["clock.unconfirmed"],
            records: 0,
            opened: 0,
            note: true,
          }
        : {
            ...reads,
            status: "by_internet",
            held: undefined,
            sale: 200,
            alerts: [],
            records: 1,
            opened: 1,
            note: false,
          },
    );
  });
});

async function post(path: string, cookie: string, body: unknown) {
  const answer = await fetch(`http://127.0.0.1:${httpPort()}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      origin: "https://dashboard.example.com",
    },
    body: JSON.stringify(body),
  });
  const text = await answer.text();
  expect(answer.status, text).toBe(200);
  return JSON.parse(text) as { challengeId: string; boxAt: string };
}

async function checkTheTime(aheadMs: number, keep: { keep?: true } = {}) {
  const { challengeId, boxAt } = await post("/api/box-clock/challenge", venue.cookie, {});
  const deviceAt = Date.parse(boxAt) + aheadMs;
  await post("/api/box-clock/confirm", venue.cookie, { challengeId, deviceAt, ...keep });
}

async function confirmOnBoxStatus() {
  const { challengeId } = await post("/api/box/clock-challenge", adminCookie, {});
  await post("/api/box/clock-confirm", adminCookie, { challengeId, asShown: true });
}

describe("a person who confirms the time while the box waits to open its new installation", () => {
  it.each<[string, () => Promise<void>, number]>([
    ["from a till whose time agrees", () => checkTheTime(20_000), 14],
    ["by keeping the box's time on a till", () => checkTheTime(600_000, { keep: true }), 16],
    ["on Box status", confirmOnBoxStatus, 18],
  ])(
    "%s has it opened by the clock watch, woken, with the time service unsynchronised",
    async (_label, confirm, minute) => {
      inMinute(minute);
      const stateDir = await newStateDir();
      const producer = await noteTheOtherProducer(stateDir);
      const before = installations();
      const seen = await serving({ producer, host: unsynchronisedHost(), stateDir }, async () => {
        const refused = await sell();
        await confirm();
        // Well inside the 15 seconds between the watch's own looks.
        await vi.waitFor(() => expect(built.start!.status).toBe("by_person"), { timeout: 8_000 });
        return { refused, sale: await sell(), alerts: await clockAlerts() };
      });

      expect(seen.refused.status, seen.refused.body).toBe(409);
      expect(JSON.parse(seen.refused.body)).toEqual(refusedUnconfirmed);
      expect(seen.sale.status, seen.sale.body).toBe(200);
      expect(recordOf(seen.sale.workingOrderId)).toEqual({
        first: 1,
        producer,
        installation: expect.stringMatching(/^[0-9A-Z]{5}$/),
      });
      expect(installations()).toBe(before + 1);
      expect(await noteExists(stateDir)).toBe(false);
      expect(seen.alerts).toEqual([]);
    },
    30_000,
  );
});

describe("a person's confirmation that cannot open the new installation", () => {
  const refusedOpening = () =>
    vi.waitFor(
      () => {
        expect(opening.attempts).toBeGreaterThan(0);
        expect(built.start!.heldConfirmation).toBeNull();
      },
      { timeout: 8_000 },
    );

  it("is dropped when the clock steps before the opening, opens nothing, and leaves Check the time to open it", async () => {
    inMinute(22);
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const before = installations();
    const records = fiscalRecordCount(venue);
    let looks = Promise.resolve();
    const host: BoxHostClient = {
      ...unsynchronisedHost(),
      clockStatus: async () => {
        await looks;
        return clockServiceAnswer(false);
      },
    };
    const seen = await serving({ producer, host, stateDir }, async () => {
      opening.attempts = 0;
      let release = () => {};
      looks = new Promise((resolve) => (release = resolve));
      try {
        await checkTheTime(0, { keep: true });
        expect(built.start!.heldConfirmation?.by).toBe("by_person");
        expect(opening.attempts).toBe(0);
        // Less than the clock watch counts as a jump.
        readClockAs(Date.now() + 30_000);
      } finally {
        release();
      }
      await refusedOpening();
      expect({
        status: built.start!.status,
        sale: (await sell()).status,
        alerts: await clockAlerts(),
        installations: installations(),
        records: fiscalRecordCount(venue),
        note: await noteExists(stateDir),
      }).toEqual({
        status: "waiting",
        sale: 409,
        alerts: ["clock.unconfirmed"],
        installations: before,
        records,
        note: true,
      });
      await checkTheTime(20_000);
      await vi.waitFor(() => expect(built.start!.status).toBe("by_person"), { timeout: 8_000 });
      return { sale: await sell(), alerts: await clockAlerts() };
    });

    expect(seen.sale.status, seen.sale.body).toBe(200);
    expect(recordOf(seen.sale.workingOrderId)).toMatchObject({ first: 1, producer });
    expect(installations()).toBe(before + 1);
    expect(seen.alerts).toEqual([]);
  }, 30_000);

  it("is dropped when it keeps a time before the release's, opens nothing, and leaves a set from the till to open it", async () => {
    // A session does not outlive a set of the clock this far.
    inMinute(24);
    const cookieAfterTheSet = await administratorCookie();
    readClockAs(Date.parse("2026-10-01T10:00:30Z"));
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const before = installations();
    const records = fiscalRecordCount(venue);
    const host: BoxHostClient = {
      ...unsynchronisedHost(),
      setClock: async ({ targetMs }) => {
        const beforeMs = Date.now();
        readClockAs(targetMs);
        return { available: true, beforeMs, afterMs: targetMs };
      },
    };
    const seen = await serving({ producer, host, stateDir }, async () => {
      opening.attempts = 0;
      await checkTheTime(600_000, { keep: true });
      await refusedOpening();
      expect({
        status: built.start!.status,
        sale: (await sell()).status,
        alerts: await clockAlerts(),
        installations: installations(),
        records: fiscalRecordCount(venue),
        note: await noteExists(stateDir),
      }).toEqual({
        status: "waiting",
        sale: 409,
        alerts: ["clock.unconfirmed"],
        installations: before,
        records,
        note: true,
      });
      await checkTheTime(middleOfMinute(24) - Date.now());
      await vi.waitFor(() => expect(built.start!.status).toBe("by_person"), { timeout: 8_000 });
      return { sale: await sell(), alerts: await clockAlerts(cookieAfterTheSet) };
    });

    expect(seen.sale.status, seen.sale.body).toBe(200);
    expect(recordOf(seen.sale.workingOrderId)).toMatchObject({ first: 1, producer });
    expect(installations()).toBe(before + 1);
    expect(seen.alerts).toEqual([]);
  }, 30_000);
});

describe("two devices that agree with the box's time", () => {
  function agree(): void {
    const at = { wallMs: Date.now(), monoMs: performance.now() };
    built.witnesses!.noteDevice("till-1", "192.168.10.20", at.wallMs + 1_000, at);
    built.witnesses!.noteDevice("till-2", "192.168.10.21", at.wallMs + 2_000, at);
  }

  it("end the wait of a box with no note, the control", async () => {
    inMinute(20);
    const stateDir = await newStateDir();
    const status = await serving(
      { producer: producerAtHead(), host: unsynchronisedHost(), stateDir },
      async () => {
        agree();
        await built.watch!.check();
        return built.start!.status;
      },
    );
    expect(status).toBe("by_devices");
  });

  it("leave a box that waits to open its new installation waiting, and open nothing", async () => {
    inMinute(20);
    const stateDir = await newStateDir();
    const producer = await noteTheOtherProducer(stateDir);
    const before = installations();
    const seen = await serving({ producer, host: unsynchronisedHost(), stateDir }, async () => {
      agree();
      await built.watch!.check();
      return {
        status: built.start!.status,
        held: built.start!.heldConfirmation,
        sale: (await sell()).status,
      };
    });
    expect(seen).toEqual({ status: "waiting", held: null, sale: 409 });
    expect(installations()).toBe(before);
    expect(await noteExists(stateDir)).toBe(true);
  });
});
