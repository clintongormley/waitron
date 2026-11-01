import { seedLiveConflict } from "@waitron/fiscal-verifactu/test/live-conflict-fixture.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isNull, sql } from "drizzle-orm";
import * as identity from "@waitron/identity";
import * as dbApi from "@waitron/db";
import { invoiceSeries, setBreakGlassVerifierTx, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { type ModuleRouteContext, type LiveModuleOperationBridge } from "@waitron/module";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { locationId, seriesId } from "@waitron/shared";
import { recordSale } from "@waitron/core";
import { FISCAL_ROUTES, VerifactuBackend } from "@waitron/fiscal-verifactu";
import { TENANT_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import {
  fakeClient,
  saleInput,
  staticResolver,
  steadyClock,
} from "@waitron/fiscal-verifactu/test/write-path-fixtures.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import type { ConflictRef } from "@waitron/fiscal-verifactu/src/conflict-evidence.js";
import type {
  ConflictAllocationInput,
  ConflictRequest,
} from "@waitron/fiscal-verifactu/src/conflict-recovery-contract.js";
import { parseConflictResult } from "@waitron/fiscal-verifactu/src/conflict-recovery-contract.js";
import { ALL_MODULES } from "./modules.js";
import { createLiveModuleOperation } from "./live-module-operation.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const PATH = "https://box.test/api/module-recovery/fiscal-verifactu/conflict";
const SECRET = "synthetic-current-node-key";
const verifier = identity.hashSecret(SECRET);
let root: string | undefined;
let monotonic = 0;
let conflict: ConflictRef;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "live-conflict-"));
  await mkdir(join(root, "state"));
  await mkdir(join(root, "venue"));
  monotonic = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:38:00Z"));
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  external.internet.mockImplementation(async () => ({
    source: "internet",
    result: "unavailable",
    reason: "tls",
  }));
  conflict = await seedLiveConflict(suite.db, {
    wall: Date.now,
    monotonic: () => monotonic,
    advance(ms) {
      monotonic += ms;
      vi.setSystemTime(Date.now() + ms);
    },
  });
  await withTransaction(suite.db, (tx) =>
    setBreakGlassVerifierTx(tx, node.nodeId, verifier, "key-1"),
  );
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
  monotonic = 0;
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function service() {
  return createNodeOperationPreparation({
    stateDir: join(root!, "state"),
    venueDir: join(root!, "venue"),
    db: suite.db,
    node,
    modules: ALL_MODULES.filter((m) => m.name === "fiscal-verifactu"),
    coordinator: createFirstSetupCoordinator(),
    environment: {},
    testClock: { wall: Date.now, monotonic: () => monotonic },
  });
}
function mounted(
  options: {
    preparation?: ReturnType<typeof service>;
    alter?: (bridge: LiveModuleOperationBridge) => LiveModuleOperationBridge;
  } = {},
) {
  const base = createLiveModuleOperation({
    node,
    preparation: options.preparation ?? service(),
    requestFromBox: () => false,
  });
  const bridge = options.alter?.(base) ?? base;
  const app = new Hono();
  const log = vi.fn();
  let parses = 0;
  app.use("*", async (c, next) => {
    const read = c.req.json.bind(c.req);
    c.req.json = (...args) => {
      parses++;
      return read(...args);
    };
    await next();
  });
  FISCAL_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: { locationId: node.locationId },
      core: {} as ModuleRouteContext["core"],
      liveOperations: bridge,
    },
    log,
  );
  const send = async (
    body: unknown,
    options: { headers?: Record<string, string>; tls?: boolean | "forged"; raw?: string } = {},
  ) => {
    const socket =
      options.tls === "forged"
        ? { encrypted: true }
        : options.tls === false
          ? new Socket()
          : new TLSSocket(new Socket());
    try {
      return await app.request(
        PATH,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...options.headers },
          body: options.raw ?? JSON.stringify(body),
        },
        { incoming: { socket } },
      );
    } finally {
      if (socket instanceof Socket) socket.destroy();
    }
  };
  return {
    send,
    log,
    get parses() {
      return parses;
    },
  };
}
function request(extra: Partial<ConflictRequest> = {}): ConflictRequest {
  return {
    recoveryKey: SECRET,
    eventId: "conflict-event-1",
    oldMachineOffline: true,
    noParallelRecovery: true,
    conflict,
    command: { kind: "status" },
    ...extra,
  };
}
async function publicAnswer(response: Response) {
  const json: unknown = await response.json();
  expect(response.status, JSON.stringify(json)).toBe(200);
  const result = parseConflictResult(json);
  expect(result, JSON.stringify(json)).not.toBeNull();
  return result!;
}
async function selected(m: ReturnType<typeof mounted>): Promise<ConflictAllocationInput> {
  const prepare = async (proposal: unknown) => {
    const result = await publicAnswer(
      await m.send(
        request({ command: { kind: "prepare", proposal } as ConflictRequest["command"] }),
      ),
    );
    if (result.kind !== "prepared") throw new Error("not prepared");
    return result.value;
  };
  const compare = async () => {
    const challenge = await prepare({ action: "clock-challenge" });
    if (!("id" in challenge)) throw new Error("no challenge");
    const comparison = await prepare({
      action: "compare-clocks",
      browser: { challengeId: challenge.id, instantMs: Date.now() },
    });
    if (!("clock" in comparison)) throw new Error("no comparison");
    expect(comparison.clock).toMatchObject({ secondClock: true, disagreement: false });
    return comparison.id;
  };
  const first = await prepare({ action: "select", comparisonId: await compare() });
  expect(first).toMatchObject({ status: "waiting", remainingMs: 120_000 });
  for (let i = 0; i < 24; i++) {
    monotonic += 5000;
    vi.setSystemTime(Date.now() + 5000);
    await publicAnswer(await m.send(request()));
  }
  const final = await prepare({ action: "select", comparisonId: await compare() });
  if (!("status" in final) || final.status !== "selected") throw new Error("no selection");
  return final.input;
}

it("runs the sessionless real key/clock/activation route and reconciles its committed result after reconstruction", async () => {
  const m = mounted();
  const before = suite.db.all(sql`select * from registros_facturacion`);
  const cases = suite.db.all(sql`select * from filing_cases`);
  const input = await selected(m);
  const activated = await publicAnswer(
    await m.send(request({ command: { kind: "activate", input } })),
  );
  expect(activated).toMatchObject({
    kind: "committed",
    result: {
      activationEventId: "conflict-event-1",
      series: [{ code: "A-0CNQT" }, { code: "FF-0CNQT" }, { code: "R-0CNQT" }],
    },
  });
  expect(suite.db.all(sql`select * from registros_facturacion`)).toEqual(before);
  expect(suite.db.all(sql`select * from filing_cases`)).toEqual(cases);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
  const reopened = mounted();
  const status = await publicAnswer(
    await reopened.send(request({ oldMachineOffline: false, noParallelRecovery: false })),
  );
  expect(status).toEqual({
    kind: "status",
    active: [],
    event: { kind: "committed", result: activated.kind === "committed" ? activated.result : null },
  });
  expect(
    await publicAnswer(await reopened.send(request({ command: { kind: "activate", input } }))),
  ).toEqual(activated);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
  expect(JSON.stringify([...m.log.mock.calls, ...reopened.log.mock.calls])).not.toContain(SECRET);
});
it.each([false, "forged"] as const)(
  "refuses %s TLS despite forwarded https and does not parse",
  async (tls) => {
    const m = mounted();
    const response = await m.send(
      {},
      { tls, raw: "not-json", headers: { "X-Forwarded-Proto": "https", Forwarded: "proto=https" } },
    );
    expect(response.status).toBe(403);
    expect(m.parses).toBe(0);
  },
);
it.each<Record<string, string>>([
  { Origin: "https://other.test" },
  { "Sec-Fetch-Site": "cross-site" },
  { "Sec-Fetch-Site": "same-site" },
])("refuses incompatible browser context %j before parsing", async (headers) => {
  const m = mounted();
  expect((await m.send({}, { headers, raw: "not-json" })).status).toBe(403);
  expect(m.parses).toBe(0);
});
it("the real admission gate bounds wrong-key work before parsing, verifier reads and hashing", async () => {
  const m = mounted();
  const hashes = vi.spyOn(identity, "verifySecretAsync");
  const reads = vi.spyOn(dbApi, "readBreakGlassVerifier");
  for (let i = 0; i < 60; i++)
    expect((await m.send(request({ recoveryKey: "wrong-key" }))).status).toBe(401);
  expect(hashes).toHaveBeenCalledTimes(60);
  const before = {
    parses: m.parses,
    hashes: hashes.mock.calls.length,
    reads: reads.mock.calls.length,
  };
  vi.setSystemTime(Date.now() - 86_400_000);
  const refused = await m.send(request({ recoveryKey: "wrong-key" }));
  expect(refused.status).toBe(429);
  expect(await refused.json()).toEqual({ error: { code: "recovery.rate_limited", params: {} } });
  expect({
    parses: m.parses,
    hashes: hashes.mock.calls.length,
    reads: reads.mock.calls.length,
  }).toEqual(before);
  monotonic = 60_000;
  expect((await m.send(request({ recoveryKey: "wrong-key" }))).status).toBe(401);
  expect(hashes).toHaveBeenCalledTimes(61);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
it("a retained uncommitted selection reports restart-required after a process restart", async () => {
  await selected(mounted());
  expect(
    await publicAnswer(
      await mounted().send(request({ oldMachineOffline: false, noParallelRecovery: false })),
    ),
  ).toMatchObject({ kind: "status", event: { kind: "restart-required" } });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
it("a management cookie cannot authorise without the current key", async () => {
  const m = mounted();
  expect(
    (
      await m.send(request({ recoveryKey: "" }), {
        headers: { cookie: "waitron_management=administrator" },
      })
    ).status,
  ).toBe(401);
  await withTransaction(suite.db, (tx) =>
    setBreakGlassVerifierTx(tx, node.nodeId, identity.hashSecret("replacement"), "key-2"),
  );
  expect((await m.send(request())).status).toBe(401);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("refuses a third in-flight handler before parsing and releases slots after successful and refused keys", async () => {
  const m = mounted();
  const verify = identity.verifySecretAsync;
  const entered = deferred();
  const release = deferred();
  let calls = 0;
  vi.spyOn(identity, "verifySecretAsync").mockImplementation(async (...args) => {
    if (++calls === 2) entered.resolve();
    await release.promise;
    return verify(...args);
  });
  const first = m.send(request());
  const second = m.send(request({ recoveryKey: "wrong" }));
  await entered.promise;
  const before = m.parses;
  const third = await m.send(request());
  expect(third.status).toBe(429);
  expect(m.parses).toBe(before);
  expect(calls).toBe(2);
  release.resolve();
  expect((await first).status).toBe(200);
  expect((await second).status).toBe(401);
  const results = await Promise.all([m.send(request()), m.send(request())]);
  expect(results.map((r) => r.status)).toEqual([200, 200]);
});

it("refuses a key replaced while comparing clocks and writes no activation", async () => {
  const m = mounted();
  const challenge = await publicAnswer(
    await m.send(
      request({ command: { kind: "prepare", proposal: { action: "clock-challenge" } } }),
    ),
  );
  if (challenge.kind !== "prepared" || !("id" in challenge.value))
    throw new Error("missing challenge");
  const entered = deferred();
  const release = deferred();
  external.internet.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { source: "internet", result: "unavailable", reason: "tls" };
  });
  const pending = m.send(
    request({
      command: {
        kind: "prepare",
        proposal: {
          action: "compare-clocks",
          browser: { challengeId: challenge.value.id, instantMs: Date.now() },
        },
      },
    }),
  );
  await entered.promise;
  await withTransaction(suite.db, (tx) =>
    setBreakGlassVerifierTx(tx, node.nodeId, identity.hashSecret("replacement"), "key-2"),
  );
  release.resolve();
  const refused = await pending;
  expect(refused.status).toBe(401);
  expect(await refused.json()).toEqual({
    error: { code: "promotion.break_glass_invalid", params: {} },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("rechecks the current key in the activation commit after preparation", async () => {
  let commits = 0;
  let rotate = false;
  const m = mounted({
    alter: (bridge) => ({
      ...bridge,
      run: (binding, key, isolation, body) =>
        bridge.run(binding, key, isolation, (scope) =>
          body({
            ...scope,
            commit: async (run) => {
              if (rotate && ++commits === 3)
                await withTransaction(suite.db, (tx) =>
                  setBreakGlassVerifierTx(
                    tx,
                    node.nodeId,
                    identity.hashSecret("replacement"),
                    "key-2",
                  ),
                );
              return scope.commit(run);
            },
          }),
        ),
    }),
  });
  const input = await selected(m);
  const before = suite.db.all(sql`select * from registro_sif`);
  rotate = true;
  const refused = await m.send(request({ command: { kind: "activate", input } }));
  expect(refused.status).toBe(401);
  expect(await refused.json()).toEqual({
    error: { code: "promotion.break_glass_invalid", params: {} },
  });
  expect(suite.db.all(sql`select * from registro_sif`)).toEqual(before);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it.each([false, true])(
  "a sale queued behind the actual activation transaction observes its %s rollback outcome",
  async (rollback) => {
    const entered = deferred();
    const release = deferred();
    let hold = false;
    const m = mounted({
      alter: (bridge) => ({
        ...bridge,
        run: (binding, key, isolation, body) =>
          bridge.run(binding, key, isolation, (scope) =>
            body({
              ...scope,
              commit: (run) =>
                scope.commit(async (tx) => {
                  const result = await run(tx);
                  if (hold && (await tx.select().from(fiscalAllocations)).length === 2) {
                    entered.resolve();
                    await release.promise;
                    if (rollback) throw new Error("synthetic activation rollback");
                  }
                  return result;
                }),
            }),
          ),
      }),
    });
    const input = await selected(m);
    const before = suite.db.all(sql`select * from registros_facturacion`);
    const cases = suite.db.all(sql`select * from filing_cases`);
    const oldSeries = await suite.db.select().from(invoiceSeries);
    hold = true;
    const switching = m.send(request({ command: { kind: "activate", input } }));
    await entered.promise;
    let saleEntered = false;
    const backend = new VerifactuBackend({
      db: suite.db,
      clock: steadyClock,
      deploymentEnvironment: "preproduction",
      resolveClient: staticResolver(fakeClient),
    });
    const sale = withTransaction(suite.db, async (tx) => {
      saleEntered = true;
      const current = await tx.select().from(invoiceSeries).where(isNull(invoiceSeries.retiredAt));
      const standard = current.find((row) => row.purpose === "standard")!;
      return recordSale(
        tx,
        backend,
        saleInput({ nodeId: node.nodeId, seriesId: seriesId(standard.id) }),
      );
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    expect(saleEntered).toBe(false);
    release.resolve();
    const response = await switching;
    const outcome = await sale;
    expect(suite.db.all(sql`select * from filing_cases`)).toEqual(cases);
    if (rollback) {
      expect(response.status).toBe(500);
      expect(outcome).toMatchObject({
        ok: false,
        error: {
          code: "sif.allocation_invalid",
          params: { reason: "conflict_requires_administrator" },
        },
      });
      expect(suite.db.all(sql`select * from registros_facturacion`)).toEqual(before);
      expect(await suite.db.select().from(invoiceSeries)).toEqual(oldSeries);
    } else {
      expect(response.status).toBe(200);
      expect(outcome).toMatchObject({ ok: true });
      const records = suite.db.all<{ sif_id: string; num_serie_factura: string }>(
        sql`select sif_id, num_serie_factura from registros_facturacion order by secuencia`,
      );
      expect(records).toHaveLength(2);
      expect(records[1]!.sif_id).not.toBe(conflict.sifId);
      expect(records[1]!.num_serie_factura).toBe("A-0CNQT/1");
      for (const prior of oldSeries)
        expect(
          (await suite.db.select().from(invoiceSeries)).find((row) => row.id === prior.id)
            ?.nextNumber,
        ).toBe(prior.nextNumber);
    }
  },
);
