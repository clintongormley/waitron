import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { invoiceSeries, stampDeployment, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { recordSale } from "@waitron/core";
import {
  withOperationAuthority,
  type LiveModuleOperationScope,
  type ModuleOperationPreparation,
  type OperationAuthority,
} from "@waitron/module";
import { locationId, seriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedVenueNodes, TENANT_A } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { createHourPreparation } from "./hour-preparation.js";
import { createHourRecoveryPreparation } from "./hour-recovery-preparation.js";
import { compareHourClocks } from "./hour-clock.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { readHourHistory } from "./hour-history-reader.js";
import type { HourSelectionStore } from "./hour-selection.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { registrosFacturacion } from "./schema/registros.js";
import { filingCases } from "./schema/filing-cases.js";
import { envios } from "./schema/envios.js";
import { cadenas } from "./schema/cadenas.js";
import { VerifactuBackend } from "./backend.js";
import { openFilingCase } from "./filing-cases.js";
import { readActiveConflicts, type ConflictRef } from "./conflict-evidence.js";
import * as recovery from "./conflict-recovery.js";
import { readHourRecoveryState } from "./hour-recovery-state.js";
import { FISCAL_OPERATIONS } from "./hour-configuration.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
let instant = Date.parse("2026-10-16T11:38:00Z");
let monotonic = 0;
let conflict: ConflictRef;
function clock() {
  return compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable",
      instantMs: instant,
      uncertaintyMs: 0,
      wallStartedMs: instant,
      wallFinishedMs: instant,
      monotonicStartedMs: monotonic,
      monotonicFinishedMs: monotonic,
    })),
    Date.parse("2026-10-15T00:00:00Z"),
  );
}
function store() {
  let value: unknown = null;
  const history: unknown[] = [];
  const withState: HourSelectionStore = async (_binding, run) =>
    run({
      get value() {
        return value;
      },
      get history() {
        return history;
      },
      async replace(next) {
        value = structuredClone(next);
        history.push(structuredClone(next));
      },
    });
  return { withState, history };
}
function bindingFor(ref = conflict, eventId = "conflict-switch-1") {
  return {
    module: "fiscal-verifactu",
    action: "conflict-switch",
    eventId,
    sourceId: JSON.stringify(["conflict", ref.sifId, ref.registroId, ref.caseId]),
    targetNodeId: node.nodeId,
  };
}
function liveScope(
  authority: OperationAuthority,
  operations: ModuleOperationPreparation,
  binding = bindingFor(),
  commit?: LiveModuleOperationScope["commit"],
): LiveModuleOperationScope {
  return {
    binding,
    authority,
    node,
    operations,
    commit: commit ?? ((run) => withTransaction(suite.db, run)),
  };
}
async function snapshot() {
  return {
    sifs: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    allocations: await suite.db.select().from(fiscalAllocations),
    records: await suite.db.select().from(registrosFacturacion),
    cases: await suite.db.select().from(filingCases),
    replies: await suite.db.select().from(envios),
    head: await suite.db.select().from(cadenas),
  };
}
beforeEach(async () => {
  instant = Date.parse("2026-10-16T11:38:00Z");
  monotonic = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-16T11:40:00Z"));
  await seedVenueNodes(suite.db);
  await stampDeployment(suite.db, "preproduction");
  const setup = createHourPreparation({
    ...store(),
    monotonicNow: () => monotonic,
    read: async () => ({
      scope,
      bases,
      contextKey: "first",
      clock: clock(),
      history: [{ reference: "empty", complete: true, records: [] }],
    }),
  });
  const binding = {
    ...bindingFor({ sifId: "", registroId: "", caseId: "" }),
    action: "setup",
    eventId: "first",
  };
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await setup.select({ binding, authority, comparisonId: "clock" });
    instant = Date.parse("2026-10-16T11:40:00Z");
    monotonic = 120_000;
    const selected = await setup.select({ binding, authority, comparisonId: "clock" });
    if (selected.status !== "selected") throw new Error("setup did not settle");
    await setup.prepare({ binding, authority, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
    );
  });
  const [series] = await suite.db
    .select()
    .from(invoiceSeries)
    .where(isNull(invoiceSeries.retiredAt));
  const backend = new VerifactuBackend({
    db: suite.db,
    clock: steadyClock,
    deploymentEnvironment: "preproduction",
    resolveClient: staticResolver(fakeClient),
  });
  const original = await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId: TENANT_A.nodeId, seriesId: seriesId(series!.id) })),
  );
  const [record] = await suite.db.select().from(registrosFacturacion);
  const opened = await withTransaction(suite.db, async (tx) => {
    await tx
      .update(envios)
      .set({ estado: "rechazado" })
      .where(eq(envios.registroId, original.fiscal.recordId));
    return openFilingCase(tx, {
      registroId: original.fiscal.recordId,
      cause: "fiscal.huella_divergente",
      evidence: { codigo: 3000, mensaje: "Conflict", csv: null },
      now: new Date(),
    });
  });
  conflict = { registroId: record!.id, sifId: record!.sifId, caseId: opened.id };
  instant = Date.parse("2026-10-16T12:38:00Z");
  monotonic = 0;
  vi.setSystemTime(new Date("2026-10-16T12:40:00Z"));
});
afterEach(() => vi.useRealTimers());

it("declares only the explicit live conflict action", () => {
  expect(FISCAL_OPERATIONS.liveRecoveryActions).toEqual(["conflict-switch"]);
});
it("reads live fiscal bases without a restore archive", async () => {
  expect(await readHourRecoveryState(suite.db, node, bindingFor())).toMatchObject({
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction",
    bases,
    priorActivation: "none",
  });
});

async function attempt(event = "conflict-switch-1") {
  const binding = bindingFor(conflict, event);
  const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: event };
  const history = [await withTransaction(suite.db, (tx) => readHourHistory(tx, "preproduction"))];
  const state = store();
  const isolation = { oldMachineOffline: true, oldMachineAbsent: false, noParallelRecovery: true };
  const preparation = createHourRecoveryPreparation({
    ...state,
    monotonicNow: () => monotonic,
    read: async () => ({
      scope,
      bases,
      contextKey: "live",
      clock: clock(),
      history,
      ...isolation,
      priorActivation: "none",
    }),
  });
  const input = await withOperationAuthority(binding, operator, async (authority) => {
    const waiting = await preparation.select({ binding, authority, comparisonId: "clock" });
    expect(waiting).toMatchObject({ status: "waiting", remainingMs: 120_000 });
    if (waiting.status !== "waiting") throw new Error("did not wait");
    instant = waiting.targetMs;
    monotonic += waiting.remainingMs;
    const selected = await preparation.select({ binding, authority, comparisonId: "clock" });
    if (selected.status !== "selected") throw new Error("recovery did not settle");
    return selected.input;
  });
  return { binding, operator, preparation, input, state, isolation };
}

it("switches with key authority, preserves the rejected original and case, and replays without a preparation token", async () => {
  const a = await attempt();
  const before = await snapshot();
  const result = await withOperationAuthority(a.binding, a.operator, (authority) =>
    recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
      binding: a.binding,
      conflict,
      input: a.input,
    }),
  );
  expect(result.activationEventId).toBe(a.binding.eventId);
  const after = await snapshot();
  expect(after.records).toEqual(before.records);
  expect(after.cases).toEqual(before.cases);
  expect(after.replies).toEqual(before.replies);
  for (const old of before.series)
    expect(after.series.find((row) => row.id === old.id)).toEqual({
      ...old,
      retiredAt: expect.any(Date),
    });
  expect(after.allocations).toHaveLength(2);
  expect(after.allocations[1]!.approval.operatorId).toEqual(a.operator);
  expect(
    after.series.filter((row) => row.retiredAt === null).map((row) => [row.code, row.nextNumber]),
  ).toEqual([
    ["A-0CNQR", 1],
    ["FF-0CNQR", 1],
    ["R-0CNQR", 1],
  ]);
  expect(after.head[0]).toMatchObject({ ultimoRegistroId: null, ultimaHuella: null });
  expect(await withTransaction(suite.db, (tx) => readActiveConflicts(tx, node.nodeId))).toEqual([]);
  await withOperationAuthority(a.binding, a.operator, async (authority) => {
    const unavailable = {
      prepare: async () => {
        throw new Error("must not prepare a replay");
      },
    };
    expect(
      await recovery.recoverActiveConflict(liveScope(authority, unavailable, a.binding), {
        binding: a.binding,
        conflict,
        input: a.input,
      }),
    ).toEqual(result);
    expect(
      await withTransaction(suite.db, (tx) =>
        recovery.readCommittedConflictSwitch(tx, node, a.binding, conflict, authority),
      ),
    ).toEqual(result);
  });
  expect(await snapshot()).toEqual(after);
});

it.each(["oldMachineOffline", "noParallelRecovery"] as const)(
  "refuses missing %s at activation without rotating anything",
  async (field) => {
    const a = await attempt();
    a.isolation[field] = false;
    const before = await snapshot();
    await withOperationAuthority(a.binding, a.operator, async (authority) => {
      await expect(
        recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
          binding: a.binding,
          conflict,
          input: a.input,
        }),
      ).rejects.toMatchObject(
        refusal(field === "oldMachineOffline" ? "old_machine_active" : "parallel_recovery"),
      );
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("allows at most one of two competing events on the same original identity", async () => {
  const first = await attempt("first-recovery");
  const second = await attempt("second-recovery");
  const original = await snapshot();
  const results = await Promise.all(
    [first, second].map((a) =>
      withOperationAuthority(a.binding, a.operator, (authority) =>
        recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
          binding: a.binding,
          conflict,
          input: a.input,
        }),
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
    ),
  );
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({
    error: refusal("conflict_not_active"),
  });
  const after = await snapshot();
  expect(after.allocations).toHaveLength(2);
  expect(after.records).toEqual(original.records);
  expect(after.cases).toEqual(original.cases);
  expect(after.replies).toEqual(original.replies);
});

it("never allocates twice when two requests repeat the same unresolved event", async () => {
  const a = await attempt();
  const run = () =>
    withOperationAuthority(a.binding, a.operator, (authority) =>
      recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
        binding: a.binding,
        conflict,
        input: a.input,
      }),
    );
  const results = await Promise.allSettled([run(), run()]);
  const successes = results.filter((result) => result.status === "fulfilled");
  expect(successes.length).toBeGreaterThanOrEqual(1);
  for (const result of results) {
    if (result.status === "fulfilled") expect(result.value).toEqual(successes[0]!.value);
    else expect(result.reason).toMatchObject(refusal("uncertain_prior_activation"));
  }
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(2);
});

it("refuses changed input and an event whose committed replacement has since been retired", async () => {
  const a = await attempt();
  const result = await withOperationAuthority(a.binding, a.operator, (authority) =>
    recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
      binding: a.binding,
      conflict,
      input: a.input,
    }),
  );
  const changed = structuredClone(a.input);
  changed.allocation.allocationId = "other-allocation";
  await withOperationAuthority(a.binding, a.operator, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        recovery.readCommittedConflictSwitch(tx, node, a.binding, conflict, authority, changed),
      ),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  await suite.db
    .update(registroSif)
    .set({ revocadoEn: new Date() })
    .where(eq(registroSif.id, result.sifId));
  const before = await snapshot();
  await withOperationAuthority(a.binding, a.operator, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        recovery.readCommittedConflictSwitch(tx, node, a.binding, conflict, authority),
      ),
    ).rejects.toMatchObject(refusal("activation_superseded"));
  });
  expect(await snapshot()).toEqual(before);
});

it.each(["binding", "input", "conflict", "operator"])(
  "refuses changed %s without activation writes",
  async (change) => {
    const a = await attempt();
    const before = await snapshot();
    const binding = change === "binding" ? { ...a.binding, sourceId: "other-conflict" } : a.binding;
    const ref = change === "conflict" ? { ...conflict, caseId: "other-case" } : conflict;
    const input = structuredClone(a.input);
    if (change === "input") input.allocation.installationIdentity = "0CNQS";
    await withOperationAuthority(
      binding,
      change === "operator" ? "administrator" : a.operator,
      async (authority) => {
        await expect(
          recovery.recoverActiveConflict(liveScope(authority, a.preparation, binding), {
            binding,
            conflict: ref,
            input,
          }),
        ).rejects.toMatchObject(
          refusal(change === "operator" ? "reauthentication_required" : "event_mismatch"),
        );
      },
    );
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses a reference whose conflict reply was not committed", async () => {
  const a = await attempt();
  await suite.db
    .update(envios)
    .set({ estado: "pendiente" })
    .where(eq(envios.registroId, conflict.registroId));
  const before = await snapshot();
  await withOperationAuthority(a.binding, a.operator, async (authority) => {
    await expect(
      recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
        binding: a.binding,
        conflict,
        input: a.input,
      }),
    ).rejects.toMatchObject(refusal("conflict_not_active"));
  });
  expect(await snapshot()).toEqual(before);
});

it("rolls back a failed activation and refuses to reuse its consumed process admission", async () => {
  const a = await attempt();
  const before = await snapshot();
  let commits = 0;
  const commit: LiveModuleOperationScope["commit"] = (run) =>
    withTransaction(suite.db, async (tx: Transaction) => {
      const result = await run(tx);
      if (++commits === 2) throw new Error("activation rolled back");
      return result;
    });
  await withOperationAuthority(a.binding, a.operator, async (authority) => {
    await expect(
      recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding, commit), {
        binding: a.binding,
        conflict,
        input: a.input,
      }),
    ).rejects.toThrow("activation rolled back");
    expect(await snapshot()).toEqual(before);
    await expect(
      recovery.recoverActiveConflict(liveScope(authority, a.preparation, a.binding), {
        binding: a.binding,
        conflict,
        input: a.input,
      }),
    ).rejects.toMatchObject(refusal("uncertain_prior_activation"));
  });
});
