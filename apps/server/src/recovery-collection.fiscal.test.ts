import { beforeEach, expect, it } from "vitest";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { dashboardSessions, persons } from "@waitron/identity";
import { readOperationAuthority } from "@waitron/module";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { seedTaxpayers, TAXPAYER_A } from "@waitron/fiscal-verifactu/test/fixtures.js";
import { withCollectedModuleAllocation } from "@waitron/fiscal-verifactu/src/allocation-operation.js";
import { drawEmergencyIdentity } from "@waitron/fiscal-verifactu/src/allocation-envelope.js";
import {
  fiscalAllocations,
  type ActivationResult,
} from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { verifactuIdentities } from "@waitron/fiscal-verifactu/src/schema/verifactu-identities.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TAXPAYER_A.nodeId };
const binding = {
  module: "fiscal-verifactu",
  action: "restore",
  eventId: "collected-recovery",
  sourceId: "archive-collected",
  targetNodeId: node.nodeId,
};
const operator = { kind: "recovery-key" as const, nodeId: node.nodeId, eventId: binding.eventId };
let secret: string;

beforeEach(async () => {
  await seedTaxpayers(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db.insert(invoiceSeries).values([
    { nodeId: node.nodeId, code: "A", purpose: "standard" },
    { nodeId: node.nodeId, code: "FF", purpose: "full" },
    { nodeId: node.nodeId, code: "R", purpose: "corrective" },
  ]);
  secret = await mintBreakGlassSecret({ venue: suite.db, node: suite.node }, node.nodeId);
});

it("authenticates the real node key, collects outside the write lock and activates all purposes in the host transaction", async () => {
  const draw = drawEmergencyIdentity();
  const input = {
    allocation: {
      version: 1,
      allocationId: "emergency-collected",
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "preproduction",
      installationIdentity: draw.identity,
      source: "emergency",
      issuedAt: "2026-10-13T13:00:00.000Z",
      series: [
        { code: `A-${draw.identity}`, purpose: "standard" },
        { code: `FF-${draw.identity}`, purpose: "full" },
        { code: `R-${draw.identity}`, purpose: "corrective" },
      ],
      reservationEvidence: { checksum: draw.checksum },
    },
    approval: {
      version: 1,
      eventId: binding.eventId,
      operatorId: operator,
      sourceId: binding.sourceId,
      targetNodeId: node.nodeId,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: "2026-10-13T13:00:00.000Z",
      incidentEvidence: "outside/emergency-collected",
    },
  };
  let activate!: (tx: Transaction, target: typeof node) => Promise<ActivationResult>;
  let writerCommitted = false;
  const result = await withRecoveryKeyOperation(
    { db: suite.db, node: suite.node, nodeId: node.nodeId },
    binding,
    secret,
    async (tx, authority) => {
      expect(writerCommitted).toBe(true);
      expect(readOperationAuthority(authority, binding)?.operatorId).toEqual(operator);
      const active = await activate(tx, node);
      await tx.update(deployment).set({ environment: "preproduction" });
      return active;
    },
    (authority, commit) =>
      withCollectedModuleAllocation(
        { binding, authority, input },
        async (request) => {
          expect(request).toEqual({ binding, operatorId: operator });
          await withTransaction(suite.db, async (tx) => {
            await tx.update(deployment).set({ environment: "preproduction" });
          });
          writerCommitted = true;
          return {
            ...request,
            evidence: {
              priorActivation: "none",
              incidentEvidence: "outside/emergency-collected",
              authority: {
                kind: "emergency",
                draw,
                knownIdentities: null,
                incidentRecorded: true,
                uncertaintyRecorded: true,
              },
            },
          };
        },
        async (ready) => {
          activate = ready;
          return commit();
        },
      ),
  );
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: `A-${draw.identity}`, purpose: "standard" },
    { code: `FF-${draw.identity}`, purpose: "full" },
    { code: `R-${draw.identity}`, purpose: "corrective" },
  ]);
  expect(await suite.db.select().from(verifactuIdentities)).toHaveLength(1);
  const ledger = await suite.db.select().from(fiscalAllocations);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]?.approval.operatorId).toEqual(operator);
  expect(ledger[0]?.result).toEqual(result);
  expect(ledger[0]?.allocation.reservationEvidence).toEqual({ checksum: draw.checksum });
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(dashboardSessions)).toEqual([]);
});
