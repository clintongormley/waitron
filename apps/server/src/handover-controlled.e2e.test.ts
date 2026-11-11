import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
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
// - The same key ring on both boxes (a real spare gets it at joining, `adopt.ts:167`), which the
//   offer checks by version. M2 has its own authority and no recovery key, where a join writes both
//   (`adopt.ts:168-186`).
//
// What else this file gives the boxes for free:
// - M1's first setup is the real selection and activation, with its selection kept in M1's state
//   folder, but on a test clock ten minutes behind, over an empty history, and with no outside
//   release check or internet clock; it is provisioning's, not the setup page's.
// - Neither box has backup settings, which the offer compares.
// - The dashboard session is minted; the password it then signs in with is checked for real.
// - M1's certificate is sealed as setup seals one, not through the dashboard's install route.
// - The test calls `startServer`, so production's entry steps before it never run.
// - `WAITRON_MIN_TICK_MS` and `WAITRON_MAX_TICK_MS` set how often its duties run.
//
// What is a stand-in for the outside world, here and later in the run:
// - AEAT is `createFakeAeat`, reached through the real drain, one record to a batch, and records what
//   each box sent. The drain opens the sealed certificate with the box's own keys first, as the real
//   transport does, but no TLS uses it. AEAT's clock reading answers nothing, the fake's own clock
//   runs 60 seconds ahead, and the drain leaves out the real path's `observeAuthorityTime`, so AEAT's
//   answer time never reaches the box's clock. `WAITRON_FISCAL_TEST_SUBMISSIONS` lets a preproduction box file to it.
// - The card provider is `FakePaymentProvider` behind the held Stripe credential, and Stripe's
//   reconciler finds nothing. A sweep on M1 hears no answer for an open payment; one on M2 captures.
//   The pending-card loop sleeps at most 50 ms between passes.
// - `restart` and a spied `process.kill` stand for the SIGTERM that ends a real process; the test
//   starts the box again in this process.
// - `requestFromBox` says no request comes from the box itself: every client here is on loopback.
//
// - `@waitron/fiscal-verifactu/src/hour-release.js` and `hour-clock-internet.js`: the switch-on's
//   release date and internet clock. The browser's clock sample comes from the test.
//
// No dormant filing setup is created for M2: it writes its own at the real switch-on step, inside the
// preparation route and under the switcher's sign-in.
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { sealAeatSecret } from "@waitron/fiscal-verifactu";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { toAeatDate } from "@waitron/fiscal-verifactu/src/registro-row.js";
import { makeAuthority } from "@waitron/fiscal-verifactu/test/certificate-fixtures.js";
import { withOperationAuthority } from "@waitron/module";
import { readHandoverOperation, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { applyVenue, mergeModulePreparationRevisions } from "@waitron/provisioning";
import { captureAttempting, listAttempting, type CollectionOwners } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import type { StartServerSeams, StartedServer } from "./boot.js";
import { ensureBoxSecrets } from "./box-secrets.js";
import { acceptedCopyPath } from "./handover-acceptance.js";
import { HANDOVER_EVENT } from "./handover-store.js";
import { establishNodeIdentity, readNodeIdentityKey } from "./node-identity.js";
import { provisionBillVenue, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { freePorts } from "./testing/free-ports.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { createHourTestClock, selectPastWaits } from "./testing/hour-test-clock.js";
import { serverFixture } from "./testing/server-fixture.js";
import { synchronisedBoxHost } from "./testing/synchronised-box-host.js";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { recordVoid } from "@waitron/core";
import { loginWithPin } from "@waitron/identity";
import { nodeId as brandNodeId, saleId as brandSaleId } from "@waitron/shared";
import { systemClock } from "./till-backend.js";
import { deploymentEnvironment } from "./config.js";

vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: () =>
    Promise.resolve({
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: performance.now(),
      monotonicFinishedMs: performance.now(),
    }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));

/** What AEAT was sent, in order, by whichever box sent it. */
const outside = vi.hoisted(() => ({
  submits: [] as {
    venueFile: string;
    recordIds: string[];
    idSistemaInformatico: string[];
    numeroInstalacion: string[];
  }[],
  holdSubmit: null as Promise<void> | null,
  /** Every cancellation AEAT was sent, by whichever box sent it. */
  anulaciones: [] as { venueFile: string; record: unknown }[],
  fake: null as unknown,
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
    createClockWatch: (...args: Parameters<typeof actual.createClockWatch>) => {
      const [deps] = args;
      return actual.createClockWatch({
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
        { db, ring, environment, skipRetryMs, signal },
        now,
      ) => {
        // Imported here: the fiscal package imports this mocked module, so a factory-time import
        // never settles.
        const { drain } = await import("@waitron/fiscal-verifactu");
        const { createFakeAeat } = await import("@waitron/verifactu/testing");
        const { readCertMaterial } =
          await import("@waitron/fiscal-verifactu/src/aeat-transport.js");
        // One AEAT for every box, so a cancellation finds the invoice it cancels.
        const aeat = (outside.fake ??= createFakeAeat({
          serverNow: new Date(Date.now() + 60_000),
        })) as ReturnType<typeof createFakeAeat>;
        aeat.setServerNow(new Date(Date.now() + 60_000));
        const fake = aeat.client();
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
            for (const record of submitted[1])
              if ("RegistroAnulacion" in record)
                outside.anulaciones.push({ venueFile, record: record.RegistroAnulacion });
            const hold = outside.holdSubmit;
            outside.holdSubmit = null;
            if (hold !== null) await hold;
            return fake.submit(...submitted);
          },
        };
        return drain(
          {
            db,
            resolveClient: async () => {
              await readCertMaterial(db, ring);
              return client;
            },
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
const COPY_PLACED_EVENT = HANDOVER_EVENT.copyPlaced;
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PASSWORD = "dashPass123";
const SIGN_IN = { email: "owner@example.test", password: PASSWORD };
/** How long the run keeps AEAT's answer back after the stepdown has answered. */
const HELD_MS = 500;
const START_MS = 10_000;
const ROUTER_PROBE_MS = 5_000;
// Each stage's limit covers its starts and waits, plus time for the requests that have no limit of
// their own. A hang stops the run at that stage and names the stage; earlier stages' cases still
// report.
const STEPDOWN_MS = 3 * START_MS + 50_000 + 15_000;
const PLACING_MS = START_MS + 40_000 + 15_000;
const SELLING_MS = 4 * START_MS + 2 * ROUTER_PROBE_MS + 60_000 + 20_000;
const RESTARTS_MS = 2 * START_MS + 15_000 + 10_000;
const FIRST_SETUP_MS = 90_000;
const INHERITED_MS = 2 * START_MS + 45_000;
const HOOK_MS = STEPDOWN_MS + PLACING_MS + SELLING_MS + INHERITED_MS + RESTARTS_MS + FIRST_SETUP_MS;

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
}

function seamsFor(box: Box): StartServerSeams {
  return {
    boxHost: synchronisedBoxHost(),
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

/** Set once teardown begins: a stage its limit gave up on may still be running. */
let runEnded = false;
// Called first by teardown as well: a stage `within` gave up on never leaves its own `finally`.
let releaseAeat = (): void => {};
// Teardown waits for these, however the stage ended, so it never removes a folder under a start.
const startsRunning = new Set<Promise<void>>();

async function start(box: Box): Promise<void> {
  if (runEnded) throw new Error(`${box.name} started after the run ended`);
  box.restartAsked = hold();
  const starting = startServer(box.env, box.env, seamsFor(box));
  let gaveUp = false;
  startsRunning.add(
    starting.then(
      async (late) => {
        if (gaveUp || runEnded) await late.close();
      },
      () => {},
    ),
  );
  try {
    const server = await within(starting, START_MS, `${box.name}'s start`);
    if (!runEnded) box.server = server;
  } catch (error) {
    gaveUp = true;
    throw error;
  }
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

interface NodeProbe {
  nodeId: string;
  term: number;
  standing: string;
  acceptingSales: boolean;
}

async function nodeProbe(box: Box): Promise<NodeProbe> {
  const answer = await ask(box, "/api/node");
  expect(answer.status).toBe(200);
  return (await answer.json()) as NodeProbe;
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

/** Rejects naming `what` if `promise` has not settled within `ms`. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} still waiting after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * M1's first setup through the real minute selection and activation, on the pattern of
 * `firstSetupOnM1` in `./testing/handover-placed-copy.ts`, with the selection kept in M1's state
 * folder. Its clock starts behind real time because a real box's name is never ahead of real time,
 * and a name on the same minute as M2's selection would make M2 wait up to a minute.
 */
function applyWithFirstSetup(stateDir: string): typeof applyVenue {
  return async (actions, deps) => {
    const clock = createHourTestClock(Date.now() - 10 * 60_000);
    const taxpayer = actions.find((action) => action.kind === "ensure-tenant")!;
    const initialNodeId = randomUUID();
    const initialAdministratorId = randomUUID();
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: randomUUID(),
      sourceId: randomUUID(),
      targetNodeId: initialNodeId,
    } as const;
    let kept: unknown = null;
    const preparation = createHourPreparation({
      monotonicNow: () => clock.monotonic(),
      withState: async (_binding, run) =>
        run({
          get value() {
            return structuredClone(kept);
          },
          history: [],
          async replace(next) {
            kept = structuredClone(next);
          },
        }),
      read: async () => ({
        scope: { taxpayerNif: taxpayer.taxId, environment: "preproduction" },
        bases: actions
          .filter((action) => action.kind === "create-series")
          .map(({ code, purpose }) => ({ code, purpose })),
        contextKey: "first",
        history: [{ reference: "empty", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: clock.wall(),
            uncertaintyMs: 0,
            wallStartedMs: clock.wall(),
            wallFinishedMs: clock.wall(),
            monotonicStartedMs: clock.monotonic(),
            monotonicFinishedMs: clock.monotonic(),
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    const held = await selectPastWaits(clock, () =>
      withOperationAuthority(binding, initialAdministratorId, (authority) =>
        preparation.select({ binding, authority, comparisonId: "comparison" }),
      ),
    );
    if (held.status !== "selected") throw new Error(`first setup answered ${held.status}`);
    await stampDeployment(deps.db, "preproduction");
    const result = await applyVenue(actions, {
      ...deps,
      initialNodeId,
      initialAdministratorId,
      moduleInputs: new Map([
        [
          "fiscal-verifactu",
          { eventId: binding.eventId, sourceId: binding.sourceId, input: held.input },
        ],
      ]),
      modules: deps.modules.map((module) =>
        module.name === "fiscal-verifactu" ? { ...module, operations: preparation } : module,
      ),
    });
    await mergeModulePreparationRevisions({ stateDir }, [{ binding, value: kept }]);
    return result;
  };
}

/**
 * M1 ready to sell and M2 its mirror, neither started. The chart, M1's row for M2 and M2's endorsement are in M2's seed because the copy carries them.
 */
async function twoBoxes(scratch: string): Promise<Boxes> {
  const ring: KeyRing = loadKeyRing(KEY_ENV);
  const migrationsRoot = join(scratch, "migrations");
  for (const [index, set] of manifestSets().entries()) {
    await cp(migrations[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

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

  beforeServerStarts();
  const venue = await provisionBillVenue(m1Files.db, { apply: applyWithFirstSetup(m1State) });
  const m1Id: string = venue.cfg.nodeId;
  const m2Id = randomUUID();
  await stampDeployment(m1Files.db, "preproduction");
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
  await withTransaction(m1Files.db, (tx) => setFreshManagementSignIn(tx, adminSession.token));

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

  // After the seed, so the only way M2 can come to hold them is the final copy.
  const openTabId = await tabWith(venue, "Paella");
  const certificate = makeAuthority().issue();
  await sealAeatSecret(
    { db: m1Files.db, ring, nodeId: m1Id },
    {
      pfxBase64: certificate.pfx.toString("base64"),
      passphrase: certificate.passphrase,
      certKind: "sello",
    },
  );

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
    // The spelling SQLite reports, which is what a batch records.
    venueFile: await realpath(join(m2Dir, "venue.db")),
    stateDir: m2State,
    env: envFor(m2State, m2Dir, m2Id, m2Port!),
    sweeps: 0,
    restartAsked: hold(),
    agent: new Agent({ connect: { ca: m2Ca } }),
  };
  return {
    m1,
    m2,
    venue,
    adminCookie: `${MANAGEMENT_COOKIE}=${adminSession.token}`,
    openTabId,
  };
}

/** The filing state one record's row says, on either box. */
const filingStateOf = (file: string, recordId: string): string | undefined =>
  readRows<{ estado: string }>(file, "select estado from envios where registro_id = ?", recordId)[0]
    ?.estado;

/** What the run saw up to M1's restart after its stepdown. */
interface StepdownSeen {
  records: { filed: string; inFlight: string; waiting: string };
  attemptingRef: string;
  m1Selling: boolean;
  m2SellingBefore: boolean;
  m2SeedHeld: { tabs: number; records: number; payments: number };
  stateAtOffer: { m1: string | undefined; m2: string | undefined };
  whileAeatHeld: { inFlight: string | undefined; restartAsked: boolean };
  submitsAtStepdownAnswer: number;
  m1SweepsBeforeStepdown: number;
  m1SweepsAtRestart: number;
  m1Restricted: { nodeId: string; acceptingSales: boolean };
  m1RefusedSale: { status: number; text: string };
  inFlightAfterStepdown: string | undefined;
  m1Certificate: CertificateCard;
}

/** What M1 and AEAT show once M2 has placed its copy, or has failed to. */
interface QuietSeen {
  batches: [string, string[]][];
  m1Waiting: string | undefined;
  m1Sweeps: number;
  m2Sweeps: number;
  stopsAsked: number;
}

/** What the run saw from there to the start of M2 that placed the copy. */
interface PlacingSeen {
  m2StateBeforePlacing: string | undefined;
  m2OperationAfterPlacing: { state: string; waiting_reason: string | null } | undefined;
  placedEvents: number;
  acceptedCopyKept: boolean;
  copy: {
    records: string[];
    filingStates: { filed?: string; inFlight?: string; waiting?: string };
    openTab: unknown[];
    payment: unknown[];
  };
  m2AfterPlacing: { acceptingSales: boolean };
  m1StateAtEnd: string | undefined;
  m1StillAnswers: { acceptingSales: boolean };
}

/** What the certificate card's route answers. */
interface CertificateCard {
  filing: boolean;
  revision: string | null;
  installed: {
    source: string;
    kind: string;
    validFrom: string;
    validUntil: string;
    installedAt: string;
  } | null;
}

async function certificateCard(boxes: Boxes, box: Box): Promise<CertificateCard> {
  const answer = await ask(box, "/management-api/fiscal-certificate", {
    cookie: boxes.adminCookie,
  });
  const text = await answer.text();
  expect(answer.status, text).toBe(200);
  return JSON.parse(text) as CertificateCard;
}

/** What one start of a box logged of its check on its peers. */
interface StartCheck {
  result: string;
  peers: { nodeId: string; answer: string; counted: boolean; why?: string }[];
}

async function logged<T>(box: Box, event: string): Promise<T[]> {
  const log = await readFile(join(box.stateDir, "logs", "waitron.log"), "utf8");
  return log
    .split("\n")
    .filter((line) => line.includes(`"${event}"`))
    .map((line) => JSON.parse(line) as T);
}

const startChecks = (box: Box) => logged<StartCheck>(box, "handover.start_check");

/** Closes the box's running start and starts it again, by what that start's check logged. */
async function startAgain(box: Box): Promise<StartCheck[]> {
  const before = (await startChecks(box)).length;
  await box.server!.close();
  await start(box);
  return (await startChecks(box)).slice(before);
}

function chartOf(box: Box): SignedMembershipDocument {
  const [row] = readRows<{ document: string }>(
    box.venueFile,
    "select document from node_membership",
  );
  return JSON.parse(row!.document) as SignedMembershipDocument;
}

/** One batch as AEAT heard it. */
type HeardBatch = (typeof outside.submits)[number];

/** A cash sale on a box, by its record. */
async function sale(boxes: Boxes, box: Box = boxes.m1): Promise<string> {
  const before = new Set(recordIds(box.venueFile));
  const answer = await ask(box, "/api/sales", {
    cookie: boxes.venue.cookie,
    body: saleBody(boxes),
  });
  const text = await answer.text();
  expect(answer.status, text).toBe(200);
  const added = recordIds(box.venueFile).filter((id) => !before.has(id));
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

async function sendOutbox(boxes: Boxes, box: Box = boxes.m1): Promise<void> {
  const retry = await ask(box, "/management-api/fiscal-outbox/retry", {
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
  await start(m2);
  await start(m1);
  const m1Selling = (await nodeProbe(m1)).acceptingSales;
  // Here, or a first start that waits fails at the first sale with a bare 404.
  expect(m1Selling, "M1's first start is not selling: read handover.start_check").toBe(true);
  const m2SellingBefore = (await nodeProbe(m2)).acceptingSales;

  const filed = await sale(boxes);
  await sendOutbox(boxes);
  await vi.waitFor(() => expect(filingStateOf(m1.venueFile, filed)).toBe("aceptado"), {
    timeout: 10_000,
  });

  const aeat = hold();
  releaseAeat = aeat.release;
  let attemptingRef: string;
  let m2SeedHeld: StepdownSeen["m2SeedHeld"];
  let m1SweepsBeforeStepdown: number;
  let submitsAtStepdownAnswer: number;
  let stateAtOffer: StepdownSeen["stateAtOffer"];
  let whileAeatHeld: StepdownSeen["whileAeatHeld"];
  let inFlight: string;
  let waiting: string;
  let m1Certificate: CertificateCard;
  try {
    outside.holdSubmit = aeat.wait;
    inFlight = await sale(boxes);
    // Before the pass below, so it is due in that pass and only the stop keeps the pass from it.
    waiting = await sale(boxes);
    await sendOutbox(boxes);
    await vi.waitFor(() => expect(outside.holdSubmit).toBeNull(), { timeout: 10_000 });

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
    attemptingRef = attempting!.payment_ref;
    await vi.waitFor(() => expect(m1.sweeps).toBeGreaterThan(0), { timeout: 10_000 });

    m2SeedHeld = {
      tabs: readRows(m2.venueFile, "select id from working_orders where id = ?", boxes.openTabId)
        .length,
      records: recordIds(m2.venueFile).length,
      payments: readRows(m2.venueFile, "select payment_ref from payments").length,
    };

    m1Certificate = await certificateCard(boxes, m1);
    m1SweepsBeforeStepdown = m1.sweeps;
    const started = await ask(m1, "/management-api/handover", {
      cookie: boxes.adminCookie,
      body: {
        operationId: OP,
        destinationNodeId: m2.nodeId,
      },
    });
    const offerText = await started.text();
    // Here, before any wait: a refused offer has M1 selling on, and no restart ever comes.
    expect(started.status, offerText).toBe(200);
    submitsAtStepdownAnswer = outside.submits.length;
    stateAtOffer = { m1: operationRow(m1)?.state, m2: operationRow(m2)?.state };

    let restartAsked = false;
    void m1.restartAsked.wait.then(() => (restartAsked = true));
    await new Promise((resolve) => setTimeout(resolve, HELD_MS));
    whileAeatHeld = { inFlight: filingStateOf(m1.venueFile, inFlight), restartAsked };
  } finally {
    aeat.release();
  }
  await within(m1.restartAsked.wait, 20_000, "M1's restart after its stepdown");
  await m1.server!.close();
  const m1SweepsAtRestart = m1.sweeps;
  const inFlightAfterStepdown = filingStateOf(m1.venueFile, inFlight);

  await start(m1);
  const m1Restricted = await nodeProbe(m1);
  const refused = await ask(m1, "/api/sales", {
    cookie: boxes.venue.cookie,
    body: saleBody(boxes),
  });
  const m1RefusedSale = { status: refused.status, text: await refused.text() };

  return {
    records: { filed, inFlight, waiting },
    attemptingRef,
    m1Selling,
    m2SellingBefore,
    m2SeedHeld,
    stateAtOffer,
    whileAeatHeld,
    submitsAtStepdownAnswer,
    m1SweepsBeforeStepdown,
    m1SweepsAtRestart,
    m1Restricted,
    m1RefusedSale,
    inFlightAfterStepdown,
    m1Certificate,
  };
}

/** Read after M2's half however it ended, so nothing later in the run can change the answer. */
function quietSeen(boxes: Boxes, stepdown: StepdownSeen, stopsAsked: number): QuietSeen {
  return {
    batches: outside.submits.map((batch) => [batch.venueFile, batch.recordIds]),
    m1Waiting: filingStateOf(boxes.m1.venueFile, stepdown.records.waiting),
    m1Sweeps: boxes.m1.sweeps,
    m2Sweeps: boxes.m2.sweeps,
    stopsAsked,
  };
}

/**
 * M2's fetch, comparison and acceptance, M1's relinquishment and the start of M2 that places the
 * copy. It stops with M2 a running mirror at `filing_assumed`, where activation takes over.
 */
async function fetchToPlacing(boxes: Boxes, stepdown: StepdownSeen): Promise<PlacingSeen> {
  const { m1, m2 } = boxes;
  await vi.waitFor(() => expect(operationRow(m2)?.state).toBe("filing_assumed"), {
    timeout: 30_000,
    interval: 250,
  });
  await within(m2.restartAsked.wait, 10_000, "M2's restart at filing_assumed");
  const m2StateBeforePlacing = operationRow(m2)?.state;
  await m2.server!.close();
  await start(m2);
  const { filed, inFlight, waiting } = stepdown.records;
  const copyFile = m2.venueFile;
  return {
    m2StateBeforePlacing,
    m2OperationAfterPlacing: operationRow(m2),
    placedEvents: readRows(
      join(m2.venueDir, "node.db"),
      "select kind from node_handover_events where operation_id = ? and kind = ?",
      OP,
      COPY_PLACED_EVENT,
    ).length,
    acceptedCopyKept: existsSync(acceptedCopyPath(m2.stateDir, OP)),
    copy: {
      records: recordIds(copyFile).sort(),
      filingStates: {
        filed: filingStateOf(copyFile, filed),
        inFlight: filingStateOf(copyFile, inFlight),
        waiting: filingStateOf(copyFile, waiting),
      },
      openTab: readRows(
        copyFile,
        "select status from working_orders where id = ?",
        boxes.openTabId,
      ),
      payment: readRows(
        copyFile,
        "select state, node_id from payments where payment_ref = ?",
        stepdown.attemptingRef,
      ),
    },
    m2AfterPlacing: await nodeProbe(m2),
    m1StateAtEnd: (await readHandoverOperation(m1Files.node, m1.nodeId, OP))?.state,
    m1StillAnswers: await nodeProbe(m1),
  };
}

/** The part of the till's own `ServerRouter` this run drives. */
interface TillRouter extends EventTarget {
  readonly current: string;
  readonly waiting: boolean;
  setServers(list: { url: string }[]): void;
  probeNow(): Promise<void>;
}

async function loadTillRouter(options: {
  origin: string;
  fetchImpl: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem">;
  timeoutMs: number;
}): Promise<TillRouter> {
  const path = fileURLToPath(new URL("../../till/src/api/server-router.ts", import.meta.url));
  const { ServerRouter } = (await import(/* @vite-ignore */ path)) as {
    ServerRouter: new (opts: typeof options) => TillRouter;
  };
  return new ServerRouter(options);
}

/** What the run saw from the switch-on to M2 selling and filing, with M1 still running. */
interface SellingSeen {
  selected: { softwareId: string; identity: string };
  activated: unknown;
  routerBefore: { current: string; waiting: boolean };
  routerAfter: { current: string; waiting: boolean };
  routerMoves: unknown[];
  m2: NodeProbe;
  m2OperationState: string | undefined;
  series: { code: string; purpose: string; node_id: string; retired_at: string | null }[];
  m1: NodeProbe;
  m1Chart: SignedMembershipDocument;
  m2Chart: SignedMembershipDocument;
  ownRecord: string;
  ownRecordFiling: string | undefined;
  ownSale: { code: string; invoice_number: number }[];
  heard: HeardBatch[];
  tableOnM2: { id: string; items: { name: string }[] }[];
  m1TableStatus: unknown[];
  m2Payment: unknown[];
  m1Payment: unknown[];
  m2Sweeps: number;
  m1Sweeps: number;
  m2Certificate: CertificateCard;
  restartAfterPlacing: { m1Selling: boolean; m2Selling: boolean; batches: number };
  restartAfterActivating: {
    m1Selling: boolean;
    m1Sale: number;
    batchesFromM1: number;
    repeatedActivate: unknown;
  };
}

/** What the run saw through M2's two later starts, the second with M1 switched off. */
interface RestartsSeen {
  withM1Up: { checks: StartCheck[]; m2: NodeProbe };
  m1Answered: boolean;
  withM1Off: { checks: StartCheck[]; m2: NodeProbe };
  afterOffRecord: string;
  afterOffFiling: string | undefined;
  heard: HeardBatch[];
  placedEvents: number;
  placingsLogged: number;
  acceptedCopyKept: boolean;
  ownRecordKept: boolean;
  m1SweepsAtSwitchOff: number;
}

/** Every step the real switch-on takes on M2, under the switcher's sign-in. */
async function switchOn(boxes: Boxes) {
  const { m1, m2 } = boxes;
  const binding = {
    module: "fiscal-verifactu",
    action: "promote",
    eventId: OP,
    sourceId: m1.nodeId,
    targetNodeId: m2.nodeId,
  };
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const answer = await ask(m2, `/api/node/handover/${OP}/${path}`, { body });
    const text = await answer.text();
    expect(answer.status, `${path}: ${text}`).toBe(200);
    return JSON.parse(text) as T;
  };
  const prepare = <T>(proposal: unknown) =>
    post<T>("preparation", {
      moduleOperation: { binding, input: null },
      signIn: SIGN_IN,
      proposal,
    });
  const challenge = await prepare<{ id: string }>({ action: "clock-challenge" });
  const compared = await prepare<{ id: string }>({
    action: "compare-clocks",
    browser: { challengeId: challenge.id, instantMs: Date.now() },
  });
  const selected = await prepare<{
    status: string;
    softwareId: string;
    identity: string;
    input: unknown;
  }>({ action: "select", comparisonId: compared.id });
  expect(selected.status).toBe("selected");
  const activate = () =>
    post<unknown>("activate", {
      moduleOperation: { binding, input: selected.input },
      signIn: SIGN_IN,
    });
  return { selected, activate, activated: await activate() };
}

/**
 * From a placed copy through M2's switch-on and restart to M2 selling and filing, with a till router
 * pointed at both boxes and M1 still running.
 */
async function switchOnToSelling(boxes: Boxes, stepdown: StepdownSeen): Promise<SellingSeen> {
  const { m1, m2 } = boxes;
  const stored = new Map<string, string>();
  const router = await loadTillRouter({
    origin: m1.url,
    // Both boxes answer over TLS on a loaded runner, and a slow answer would read as a box gone.
    timeoutMs: ROUTER_PROBE_MS,
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
    },
    fetchImpl: ((input: string, init: RequestInit) =>
      fetch(input, {
        ...init,
        dispatcher: input.startsWith(m2.url) ? m2.agent : m1.agent,
      } as RequestInit)) as typeof fetch,
  });
  router.setServers([{ url: m1.url }, { url: m2.url }]);
  const routerMoves: unknown[] = [];
  router.addEventListener("server-changed", (event) =>
    routerMoves.push((event as CustomEvent).detail),
  );
  await router.probeNow();
  const routerBefore = { current: router.current, waiting: router.waiting };

  await startAgain(m1);
  await startAgain(m2);
  const restartAfterPlacing = {
    m1Selling: (await nodeProbe(m1)).acceptingSales,
    m2Selling: (await nodeProbe(m2)).acceptingSales,
    batches: outside.submits.length,
  };

  const { selected, activate, activated } = await switchOn(boxes);
  await within(m2.restartAsked.wait, 10_000, "M2's restart after activating");
  await startAgain(m2);
  const m2Probe = await nodeProbe(m2);

  // Not fatal here: M1's case reads the chart it holds, and the rest of the run does not need it.
  await vi
    .waitFor(() => expect(chartOf(m1).body.term).toBe(m2Probe.term), {
      timeout: 10_000,
      interval: 100,
    })
    .catch(() => {});
  await startAgain(m1);
  const m1Sale = await ask(m1, "/api/sales", { cookie: boxes.venue.cookie, body: saleBody(boxes) });
  const restartAfterActivating = {
    m1Selling: (await nodeProbe(m1)).acceptingSales,
    m1Sale: m1Sale.status,
    batchesFromM1: outside.submits.filter((batch) => batch.venueFile === m1.venueFile).length,
    repeatedActivate: await activate(),
  };
  await vi.waitFor(
    () => expect(filingStateOf(m2.venueFile, stepdown.records.waiting)).toBe("aceptado"),
    { timeout: 15_000, interval: 100 },
  );
  const ownRecord = await sale(boxes, m2);
  await sendOutbox(boxes, m2);
  await vi.waitFor(() => expect(filingStateOf(m2.venueFile, ownRecord)).toBe("aceptado"), {
    timeout: 15_000,
    interval: 100,
  });
  const paymentIn = (box: Box) =>
    readRows<{ state: string }>(
      box.venueFile,
      "select state from payments where payment_ref = ?",
      stepdown.attemptingRef,
    );
  // Not fatal either: the sweep's case reads the payment.
  await vi
    .waitFor(() => expect(paymentIn(m2)).toEqual([{ state: "captured" }]), {
      timeout: 10_000,
      interval: 100,
    })
    .catch(() => {});
  const orders = await ask(m2, "/api/working-orders", { cookie: boxes.venue.cookie });
  const ordersText = await orders.text();
  expect(orders.status, ordersText).toBe(200);
  await router.probeNow();

  return {
    selected: { softwareId: selected.softwareId, identity: selected.identity },
    activated,
    routerBefore,
    routerAfter: { current: router.current, waiting: router.waiting },
    routerMoves,
    m2: m2Probe,
    m2OperationState: operationRow(m2)?.state,
    series: readRows(
      m2.venueFile,
      "select code, purpose, node_id, retired_at from invoice_series order by code",
    ),
    m1: await nodeProbe(m1),
    m1Chart: chartOf(m1),
    m2Chart: chartOf(m2),
    ownRecord,
    ownRecordFiling: filingStateOf(m2.venueFile, ownRecord),
    ownSale: readRows(
      m2.venueFile,
      `select series.code, sales.invoice_number from sales
       join invoice_series series on series.id = sales.series_id
       where sales.node_id = ?`,
      m2.nodeId,
    ),
    heard: [...outside.submits],
    tableOnM2: JSON.parse(ordersText) as SellingSeen["tableOnM2"],
    m1TableStatus: readRows(
      m1.venueFile,
      "select status from working_orders where id = ?",
      boxes.openTabId,
    ),
    m2Payment: paymentIn(m2),
    m1Payment: paymentIn(m1),
    m2Sweeps: m2.sweeps,
    m1Sweeps: m1.sweeps,
    m2Certificate: await certificateCard(boxes, m2),
    restartAfterPlacing,
    restartAfterActivating,
  };
}

/** M2 started again beside M1, then again with M1 switched off, and selling after it. */
async function restartWithM1Off(boxes: Boxes, selling: SellingSeen): Promise<RestartsSeen> {
  const { m1, m2 } = boxes;
  const upChecks = await startAgain(m2);
  const withM1Up = { checks: upChecks, m2: await nodeProbe(m2) };

  await m1.server!.close();
  const m1SweepsAtSwitchOff = m1.sweeps;
  const m1Answered = await ask(m1, "/api/node").then(
    () => true,
    () => false,
  );

  const offChecks = await startAgain(m2);
  const withM1Off = { checks: offChecks, m2: await nodeProbe(m2) };
  // Here, or a start that waits shows only as the refused sale's bare 404.
  expect(withM1Off.m2.acceptingSales, JSON.stringify(offChecks)).toBe(true);
  const afterOffRecord = await sale(boxes, m2);
  await sendOutbox(boxes, m2);
  await vi.waitFor(() => expect(filingStateOf(m2.venueFile, afterOffRecord)).toBe("aceptado"), {
    timeout: 15_000,
    interval: 100,
  });
  return {
    withM1Up,
    m1Answered,
    withM1Off,
    afterOffRecord,
    afterOffFiling: filingStateOf(m2.venueFile, afterOffRecord),
    heard: [...outside.submits],
    placedEvents: readRows(
      join(m2.venueDir, "node.db"),
      "select kind from node_handover_events where operation_id = ? and kind = ?",
      OP,
      COPY_PLACED_EVENT,
    ).length,
    placingsLogged: (await logged(m2, "handover-place-copy.placed")).length,
    acceptedCopyKept: existsSync(acceptedCopyPath(m2.stateDir, OP)),
    ownRecordKept: recordIds(m2.venueFile).includes(selling.ownRecord),
    m1SweepsAtSwitchOff,
  };
}

// ---- M2 works with what it inherited from M1. Each step records what came back and never throws,
// so every case below reports on its own.

/** One request's answer, or the error that stopped it. */
interface Attempt {
  status: number;
  body: unknown;
}

async function attempt(
  box: Box,
  path: string,
  init: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Attempt> {
  try {
    const answer = await ask(box, path, init);
    const text = await answer.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON: keep the text.
    }
    return { status: answer.status, body };
  } catch (error) {
    return { status: -1, body: String(error) };
  }
}

function caught(error: unknown) {
  const e = error as { code?: unknown; params?: unknown };
  return { code: e.code ?? null, params: e.params ?? null, message: String(error) };
}

/** What a bill route is sent as `expectedEdit`, read the way `whole-payment-fixture.ts` reads it. */
function editOf(file: string, billId: string) {
  const [row] = readRows<{
    editorVersion: number;
    draftId: string | null;
    draftRevision: number | null;
  }>(
    file,
    `select coalesce(s.editor_version, 0) as editorVersion, d.id as draftId, d.revision as draftRevision
     from working_orders o left join bill_edit_states s on s.bill_id = o.id
     left join order_drafts d on d.bill_id = o.id and d.state = 'open'
     where o.id = ?`,
    billId,
  );
  return {
    billId,
    editorVersion: row?.editorVersion ?? 0,
    draftId: row?.draftId ?? null,
    draftRevision: row?.draftRevision ?? null,
  };
}

interface InheritedSeen {
  tab: { linesBefore: number };
  readOne: Attempt;
  change: Attempt;
  linesAfterChange: number;
  balance: Attempt;
  pay: Attempt;
  place: Attempt | null;
  collect: Attempt | null;
  tabStatusAfterPay: string | undefined;
  tabSale: { id: string; node_id: string; code: string; invoice_number: number }[];
  tabSaleRecord: { id: string; node_id: string; estado?: string }[];
  newOrder: Attempt;
  m1Orders: { id: string; node_id: string; order_number: number; status: string }[];
  m2Orders: { id: string; node_id: string; order_number: number; status: string }[];
  salesByNode: { node_id: string; n: number }[];
  overview: Attempt;
  dailyClose: Attempt;
  refundSaleNode: string | null;
  refund: Attempt | null;
  refundRows: { node_id: string; state: string }[];
  m1RecordsAroundRefund: { before: number; after: number };
  voidedInvoice: { serie: string; emisor: string; fecha: string } | null;
  m2SifId: string | null;
  voidSaleNode: string | null;
  voided: { ok: true; fiscal: unknown } | { ok: false; error: ReturnType<typeof caught> } | null;
  voidRecords: {
    id: string;
    node_id: string;
    sif_id: string;
    tipo_registro: string;
    estado?: string;
  }[];
  voidHeard: { venueFile: string; record: unknown }[];
  m2SellingAfterVoidRestart: boolean | null;
  stageErrors: string[];
}

async function inheritedWork(
  boxes: Boxes,
  stepdown: StepdownSeen,
  selling: SellingSeen,
): Promise<InheritedSeen> {
  const { m1, m2, venue } = boxes;
  const tabId = boxes.openTabId;
  const errors: string[] = [];
  const guard = <T>(what: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (error) {
      errors.push(`${what}: ${String(error)}`);
      return fallback;
    }
  };
  const lineCount = () =>
    guard(
      "line count",
      () =>
        readRows<{ n: number }>(
          m2.venueFile,
          "select count(*) as n from working_order_lines where working_order_id = ?",
          tabId,
        )[0]!.n,
      -1,
    );
  const [tabRow] = guard(
    "tab row",
    () =>
      readRows<{ party_id: string | null }>(
        m2.venueFile,
        "select party_id from working_orders where id = ?",
        tabId,
      ),
    [],
  );
  const partyId = tabRow?.party_id ?? null;
  const partyRevision = () =>
    guard(
      "party revision",
      () =>
        readRows<{ revision: number }>(
          m2.venueFile,
          "select revision from parties where id = ?",
          partyId ?? "",
        )[0]?.revision ?? 0,
      0,
    );
  const linesBefore = lineCount();

  // Change the inherited table: one more Caña, sent to the kitchen.
  const readOne = await attempt(m2, `/api/working-orders/${tabId}`, { cookie: venue.cookie });
  const change = await attempt(m2, `/api/parties/${partyId}/groups`, {
    cookie: venue.cookie,
    body: {
      submissionId: randomUUID(),
      expectedPartyRevision: partyRevision(),
      expectedEdit: guard("edit", () => editOf(m2.venueFile, tabId), null),
      groups: [{ lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }], release: "fire" }],
    },
  });
  const linesAfterChange = lineCount();

  // Pay the inherited table in cash: the whole outstanding amount as one bill payment, and if
  // that leaves it unsettled, the whole-bill path (place, then collect).
  const balance = await attempt(m2, `/api/working-orders/${tabId}/payments`, {
    cookie: venue.cookie,
  });
  const linesTotal = guard(
    "lines total",
    () =>
      readRows<{ cents: number }>(
        m2.venueFile,
        "select coalesce(sum(line_total), 0) as cents from working_order_lines where working_order_id = ?",
        tabId,
      )[0]!.cents,
    0,
  );
  const outstanding =
    balance.status === 200 &&
    typeof (balance.body as { outstanding?: unknown }).outstanding === "string"
      ? (balance.body as { outstanding: string }).outstanding
      : (linesTotal / 100).toFixed(2);
  const pay = await attempt(m2, `/api/working-orders/${tabId}/payments`, {
    cookie: venue.cookie,
    body: {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: outstanding,
      method: "cash",
      tendered: outstanding,
      applied: outstanding,
      tip: "0.00",
      expectedEdit: guard("edit", () => editOf(m2.venueFile, tabId), null),
    },
  });
  const statusNow = () =>
    guard(
      "tab status",
      () =>
        readRows<{ status: string }>(
          m2.venueFile,
          "select status from working_orders where id = ?",
          tabId,
        )[0]?.status,
      undefined,
    );
  let place: Attempt | null = null;
  let collect: Attempt | null = null;
  if (statusNow() !== "settled") {
    place = await attempt(m2, `/api/working-orders/${tabId}/place`, {
      cookie: venue.cookie,
      body: { expectedEdit: guard("edit", () => editOf(m2.venueFile, tabId), null) },
    });
    collect = await attempt(m2, `/api/working-orders/${tabId}/collect`, {
      cookie: venue.cookie,
      body: {
        expectedEdit: guard("edit", () => editOf(m2.venueFile, tabId), null),
        tender: { method: "cash", amount: outstanding },
      },
    });
  }
  const tabStatusAfterPay = statusNow();
  const tabSale = guard(
    "tab sale",
    () =>
      readRows<{ id: string; node_id: string; code: string; invoice_number: number }>(
        m2.venueFile,
        `select s.id, s.node_id, series.code, s.invoice_number from sales s
         join invoice_series series on series.id = s.series_id where s.working_order_id = ?`,
        tabId,
      ),
    [],
  );
  if (tabSale.length > 0) await sendOutbox(boxes, m2).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const tabSaleRecord = guard(
    "tab sale record",
    () =>
      readRows<{ id: string; node_id: string }>(
        m2.venueFile,
        "select id, node_id from registros_facturacion where sale_id = ?",
        tabSale[0]?.id ?? "",
      ).map((row) => ({ ...row, estado: filingStateOf(m2.venueFile, row.id) })),
    [],
  );

  // A new order on M2, and the order numbers M1 gave out.
  const newOrder = await attempt(m2, "/api/working-orders", {
    cookie: venue.cookie,
    body: {
      id: randomUUID(),
      zoneId: venue.zoneId,
      lines: [{ menuItemId: venue.offerFor("Caña"), quantity: "1" }],
    },
  });
  const ordersOf = (file: string) =>
    guard(
      "orders",
      () =>
        readRows<{ id: string; node_id: string; order_number: number; status: string }>(
          file,
          "select id, node_id, order_number, status from working_orders order by order_number",
        ),
      [],
    );

  // The reports for today, the day M1 sold on.
  const overview = await attempt(m2, "/management-api/reports/overview", {
    cookie: boxes.adminCookie,
  });
  const day =
    (overview.body as { businessDay?: string } | null)?.businessDay ??
    new Date().toISOString().slice(0, 10);
  const dailyClose = await attempt(m2, `/management-api/reports/daily-close?businessDay=${day}`, {
    cookie: boxes.adminCookie,
  });
  const salesByNode = guard(
    "sales by node",
    () =>
      readRows<{ node_id: string; n: number }>(
        m2.venueFile,
        "select node_id, count(*) as n from sales group by node_id",
      ),
    [],
  );

  // A cash refund of an M1 sale other than the one cancelled below.
  const [refundTarget] = guard(
    "refund target",
    () =>
      readRows<{ sale_id: string; node_id: string; tender_id: string; amount: number }>(
        m2.venueFile,
        `select r.sale_id, r.node_id, t.id as tender_id, t.amount from registros_facturacion r
         join tenders t on t.sale_id = r.sale_id and t.method = 'cash' where r.id = ?`,
        stepdown.records.inFlight,
      ),
    [],
  );
  const m1Records = () =>
    guard(
      "M1's records",
      () =>
        readRows<{ n: number }>(
          m2.venueFile,
          "select count(*) as n from registros_facturacion where node_id = ?",
          m1.nodeId,
        )[0]!.n,
      -1,
    );
  const m1RecordsBeforeRefund = m1Records();
  const refund =
    refundTarget === undefined
      ? null
      : await attempt(m2, `/api/transactions/${refundTarget.sale_id}/refunds`, {
          cookie: venue.cookie,
          body: {
            submissionId: randomUUID(),
            tenderId: refundTarget.tender_id,
            appliedAmount: (refundTarget.amount / 100).toFixed(2),
            tipAmount: "0.00",
            reason: "Goodwill",
            override: { personId: venue.adminId, pin: "1234" },
          },
        });
  const refundRows = guard(
    "refund rows",
    () =>
      readRows<{ node_id: string; state: string }>(
        m2.venueFile,
        "select node_id, state from tender_refunds where sale_id = ?",
        refundTarget?.sale_id ?? "",
      ),
    [],
  );
  const m1RecordsAroundRefund = { before: m1RecordsBeforeRefund, after: m1Records() };

  // Cancel one of M1's filed sales. No route reaches `recordVoid` (only test fixtures call it),
  // so it is called in process on M2's own files, with M2's server closed.
  const [voidTarget] = guard(
    "void target",
    () =>
      readRows<{
        sale_id: string;
        node_id: string;
        num_serie_factura: string;
        id_emisor_factura: string;
        fecha_expedicion_factura: string;
      }>(
        m2.venueFile,
        `select sale_id, node_id, num_serie_factura, id_emisor_factura, fecha_expedicion_factura
         from registros_facturacion where id = ?`,
        stepdown.records.filed,
      ),
    [],
  );
  const [m2Sif] = guard(
    "M2's SIF",
    () =>
      readRows<{ sif_id: string }>(
        m2.venueFile,
        "select sif_id from registros_facturacion where id = ?",
        selling.ownRecord,
      ),
    [],
  );
  let voided: InheritedSeen["voided"] = null;
  let voidRecords: InheritedSeen["voidRecords"] = [];
  let m2SellingAfterVoidRestart: boolean | null = null;
  const heardBefore = outside.anulaciones.length;
  if (voidTarget !== undefined) {
    try {
      await m2.server!.close();
      const files = await openVenueDatabase(m2.venueDir);
      try {
        const env = deploymentEnvironment(m2.env);
        const backend = new VerifactuBackend({
          clock: systemClock(),
          db: files.venue,
          environment: env,
          deploymentEnvironment: env,
          resolveClient: () => Promise.reject(new Error("a void never submits inline")),
        });
        const fiscal = await withTransaction(files.venue, async (tx) => {
          const session = await loginWithPin(tx, {
            deviceId: venue.deviceId,
            personId: venue.adminId,
            pin: "1234",
          });
          return recordVoid(
            tx,
            backend,
            brandSaleId(voidTarget.sale_id),
            "Rung up twice",
            { sessionId: session.id },
            brandNodeId(m2.nodeId),
          );
        });
        voided = { ok: true, fiscal };
      } catch (error) {
        voided = { ok: false, error: caught(error) };
      } finally {
        await files.close();
      }
    } catch (error) {
      errors.push(`void setup: ${String(error)}`);
    }
    try {
      await start(m2);
      m2SellingAfterVoidRestart = (await nodeProbe(m2)).acceptingSales;
      await sendOutbox(boxes, m2);
      await vi
        .waitFor(
          () => {
            const rows = readRows<{ id: string }>(
              m2.venueFile,
              "select id from registros_facturacion where sale_id = ? and tipo_registro = 'anulacion'",
              voidTarget.sale_id,
            );
            expect(rows.length).toBeGreaterThan(0);
            expect(filingStateOf(m2.venueFile, rows[0]!.id)).toBe("aceptado");
          },
          { timeout: 15_000, interval: 250 },
        )
        .catch(() => {});
    } catch (error) {
      errors.push(`restart after void: ${String(error)}`);
    }
    voidRecords = guard(
      "void records",
      () =>
        readRows<{ id: string; node_id: string; sif_id: string; tipo_registro: string }>(
          m2.venueFile,
          "select id, node_id, sif_id, tipo_registro from registros_facturacion where sale_id = ? and tipo_registro = 'anulacion'",
          voidTarget.sale_id,
        ).map((row) => ({ ...row, estado: filingStateOf(m2.venueFile, row.id) })),
      [],
    );
  }

  return {
    tab: { linesBefore },
    readOne,
    change,
    linesAfterChange,
    balance,
    pay,
    place,
    collect,
    tabStatusAfterPay,
    tabSale,
    tabSaleRecord,
    newOrder,
    m1Orders: ordersOf(m1.venueFile),
    m2Orders: ordersOf(m2.venueFile),
    salesByNode,
    overview,
    dailyClose,
    refundSaleNode: refundTarget?.node_id ?? null,
    refund,
    refundRows,
    m1RecordsAroundRefund,
    voidedInvoice:
      voidTarget === undefined
        ? null
        : {
            serie: voidTarget.num_serie_factura,
            emisor: voidTarget.id_emisor_factura,
            fecha: voidTarget.fecha_expedicion_factura,
          },
    m2SifId: m2Sif?.sif_id ?? null,
    voidSaleNode: voidTarget?.node_id ?? null,
    voided,
    voidRecords,
    voidHeard: outside.anulaciones.slice(heardBefore),
    m2SellingAfterVoidRestart,
    stageErrors: errors,
  };
}

describe("a controlled handover between two boxes, simulated in one process", () => {
  let scratch: string | undefined;
  let boxes: Boxes | undefined;
  let stepdown: StepdownSeen | undefined;
  let quiet: QuietSeen | undefined;
  let placing: PlacingSeen | undefined;
  let placingFailure: unknown;
  let selling: SellingSeen | undefined;
  let sellingFailure: unknown;
  let restarts: RestartsSeen | undefined;
  let restartsFailure: unknown;
  let inherited: InheritedSeen | undefined;
  let inheritedFailure: unknown;
  let stopsAskedAtEnd = 0;
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);

  beforeAll(async () => {
    // Noon keeps the venue's and the fake's dates equal; real waits must still advance the clock.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-06T12:00:00Z"),
      shouldAdvanceTime: true,
    });
    scratch = await mkdtemp(join(tmpdir(), "waitron-handover-controlled-"));
    boxes = await within(twoBoxes(scratch), FIRST_SETUP_MS, "M1's first setup");
    stepdown = await within(offerToStepdown(boxes), STEPDOWN_MS, "the stage up to M1's stepdown");
    // Held back, so a run in which M2 never gets there still reports what M1 did meanwhile.
    try {
      placing = await within(fetchToPlacing(boxes, stepdown), PLACING_MS, "the placing stage");
    } catch (error) {
      placingFailure = error;
    }
    quiet = quietSeen(boxes, stepdown, kill.mock.calls.length);
    if (placing !== undefined) {
      try {
        selling = await within(switchOnToSelling(boxes, stepdown), SELLING_MS, "the selling stage");
        try {
          inherited = await within(
            inheritedWork(boxes, stepdown, selling),
            INHERITED_MS,
            "the inherited-work stage",
          );
        } catch (error) {
          inheritedFailure = error;
        }
        restarts = await within(restartWithM1Off(boxes, selling), RESTARTS_MS, "the restart stage");
      } catch (error) {
        if (selling === undefined) sellingFailure = error;
        restartsFailure = error;
      }
    }
    stopsAskedAtEnd = kill.mock.calls.length;
  }, HOOK_MS);

  afterAll(async () => {
    runEnded = true;
    releaseAeat();
    await Promise.allSettled(startsRunning);
    const closing = [
      boxes?.m1.server?.close(),
      boxes?.m2.server?.close(),
      boxes?.m1.agent?.close(),
      boxes?.m2.agent?.close(),
    ];
    const closed = await Promise.allSettled(closing);
    vi.useRealTimers();
    kill.mockRestore();
    if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
    for (const result of closed) if (result.status === "rejected") throw result.reason;
  }, 60_000);

  const seen = (): { b: Boxes; run: StepdownSeen; later: QuietSeen } => {
    if (boxes === undefined || stepdown === undefined || quiet === undefined)
      throw new Error("no stepdown was observed");
    return { b: boxes, run: stepdown, later: quiet };
  };
  const placed = (): { b: Boxes; run: StepdownSeen; end: PlacingSeen } => {
    if (placing === undefined) throw placingFailure ?? new Error("nothing was placed");
    return { ...seen(), end: placing };
  };

  const sold = (): { b: Boxes; run: StepdownSeen; on: SellingSeen } => {
    if (selling === undefined) throw sellingFailure ?? new Error("M2 never got to selling");
    return { ...seen(), on: selling };
  };
  const restarted = (): { b: Boxes; run: StepdownSeen; on: SellingSeen; after: RestartsSeen } => {
    if (restarts === undefined) throw restartsFailure ?? new Error("M2 was never restarted");
    return { ...sold(), after: restarts };
  };

  it("starts with M1 selling, and M2 a mirror holding nothing M1 recorded after its seed", () => {
    const { run } = seen();
    expect(run.m1Selling).toBe(true);
    expect(run.m2SellingBefore).toBe(false);
    expect(run.m2SeedHeld).toEqual({ tabs: 0, records: 0, payments: 0 });
  });

  it("M2 records the offer, and M1 steps down, before M1's request is answered", () => {
    expect(seen().run.stateAtOffer).toEqual({ m1: "source_stepped_down", m2: "prepared" });
  });

  it("a batch being sent when the stepdown starts finishes before M1 restarts", () => {
    const { run } = seen();
    expect(run.whileAeatHeld).toEqual({ inFlight: "enviando", restartAsked: false });
    expect(run.inFlightAfterStepdown).toBe("aceptado");
  });

  // Control, run locally and not committed: the start's early return alone left out, M1 waits on M2
  // at its start check, sells nothing, and M2's cases fail. With `checkPeers` also answering proceed,
  // this case and the next two fail, the next with three batches against two.
  it("after its restart M1 answers acceptingSales false and serves no sale", () => {
    const { b, run } = seen();
    expect(run.m1Restricted).toMatchObject({ nodeId: b.m1.nodeId, acceptingSales: false });
    // A restricted start mounts no till route at all.
    expect(run.m1RefusedSale.status, run.m1RefusedSale.text).toBe(404);
  });

  // Weaker than its name: with `signalDuties` in `stepDown` left out this still passes, because the
  // close that begins moments later also stops the drain; `handover-stepdown.real.test.ts` pins that
  // signal.
  it("M1 starts no new filing after its stepdown: AEAT heard only the two batches before it", () => {
    const { b, run, later } = seen();
    const { filed, inFlight } = run.records;
    expect(run.submitsAtStepdownAnswer).toBe(2);
    expect(later.batches).toEqual([
      [b.m1.venueFile, [filed]],
      [b.m1.venueFile, [inFlight]],
    ]);
    expect(later.m1Waiting).toBe("pendiente");
  });

  it("M1 starts no card sweep after its close, and M2 runs none as a mirror", () => {
    const { run, later } = seen();
    expect(run.m1SweepsBeforeStepdown).toBeGreaterThan(0);
    expect(later.m1Sweeps).toBe(run.m1SweepsAtRestart);
    expect(later.m2Sweeps).toBe(0);
  });

  it("M1 relinquishes filing to M2, which records it and asks for the start that places", () => {
    const { end } = placed();
    expect(end.m1StateAtEnd).toBe("filing_relinquished");
    expect(end.m1StillAnswers.acceptingSales).toBe(false);
    expect(end.m2StateBeforePlacing).toBe("filing_assumed");
    expect(end.m2OperationAfterPlacing).toMatchObject({
      state: "filing_assumed",
      waiting_reason: null,
    });
  });

  it("M2's start places the copy, keeps no accepted file, and stays a mirror that sells nothing", () => {
    const { end } = placed();
    expect(end.placedEvents).toBe(1);
    expect(end.acceptedCopyKept).toBe(false);
    expect(end.m2AfterPlacing.acceptingSales).toBe(false);
  });

  it("the copy M2 placed holds M1's final state: every record, the batch's answer, the open table and the card payment", () => {
    const { b, run, end } = placed();
    const { filed, inFlight, waiting } = run.records;
    expect(end.copy.records).toEqual([filed, inFlight, waiting].sort());
    expect(end.copy.filingStates).toEqual({
      filed: "aceptado",
      inFlight: "aceptado",
      waiting: "pendiente",
    });
    expect(end.copy.openTab).toEqual([{ status: "open" }]);
    expect(end.copy.payment).toEqual([{ state: "attempting", node_id: b.m1.nodeId }]);
  });

  it("nothing asked this process to stop", () => {
    expect(seen().later.stopsAsked).toBe(0);
  });

  it("the switch-on makes M2 the main box, selling on a new series named for its own minute", () => {
    const { b, on } = sold();
    expect(on.activated).toEqual({ activated: true, restarting: true });
    expect(on.m2OperationState).toBe("activated");
    expect(on.m2).toMatchObject({
      nodeId: b.m2.nodeId,
      term: 4,
      standing: "serving-primary",
      acceptingSales: true,
    });
    const { identity } = on.selected;
    const own = on.series.filter((row) => row.node_id === b.m2.nodeId);
    expect(own.map((row) => row.code)).toEqual(
      ["A", "FF", "R"].map((prefix) => `${prefix}-${identity}`),
    );
    expect(own.every((row) => row.retired_at === null)).toBe(true);
    expect(on.ownSale).toEqual([{ code: `A-${identity}`, invoice_number: 1 }]);
  });

  it("M1 holds M2's chart, naming M2 the main box, and goes on selling nothing", () => {
    const { b, on } = sold();
    expect(on.m1Chart).toEqual(on.m2Chart);
    expect(on.m1Chart.signerNodeId).toBe(b.m2.nodeId);
    expect(on.m1Chart.body.term).toBe(4);
    const standingOf = (id: string) => on.m1Chart.body.nodes.find((n) => n.nodeId === id)?.standing;
    expect(standingOf(b.m2.nodeId)).toBe("serving-primary");
    expect(standingOf(b.m1.nodeId)).not.toBe("serving-primary");
    expect(on.m1).toMatchObject({ term: 4, acceptingSales: false });
  });

  it("M2 files M1's waiting record under M1's identity, and its own first sale under its own", () => {
    const { b, run, on } = sold();
    const m1Batch = on.heard.find((batch) => batch.venueFile === b.m1.venueFile)!;
    const m1Identity = m1Batch.numeroInstalacion[0]!;
    expect(m1Identity).not.toBe(on.selected.identity);
    expect(on.heard.filter((batch) => batch.venueFile === b.m2.venueFile)).toEqual([
      {
        venueFile: b.m2.venueFile,
        recordIds: [run.records.waiting],
        idSistemaInformatico: m1Batch.idSistemaInformatico,
        numeroInstalacion: [m1Identity],
      },
      {
        venueFile: b.m2.venueFile,
        recordIds: [on.ownRecord],
        idSistemaInformatico: [on.selected.softwareId],
        numeroInstalacion: [on.selected.identity],
      },
    ]);
    expect(on.ownRecordFiling).toBe("aceptado");
  });

  it("the open table is on M2, through its till route, as it stands on M1", () => {
    const { b, on } = sold();
    expect(on.tableOnM2.find((order) => order.id === b.openTabId)?.items).toMatchObject([
      { name: "Paella" },
    ]);
    expect(on.m1TableStatus).toEqual([{ status: "open" }]);
  });

  it("M2's sweep resolves the open card payment, and M1's does not", () => {
    const { run, on } = sold();
    expect(on.m2Sweeps).toBeGreaterThan(0);
    expect(on.m2Payment).toEqual([{ state: "captured" }]);
    expect(on.m1Payment).toEqual([{ state: "attempting" }]);
    expect(on.m1Sweeps).toBe(run.m1SweepsAtRestart);
  });

  it("M1 runs no sweep and files nothing more, up to the moment it is switched off", () => {
    const { b, run, after } = restarted();
    expect(after.m1SweepsAtSwitchOff).toBe(run.m1SweepsAtRestart);
    expect(after.heard.filter((batch) => batch.venueFile === b.m1.venueFile)).toHaveLength(2);
  });

  it("a till router pointed at both boxes waits while neither sells, then moves to M2", () => {
    const { b, on } = sold();
    expect(on.routerBefore).toEqual({ current: b.m1.url, waiting: true });
    expect(on.routerAfter).toEqual({ current: b.m2.url, waiting: false });
    expect(on.routerMoves).toEqual([{ from: b.m1.url, to: b.m2.url }]);
  });

  it("one more restart of both boxes after placing, and after activating, leaves one filing box", () => {
    const { on } = sold();
    expect(on.restartAfterPlacing).toEqual({ m1Selling: false, m2Selling: false, batches: 2 });
    expect(on.restartAfterActivating).toEqual({
      m1Selling: false,
      m1Sale: 404,
      batchesFromM1: 2,
      repeatedActivate: { activated: true, restarting: false },
    });
    expect(on.m2.acceptingSales).toBe(true);
  });

  it("M2's next start beside M1 verifies M1's signed answer", () => {
    const { b, after } = restarted();
    expect(after.withM1Up.checks).toMatchObject([
      { result: "proceed", peers: [{ nodeId: b.m1.nodeId, answer: "=", counted: false }] },
    ]);
    expect(after.withM1Up.m2.acceptingSales).toBe(true);
  });

  it("with M1 switched off, M2 starts selling without waiting, and files its next sale", () => {
    const { b, on, after } = restarted();
    expect(after.m1Answered).toBe(false);
    expect(after.withM1Off.checks).toMatchObject([
      {
        result: "proceed",
        peers: [{ nodeId: b.m1.nodeId, answer: "S", counted: false, why: "unreachable" }],
      },
    ]);
    expect(after.withM1Off.m2).toMatchObject({ term: 4, acceptingSales: true });
    expect(after.afterOffFiling).toBe("aceptado");
    expect(after.heard.at(-1)).toMatchObject({
      recordIds: [after.afterOffRecord],
      numeroInstalacion: [on.selected.identity],
    });
  });

  it("M2's later starts place nothing: the copy was placed once and its own sale is still there", () => {
    const { after } = restarted();
    expect(after.placedEvents).toBe(1);
    expect(after.placingsLogged).toBe(1);
    expect(after.acceptedCopyKept).toBe(false);
    expect(after.ownRecordKept).toBe(true);
  });

  it("nothing asked this process to stop through the switch-on and every later start", () => {
    restarted();
    expect(stopsAskedAtEnd).toBe(0);
  });

  it("M1's certificate card shows the certificate it holds", () => {
    const { run } = seen();
    expect(run.m1Certificate.filing).toBe(true);
    expect(run.m1Certificate.revision).not.toBeNull();
    expect(run.m1Certificate.installed).toMatchObject({ source: "setup", kind: "sello" });
  });

  it("M2 holds the certificate after the handover", () => {
    const { run, on } = sold();
    expect(on.m2Certificate.filing).toBe(true);
    expect(on.m2Certificate.revision).toBe(run.m1Certificate.revision);
  });

  it("M2's certificate card shows that certificate", () => {
    const { run, on } = sold();
    const m1 = run.m1Certificate.installed;
    expect(m1).not.toBeNull();
    expect(on.m2Certificate.installed).toMatchObject({
      source: "setup",
      kind: "sello",
      validFrom: m1!.validFrom,
      validUntil: m1!.validUntil,
      installedAt: m1!.installedAt,
    });
  });

  const inheritedRun = () => {
    if (inherited === undefined) throw inheritedFailure ?? new Error("no inherited-work stage ran");
    return { ...sold(), w: inherited };
  };

  it("M2 adds a dish to the table it took over", () => {
    const { w } = inheritedRun();
    expect(w.readOne.status, JSON.stringify(w.readOne.body)).toBe(200);
    expect(w.change.status, JSON.stringify(w.change.body)).toBe(200);
    expect(w.linesAfterChange).toBe(w.tab.linesBefore + 1);
  });

  it("M2 takes cash for that table, on a sale in its own series", () => {
    const { b, on, w } = inheritedRun();
    expect(w.balance.status, JSON.stringify(w.balance.body)).toBe(200);
    expect(
      w.pay.status === 200 || w.collect?.status === 200,
      JSON.stringify({ pay: w.pay, place: w.place, collect: w.collect }),
    ).toBe(true);
    expect(w.tabStatusAfterPay).toBe("settled");
    expect(w.tabSale).toHaveLength(1);
    expect(w.tabSale[0]!.node_id).toBe(b.m2.nodeId);
    expect(w.tabSale[0]!.code).toBe(`A-${on.selected.identity}`);
    expect(w.tabSaleRecord).toMatchObject([{ node_id: b.m2.nodeId, estado: "aceptado" }]);
  });

  it("M2's next order number is above every number given out, and none repeats", () => {
    const { w } = inheritedRun();
    expect(w.newOrder.status, JSON.stringify(w.newOrder.body)).toBe(200);
    const number = (w.newOrder.body as { orderNumber: number }).orderNumber;
    const given = w.m1Orders.map((row) => row.order_number);
    expect(number, JSON.stringify(w.m1Orders)).toBeGreaterThan(Math.max(0, ...given));
    const onM2 = w.m2Orders.map((row) => row.order_number);
    expect(new Set(onM2).size, JSON.stringify(w.m2Orders)).toBe(onM2.length);
  });

  it("M2 refunds in cash one of M1's sales", () => {
    const { b, w } = inheritedRun();
    expect(w.refundSaleNode).toBe(b.m1.nodeId);
    expect(w.refund?.status, JSON.stringify(w.refund?.body)).toBe(200);
    expect(w.refund?.body).toMatchObject({ state: "completed" });
    expect(w.refundRows).toEqual([{ node_id: b.m2.nodeId, state: "completed" }]);
    expect(w.m1RecordsAroundRefund.after).toBe(w.m1RecordsAroundRefund.before);
  });

  it("M2 cancels one of M1's filed sales on its own chain, and files it", () => {
    const { b, on, w } = inheritedRun();
    expect(w.voidSaleNode).toBe(b.m1.nodeId);
    expect(w.voided, JSON.stringify(w.voided)).toMatchObject({ ok: true });
    expect(w.voidRecords).toHaveLength(1);
    const [record] = w.voidRecords;
    expect(record!.node_id).toBe(b.m2.nodeId);
    expect(record!.sif_id).toBe(w.m2SifId);
    expect(record!.estado).toBe("aceptado");
    expect(w.voidHeard).toHaveLength(1);
    expect(w.voidHeard[0]!.record).toMatchObject({
      SistemaInformatico: { NumeroInstalacion: on.selected.identity },
      IDFactura: {
        IDEmisorFacturaAnulada: w.voidedInvoice?.emisor,
        NumSerieFacturaAnulada: w.voidedInvoice?.serie,
        FechaExpedicionFacturaAnulada: w.voidedInvoice && toAeatDate(w.voidedInvoice.fecha),
      },
    });
  });

  it("the day's cash-up on M2 includes M1's sales", () => {
    const { w } = inheritedRun();
    const allSales = w.salesByNode.reduce((sum, row) => sum + row.n, 0);
    expect(w.overview.status, JSON.stringify(w.overview.body)).toBe(200);
    expect(w.dailyClose.status, JSON.stringify(w.dailyClose.body)).toBe(200);
    const counts = (w.dailyClose.body as { counts: { sales: number } }).counts;
    expect(counts.sales, JSON.stringify({ byNode: w.salesByNode, counts })).toBe(allSales);
  });

  it("the inherited-work stage ran to its end", () => {
    const { w } = inheritedRun();
    expect(w.stageErrors).toEqual([]);
    expect(w.m2SifId).not.toBeNull();
    expect(w.voidedInvoice).not.toBeNull();
    expect(w.m1RecordsAroundRefund.before).toBeGreaterThan(0);
    for (const answer of [w.balance, w.newOrder, w.overview, w.dailyClose])
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(w.voided, JSON.stringify(w.voided)).toMatchObject({ ok: true });
    expect(w.voidRecords).toHaveLength(1);
    expect(w.m2SellingAfterVoidRestart).toBe(true);
  });
});
