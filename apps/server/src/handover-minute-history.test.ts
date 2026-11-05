// Does a spare promoted from M1's database copy avoid every minute name M1 used, without M1's
// module-preparation-state.json? Each case but the control puts the spare's clock on the minute of
// M1's later name, where a reused name prints `selected` with that name and an avoided one prints
// `waiting`.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
import { createFirstSetupCoordinator } from "@waitron/provisioning";
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
import { persons, hashPassword } from "@waitron/identity";
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
const SPARE_FILE = "module-preparation-state.json";
let root: string;
let key: { name: string; secret: string };

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
    read: async () => ({
      scope: { taxpayerNif: "89890001K", environment: "preproduction" },
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
    }),
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
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
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
  await suite.db.insert(persons).values({
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

// Pins today's behaviour, not a wanted one: the manifest's module-preparation-state.json row
// rests on it.
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
  const path = join(root, "state", SPARE_FILE);
  const own = JSON.parse(await readFile(path, "utf8")) as { revisions: unknown[] };
  await writeFile(
    path,
    JSON.stringify({ version: 1, revisions: [...m1Revisions, ...own.revisions] }),
  );
  const minute = minuteOf(abandoned.identity);
  vi.setSystemTime(minute);
  expect(await spareSelects(s)).toEqual(
    expect.objectContaining({ status: "waiting", targetMs: minute + 60_000 }),
  );
});

// Pins today's behaviour, not a wanted one: the manifest's module-preparation-state.json row
// rests on it.
it("M1's history placed as the restore path places it (module-evidence) is not read by the promotion: the name is reused", async () => {
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
  const folder = join(root, "state", "module-evidence", "fiscal-verifactu");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "hour-history.json"), JSON.stringify(evidence));
  vi.setSystemTime(minuteOf(abandoned.identity));
  expect(await spareSelects(s)).toMatchObject({ status: "selected", identity: abandoned.identity });
});
