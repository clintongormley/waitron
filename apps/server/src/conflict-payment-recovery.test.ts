import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { Hono } from "hono";
import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { stampDeployment, withTransaction } from "@waitron/db";
import { withNodeTransaction } from "@waitron/db";
import { setRecoveryKeyTx } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashSecret } from "@waitron/identity";
import { createFirstSetupCoordinator } from "@waitron/provisioning";
import { withOperationAuthority, type ModuleRouteContext } from "@waitron/module";
import { applyVenue } from "@waitron/provisioning";
import { createHourPreparation } from "@waitron/fiscal-verifactu/src/hour-preparation.js";
import { compareHourClocks } from "@waitron/fiscal-verifactu/src/hour-clock.js";
import { FISCAL_ROUTES } from "@waitron/fiscal-verifactu";
import { openFilingCase } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import {
  parseConflictResult,
  type ConflictRequest,
} from "@waitron/fiscal-verifactu/src/conflict-recovery-contract.js";
import { provisionBillVenue, send, tabWith } from "./testing/bill-venue.js";
import { ALL_MODULES } from "./modules.js";
import { createLiveModuleOperation } from "./live-module-operation.js";
import { createNodeOperationPreparation } from "./node-operation-preparation.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";

const external = vi.hoisted(() => ({ internet: vi.fn() }));
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: external.internet,
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
vi.mock("@waitron/provisioning/testing/allocated-venue", () => ({
  applyHistoricalTestVenue: async (...[actions, deps]: Parameters<typeof applyVenue>) => {
    const taxpayer = actions.find((action) => action.kind === "ensure-tenant")!;
    const bases = actions
      .filter((action) => action.kind === "create-series")
      .map(({ code, purpose }) => ({ code, purpose }));
    const nodeId = randomUUID();
    const administratorId = randomUUID();
    const binding = {
      module: "fiscal-verifactu",
      action: "setup",
      eventId: "initial-minute",
      sourceId: "initial-venue",
      targetNodeId: nodeId,
    };
    let state: unknown = null;
    const engine = createHourPreparation({
      withState: async (_binding, run) =>
        run({
          get value() {
            return state;
          },
          history: [],
          async replace(value) {
            state = structuredClone(value);
          },
        }),
      monotonicNow: () => time.monotonic,
      read: async () => ({
        scope: { taxpayerNif: taxpayer.taxId, environment: "preproduction" },
        bases,
        contextKey: "initial-minute",
        history: [{ reference: "empty-venue", complete: true, records: [] }],
        clock: compareHourClocks(
          ["box", "browser"].map((source) => ({
            source: source as "box" | "browser",
            result: "usable",
            instantMs: Date.now(),
            uncertaintyMs: 0,
            wallStartedMs: Date.now(),
            wallFinishedMs: Date.now(),
            monotonicStartedMs: time.monotonic,
            monotonicFinishedMs: time.monotonic,
          })),
          Date.parse("2026-10-15T00:00:00Z"),
        ),
      }),
    });
    return withOperationAuthority(binding, administratorId, async (authority) => {
      const first = await engine.select({ binding, authority, comparisonId: "initial-clock" });
      if (first.status !== "waiting") throw new Error("initial minute did not wait");
      time.monotonic += first.remainingMs;
      vi.setSystemTime(Date.now() + first.remainingMs);
      const selected = await engine.select({ binding, authority, comparisonId: "initial-clock" });
      if (selected.status !== "selected") throw new Error("initial minute did not select");
      await stampDeployment(deps.db, "preproduction");
      return applyVenue(actions, {
        ...deps,
        initialNodeId: nodeId,
        initialAdministratorId: administratorId,
        moduleInputs: new Map([
          [
            "fiscal-verifactu",
            { eventId: binding.eventId, sourceId: binding.sourceId, input: selected.input },
          ],
        ]),
        modules: deps.modules.map((module) =>
          module.name === "fiscal-verifactu"
            ? { ...module, operations: { prepare: engine.prepare } }
            : module,
        ),
      });
    });
  },
}));
const time = vi.hoisted(() => ({ monotonic: 0 }));
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let scratch: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
});

it("finalises an already captured bill once after the actual administrator switch without collecting again", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T12:38:00Z"));
  time.monotonic = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time.monotonic);
  external.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const venue = await provisionBillVenue(suite.db);
  const pay = (billId: string) =>
    send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      method: "card",
      entry: "reader",
      amount: "35.00",
      applied: "35.00",
      tip: "0.00",
    });
  expect((await pay(await tabWith(venue, "Paella"))).status).toBe(200);
  const original = suite.db.all<{ id: string; sif_id: string }>(
    sql`select id, sif_id from registros_facturacion`,
  )[0]!;
  const collect = venue.card.collect.bind(venue.card);
  let conflict!: NonNullable<ConflictRequest["conflict"]>;
  venue.card.collect = async (input) => {
    const result = await collect(input);
    const incident = await withTransaction(suite.db, async (tx) => {
      await tx.run(sql`update envios set estado = 'rechazado' where registro_id = ${original.id}`);
      return openFilingCase(tx, {
        registroId: original.id,
        cause: "fiscal.huella_divergente",
        evidence: { codigo: 3000, mensaje: "Invoice identity conflict", csv: null },
        now: venue.clock.now().instant,
      });
    });
    conflict = { registroId: original.id, sifId: original.sif_id, caseId: incident.id };
    return result;
  };
  const billId = await tabWith(venue, "Paella");
  expect((await pay(billId)).json).toMatchObject({
    code: "sale.charged_not_recorded",
    params: { reason: "issuance_refused" },
  });
  const captures = suite.db.all(sql`select * from payments`);
  const records = suite.db.all(sql`select * from registros_facturacion`);
  const cases = suite.db.all(sql`select * from filing_cases`);
  const orders = suite.db.all(sql`select * from working_orders`);
  const node = { nodeId: venue.cfg.nodeId, locationId: venue.cfg.locationId };
  const key = "synthetic-conflict-current-key";
  await stampDeployment(suite.db, "preproduction");
  await withNodeTransaction(suite.node, (tx) =>
    setRecoveryKeyTx(tx, node.nodeId, hashSecret(key), "key-1"),
  );
  scratch = await mkdtemp(join(tmpdir(), "conflict-payment-"));
  const preparation = createNodeOperationPreparation({
    stateDir: join(scratch, "state"),
    venueDir: join(scratch, "venue"),
    db: suite.db,
    nodeDb: suite.node,
    node,
    modules: ALL_MODULES.filter((m) => m.name === "fiscal-verifactu"),
    coordinator: createFirstSetupCoordinator(),
    environment: {},
    testClock: { wall: Date.now, monotonic: () => time.monotonic },
  });
  const app = new Hono();
  FISCAL_ROUTES.mount(
    app,
    {
      db: suite.db,
      cfg: { locationId: node.locationId },
      core: {} as ModuleRouteContext["core"],
      liveOperations: createLiveModuleOperation({ node, preparation, requestFromBox: () => false }),
    },
    () => {},
  );
  const request = async (command: ConflictRequest["command"]) => {
    const socket = new TLSSocket(new Socket());
    try {
      const response = await app.request(
        "https://box.test/api/module-recovery/fiscal-verifactu/conflict",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            recoveryKey: key,
            eventId: "captured-payment-switch",
            conflict,
            oldMachineOffline: true,
            noParallelRecovery: true,
            command,
          }),
        },
        { incoming: { socket } },
      );
      const body: unknown = await response.json();
      expect(response.status, JSON.stringify(body)).toBe(200);
      const result = parseConflictResult(body);
      expect(result).not.toBeNull();
      return result!;
    } finally {
      socket.destroy();
    }
  };
  const compare = async () => {
    const challenge = await request({ kind: "prepare", proposal: { action: "clock-challenge" } });
    if (challenge.kind !== "prepared" || !("id" in challenge.value))
      throw new Error("no challenge");
    const compared = await request({
      kind: "prepare",
      proposal: {
        action: "compare-clocks",
        browser: { challengeId: challenge.value.id, instantMs: Date.now() },
      },
    });
    if (compared.kind !== "prepared" || !("clock" in compared.value))
      throw new Error("no clock comparison");
    return compared.value.id;
  };
  const waiting = await request({
    kind: "prepare",
    proposal: { action: "select", comparisonId: await compare() },
  });
  expect(waiting).toMatchObject({
    kind: "prepared",
    value: { status: "waiting", remainingMs: 120_000 },
  });
  time.monotonic += 120_000;
  vi.setSystemTime(Date.now() + 120_000);
  const selected = await request({
    kind: "prepare",
    proposal: { action: "select", comparisonId: await compare() },
  });
  if (
    selected.kind !== "prepared" ||
    !("status" in selected.value) ||
    selected.value.status !== "selected"
  )
    throw new Error("no selected minute");
  const switched = await request({ kind: "activate", input: selected.value.input });
  expect(switched).toMatchObject({ kind: "committed" });
  expect(suite.db.all(sql`select * from payments`)).toEqual(captures);
  expect(suite.db.all(sql`select * from working_orders`)).toEqual(orders);
  expect(suite.db.all(sql`select * from registros_facturacion`)).toEqual(records);
  expect(suite.db.all(sql`select * from filing_cases`)).toEqual(cases);
  const deps = {
    db: suite.db,
    cfg: venue.cfg,
    backend: venue.backend,
    clock: venue.clock,
    refundProviderFor: (name: string) => venue.pool.get(name),
  };
  expect(await settlePendingBillPayments(deps)).toMatchObject({
    received: 1,
    pending: 0,
    errors: [],
  });
  const final = suite.db.all(sql`select * from sales where working_order_id = ${billId}`);
  expect(final).toHaveLength(1);
  expect(
    suite.db.all(sql`select num_serie_factura from registros_facturacion order by secuencia`),
  ).toEqual([{ num_serie_factura: "A-0CNQR/1" }, { num_serie_factura: "A-0CNQT/1" }]);
  expect(await settlePendingBillPayments(deps)).toMatchObject({
    received: 0,
    pending: 0,
    errors: [],
  });
  expect(suite.db.all(sql`select * from sales where working_order_id = ${billId}`)).toEqual(final);
  expect(venue.card.collectCalls).toHaveLength(2);
  expect(venue.card.refundCalls).toHaveLength(0);
});
