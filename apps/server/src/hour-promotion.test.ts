import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  invoiceSeries,
  locations,
  nodes,
  stampDeployment,
  tenants,
  withTransaction,
} from "@waitron/db";
import { readNodeMode, setNodeMode, writeMirrorLink } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupCoordinator, readModulePreparationHistory } from "@waitron/provisioning";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type OperationBinding,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { encodeMinuteIdentity } from "@waitron/fiscal-verifactu/src/hour-identity.js";
import { activatePreparedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-preparation.js";
import { ALLOCATED_FISCAL_STANDBY } from "@waitron/fiscal-verifactu/src/allocated-standby.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { fiscalReservations } from "@waitron/fiscal-verifactu/src/schema/reservations.js";
import { registroSif } from "@waitron/fiscal-verifactu/src/schema/sif.js";
import { loadKeyRing } from "@waitron/credentials";
import { persons, hashPassword } from "@waitron/identity";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mintBreakGlassKey } from "./break-glass.js";
import { establishNodeIdentity } from "./node-identity.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { Hono } from "hono";
import { mountPromoteApi } from "./promote-api.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { TLSSocket } from "node:tls";
import { Socket } from "node:net";
import { Agent } from "undici";
import { ensureBoxSecrets } from "./box-secrets.js";
import { freePorts } from "./testing/free-ports.js";
import { startServer, type StartedServer } from "./boot.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { seedFixtureSif } from "@waitron/fiscal-verifactu/test/sif-fixture.js";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import { nodeId as brandNodeId } from "@waitron/shared";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const migrations = migrationOptionsFor(manifestSets(), null);
const suite = useVenueDb({ migrations });
const spare = useVenueDb({ migrations });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const ADMIN = "e1000000-0000-4000-8000-000000000004";
const PASSWORD = "synthetic-promotion-password";
const hash = hashPassword(PASSWORD);
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
/** The last clock comparison taken, which the next select names. */
let comparisonId = "";
let key: { name: string; secret: string };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "hour-promotion-"));
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
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Promotion SL" });
  await suite.db.insert(locations).values({
    id: primary.locationId,
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
    timeZone: "Europe/Madrid",
  });
  await suite.db.insert(nodes).values(
    [primary, standby].map((node) => ({
      id: node.nodeId,
      locationId: node.locationId,
      name: node === primary ? "Primary" : "Standby",
      filingModule: "verifactu",
      taxModule: "vat",
    })),
  );
  await stampDeployment(suite.db, "preproduction");
  await suite.db
    .insert(persons)
    .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: hash });
  let value: unknown = null;
  const first = { ...joinBinding, action: "setup", eventId: "first", targetNodeId: primary.nodeId };
  const setup = createHourPreparation({
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
      contextKey: "first",
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
  await withOperationAuthority(first, ADMIN, async (authority) => {
    let selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    if (selected.status === "waiting") {
      vi.advanceTimersByTime(selected.targetMs + 1 - Date.now());
      selected = await setup.select({ binding: first, authority, comparisonId: "comparison" });
    }
    if (selected.status !== "selected") throw new Error("first setup selection");
    await setup.prepare({ binding: first, authority, input: selected.input }, (ready) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, ready)),
    );
  });
  await suite.db.update(invoiceSeries).set({ nextNumber: 123 });
  await establishNodeIdentity({ ownerDb: suite.db, ring }, standby.nodeId);
  await setNodeMode({ venue: suite.db, node: suite.node }, standby.nodeId, "mirror");
  key = await mintBreakGlassKey(suite.db, standby.nodeId);
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(async () => {
  vi.useRealTimers();
  external.internet.mockReset();
  if (root) await rm(root, { recursive: true, force: true });
});

async function service(modules = ALL_MODULES.filter((module) => module.name === binding.module)) {
  return createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    node: standby,
    modules,
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
}
async function admit(s: Awaited<ReturnType<typeof service>>) {
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
  await s.withOperation(
    { binding: establish, input: state },
    credentials,
    {},
    async (modules, operations) =>
      withPreparedModuleOperations(modules, operations, standby.nodeId, "establish", (ready) =>
        withTransaction(suite.db, (tx) =>
          ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, ready.get(binding.module)),
        ),
      ),
  );
  return state;
}
async function compare(
  s: Awaited<ReturnType<typeof service>>,
  auth: unknown = { breakGlass: key.secret },
  held = binding,
) {
  const challenge = (await s.prepare(
    held,
    auth,
    context,
    { action: "clock-challenge" },
    { onBox: true },
  )) as {
    id: string;
  };
  const compared = (await s.prepare(
    held,
    auth,
    context,
    {
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    },
    { onBox: true },
  )) as { id: string };
  comparisonId = compared.id;
  return compared;
}
async function rows() {
  return {
    series: await suite.db.select().from(invoiceSeries),
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
    sif: await suite.db.select().from(registroSif),
  };
}
async function promote(
  s: Awaited<ReturnType<typeof service>>,
  input: unknown,
  auth: unknown = { breakGlass: key.secret },
) {
  return s.withPromotion({ binding, input }, auth, context, (modules, runner) =>
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

it.each(["key", "manager"])(
  "selects a promotion hour only after dormant admission, with %s authority",
  async (method) => {
    const s = await service();
    const before = await rows();
    await admit(s);
    expect(await rows()).toEqual(before);
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        binding.module,
      ),
    ).toEqual([
      expect.objectContaining({ entries: [], dormant: [expect.objectContaining({ bases })] }),
    ]);
    const auth = method === "key" ? { breakGlass: key.secret } : credentials;
    await compare(s, auth);
    const selected = (await s.prepare(
      binding,
      auth,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    )) as { input: unknown };
    expect(selected).toMatchObject({ status: "selected", identity: "0CNQR", bases });
    expect(await rows()).toEqual(before);
    expect(await promote(s, selected.input, auth)).toMatchObject({ alreadyPrimary: false });
    const after = await rows();
    expect(after.reservations).toEqual([]);
    expect(after.allocations).toHaveLength(2);
    expect(after.series.filter((row) => row.nodeId === primary.nodeId)).toEqual(before.series);
    expect(
      after.series
        .filter((row) => row.nodeId === standby.nodeId)
        .map(({ code, purpose, nextNumber }) => ({ code, purpose, nextNumber })),
    ).toEqual(bases.map((base) => ({ ...base, code: `${base.code}-0CNQR`, nextNumber: 1 })));
    expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("primary");
    expect((await readNodeMode(suite.node, standby.nodeId)).singletonRole).toBe("primary");
    expect(await promote(s, selected.input, auth)).toMatchObject({ alreadyPrimary: true });
    expect(await rows()).toEqual(after);
    expect(await readFile(join(root, "state/module-preparation-state.json"), "utf8")).not.toContain(
      key.secret,
    );
  },
);

it("refuses a selection that still carries an installation code, writing nothing", async () => {
  const s = await service();
  await admit(s);
  await compare(s);
  const before = await rows();
  await expect(
    s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      { action: "select", comparisonId, installationCodes: ["0CNQX"] },
      { onBox: true },
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "event_mismatch" },
  });
  expect(await rows()).toEqual(before);
});

it.each(["key", "isolation", "parallel", "source", "node"])(
  "refuses changed %s before selection writes",
  async (fault) => {
    const s = await service();
    await admit(s);
    const held = {
      ...binding,
      ...(fault === "source" ? { sourceId: "changed" } : {}),
      ...(fault === "node" ? { targetNodeId: primary.nodeId } : {}),
    };
    const before = await readFile(join(root, "state/module-preparation-state.json"), "utf8");
    await expect(
      s.prepare(
        held,
        { breakGlass: fault === "key" ? "wrong" : key.secret },
        {
          ...context,
          ...(fault === "isolation" ? { oldNodeNeutralised: false } : {}),
          ...(fault === "parallel" ? { noParallelRecovery: false } : {}),
        },
        { action: "clock-challenge" },
        { onBox: true },
      ),
    ).rejects.toMatchObject({
      code:
        fault === "key"
          ? "promotion.break_glass_invalid"
          : fault === "node"
            ? "module.operation_invalid"
            : fault === "isolation"
              ? "promotion.fence_not_attested"
              : fault === "parallel"
                ? "module.operation_invalid"
                : "sif.allocation_invalid",
    });
    expect(await readFile(join(root, "state/module-preparation-state.json"), "utf8")).toBe(before);
  },
);

it("retains the selected hour across restart but discards transient comparison authority", async () => {
  const first = await service();
  await admit(first);
  await compare(first);
  const selected = (await first.prepare(
    binding,
    { breakGlass: key.secret },
    context,
    {
      action: "select",
      comparisonId,
    },
    { onBox: true },
  )) as { input: unknown };
  const next = await service();
  await expect(promote(next, selected.input)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  vi.setSystemTime(new Date("2026-10-16T13:10:00Z"));
  await compare(next);
  expect(
    await next.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).toEqual(selected);
  await promote(next, selected.input);
  expect((await rows()).allocations).toHaveLength(2);
});

it.each(["standard", "full", "rectificative"])(
  "refuses a second %s prefix before dormant admission or hour selection",
  async (purpose) => {
    await suite.db.insert(invoiceSeries).values({
      nodeId: primary.nodeId,
      code: "a/B_1.2-3-0CNNW",
      purpose,
    });
    const s = await service();
    const before = await rows();
    await expect(admit(s)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "series_configuration_unsupported" },
    });
    expect(await rows()).toEqual(before);
    expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("mirror");
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        binding.module,
      ),
    ).toEqual([]);
  },
);

it("never counts a browser on the box itself as the promotion's second clock", async () => {
  const s = await service();
  await admit(s);
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "unavailable",
    reason: "offline",
  }));
  const compare = async (requestFromBox?: () => boolean) => {
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: suite.db,
      nodeId: standby.nodeId,
      credentialKeyRing: TOTP_KEY_RING,
      nodePreparation: s,
      requestFromBox,
      run: async () => {
        throw new Error("not promoting");
      },
    });
    const socket = new TLSSocket(new Socket());
    Object.defineProperty(socket, "remoteAddress", { value: "127.0.0.1" });
    try {
      const send = async (proposal: unknown) => {
        const response = await app.request(
          "https://box.test/management-api/promote/preparation",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...context,
              breakGlass: key.secret,
              moduleOperation: { binding, input: null },
              proposal,
            }),
          },
          { incoming: { socket } },
        );
        expect(response.status).toBe(200);
        return response.json();
      };
      const challenge = await send({ action: "clock-challenge" });
      return (
        await send({
          action: "compare-clocks",
          browser: { challengeId: challenge.id, instantMs: Date.now() },
        })
      ).clock as { secondClock: boolean; unavailable: unknown[] };
    } finally {
      socket.destroy();
    }
  };
  const box = await compare();
  expect(box.secondClock).toBe(false);
  expect(box.unavailable).toContainEqual(
    expect.objectContaining({ source: "browser", reason: "same_machine" }),
  );
  expect((await compare(() => false)).secondClock).toBe(true);
});

it("serves clock, selection and authenticated promotion through the management routes", async () => {
  const s = await service();
  await admit(s);
  const app = new Hono();
  mountPromoteApi(app, {
    appDb: suite.db,
    nodeId: standby.nodeId,
    credentialKeyRing: TOTP_KEY_RING,
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    nodePreparation: s,
    run: async (attestation, runner) => {
      const result = await promoteMirrorToPrimary(
        {
          db: suite.db,
          node: suite.node,
          nodeId: standby.nodeId,
          ring,
          modules: ALL_MODULES.filter((module) => module.name === binding.module),
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          persistTradingEnv: async () => {},
          withModuleOperations: runner,
        },
        attestation,
      );
      return { ...result, restarting: !result.alreadyPrimary };
    },
  });
  const socket = new TLSSocket(new Socket());
  try {
    const send = async (path: string, body: unknown) => {
      const response = await app.request(
        `https://box.test/management-api/promote${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { incoming: { socket } },
      );
      expect(response.status).toBe(200);
      const value = await response.json();
      expect(response.headers.get("cache-control")).toBe("no-store");
      return value;
    };
    const body = { ...context, breakGlass: key.secret, moduleOperation: { binding, input: null } };
    const challenge = await send("/preparation", {
      ...body,
      proposal: { action: "clock-challenge" },
    });
    const compared = await send("/preparation", {
      ...body,
      proposal: {
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      },
    });
    const selected = await send("/preparation", {
      ...body,
      proposal: { action: "select", comparisonId: compared.id },
    });
    expect(selected).toMatchObject({ status: "selected", identity: "0CNQR" });
    const plain = await app.request("http://box.test/management-api/promote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, moduleOperation: { binding, input: selected.input } }),
    });
    expect(plain.status).toBe(403);
    expect(await plain.json()).toMatchObject({ error: { code: "authorization.not_permitted" } });
    expect((await rows()).allocations).toHaveLength(1);
    expect(
      await send("", { ...body, moduleOperation: { binding, input: selected.input } }),
    ).toMatchObject({ alreadyPrimary: false, restarting: true });
    expect((await rows()).allocations).toHaveLength(2);
  } finally {
    socket.destroy();
  }
});

it("a promotion beside a leftover start-again note file is not held back by the file's floor", async () => {
  const stateDir = join(root, "state");
  const s = await service();
  await admit(s);
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "first-setup-start-again.json"),
    JSON.stringify({
      version: 1,
      floorMs: Date.now() + 10 * 60_000,
      lastName: "0CNQT",
      module: binding.module,
    }),
  );
  const recovery = binding;
  const auth = { breakGlass: key.secret };
  await compare(s, auth, recovery);
  expect(
    await s.prepare(recovery, auth, context, { action: "select", comparisonId }, { onBox: true }),
  ).toMatchObject({ status: "selected" });
});

it("waits past the minute a recorded installation name holds, writing no fiscal rows", async () => {
  const s = await service();
  await admit(s);
  const [live] = await suite.db.select().from(registroSif);
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  await suite.db.insert(registroSif).values({
    nodeId: primary.nodeId,
    nif: live!.nif,
    idSistemaInformatico: live!.idSistemaInformatico,
    numeroInstalacion: encodeMinuteIdentity(minute),
    registradoEn: new Date(Date.now() - 60 * 60_000),
    revocadoEn: new Date(Date.now() - 30 * 60_000),
  });
  await compare(s);
  const before = await rows();
  expect(
    await s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      { action: "select", comparisonId },
      { onBox: true },
    ),
  ).toMatchObject({ status: "waiting", targetMs: minute + 60_000 });
  expect(await rows()).toEqual(before);
});

it("a promotion takes its current minute although a later installation name is recorded", async () => {
  const s = await service();
  await admit(s);
  const [live] = await suite.db.select().from(registroSif);
  await suite.db.insert(registroSif).values({
    nodeId: primary.nodeId,
    nif: live!.nif,
    idSistemaInformatico: live!.idSistemaInformatico,
    numeroInstalacion: encodeMinuteIdentity(Date.now() + 10 * 60_000),
    registradoEn: new Date(Date.now() - 60 * 60_000),
    revocadoEn: new Date(Date.now() - 30 * 60_000),
  });
  await compare(s);
  expect(
    await s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      { action: "select", comparisonId },
      { onBox: true },
    ),
  ).toMatchObject({ status: "selected", identity: encodeMinuteIdentity(Date.now()) });
});

it("a key-only operation service refuses administrator credentials without a credential key ring", async () => {
  const s = createNodeOperationPreparation({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    db: suite.db,
    node: standby,
    modules: ALL_MODULES,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  });
  const before = await rows();
  await expect(
    s.withOperation(
      { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
      credentials,
      {},
      async () => "unexpected-activation",
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(await rows()).toEqual(before);
});

it("invalidates an earlier comparison when the named recovery key changes", async () => {
  const s = await service();
  await admit(s);
  await compare(s);
  key = await mintBreakGlassKey(suite.db, standby.nodeId);
  await expect(
    s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "clock_stale" } });
  await compare(s);
  expect(
    await s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    ),
  ).toMatchObject({ identity: "0CNQR" });
});

it("the real mirror boot serves preparation over verified HTTPS and promotes the dormant node once", async () => {
  const s = await service();
  await admit(s);
  const stateDir = join(root, "state");
  await writeMirrorLink(suite.node, standby.nodeId, {
    relayUrl: "https://127.0.0.1:1/",
    boxHostname: "box.test",
    boxCaPem: "unused-ca",
    originNodeId: primary.nodeId,
  });
  for (const [index, set] of manifestSets().entries())
    await cp(migrations[index]!.migrationsFolder, join(root, "migrations", set.name), {
      recursive: true,
    });
  await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
  await writeFile(
    join(stateDir, "modules.json"),
    JSON.stringify({ modules: { "fiscal-verifactu": true, "fiscal-none": false } }),
  );
  const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
  const [port] = await freePorts(1);
  let server: StartedServer | undefined;
  let agent: Agent | undefined;
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  try {
    server = await startServer({
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: stateDir,
      WAITRON_MIGRATIONS_DIR: join(root, "migrations"),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: standby.nodeId,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "dev",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
    });
    agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
    const send = async (path: string, body: unknown) => {
      const response = await fetch(`https://127.0.0.1:${port}/management-api/promote${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: `https://127.0.0.1:${port}`,
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify(body),
        dispatcher: agent,
      } as RequestInit);
      const value = await response.json();
      expect(response.status, JSON.stringify(value)).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return value;
    };
    const body = { ...context, breakGlass: key.secret, moduleOperation: { binding, input: null } };
    const challenge = await send("/preparation", {
      ...body,
      proposal: { action: "clock-challenge" },
    });
    const compared = await send("/preparation", {
      ...body,
      proposal: {
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      },
    });
    const selected = await send("/preparation", {
      ...body,
      proposal: { action: "select", comparisonId: compared.id },
    });
    expect(selected).toMatchObject({ identity: "0CNQR" });
    expect(
      await send("", { ...body, moduleOperation: { binding, input: selected.input } }),
    ).toMatchObject({ alreadyPrimary: false, restarting: true });
    await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
  } finally {
    await agent?.close();
    await server?.close();
    kill.mockRestore();
  }
  expect((await rows()).allocations).toHaveLength(2);
  expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("primary");
}, 120_000);

it.each(["key", "manager"])(
  "reboots a promoted mirror in a later hour without allocating again or resetting counters, with %s authority",
  async (method) => {
    const auth = method === "key" ? { breakGlass: key.secret } : credentials;
    const s = await service();
    await admit(s);
    await compare(s, auth);
    const selected = (await s.prepare(
      binding,
      auth,
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    )) as { input: unknown };
    expect(selected).toMatchObject({ identity: "0CNQR" });
    await writeMirrorLink(suite.node, standby.nodeId, {
      relayUrl: "https://127.0.0.1:1/",
      boxHostname: "box.test",
      boxCaPem: "unused-ca",
      originNodeId: primary.nodeId,
    });
    for (const [index, set] of manifestSets().entries())
      await cp(migrations[index]!.migrationsFolder, join(root, "migrations", set.name), {
        recursive: true,
      });
    const stateDir = join(root, "state");
    await ensureBoxSecrets({ stateDir, hostnames: ["localhost"], now: () => new Date() });
    await writeFile(
      join(stateDir, "modules.json"),
      JSON.stringify({ modules: { "fiscal-verifactu": true, "fiscal-none": false } }),
    );
    const database = suite.db.all<{ file: string }>(sql`pragma database_list`)[0]!.file;
    const [port] = await freePorts(1);
    const env = {
      WAITRON_VENUE_DIR: dirname(database),
      WAITRON_STATE_DIR: stateDir,
      WAITRON_MIGRATIONS_DIR: join(root, "migrations"),
      WAITRON_HTTP_HOST: "127.0.0.1",
      WAITRON_HTTP_PORT: String(port),
      WAITRON_HTTP_LANDING_PORT: "0",
      WAITRON_NODE_ID: standby.nodeId,
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_ENV: "dev",
      WAITRON_MANAGEMENT_RP_ID: "localhost",
      WAITRON_MANAGEMENT_ORIGIN: `https://localhost:${port}`,
    };
    let server: StartedServer | undefined;
    let agent: Agent | undefined;
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const send = async () => {
      const response = await fetch(`https://127.0.0.1:${port}/management-api/promote`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Origin: `https://127.0.0.1:${port}`,
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          ...context,
          ...auth,
          moduleOperation: { binding, input: selected.input },
        }),
        dispatcher: agent,
      } as RequestInit);
      const body = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      return body;
    };
    try {
      // The listener owns a new preparation service, so it must compare again before consuming intent.
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      const post = async (proposal: unknown) => {
        const response = await fetch(
          `https://127.0.0.1:${port}/management-api/promote/preparation`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...context,
              ...auth,
              moduleOperation: { binding, input: null },
              proposal,
            }),
            dispatcher: agent,
          } as RequestInit,
        );
        const body = await response.json();
        expect(response.status, JSON.stringify(body)).toBe(200);
        return body;
      };
      const challenge = await post({ action: "clock-challenge" });
      await post({
        action: "compare-clocks",
        browser: { challengeId: challenge.id, instantMs: Date.now() },
      });
      expect(await send()).toEqual({ alreadyPrimary: false, restarting: true });
      await vi.waitFor(() => expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM"));
      await agent.close();
      agent = undefined;
      await server.close();
      server = undefined;
      await suite.db
        .update(invoiceSeries)
        .set({ nextNumber: 47 })
        .where(eq(invoiceSeries.nodeId, standby.nodeId));
      const before = await rows();
      expect(before.series.filter((row) => row.nodeId === standby.nodeId)).toHaveLength(3);
      expect(before.allocations).toHaveLength(2);
      expect(before.series.filter((row) => row.nodeId === standby.nodeId)).toEqual(
        expect.arrayContaining(
          ["A-0CNQR", "FF-0CNQR", "R-0CNQR"].map((code) =>
            expect.objectContaining({ code, nextNumber: 47 }),
          ),
        ),
      );
      const journal = await readFile(join(stateDir, "module-preparation-state.json"), "utf8");
      kill.mockClear();
      vi.setSystemTime(new Date("2026-10-16T13:40:00Z"));
      server = await startServer(env);
      agent = new Agent({ connect: { ca: await readFile(join(stateDir, "tls/ca.crt")) } });
      expect(await send()).toEqual({ alreadyPrimary: true, restarting: false });
      expect(kill).not.toHaveBeenCalled();
      expect(await rows()).toEqual(before);
      expect(await readFile(join(stateDir, "module-preparation-state.json"), "utf8")).toBe(journal);
      expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("primary");
      expect((await readNodeMode(suite.node, standby.nodeId)).singletonRole).toBe("primary");
    } finally {
      await agent?.close();
      await server?.close();
      kill.mockRestore();
    }
  },
  120_000,
);

it("establishes the real reserved node and identity while keeping its fiscal state dormant", async () => {
  const identity = generateStandbyIdentity();
  const target = { ...standby, nodeId: brandNodeId(identity.nodeId) };
  const held = { ...joinBinding, targetNodeId: target.nodeId };
  const options = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    node: target,
    modules: ALL_MODULES.filter((module) => module.name === binding.module),
    credentialKeyRing: TOTP_KEY_RING,
    coordinator: createFirstSetupCoordinator(),
    environment: {},
  };
  const reserving = createNodeOperationPreparation({ ...options, db: suite.db });
  let state: unknown;
  await reserving.withOperation(
    { binding: held, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    (modules, operations) =>
      withPreparedModuleOperations(modules, operations, target.nodeId, "reserve", (ready) =>
        withTransaction(suite.db, async (tx) => {
          state = (
            await ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, target, ready.get(binding.module))
          ).state;
        }),
      ),
  );
  const primaryKeys = generateNodeKeyPair();
  await spare.db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "89890001K", legalName: "Promotion SL" });
  await spare.db.insert(locations).values({
    id: primary.locationId,
    name: "Restaurant",
    invoiceLocales: ["en"],
    operationDescription: "Hospitality",
  });
  await spare.db.insert(nodes).values({
    id: primary.nodeId,
    locationId: primary.locationId,
    name: "Original",
    publicKey: primaryKeys.publicKey,
    filingModule: "verifactu",
    taxModule: "vat",
  });
  await spare.db
    .insert(persons)
    .values({ id: ADMIN, displayName: "Administrator", role: "admin", passwordHash: hash });
  await stampDeployment(spare.db, "preproduction");
  await withTransaction(spare.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: primary.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
      numeroInstalacion: "0CNNW",
    }),
  );
  await spare.db.insert(invoiceSeries).values(
    bases.map((base) => ({
      ...base,
      nodeId: primary.nodeId,
      code: `${base.code}-0CNNW`,
      nextNumber: 123,
    })),
  );
  const baseline = {
    series: await spare.db.select().from(invoiceSeries),
    sif: await spare.db.select().from(registroSif),
  };
  const s = createNodeOperationPreparation({ ...options, db: spare.db });
  const operation = { binding: { ...held, action: "establish" }, input: state };
  const endorsement = endorseKey(
    identity.nodeId,
    identity.publicKey,
    primary.nodeId,
    primaryKeys.privateKey,
  );
  const establish = () =>
    s.withOperation(operation, credentials, {}, (modules, moduleOperations) =>
      establishReservedStandbyIdentity(
        { ownerDb: spare.db, ring },
        {
          locationId: target.locationId,
          standby: identity,
          nodeName: "New spare",
          filingModule: "verifactu",
          taxModule: "vat",
          modules,
          moduleOperations,
          reserved: { modules: { [binding.module]: state }, series: [], endorsement },
        },
      ),
    );
  await establish();
  expect(await spare.db.select().from(nodes).where(eq(nodes.id, target.nodeId))).toEqual([
    expect.objectContaining({ id: target.nodeId, publicKey: identity.publicKey, endorsement }),
  ]);
  expect(await spare.db.select().from(invoiceSeries)).toEqual(baseline.series);
  expect(await spare.db.select().from(registroSif)).toEqual(baseline.sif);
  expect(await spare.db.select().from(fiscalReservations)).toEqual([]);
  expect(await spare.db.select().from(fiscalAllocations)).toEqual([]);
  const saved = await readModulePreparationHistory(options, binding.module);
  expect(saved).toEqual([{ version: 1, entries: [], dormant: [state] }]);
  await establish();
  expect(await readModulePreparationHistory(options, binding.module)).toEqual(saved);
  expect(await spare.db.select().from(invoiceSeries)).toEqual(baseline.series);
});

it("refuses promotion preparation without retained dormant admission", async () => {
  const s = await service();
  const before = await rows();
  await expect(compare(s)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  expect(await rows()).toEqual(before);
  expect(
    await readModulePreparationHistory(
      { stateDir: join(root, "state"), venueDir: join(root, "venue") },
      binding.module,
    ),
  ).toEqual([]);
});

it.each(["identity", "allocation-id", "bases", "purpose", "approval", "binding"])(
  "refuses altered selected %s before promotion commits",
  async (fault) => {
    const s = await service();
    await admit(s);
    await compare(s);
    const selected = (await s.prepare(
      binding,
      { breakGlass: key.secret },
      context,
      {
        action: "select",
        comparisonId,
      },
      { onBox: true },
    )) as {
      input: {
        allocation: {
          installationIdentity: string;
          allocationId: string;
          series: { code: string; purpose: string }[];
        };
        approval: { oldMachineOffline: boolean };
      };
    };
    const input = structuredClone(selected.input);
    if (fault === "identity") input.allocation.installationIdentity = "0CNSM";
    if (fault === "allocation-id") input.allocation.allocationId = "changed-allocation";
    if (fault === "bases") input.allocation.series.pop();
    if (fault === "purpose") input.allocation.series[0]!.purpose = "full";
    if (fault === "approval") input.approval.oldMachineOffline = false;
    const before = await rows();
    await expect(
      fault === "binding"
        ? s.withPromotion(
            { binding: { ...binding, eventId: "other" }, input },
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
          )
        : promote(s, input),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await rows()).toEqual(before);
    expect((await readNodeMode(suite.node, standby.nodeId)).mode).toBe("mirror");
  },
);

it.each(["module", "operation-action", "prepare-action", "promotion-action"])(
  "refuses an unbound %s request before preparation writes",
  async (fault) => {
    const s = await service();
    const operation = { binding: { ...binding, action: "setup" }, input: {} };
    await expect(
      fault === "module"
        ? s.prepare(
            { ...binding, module: "unknown" },
            { breakGlass: key.secret },
            context,
            {
              action: "clock-challenge",
            },
            { onBox: true },
          )
        : fault === "operation-action"
          ? s.withOperation(operation, credentials, context, async () => "unexpected")
          : fault === "prepare-action"
            ? s.prepare(joinBinding, credentials, context, {}, { onBox: true })
            : s.withPromotion(
                { ...operation, binding: joinBinding },
                credentials,
                context,
                async () => "unexpected",
              ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(
      await readModulePreparationHistory(
        { stateDir: join(root, "state"), venueDir: join(root, "venue") },
        binding.module,
      ),
    ).toEqual([]);
  },
);

it.each(["database", "node"])(
  "refuses a promotion runner used with a different %s",
  async (fault) => {
    const s = await service();
    await expect(
      s.withPromotion(
        { binding, input: {} },
        { breakGlass: key.secret },
        context,
        async (_modules, runner) =>
          runner(
            {
              db: fault === "database" ? spare.db : suite.db,
              node: fault === "node" ? primary : standby,
            },
            async () => "unexpected",
          ),
      ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
  },
);

it("refuses a configured preparation module after its authenticated call ends", async () => {
  const s = await service();
  const configured = await s.withOperation(
    { binding: joinBinding, input: { kind: "hour-dormant", version: 1 } },
    credentials,
    {},
    async (modules) => modules,
  );
  await expect(
    withOperationAuthority(
      binding,
      { kind: "recovery-key", nodeId: standby.nodeId, eventId: binding.eventId },
      (authority) =>
        configured[0]!.operations!.recovery!(
          { binding, authority },
          { action: "clock-challenge" },
          { onBox: true },
        ),
    ),
  ).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses an operation contribution with no recovery preparation", async () => {
  const modules = ALL_MODULES.filter((module) => module.name === binding.module).map((module) => ({
    ...module,
    operations: {
      async prepare<T>(
        operation: import("@waitron/module").ModuleOperationInput,
        run: (ready: import("@waitron/module").ModuleOperationInput) => Promise<T>,
      ) {
        return run(operation);
      },
    },
  }));
  const s = await service(modules);
  await expect(compare(s)).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses a recovery module that cannot read the current database state", async () => {
  const modules = ALL_MODULES.filter((module) => module.name === binding.module).map((module) => ({
    ...module,
    operations: { ...module.operations!, readRecoveryState: undefined },
  }));
  const s = await service(modules);
  await expect(compare(s)).rejects.toMatchObject({ code: "module.operation_invalid" });
});

it("refuses a recovery key rotated while a comparison is in flight", async () => {
  const s = await service();
  await admit(s);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  external.internet.mockImplementationOnce(async () => {
    entered();
    await gate;
    return { source: "internet", result: "unavailable", reason: "offline" };
  });
  const before = await readFile(join(root, "state/module-preparation-state.json"), "utf8");
  const pending = compare(s);
  await started;
  key = await mintBreakGlassKey(suite.db, standby.nodeId);
  const refused = expect(pending).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
  release();
  await refused;
  expect(await readFile(join(root, "state/module-preparation-state.json"), "utf8")).toBe(before);
});
