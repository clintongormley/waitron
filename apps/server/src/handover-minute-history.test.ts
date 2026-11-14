import { seedModuleRecord } from "../test/module-records.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { seedVenueSettings, seedBusinessDay } from "@waitron/db/testing/seed.js";
// Does a spare promoted from M1's database copy avoid every minute name M1 used, without M1's
// module-records/fiscal-verifactu.json? The cases asking this put the spare's clock on the minute of
// M1's later name, where a reused name prints `selected` with that name and an avoided one prints
// `waiting`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  invoiceSeries,
  locations,
  nodes,
  stampDeployment,
  tenants,
  withTransaction,
} from "@waitron/db";
import { setNodeMode } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import {
  createFirstSetupCoordinator,
  createRecoveryPreparationHost,
  mergeModulePreparationRevisions,
  modulePreparationMergeFits,
  readModulePreparationRevisions,
} from "@waitron/provisioning";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type OperationBinding,
} from "@waitron/module";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { FISCAL_HOUR_BACKUP_STATE } from "@waitron/fiscal-verifactu";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { readHourHistory } from "@waitron/fiscal-verifactu/src/hour-history-reader.js";
import { createHourSelection } from "@waitron/fiscal-verifactu/src/hour-selection.js";
import {
  EPOCH_MS,
  MINUTE_MS,
  decodeMinuteIdentity,
  encodeMinuteIdentity,
} from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu/src/allocated-standby.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { loadKeyRing } from "@waitron/credentials";
import { hashPassword } from "@waitron/identity";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { establishNodeIdentity } from "./node-identity.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { promoteMirrorToPrimary } from "./promote.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
// One venue file holds both nodes: a mirror's venue.db is M1's whole database, so it is the copy.
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const primary = { nodeId: TENANT_A.nodeId };
const standby = { nodeId: TENANT_A.nodeId2 };
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const PASSWORD = "synthetic-handover-password";
const credentials = { personId: ADMIN, password: PASSWORD };
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const joinBinding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "reserve",
  eventId: "admission",
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
const binding: OperationBinding = { ...joinBinding, action: "promote", eventId: "promotion" };
const context = { oldNodeNeutralised: true, noParallelRecovery: true };
let root: string;
let key: { name: string; secret: string };

/** What a box's selection reads, with the clocks agreeing and no history of its own. */
const hourFacts = (eventId: string) => ({
  scope: { taxpayerNif: "89890001K", environment: "preproduction" as const },
  bases,
  contextKey: eventId,
  history: [{ reference: "empty", complete: true, records: [] }],
  clock: compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 0,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: 0,
      monotonicFinishedMs: 0,
    })),
    Date.parse("2026-10-15T00:00:00Z"),
  ),
});

/** One of M1's own minute selections, kept in the `{ binding, value }` shape. */
async function selectOnM1(eventId: string, activate: boolean) {
  let value: unknown = null;
  const held = { ...joinBinding, action: "setup", eventId, targetNodeId: primary.nodeId };
  const preparation = createHourPreparation({
    withState: async (_binding, run) =>
      run({
        get value() {
          return value;
        },
        history: [],
        async replace(next) {
          value = next;
        },
      }),
    monotonicNow: () => performance.now(),
    read: async () => hourFacts(eventId),
  });
  const identity = await withOperationAuthority(held, ADMIN, async (authority) => {
    let selected = await preparation.select({ binding: held, authority, comparisonId: eventId });
    if (selected.status === "waiting") {
      vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
      selected = await preparation.select({ binding: held, authority, comparisonId: eventId });
    }
    if (selected.status !== "selected") throw new Error(`M1 selection ${eventId}`);
    if (activate)
      await preparation.prepare({ binding: held, authority, input: selected.input }, (ready) =>
        withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
      );
    return selected.identity;
  });
  return { identity, revision: { binding: held, value } };
}

let m1Revisions: { binding: OperationBinding; value: unknown }[];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "handover-minute-history-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 0,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }));
  await suite.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Handover SL" });
  await suite.db.insert(locations).values({
    id: TENANT_A.locationId,
  });
  await seedVenueSettings(suite.db, {
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await seedBusinessDay(suite.db, { timeZone: "Europe/Madrid" });
  await suite.db.insert(nodes).values(
    [primary, standby].map((node) => ({
      id: node.nodeId,
      locationId: TENANT_A.locationId,
      name: node === primary ? "Primary" : "Standby",
      filingModule: "verifactu",
      taxModule: "vat",
    })),
  );
  await stampDeployment(suite.db, "preproduction");
  await seedPersons(suite.db, {
    id: ADMIN,
    displayName: "Administrator",
    role: "admin",
    passwordHash: hashPassword(PASSWORD),
  });
  m1Revisions = [(await selectOnM1("first", true)).revision];
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, standby.nodeId);
  await setNodeMode({ venue: suite.db, node: suite.node }, standby.nodeId, "mirror");
  key = await mintBreakGlassKey({ venue: suite.db, node: suite.node }, standby.nodeId);
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});

/** The spare's own operation service, reading only its own state folder. */
function spareService() {
  return createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    nodeDb: suite.node,
    node: standby,
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}
async function admit(s: ReturnType<typeof spareService>) {
  let state: unknown;
  await s.withOperation(
    { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "reserve", (ready) =>
        withTransaction(suite.db, async (tx) => {
          state = (
            await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, ready.get(binding.module))
          ).state;
        }),
      ),
  );
  const establish = { ...joinBinding, action: "establish" };
  await s.withOperation({ binding: establish, input: state }, credentials, {}, async (m, o) =>
    withPreparedModuleOperations(m, o, standby.nodeId, "establish", (ready) =>
      withTransaction(suite.db, (tx) =>
        ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(binding.module)),
      ),
    ),
  );
}
/** The handover route's first request: a person signs in, and the setup is written from the copy. */
async function switchOnWritesSetup(s: ReturnType<typeof spareService>) {
  await s.prepareWithDormantSetup(
    binding,
    credentials,
    context,
    { action: "clock-challenge" },
    { onBox: true },
  );
}
/** The spare's promotion selection: a fresh clock comparison, then `select`. */
async function spareSelects(s: ReturnType<typeof spareService>) {
  const auth = { breakGlass: key.secret };
  const challenge = (await s.prepare(
    binding,
    auth,
    context,
    { action: "clock-challenge" },
    { onBox: true },
  )) as { id: string };
  const compared = (await s.prepare(
    binding,
    auth,
    context,
    { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: Date.now() } },
    { onBox: true },
  )) as { id: string };
  return (await s.prepare(
    binding,
    auth,
    context,
    { action: "select", comparisonId: compared.id },
    { onBox: true },
  )) as { status: string; identity?: string; targetMs?: number; input?: unknown };
}
/** The spare's promotion, activating the selection `select` answered. */
async function sparePromotes(s: ReturnType<typeof spareService>, input: unknown) {
  return s.withPromotion(
    { binding, input },
    { breakGlass: key.secret },
    context,
    (modules, runner) =>
      promoteMirrorToPrimary(
        {
          db: suite.db,
          node: suite.node,
          nodeId: standby.nodeId,
          ring,
          modules,
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          persistTradingEnv: async () => {},
          withModuleOperations: runner,
        },
        { oldNodeNeutralised: true },
      ),
  );
}
/** M1's later name, recorded in the copy as a retired installation of M1's. */
async function recordLaterNameInCopy(minute: number) {
  const [live] = await suite.db.select().from(registroSif);
  await suite.db.insert(registroSif).values({
    nodeId: primary.nodeId,
    nif: live!.nif,
    idSistemaInformatico: live!.idSistemaInformatico,
    numeroInstalacion: encodeMinuteIdentity(minute),
    registradoEn: new Date(minute - 60 * 60_000),
    revocadoEn: new Date(minute - 30 * 60_000),
  });
}
const minuteOf = (identity: string) => EPOCH_MS + decodeMinuteIdentity(identity) * MINUTE_MS;
const thisMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const firstName = async () => (await suite.db.select().from(registroSif))[0]!.numeroInstalacion;

it("a later name M1 recorded in the copy is not reused: the spare waits past its minute", async () => {
  const s = spareService();
  await admit(s);
  const later = thisMinute();
  await recordLaterNameInCopy(later);
  expect(minuteOf(await firstName())).toBeLessThan(later);
  expect(await spareSelects(s)).toEqual(
    expect.objectContaining({ status: "waiting", targetMs: later + 60_000 }),
  );
});

it("control: one minute after both of M1's names the spare selects a fresh name", async () => {
  const s = spareService();
  await admit(s);
  const later = thisMinute();
  await recordLaterNameInCopy(later);
  vi.setSystemTime(later + 60_000);
  const selected = await spareSelects(s);
  expect(selected).toMatchObject({ status: "selected" });
  expect([await firstName(), encodeMinuteIdentity(later)]).not.toContain(selected.identity);
});

// Pins today's behaviour, not a wanted one.
it("a name M1 selected and never activated is not in the copy, and the spare without M1's file reuses it", async () => {
  const s = spareService();
  await admit(s);
  const abandoned = await selectOnM1("abandoned", false);
  m1Revisions.push(abandoned.revision);
  vi.setSystemTime(minuteOf(abandoned.identity));
  const selected = await spareSelects(s);
  expect(selected).toMatchObject({ status: "selected", identity: abandoned.identity });
  await sparePromotes(s, selected.input);
  const sif = await suite.db.select().from(registroSif);
  expect(sif.find((row) => row.nodeId === standby.nodeId)?.numeroInstalacion).toBe(
    abandoned.identity,
  );
});

it("with M1's selections in the spare's own preparation file, the spare waits past that name", async () => {
  const s = spareService();
  await admit(s);
  const abandoned = await selectOnM1("abandoned", false);
  m1Revisions.push(abandoned.revision);
  await mergeModulePreparationRevisions({ stateDir: join(root, "state") }, m1Revisions);
  const minute = minuteOf(abandoned.identity);
  vi.setSystemTime(minute);
  expect(await spareSelects(s)).toEqual(
    expect.objectContaining({ status: "waiting", targetMs: minute + 60_000 }),
  );
});

it("a name M1 selected and never used stays used after the switch-on writes the setup", async () => {
  const s = spareService();
  const abandoned = await selectOnM1("abandoned", false);
  m1Revisions.push(abandoned.revision);
  await mergeModulePreparationRevisions({ stateDir: join(root, "state") }, m1Revisions);
  await switchOnWritesSetup(s);
  const history = await readModulePreparationRevisions({ stateDir: join(root, "state") });
  expect(history).toHaveLength(m1Revisions.length + 1);
  expect(history.at(-1)?.binding).toEqual({
    ...binding,
    action: "establish",
  });
  const minute = minuteOf(abandoned.identity);
  vi.setSystemTime(minute);
  expect(await spareSelects(s)).toEqual(
    expect.objectContaining({ status: "waiting", targetMs: minute + 60_000 }),
  );
  vi.advanceTimersByTime(60_000);
  const selected = await spareSelects(s);
  expect(selected).toMatchObject({ status: "selected" });
  expect(selected.identity).not.toBe(abandoned.identity);
  await sparePromotes(s, selected.input);
});

it("holding M1's selections on two adjacent minutes, the spare waits past both, selects another and promotes under it", async () => {
  const s = spareService();
  await admit(s);
  const abandoned = await selectOnM1("abandoned", false);
  const minute = minuteOf(abandoned.identity);
  vi.setSystemTime(minute - 60_000);
  const next = await selectOnM1("abandoned-next", false);
  expect(minuteOf(next.identity)).toBe(minute + 60_000);
  m1Revisions.push(abandoned.revision, next.revision);
  await mergeModulePreparationRevisions({ stateDir: join(root, "state") }, m1Revisions);
  vi.setSystemTime(minute);
  expect(await spareSelects(s)).toEqual(
    expect.objectContaining({ status: "waiting", targetMs: minute + 120_000 }),
  );
  vi.advanceTimersByTime(120_000);
  const selected = await spareSelects(s);
  expect(selected).toMatchObject({ status: "selected" });
  await sparePromotes(s, selected.input);
  const sif = await suite.db.select().from(registroSif);
  expect(sif.find((row) => row.nodeId === standby.nodeId)?.numeroInstalacion).toBe(
    selected.identity,
  );
});

describe("a merged file close to its limit", () => {
  const LIMIT = 1024 * 1024;
  type Retained = { binding: OperationBinding; value: unknown };
  const revisionBytes = (revision: Retained) => Buffer.byteLength(JSON.stringify(revision));
  const stateDir = () => join(root, "state");
  /** M1's selections plus padding under a second module, so the merged file is `size` bytes. */
  const paddedTo = async (size: number) => {
    const own = await readModulePreparationRevisions({ stateDir: stateDir() });
    const padding = (text: string) => ({
      binding: { ...joinBinding, module: "padding", eventId: "padding" },
      value: { text },
    });
    const bytes = Buffer.byteLength(
      JSON.stringify({ version: 1, prepared: [...m1Revisions, padding(""), ...own], retained: {} }),
    );
    return [...m1Revisions, padding("x".repeat(size - bytes))];
  };
  const mergeTo = async (size: number) => {
    await mergeModulePreparationRevisions({ stateDir: stateDir() }, await paddedTo(size));
    expect(
      Buffer.byteLength(
        JSON.stringify({
          version: 1,
          prepared: await readModulePreparationRevisions({ stateDir: stateDir() }),
          retained: {},
        }),
      ),
    ).toBe(size);
  };
  /** The clock on M1's name, so `select` writes a wait and then an intent before promotion. */
  const onAbandonedMinute = async () => {
    const abandoned = await selectOnM1("abandoned", false);
    m1Revisions.push(abandoned.revision);
    const minute = minuteOf(abandoned.identity);
    vi.setSystemTime(minute);
    return minute;
  };

  /** Past attempts written by the real selection code through the real file store. */
  const attemptsOn = async (
    dir: string,
    nodeId: string,
    count: number,
    { venueHistory, waits }: { venueHistory: boolean; waits: boolean },
  ) => {
    await mkdir(dir, { recursive: true });
    const host = createRecoveryPreparationHost({
      stateDir: dir,
      venueDir: join(root, "venue"),
      coordinator: createFirstSetupCoordinator(),
      authorize: async () => {},
      withVenueExclusion: (run) => run(),
      readRecoveryFacts: async () => {
        throw new Error("a past attempt reads no recovery facts");
      },
    });
    const selection = createHourSelection({
      withState: host.withPreparationState,
      monotonicNow: () => performance.now(),
      read: async (held) => ({
        ...hourFacts(held.eventId),
        ...(venueHistory && {
          history: [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))],
        }),
      }),
    });
    let last = "";
    for (let attempt = 0; attempt < count; attempt += 1) {
      const eventId = randomUUID();
      // A setup waits for a later minute and writes twice; a promotion on a free minute writes once.
      const action = waits ? "setup" : "promote";
      const held = { ...joinBinding, action, eventId, targetNodeId: nodeId };
      vi.advanceTimersByTime(60_000);
      last = await withOperationAuthority(held, ADMIN, async (authority) => {
        const request = { binding: held, authority, comparisonId: eventId };
        if (waits) {
          const waiting = await selection.select(request);
          if (waiting.status !== "waiting") throw new Error(`attempt ${eventId} did not wait`);
          vi.advanceTimersByTime(waiting.targetMs + 1 - Date.now());
        }
        const selected = await selection.select(request);
        if (selected.status !== "selected") throw new Error(`attempt ${eventId} did not select`);
        return selected.identity;
      });
    }
    return minuteOf(last);
  };
  /**
   * `real` plus revisions under a second module, each at most about half the largest of `real`, so
   * they add to the file without changing what the size check reads from the largest.
   */
  const fillerChunk = (real: readonly Retained[]) =>
    Math.floor(Math.max(...real.map(revisionBytes)) / 2);
  const filled = (real: readonly Retained[], full: number, extra: number): Retained[] => {
    const filler = (index: number, length: number) => ({
      binding: { ...joinBinding, module: "filler", eventId: `filler-${index}` },
      value: { text: "x".repeat(length) },
    });
    return [
      ...real,
      ...Array.from({ length: full }, (_, index) => filler(index, fillerChunk(real))),
      filler(full, extra),
    ];
  };
  /** The largest whole number `accepted` takes, given it takes `low` and refuses `high`. */
  const lastAccepted = async (
    low: number,
    high: number,
    accepted: (value: number) => Promise<boolean>,
  ) => {
    let [yes, no] = [low, high];
    while (no - yes > 1) {
      const middle = Math.floor((yes + no) / 2);
      if (await accepted(middle)) yes = middle;
      else no = middle;
    }
    return yes;
  };
  /** Filled to the last byte the check takes: the search asks the check, never its arithmetic. */
  const justInside = async (real: readonly Retained[]) => {
    const fits = (list: readonly Retained[]) =>
      modulePreparationMergeFits({ stateDir: stateDir() }, list);
    expect(await fits(filled(real, 0, 0))).toBe(true);
    const most = Math.ceil(LIMIT / fillerChunk(real));
    const full = await lastAccepted(0, most, (count) => fits(filled(real, count, 0)));
    const extra = await lastAccepted(0, LIMIT, (length) => fits(filled(real, full, length)));
    expect(await fits(filled(real, full, extra + 1))).toBe(false);
    return filled(real, full, extra);
  };
  /** The clock on a used minute: the spare writes a wait, then its selection, then promotes. */
  const waitsSelectsPromotes = async (s: ReturnType<typeof spareService>, minute: number) => {
    vi.setSystemTime(minute);
    expect(await spareSelects(s)).toEqual(
      expect.objectContaining({ status: "waiting", targetMs: minute + 60_000 }),
    );
    vi.advanceTimersByTime(60_000);
    const selected = await spareSelects(s);
    expect(selected).toMatchObject({ status: "selected" });
    await sparePromotes(s, selected.input);
    const sif = await suite.db.select().from(registroSif);
    expect(sif.find((row) => row.nodeId === standby.nodeId)?.numeroInstalacion).toBe(
      selected.identity,
    );
  };
  const m1Dir = () => join(root, "m1-state");

  const rig = async (
    m1Attempts: number,
    m2Attempts: number,
    shape: { venueHistory: boolean; waits: boolean },
    { setupAlreadyWritten = true } = {},
  ) => {
    const s = spareService();
    if (setupAlreadyWritten) await admit(s);
    await mkdir(m1Dir(), { recursive: true });
    let minute = await onAbandonedMinute();
    await mergeModulePreparationRevisions({ stateDir: m1Dir() }, m1Revisions);
    if (m1Attempts > 0) minute = await attemptsOn(m1Dir(), primary.nodeId, m1Attempts, shape);
    if (m2Attempts > 0) minute = await attemptsOn(stateDir(), standby.nodeId, m2Attempts, shape);
    const m1List = await readModulePreparationRevisions({ stateDir: m1Dir() });
    return { s, minute, m1List };
  };

  const FILLED_SHAPES = [
    { title: "few selections", m1: 0, m2: 0, venueHistory: false, waits: true },
    {
      title: "30 past attempts that never waited",
      m1: 30,
      m2: 0,
      venueHistory: false,
      waits: false,
    },
    { title: "the most attempts one box holds", m1: 20, m2: 0, venueHistory: false, waits: true },
    {
      title: "the most, reading the venue's history",
      m1: 20,
      m2: 0,
      venueHistory: true,
      waits: true,
    },
    { title: "two boxes' lists", m1: 14, m2: 14, venueHistory: false, waits: true },
    {
      title: "two lists, reading the venue's history",
      m1: 13,
      m2: 13,
      venueHistory: true,
      waits: true,
    },
  ];

  it.each(FILLED_SHAPES)(
    "filled to the last byte the size check takes, $title: the spare still waits, selects and promotes",
    async ({ m1, m2, venueHistory, waits }) => {
      const { s, minute, m1List } = await rig(m1, m2, { venueHistory, waits });
      const incoming = await justInside(m1List);
      await mergeModulePreparationRevisions({ stateDir: stateDir() }, incoming);
      await waitsSelectsPromotes(s, minute);
    },
    120_000,
  );

  it.each(FILLED_SHAPES)(
    "filled to the last byte the size check takes, $title: the switch-on writes its setup, then the spare waits, selects and promotes",
    async ({ m1, m2, venueHistory, waits }) => {
      const { s, minute, m1List } = await rig(
        m1,
        m2,
        { venueHistory, waits },
        { setupAlreadyWritten: false },
      );
      const incoming = await justInside(m1List);
      await mergeModulePreparationRevisions({ stateDir: stateDir() }, incoming);
      await switchOnWritesSetup(s);
      await waitsSelectsPromotes(s, minute);
    },
    120_000,
  );

  it("control: with 1000 bytes of the file left, the real select refuses", async () => {
    const s = spareService();
    await admit(s);
    await onAbandonedMinute();
    await mergeTo(LIMIT - 1000);
    await expect(spareSelects(s)).rejects.toMatchObject({ code: "setup.attempt_invalid" });
  });
});

// Pins today's behaviour, not a wanted one.
it("M1's history placed as the restore path places it (the retained section) is not read by the promotion: the name is reused", async () => {
  const s = spareService();
  await admit(s);
  const abandoned = await selectOnM1("abandoned", false);
  m1Revisions.push(abandoned.revision);
  if (FISCAL_HOUR_BACKUP_STATE.kind !== "preparation-history") throw new Error("source kind");
  const evidence = FISCAL_HOUR_BACKUP_STATE.project({
    preparations: m1Revisions.map((revision) => revision.value),
    retained: [],
  }) as { records: { identity: string }[] };
  expect(evidence.records.map((row) => row.identity)).toContain(abandoned.identity);
  await seedModuleRecord(join(root, "state"), "fiscal-verifactu", {
    retained: { "hour-history": evidence },
  });
  vi.setSystemTime(minuteOf(abandoned.identity));
  expect(await spareSelects(s)).toMatchObject({ status: "selected", identity: abandoned.identity });
});
