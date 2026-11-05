// A simulation of two boxes in one process, not physical qualification. It covers two boxes only:
// each with its own folders, real start, real routes and real TLS on its own port; the runs say
// nothing of a third box, of two machines or of a real network.
//
// What real boxes will get from A947 3b, and this file stands in for:
// - M2's venue.db is a copy M1's file made with VACUUM INTO before M1 starts, where a real spare
//   holds the copy of its join. M1 sells afterwards, so what reaches M2 later comes by the final copy.
// - M1's `nodes` row for M2, on the key M2 sealed in its own node.db.
// - M2's endorsement in the chart both boxes hold. M1 answers M2's signed query only if the chart M2
//   hands it after activation still carries it (`adopt.ts:154-159` checks the one a real join gives).
// - M2's mirror link, naming M1 and pinning M1's certificate authority, and its pin of M1's key.
//
// What is a stand-in for the outside world, here and later in the run:
// - AEAT is `createFakeAeat`, reached through the real drain, one record to a batch, and records what
//   each box sent. AEAT's clock reading answers nothing.
// - The card provider is `FakePaymentProvider` behind the held Stripe credential, and Stripe's
//   reconciler finds nothing. A sweep on M1 hears no answer for an open payment; one on M2 captures.
// - `restart` and a spied `process.kill` stand for the SIGTERM that ends a real process; the test
//   starts the box again in this process.
// - `requestFromBox` says no request comes from the box itself: every client here is on loopback.
//
// No dormant filing setup is created for M2: it writes its own at the switch-on, which comes after
// the point this run has reached.
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { Agent } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  insertReservedNodeTx,
  nodes,
  openVenueDatabase,
  stampDeployment,
  withTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  putCredential,
  type KeyRing,
} from "@waitron/credentials";
import { startManagementSession } from "@waitron/identity";
import {
  endorseKey,
  signDocumentBody,
  type MembershipDocumentBody,
  type SignedMembershipDocument,
} from "@waitron/membership";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readHandoverOperation, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { captureAttempting, listAttempting, type CollectionOwners } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { StartServerSeams, StartedServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { COPY_PLACED_EVENT } from "./handover-place-copy.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { provisionBillVenue, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { freePorts } from "./testing/free-ports.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { serverFixture } from "./testing/server-fixture.js";

/** What AEAT was sent, in order, by whichever box sent it. */
const outside = vi.hoisted(() => ({
  submits: [] as {
    venueFile: string;
    recordIds: string[];
    idSistemaInformatico: string[];
    numeroInstalacion: string[];
  }[],
  holdSubmit: null as Promise<void> | null,
}));

// The pending-card loop sleeps at most 50 ms between passes, so a box that sweeps does so inside the
// run, and a sweep count that stays put is a loop that stopped.
vi.mock("./pending-card-recovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pending-card-recovery.js")>();
  return {
    ...actual,
    runPendingCardLoop: (...args: Parameters<typeof actual.runPendingCardLoop>) => {
      const [deps] = args;
      return actual.runPendingCardLoop({
        ...deps,
        sleep: (ms, signal) =>
          new Promise<void>((done) => {
            const timer = setTimeout(done, Math.min(ms, 50));
            signal.addEventListener(
              "abort",
              () => {
                clearTimeout(timer);
                done();
              },
              { once: true },
            );
          }),
      });
    },
  };
});

// AEAT's clock reading answers nothing, so the only AEAT traffic is the drain's.
vi.mock("./clock-watch.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./clock-watch.js")>();
  return {
    ...actual,
    startClockWatch: (...args: Parameters<typeof actual.startClockWatch>) => {
      const [deps] = args;
      return actual.startClockWatch({
        ...deps,
        backend: new Proxy(deps.backend, {
          get: (target, key) => {
            if (key === "readAuthorityTime") return () => Promise.resolve(null);
            const value: unknown = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      });
    },
  };
});

// The real drain and its loop, with AEAT's transport replaced. A cap of one makes each record a full
// batch, which goes at once, so a record still waiting is one no later pass was allowed to claim.
vi.mock("@waitron/module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/module")>();
  return {
    ...actual,
    fiscalSlot: (...args: Parameters<typeof actual.fiscalSlot>) => {
      const real = actual.fiscalSlot(...args);
      if (real.id !== "verifactu") return real;
      const drainHere: typeof real.drain = async (
        { db, environment, skipRetryMs, signal },
        now,
      ) => {
        // Imported here: the fiscal package imports this mocked module, so a factory-time import
        // never settles.
        const { drain } = await import("@waitron/fiscal-verifactu");
        const { createFakeAeat } = await import("@waitron/verifactu/testing");
        const fake = createFakeAeat({ serverNow: new Date(Date.now() + 60_000) }).client();
        const venueFile = db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
        const client = {
          ...fake,
          submit: async (...submitted: Parameters<typeof fake.submit>) => {
            const altas = submitted[1].flatMap((record) =>
              "RegistroAlta" in record ? [record.RegistroAlta] : [],
            );
            outside.submits.push({
              venueFile,
              recordIds: altas.map((alta) => alta.RefExterna!),
              idSistemaInformatico: altas.map(
                (alta) => alta.SistemaInformatico.IdSistemaInformatico,
              ),
              numeroInstalacion: altas.map((alta) => alta.SistemaInformatico.NumeroInstalacion),
            });
            const hold = outside.holdSubmit;
            outside.holdSubmit = null;
            if (hold !== null) await hold;
            return fake.submit(...submitted);
          },
        };
        return drain(
          {
            db,
            resolveClient: () => Promise.resolve(client),
            skipRetryMs,
            environment,
            maxRegistrosPorEnvio: 1,
            ...(signal === undefined ? {} : { signal }),
          },
          now,
        );
      };
      return { ...real, drain: drainHere };
    },
  };
});

// Stripe's reconciler finds nothing.
vi.mock("@waitron/payments-stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/payments-stripe")>();
  class FindsNothing {
    readonly provider = "stripe";
    reconcile(period: { from: Date; to: Date }) {
      return Promise.resolve({
        period,
        checked: 0,
        unsettled: [],
        lostSettlement: [],
        orphan: [],
        missingLocal: [],
        drift: [],
        incidentsRaised: 0,
        remediated: 0,
        remediationFailures: [],
      });
    }
  }
  return { ...actual, StripeReconciler: FindsNothing };
});

const { beforeServerStarts, startServer } = serverFixture();

const migrations = migrationOptionsFor(manifestSets(), null);
const m1Files = useVenueDb({ migrations, resetPerTest: false, timeoutMs: 120_000 });

const KEY_ENV = {
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
};
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PASSWORD = "dashPass123";
/** How long the run keeps AEAT's answer back after the stepdown has answered. */
const HELD_MS = 500;

function hold() {
  let release!: () => void;
  const wait = new Promise<void>((done) => (release = done));
  return { release, wait };
}

interface Box {
  name: "M1" | "M2";
  nodeId: string;
  port: number;
  url: string;
  venueDir: string;
  venueFile: string;
  stateDir: string;
  env: Record<string, string>;
  /** The server now running here, if any. */
  server?: StartedServer;
  /** The provider the running server's card sweep and till reach. */
  card?: FakePaymentProvider;
  /** How many sweeps of the pending-card loop reached the provider, by any run of this box. */
  sweeps: number;
  /** Resolved the first time this run of the box asks for a restart. */
  restartAsked: ReturnType<typeof hold>;
  agent: Agent;
}

/** What the boxes hold, for this half of the run and whatever continues it. */
interface Boxes {
  m1: Box;
  m2: Box;
  venue: BillVenue;
  adminCookie: string;
  openTabId: string;
  scratch: string;
}

function seamsFor(box: Box): StartServerSeams {
  return {
    requestFromBox: () => false,
    stepdown: { mount: () => {}, restart: () => box.restartAsked.release() },
    cardPool: ({ db }) => {
      const card = new FakePaymentProvider(db);
      Object.defineProperty(card, "provider", { value: "stripe" });
      card.resolvePending = (async (now: Date, collection: CollectionOwners) => {
        box.sweeps += 1;
        if (box.name === "M1") {
          return { nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 };
        }
        const rows = await withTransaction(db, (tx) => listAttempting(tx, "stripe", collection));
        for (const { paymentRef } of rows) {
          await withTransaction(db, (tx) =>
            captureAttempting(tx, {
              provider: "stripe",
              paymentRef,
              settledAt: now,
              externalRef: `ext-${paymentRef}`,
            }),
          );
        }
        return { nextDueAt: null, forwarded: rows.length, declined: 0, incidentsRaised: 0 };
      }) as typeof card.resolvePending;
      box.card = card;
      return {
        get: (providerId) =>
          providerId === "stripe"
            ? Promise.resolve(card)
            : Promise.reject(new Error(`no stand-in for ${providerId}`)),
        evict: () => {},
      };
    },
  };
}

async function start(box: Box): Promise<void> {
  box.restartAsked = hold();
  box.server = await startServer(box.env, box.env, seamsFor(box));
}

/** A box's own request over its real TLS, the way a browser that trusts its authority makes one. */
function ask(
  box: Box,
  path: string,
  init: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  return fetch(`${box.url}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      origin: box.url,
      "sec-fetch-site": "same-origin",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.cookie === undefined ? {} : { cookie: init.cookie }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    dispatcher: box.agent,
  } as RequestInit);
}

async function nodeProbe(box: Box): Promise<{ nodeId: string; acceptingSales: boolean }> {
  const answer = await ask(box, "/api/node");
  expect(answer.status).toBe(200);
  return (await answer.json()) as { nodeId: string; acceptingSales: boolean };
}

/** Rows from a box's files, read-only, because M2's venue.db is replaced under any open handle. */
function readRows<T>(path: string, statement: string, ...values: string[]): T[] {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    return raw.prepare(statement).all(...values) as T[];
  } finally {
    raw.close();
  }
}

function operationRow(box: Box) {
  return readRows<{ state: string; waiting_reason: string | null; role: string }>(
    join(box.venueDir, "node.db"),
    "select state, waiting_reason, role from node_handover_operations where operation_id = ?",
    OP,
  )[0];
}

/**
 * M1 selling and M2 its mirror, each started for real, M2 first so M1's start check gets its answer.
 * The chart, M1's row for M2 and M2's endorsement are in M2's seed because the copy carries them.
 */
async function twoBoxes(): Promise<Boxes> {
  const scratch = await mkdtemp(join(tmpdir(), "waitron-handover-controlled-"));
  const ring: KeyRing = loadKeyRing(KEY_ENV);
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  beforeServerStarts();
  const venue = await provisionBillVenue(m1Files.db);
  const m1Id: string = venue.cfg.nodeId;
  const m2Id = randomUUID();
  await stampDeployment(m1Files.db, "preproduction");
  const [m1Port, m2Port] = await freePorts(2);
  const m1Url = `https://localhost:${m1Port}`;
  const m2Url = `https://localhost:${m2Port}`;

  const makeState = async (name: string) => {
    const stateDir = join(scratch, name);
    await mkdir(stateDir, { recursive: true });
    await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-none": false } }),
    );
    return stateDir;
  };
  const m1State = await makeState("m1-state");
  const m2State = await makeState("m2-state");
  const m1Ca = await readFile(join(m1State, "tls/ca.crt"), "utf8");
  const m2Ca = await readFile(join(m2State, "tls/ca.crt"), "utf8");

  await establishNodeIdentity({ ownerDb: m1Files.db, node: m1Files.node, ring }, m1Id);
  const m1Key = await readNodeIdentityKey(m1Files.node, ring, m1Id);

  // M2's key is sealed in its own node.db, so its folder exists before its seed does; the row this
  // stamps does not exist yet, and M2's row comes from M1 in the seed.
  const m2Dir = await mkdtemp(join(scratch, "m2-venue-"));
  await applyMigrations(m2Dir, migrations);
  const m2Empty = await openVenueDatabase(m2Dir);
  await establishNodeIdentity({ ownerDb: m2Empty.venue, node: m2Empty.node, ring }, m2Id);
  const m2Public = nodeSigningPublicKey(await readNodeIdentityKey(m2Empty.node, ring, m2Id));
  await m2Empty.close();

  const [m1Row] = await m1Files.db.select().from(nodes).where(eq(nodes.id, m1Id));
  await withTransaction(m1Files.db, (tx) =>
    insertReservedNodeTx(tx, {
      id: m2Id,
      locationId: venue.cfg.locationId,
      name: `${m1Row!.name} (standby)`,
      filingModule: m1Row!.filingModule,
      taxModule: m1Row!.taxModule,
      publicKey: m2Public,
      endorsement: endorseKey(m2Id, m2Public, m1Id, m1Key),
    }),
  );
  const body: MembershipDocumentBody = {
    term: 3,
    nodes: [
      { nodeId: m1Id, contactUrl: m1Url, standing: "serving-primary" },
      { nodeId: m2Id, contactUrl: m2Url, standing: "serving-secondary" },
    ],
  };
  const chart: SignedMembershipDocument = {
    body,
    signerNodeId: m1Id,
    signature: signDocumentBody(body, m1Key),
    endorsements: [endorseKey(m2Id, m2Public, m1Id, m1Key)],
  };
  await writeNodeMembership(m1Files.db, chart);

  // The fixture adds a standard series of its own; a sale files in the venue's.
  await m1Files.db.execute(
    sql`update invoice_series set retired_at = ${new Date().toISOString()}
        where node_id = ${m1Id} and purpose = 'standard' and id <> ${venue.seriesId}`,
  );
  await m1Files.db.execute(sql`update card_readers set provider = 'stripe'`);
  await withTransaction(m1Files.db, (tx) =>
    putCredential(tx, ring, {
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_controlled",
        webhookSecret: "whsec_controlled",
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/no",
      },
    }),
  );
  const adminSession = await withTransaction(m1Files.db, (tx) =>
    startManagementSession(tx, { personId: venue.adminId }),
  );

  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(join(m2Dir, `venue.db${suffix}`), { force: true });
  }
  m1Files.db.run(sql`vacuum into ${join(m2Dir, "venue.db")}`);
  const m2Files = await openVenueDatabase(m2Dir);
  await setNodeMode({ venue: m2Files.venue, node: m2Files.node }, m2Id, "mirror");
  await writeMirrorLink(m2Files.node, m2Id, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "localhost",
    boxCaPem: m1Ca,
    originNodeId: m1Id,
  });
  await pinMainBoxKey(m2Files.node, m2Id, {
    nodeId: m1Id,
    publicKey: nodeSigningPublicKey(m1Key),
  });
  await m2Files.close();

  // After the seed, so the only way M2 can come to hold it is the final copy.
  const openTabId = await tabWith(venue, "Paella");

  const envFor = (
    stateDir: string,
    venueDir: string,
    nodeId: string,
    port: number,
  ): Record<string, string> => ({
    ...KEY_ENV,
    WAITRON_HTTP_LANDING_PORT: "0",
    WAITRON_HTTP_HOST: "127.0.0.1",
    WAITRON_HTTP_PORT: String(port),
    WAITRON_MANAGEMENT_RP_ID: "localhost",
    WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
    WAITRON_STATE_DIR: stateDir,
    WAITRON_VENUE_DIR: venueDir,
    WAITRON_NODE_ID: nodeId,
    WAITRON_MIGRATIONS_DIR: migrationsRoot,
    WAITRON_ENV: "preproduction",
    WAITRON_CLOUD_ORIGIN: "https://cloud.example",
    WAITRON_MAX_TICK_MS: "600000",
    WAITRON_MIN_TICK_MS: "200",
    WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled",
  });
  const m1File = m1Files.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const m1: Box = {
    name: "M1",
    nodeId: m1Id,
    port: m1Port!,
    url: m1Url,
    venueDir: dirname(m1File),
    venueFile: m1File,
    stateDir: m1State,
    env: envFor(m1State, dirname(m1File), m1Id, m1Port!),
    sweeps: 0,
    restartAsked: hold(),
    agent: new Agent({ connect: { ca: m1Ca } }),
  };
  const m2: Box = {
    name: "M2",
    nodeId: m2Id,
    port: m2Port!,
    url: m2Url,
    venueDir: m2Dir,
    venueFile: join(m2Dir, "venue.db"),
    stateDir: m2State,
    env: envFor(m2State, m2Dir, m2Id, m2Port!),
    sweeps: 0,
    restartAsked: hold(),
    agent: new Agent({ connect: { ca: m2Ca } }),
  };
  await start(m2);
  await start(m1);
  return {
    m1,
    m2,
    venue,
    adminCookie: `${MANAGEMENT_COOKIE}=${adminSession.token}`,
    openTabId,
    scratch,
  };
}

/** The filing state one record's row says, on either box. */
const filingStateOf = (file: string, recordId: string): string | undefined =>
  readRows<{ estado: string }>(file, "select estado from envios where registro_id = ?", recordId)[0]
    ?.estado;

/** What the run saw up to M1's restricted start. */
interface StepdownSeen {
  records: { filed: string; inFlight: string; waiting: string };
  attemptingRef: string;
  m1Selling: boolean;
  m2SellingBefore: boolean;
  m2SeedHeld: { tabs: number; records: number; payments: number };
  offer: { status: number; body: unknown };
  stateAtOffer: { m1: string | undefined; m2: string | undefined };
  whileAeatHeld: { inFlight: string | undefined; restartAsked: boolean };
  submitsAtStepdownAnswer: number;
  m1SweepsBeforeStepdown: number;
  m1SweepsAtRestart: number;
  m1Restricted: { nodeId: string; acceptingSales: boolean };
  m1RefusedSale: { status: number; text: string };
  inFlightAfterStepdown: string | undefined;
}

/** What the run saw from there to the start of M2 that placed the copy. */
interface PlacingSeen {
  m2StateBeforePlacing: string | undefined;
  m2Records: string[];
  m2AfterPlacing: { acceptingSales: boolean };
  m1StateAtEnd: string | undefined;
  m1StillAnswers: { acceptingSales: boolean };
}

/** A cash sale on M1, by its record. */
async function sale(boxes: Boxes): Promise<string> {
  const before = new Set(recordIds(boxes.m1.venueFile));
  const answer = await ask(boxes.m1, "/api/sales", {
    cookie: boxes.venue.cookie,
    body: saleBody(boxes),
  });
  const text = await answer.text();
  expect(answer.status, text).toBe(200);
  const added = recordIds(boxes.m1.venueFile).filter((id) => !before.has(id));
  expect(added, text).toHaveLength(1);
  return added[0]!;
}

function saleBody(boxes: Boxes) {
  return {
    zoneId: boxes.venue.zoneId,
    lines: [{ menuItemId: boxes.venue.offerFor("Caña"), quantity: "1" }],
    tender: { method: "cash", amount: "3.00" },
  };
}

function recordIds(file: string): string[] {
  return readRows<{ id: string }>(file, "select id from registros_facturacion").map((r) => r.id);
}

async function sendOutbox(boxes: Boxes): Promise<void> {
  const retry = await ask(boxes.m1, "/management-api/fiscal-outbox/retry", {
    cookie: boxes.adminCookie,
    body: {},
  });
  expect(retry.status).toBe(200);
}

/**
 * From a selling M1 with one record filed, one in AEAT's hands and one waiting, through the offer
 * and the stepdown to M1's restricted start.
 */
async function offerToStepdown(boxes: Boxes): Promise<StepdownSeen> {
  const { m1, m2 } = boxes;
  const m1Selling = (await nodeProbe(m1)).acceptingSales;
  const m2SellingBefore = (await nodeProbe(m2)).acceptingSales;

  const filed = await sale(boxes);
  await sendOutbox(boxes);
  await vi.waitFor(() => expect(filingStateOf(m1.venueFile, filed)).toBe("aceptado"), {
    timeout: 20_000,
  });

  const aeat = hold();
  outside.holdSubmit = aeat.wait;
  const inFlight = await sale(boxes);
  await sendOutbox(boxes);
  await vi.waitFor(() => expect(outside.holdSubmit).toBeNull(), { timeout: 20_000 });
  const waiting = await sale(boxes);

  m1.card!.stallNextCollect();
  const paying = await ask(m1, "/api/pay", {
    cookie: boxes.venue.cookie2,
    body: {
      id: randomUUID(),
      zoneId: boxes.venue.zoneId,
      lines: [{ menuItemId: boxes.venue.offerFor("Caña"), quantity: "1" }],
    },
  });
  const payingText = await paying.text();
  const [attempting] = readRows<{ payment_ref: string }>(
    m1.venueFile,
    "select payment_ref from payments where state = 'attempting'",
  );
  expect(attempting, payingText).toBeDefined();
  await vi.waitFor(() => expect(m1.sweeps).toBeGreaterThan(0), { timeout: 20_000 });

  const m2SeedHeld = {
    tabs: readRows(m2.venueFile, "select id from working_orders where id = ?", boxes.openTabId)
      .length,
    records: recordIds(m2.venueFile).length,
    payments: readRows(m2.venueFile, "select payment_ref from payments").length,
  };

  const m1SweepsBeforeStepdown = m1.sweeps;
  const started = await ask(m1, "/management-api/handover", {
    cookie: boxes.adminCookie,
    body: {
      operationId: OP,
      destinationNodeId: m2.nodeId,
      signIn: { method: "password", password: PASSWORD },
    },
  });
  const offer = { status: started.status, body: (await started.json()) as unknown };
  const submitsAtStepdownAnswer = outside.submits.length;
  const stateAtOffer = { m1: operationRow(m1)?.state, m2: operationRow(m2)?.state };

  let restartAsked = false;
  void m1.restartAsked.wait.then(() => (restartAsked = true));
  await new Promise((resolve) => setTimeout(resolve, HELD_MS));
  const whileAeatHeld = { inFlight: filingStateOf(m1.venueFile, inFlight), restartAsked };
  aeat.release();
  await m1.restartAsked.wait;
  await m1.server!.close();
  const m1SweepsAtRestart = m1.sweeps;

  await start(m1);
  const m1Restricted = await nodeProbe(m1);
  const refused = await ask(m1, "/api/sales", {
    cookie: boxes.venue.cookie,
    body: saleBody(boxes),
  });
  const m1RefusedSale = { status: refused.status, text: await refused.text() };

  return {
    records: { filed, inFlight, waiting },
    attemptingRef: attempting!.payment_ref,
    m1Selling,
    m2SellingBefore,
    m2SeedHeld,
    offer,
    stateAtOffer,
    whileAeatHeld,
    submitsAtStepdownAnswer,
    m1SweepsBeforeStepdown,
    m1SweepsAtRestart,
    m1Restricted,
    m1RefusedSale,
    inFlightAfterStepdown: filingStateOf(m1.venueFile, inFlight),
  };
}

/**
 * M2's fetch, comparison and acceptance, M1's relinquishment and the start of M2 that places the
 * copy. It stops with M2 a running mirror at `filing_assumed`, where activation takes over.
 */
async function fetchToPlacing(boxes: Boxes): Promise<PlacingSeen> {
  const { m1, m2 } = boxes;
  await vi.waitFor(() => expect(operationRow(m2)?.state).toBe("filing_assumed"), {
    timeout: 90_000,
    interval: 250,
  });
  await m2.restartAsked.wait;
  const m2StateBeforePlacing = operationRow(m2)?.state;
  await m2.server!.close();
  await start(m2);
  return {
    m2StateBeforePlacing,
    m2Records: recordIds(m2.venueFile).sort(),
    m2AfterPlacing: await nodeProbe(m2),
    m1StateAtEnd: (await readHandoverOperation(m1Files.node, m1.nodeId, OP))?.state,
    m1StillAnswers: await nodeProbe(m1),
  };
}

describe("a controlled handover between two boxes, simulated in one process", () => {
  let boxes: Boxes | undefined;
  let stepdown: StepdownSeen | undefined;
  let placing: PlacingSeen | undefined;
  let placingFailure: unknown;
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

  beforeAll(async () => {
    boxes = await twoBoxes();
    stepdown = await offerToStepdown(boxes);
    // Held back, so a run in which M2 never gets there still reports what M1 did meanwhile.
    try {
      placing = await fetchToPlacing(boxes);
    } catch (error) {
      placingFailure = error;
    }
  }, 240_000);

  afterAll(async () => {
    kill.mockRestore();
    if (boxes === undefined) return;
    await boxes.m1.server?.close();
    await boxes.m2.server?.close();
    await boxes.m1.agent.close();
    await boxes.m2.agent.close();
    await rm(boxes.scratch, { recursive: true, force: true });
  }, 60_000);

  const seen = (): { b: Boxes; run: StepdownSeen } => {
    if (boxes === undefined || stepdown === undefined) throw new Error("no stepdown was observed");
    return { b: boxes, run: stepdown };
  };
  const placed = (): { b: Boxes; run: StepdownSeen; end: PlacingSeen } => {
    if (placing === undefined) throw placingFailure ?? new Error("nothing was placed");
    return { ...seen(), end: placing };
  };

  it("starts with M1 selling, and M2 a mirror holding nothing M1 recorded after its seed", () => {
    const { run } = seen();
    expect(run.m1Selling).toBe(true);
    expect(run.m2SellingBefore).toBe(false);
    expect(run.m2SeedHeld).toEqual({ tabs: 0, records: 0, payments: 0 });
  });

  it("M2 records the offer, and M1 steps down, before M1's request is answered", () => {
    const { run } = seen();
    expect(run.offer.status, JSON.stringify(run.offer.body)).toBe(200);
    expect(run.stateAtOffer).toEqual({ m1: "source_stepped_down", m2: "prepared" });
  });

  it("a batch being sent when the stepdown starts finishes before M1 restarts", () => {
    const { run } = seen();
    expect(run.whileAeatHeld).toEqual({ inFlight: "enviando", restartAsked: false });
    expect(run.inFlightAfterStepdown).toBe("aceptado");
  });

  // Control, run locally and not committed: the start's early return alone left out, M1 waits on M2
  // at its start check, sells nothing, and only M2's three cases fail. With `checkPeers` also
  // answering proceed, this case and the next two fail, the next with three batches against two.
  it("M1's restricted start answers acceptingSales false and serves no sale", () => {
    const { b, run } = seen();
    expect(run.m1Restricted).toMatchObject({ nodeId: b.m1.nodeId, acceptingSales: false });
    // A restricted start mounts no till route at all.
    expect(run.m1RefusedSale.status, run.m1RefusedSale.text).toBe(404);
  });

  // Weaker than its name: with `signalDuties` in `stepDown` left out this still passes, because the
  // close that follows also stops the drain; `handover-stepdown.real.test.ts` pins that signal.
  it("M1 starts no new filing after its stepdown: AEAT heard only the two batches before it", () => {
    const { b, run } = seen();
    const { filed, inFlight, waiting } = run.records;
    expect(run.submitsAtStepdownAnswer).toBe(2);
    expect(outside.submits.map((s) => [s.venueFile, s.recordIds])).toEqual([
      [b.m1.venueFile, [filed]],
      [b.m1.venueFile, [inFlight]],
    ]);
    expect(filingStateOf(b.m1.venueFile, waiting)).toBe("pendiente");
  });

  it("M1's card sweep stops at the stepdown and M2's never ran as a mirror", () => {
    const { b, run } = seen();
    expect(run.m1SweepsBeforeStepdown).toBeGreaterThan(0);
    expect(b.m1.sweeps).toBe(run.m1SweepsAtRestart);
    expect(b.m2.sweeps).toBe(0);
  });

  it("M1 relinquishes filing to M2, which records it and asks for the start that places", () => {
    const { b, end } = placed();
    expect(end.m1StateAtEnd).toBe("filing_relinquished");
    expect(end.m1StillAnswers.acceptingSales).toBe(false);
    expect(end.m2StateBeforePlacing).toBe("filing_assumed");
    expect(operationRow(b.m2)).toMatchObject({ state: "filing_assumed", waiting_reason: null });
  });

  it("M2's start places the copy once and stays a mirror that sells nothing", () => {
    const { b, end } = placed();
    expect(
      readRows(
        join(b.m2.venueDir, "node.db"),
        "select kind from node_handover_events where operation_id = ? and kind = ?",
        OP,
        COPY_PLACED_EVENT,
      ),
    ).toHaveLength(1);
    expect(existsSync(acceptedCopyPath(b.m2.stateDir, OP))).toBe(false);
    expect(end.m2AfterPlacing.acceptingSales).toBe(false);
  });

  it("the copy M2 placed holds M1's final state: every record, the batch's answer, the open table and the card payment", () => {
    const { b, run, end } = placed();
    const { filed, inFlight, waiting } = run.records;
    const copy = b.m2.venueFile;
    expect(end.m2Records).toEqual([filed, inFlight, waiting].sort());
    expect(filingStateOf(copy, filed)).toBe("aceptado");
    expect(filingStateOf(copy, inFlight)).toBe("aceptado");
    expect(filingStateOf(copy, waiting)).toBe("pendiente");
    expect(readRows(copy, "select status from working_orders where id = ?", b.openTabId)).toEqual([
      { status: "open" },
    ]);
    expect(
      readRows(
        copy,
        "select state, node_id from payments where payment_ref = ?",
        run.attemptingRef,
      ),
    ).toEqual([{ state: "attempting", node_id: b.m1.nodeId }]);
  });

  it("nothing asked this process to stop", () => {
    expect(kill).not.toHaveBeenCalled();
  });
});
