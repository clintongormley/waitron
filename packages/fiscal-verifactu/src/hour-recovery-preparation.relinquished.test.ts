import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type ModuleOperationInput,
  type ModuleRecoveryFacts,
  type OperationBinding,
  type OperationOperator,
} from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { withHourAdmission } from "./allocation-envelope.js";
import { withCollectedModuleAllocation } from "./allocation-operation.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { FISCAL_OPERATIONS } from "./index.js";
import * as internet from "./hour-clock-internet.js";
import * as release from "./hour-release.js";
import { fiscalAllocations } from "./schema/allocations.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = Date.parse("2026-10-16T12:00:00.000Z");
const primary = { nodeId: TENANT_A.nodeId };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
let wall = NOW;
let monotonic = 1000;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  wall = NOW;
  monotonic = 1000;
  vi.spyOn(release, "readHourRelease").mockReturnValue({
    sourceCommit: "a".repeat(40),
    instantMs: NOW - 86_400_000,
    committedAt: "2026-10-15T12:00:00.000Z",
    generator: "scripts/generate-hour-release.mjs:v1",
    generatorSha256: "b".repeat(64),
  });
  vi.spyOn(internet, "observeInternetHourClock").mockImplementation(async () => ({
    source: "internet",
    result: "usable",
    instantMs: wall,
    uncertaintyMs: 0,
    wallStartedMs: wall,
    wallFinishedMs: wall,
    monotonicStartedMs: monotonic,
    monotonicFinishedMs: monotonic,
  }));
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await activateOriginal();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function activateOriginal() {
  const binding: OperationBinding = {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "original",
    sourceId: primary.nodeId,
    targetNodeId: primary.nodeId,
  };
  const issuedAt = "2026-10-16T11:40:00.000Z";
  const input = {
    allocation: {
      version: 1,
      allocationId: "hour/original",
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "preproduction",
      installationIdentity: "0CNNW",
      series: bases.map((base) => ({ ...base, code: `${base.code}-0CNNW` })),
      source: "hour",
      reservationEvidence: null,
      issuedAt,
    },
    approval: {
      version: 1,
      eventId: "original",
      operatorId: "administrator",
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      oldMachineOffline: false,
      oldMachineAbsent: true,
      noParallelRecovery: true,
      confirmedAt: issuedAt,
      incidentEvidence: "hour/original",
    },
  };
  await withOperationAuthority(binding, "administrator", (authority) => {
    const operation = { binding, authority, input };
    return withHourAdmission(operation, { requiredBases: bases, priorActivation: "none" }, (e) =>
      withCollectedModuleAllocation(
        operation,
        async (request) => ({ ...request, evidence: e }),
        (write) => withTransaction(suite.db, (tx) => write(tx, primary)),
      ),
    );
  });
}

function hostWith(facts: Partial<ModuleRecoveryFacts>) {
  let value: unknown = null;
  const history: unknown[] = [];
  let held = false;
  const host: ModuleOperationHost = {
    environment: {},
    testClock: { wall: () => wall, monotonic: () => monotonic },
    readPublicEvidence: async () => undefined,
    // As the real host does, facts are read only inside a preparation scope.
    readRecoveryFacts: async () => {
      if (!held) throw new Error("facts read outside a preparation scope");
      return {
        country: "ES",
        taxId: "89890001K",
        environment: "preproduction",
        bases,
        contextKey: "promotion/host-key/isolation",
        history: [{ reference: "selected-backup", complete: true, records: [] }],
        oldMachineOffline: false,
        oldMachineAbsent: false,
        oldMachineRelinquished: false,
        noParallelRecovery: true,
        priorActivation: "none",
        ...facts,
      };
    },
    withPreparationState: async (_binding, run) => {
      if (held) throw new Error("nested exclusion");
      held = true;
      try {
        return await run({
          get value() {
            return structuredClone(value);
          },
          get history() {
            return structuredClone(history);
          },
          async replace(next) {
            value = structuredClone(next);
            history.push(structuredClone(next));
          },
        });
      } finally {
        held = false;
      }
    },
  };
  return FISCAL_OPERATIONS.configure!(host);
}
type Operations = ReturnType<typeof hostWith>;
type Operation = Pick<ModuleOperationInput, "binding" | "authority">;

const promotion: OperationBinding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: "promotion",
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
const restore: OperationBinding = { ...promotion, action: "restore", eventId: "restored" };
const recoveryKey = {
  kind: "recovery-key" as const,
  nodeId: restore.targetNodeId,
  eventId: restore.eventId,
};

async function select(operations: Operations, operation: Operation) {
  const once = async () => {
    const challenge = (await operations.recovery!(
      operation,
      { action: "clock-challenge" },
      { onBox: true },
    )) as { id: string };
    const compared = (await operations.recovery!(
      operation,
      { action: "compare-clocks", browser: { challengeId: challenge.id, instantMs: wall } },
      { onBox: true },
    )) as { id: string };
    return (await operations.recovery!(
      operation,
      { action: "select", comparisonId: compared.id },
      { onBox: true },
    )) as { status: string; input: { approval: unknown }; targetMs: number; remainingMs: number };
  };
  const first = await once();
  if (first.status !== "waiting") return first;
  monotonic += first.remainingMs;
  wall = first.targetMs;
  vi.setSystemTime(wall);
  return once();
}

async function selectAndActivate(
  operations: Operations,
  binding: OperationBinding,
  operator: OperationOperator,
) {
  return withOperationAuthority(binding, operator, async (authority) => {
    const operation = { binding, authority };
    const selected = await select(operations, operation);
    expect(selected.status).toBe("selected");
    await operations.prepare({ ...operation, input: selected.input }, (prepared) =>
      withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, standby, prepared)),
    );
    const [stored] = await suite.db
      .select()
      .from(fiscalAllocations)
      .where(eq(fiscalAllocations.eventKey, binding.eventId));
    return { selected: selected.input.approval, stored: stored!.approval };
  });
}

it("a controlled promotion stores a version 2 approval saying the old box relinquished filing", async () => {
  const { stored } = await selectAndActivate(
    hostWith({ oldMachineRelinquished: true }),
    promotion,
    "administrator",
  );
  expect(stored).toEqual({
    version: 2,
    eventId: "promotion",
    sourceId: primary.nodeId,
    targetNodeId: standby.nodeId,
    operatorId: "administrator",
    oldMachineOffline: false,
    oldMachineAbsent: false,
    oldMachineRelinquished: true,
    noParallelRecovery: true,
    confirmedAt: "2026-10-16T12:00:00.000Z",
    incidentEvidence: "hour/promotion",
  });
});

it("a promotion whose facts say both offline and relinquished stores the version 2 approval with offline false", async () => {
  const { selected, stored } = await selectAndActivate(
    hostWith({ oldMachineOffline: true, oldMachineRelinquished: true }),
    promotion,
    "administrator",
  );
  const relinquished = {
    version: 2,
    eventId: "promotion",
    sourceId: primary.nodeId,
    targetNodeId: standby.nodeId,
    operatorId: "administrator",
    oldMachineOffline: false,
    oldMachineAbsent: false,
    oldMachineRelinquished: true,
    noParallelRecovery: true,
    confirmedAt: "2026-10-16T12:00:00.000Z",
    incidentEvidence: "hour/promotion",
  };
  expect(selected).toEqual(relinquished);
  expect(stored).toEqual(relinquished);
});

it("select and prepare build the same version 2 input, so a relinquished promotion is not refused event_mismatch", async () => {
  const operations = hostWith({ oldMachineRelinquished: true });
  await withOperationAuthority(promotion, "administrator", async (authority) => {
    const operation = { binding: promotion, authority };
    const selected = await select(operations, operation);
    expect(selected.input.approval).toMatchObject({
      version: 2,
      oldMachineOffline: false,
      oldMachineRelinquished: true,
    });
    expect(
      await operations.prepare({ ...operation, input: selected.input }, async () => "admitted"),
    ).toBe("admitted");
  });
});

it("a recovery whose facts say both offline and relinquished is refused old_machine_active", async () => {
  const operations = hostWith({ oldMachineOffline: true, oldMachineRelinquished: true });
  await expect(
    withOperationAuthority(restore, recoveryKey, (authority) =>
      select(operations, { binding: restore, authority }),
    ),
  ).rejects.toMatchObject(refusal("old_machine_active"));
});

it("a promotion without the relinquished fact stores version 1 exactly as today", async () => {
  const { selected, stored } = await selectAndActivate(
    hostWith({ oldMachineOffline: true }),
    promotion,
    "administrator",
  );
  const today = {
    version: 1,
    eventId: "promotion",
    sourceId: primary.nodeId,
    targetNodeId: standby.nodeId,
    operatorId: "administrator",
    oldMachineOffline: true,
    oldMachineAbsent: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-16T12:00:00.000Z",
    incidentEvidence: "hour/promotion",
  };
  expect(JSON.stringify(selected)).toBe(JSON.stringify(today));
  expect(stored).toEqual(today);
});

// A restore's activation needs the restored box's own series rows, so this case stops at admission.
it("a recovery still builds version 1, byte for byte as today, and preparation admits it", async () => {
  const operations = hostWith({ oldMachineOffline: true });
  await withOperationAuthority(restore, recoveryKey, async (authority) => {
    const operation = { binding: restore, authority };
    const selected = await select(operations, operation);
    expect(selected.status).toBe("selected");
    const today = {
      version: 1,
      eventId: "restored",
      sourceId: primary.nodeId,
      targetNodeId: standby.nodeId,
      operatorId: recoveryKey,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: new Date(wall).toISOString(),
      incidentEvidence: "hour/restored",
    };
    expect(JSON.stringify(selected.input.approval)).toBe(JSON.stringify(today));
    expect(
      await operations.prepare({ ...operation, input: selected.input }, async () => "admitted"),
    ).toBe("admitted");
  });
});

it("a promotion with neither fact is refused old_machine_active", async () => {
  const operations = hostWith({});
  await expect(
    withOperationAuthority(promotion, "administrator", (authority) =>
      select(operations, { binding: promotion, authority }),
    ),
  ).rejects.toMatchObject(refusal("old_machine_active"));
});
