import { generateKeyPairSync } from "node:crypto";
import { isNull } from "drizzle-orm";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  withPreparedModuleOperations,
  type ModuleOperationInput,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import * as preparation from "./allocation-preparation.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { AllocationOperationEvidence } from "./allocation-operation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import { fiscalAllocations, type ActivationResult } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "recovery-collection",
  sourceId: "backup-collection",
  targetNodeId: node.nodeId,
};
const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const candidate = {
  version: 1 as const,
  allocationId: "collection-42",
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper" as const,
  issuedAt: "2026-10-13T10:00:00.000Z",
};
const block = signPaperBlock(
  {
    version: 1,
    custodianId: "custodian",
    generationId: "generation-collection",
    blockId: "block-collection",
    packVersion: 1,
    recipientVenueId: "venue-collection",
    allocations: [candidate],
  },
  privateKey,
);
const approval = {
  version: 1 as const,
  eventId: binding.eventId,
  operatorId: operator,
  sourceId: binding.sourceId,
  targetNodeId: node.nodeId,
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-13T11:00:00.000Z",
  incidentEvidence: "outside/collection-42",
};
const consumption = signPaperConsumptionForBlock(
  block,
  candidate.allocationId,
  {
    eventId: approval.eventId,
    operatorId: operator,
    sourceId: approval.sourceId,
    targetNodeId: approval.targetNodeId,
    incidentEvidence: approval.incidentEvidence,
    consumedAt: approval.confirmedAt,
  },
  privateKey,
);
const input = {
  allocation: { ...candidate, reservationEvidence: { block, consumption } },
  approval,
};
const evidence: AllocationOperationEvidence = {
  incidentEvidence: approval.incidentEvidence,
  priorActivation: "none",
  requiredBases: bases,
  authority: {
    kind: "paper",
    trust,
    recipientVenueId: "venue-collection",
    generationId: "generation-collection",
    blockId: "block-collection",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  },
};

function receipt() {
  return structuredClone({ binding, operatorId: operator, evidence });
}
function refusal(reason: string) {
  return { code: "sif.allocation_invalid", params: { reason } };
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});

function configured(source = async () => receipt()) {
  return fakeModule(binding.module, {
    operations: preparation.createAllocationPreparation(source),
  });
}

function attempt(
  run: (tx: Transaction, operation: ModuleOperationInput) => Promise<ActivationResult> = (
    tx,
    operation,
  ) => preparation.activatePreparedModuleAllocation(tx, node, operation),
  source = async () => receipt(),
) {
  return withOperationAuthority(binding, operator, (authority) =>
    withPreparedModuleOperations(
      [configured(source)],
      new Map([[binding.module, { binding, authority, input }]]),
      node.nodeId,
      binding.action,
      (ready) => withTransaction(suite.db, (tx) => run(tx, ready.get(binding.module)!)),
    ),
  );
}

it("activates every purpose through the public module preparation seat", async () => {
  const result = await attempt();
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ]);
  const rows = await suite.db.select().from(fiscalAllocations);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.approval).toEqual(approval);
  expect(rows[0]?.result).toEqual(result);
  expect(
    await suite.db.select({ identity: registroSif.numeroInstalacion }).from(registroSif),
  ).toEqual([{ identity: "P000042" }]);
});

it("refuses submitted input that has never been collected", async () => {
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        preparation.activatePreparedModuleAllocation(tx, node, { binding, authority, input }),
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("refuses a copied prepared token while accepting the original in the same authority scope", async () => {
  await withOperationAuthority(binding, operator, (authority) =>
    withPreparedModuleOperations(
      [configured()],
      new Map([[binding.module, { binding, authority, input }]]),
      node.nodeId,
      binding.action,
      async (ready) => {
        const operation = ready.get(binding.module)!;
        await expect(
          withTransaction(suite.db, (tx) =>
            preparation.activatePreparedModuleAllocation(tx, node, {
              ...operation,
              input: structuredClone(operation.input),
            }),
          ),
        ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
        const result = await withTransaction(suite.db, (tx) =>
          preparation.activatePreparedModuleAllocation(tx, node, operation),
        );
        expect(result.series).toHaveLength(3);
      },
    ),
  );
});

it("revokes preparation after the callback even while its authentication remains live", async () => {
  await withOperationAuthority(binding, operator, async (authority) => {
    let captured!: ModuleOperationInput;
    await withPreparedModuleOperations(
      [configured()],
      new Map([[binding.module, { binding, authority, input }]]),
      node.nodeId,
      binding.action,
      async (ready) => {
        captured = ready.get(binding.module)!;
      },
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        preparation.activatePreparedModuleAllocation(tx, node, captured),
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["action", "eventId", "sourceId", "targetNodeId"] as const)(
  "refuses a prepared token rebound to another %s",
  async (key) => {
    await expect(
      attempt(async (tx, operation) =>
        preparation.activatePreparedModuleAllocation(tx, node, {
          ...operation,
          binding: { ...operation.binding, [key]: "other" },
        }),
      ),
    ).rejects.toMatchObject(refusal("event_mismatch"));
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);

it("refuses a prepared token combined with another live authentication", async () => {
  await withOperationAuthority(binding, operator, async (other) => {
    await expect(
      attempt(async (tx, operation) =>
        preparation.activatePreparedModuleAllocation(tx, node, { ...operation, authority: other }),
      ),
    ).rejects.toMatchObject(refusal("reauthentication_required"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("rolls back activation when the later host write refuses", async () => {
  const before = await suite.db.select().from(invoiceSeries);
  await expect(
    attempt(async (tx, operation) => {
      await preparation.activatePreparedModuleAllocation(tx, node, operation);
      throw new Error("later-host-refusal");
    }),
  ).rejects.toThrow("later-host-refusal");
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
});

it("collects outside the write transaction so another writer can commit", async () => {
  let written = false;
  const result = await attempt(undefined, async () => {
    await withTransaction(suite.db, (tx) => tx.update(invoiceSeries).set({ nextNumber: 7 }));
    written = true;
    return receipt();
  });
  expect(written).toBe(true);
  expect(result.series).toHaveLength(3);
  const retired = await suite.db
    .select()
    .from(invoiceSeries)
    .where(isNull(invoiceSeries.retiredAt));
  expect(retired.map((row) => row.nextNumber)).toEqual([1, 1, 1]);
});

it("refuses missing host trust through the public paper selector", async () => {
  const module = fakeModule(binding.module, {
    operations: preparation.createPaperAllocationPreparation({
      custodianPath: "",
      confirmationPath: "",
      confirmedFingerprint: "",
    }),
  });
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(
      withPreparedModuleOperations(
        [module],
        new Map([[binding.module, { binding, authority, input }]]),
        node.nodeId,
        binding.action,
        async () => "unexpected",
      ),
    ).rejects.toMatchObject(refusal("reservation_untrusted"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each([null, undefined, "copied marker", 7])("refuses an unprepared token %#", async (token) => {
  await withOperationAuthority(binding, operator, async (authority) => {
    await expect(
      withTransaction(suite.db, (tx) =>
        preparation.activatePreparedModuleAllocation(tx, node, {
          binding,
          authority,
          input: token,
        }),
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
