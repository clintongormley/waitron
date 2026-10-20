import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { allocationFixture } from "../test/allocation-fixture.js";
import {
  createAllocationPreparation,
  activatePreparedModuleAllocation,
  createPaperAllocationPreparation,
} from "./allocation-preparation.js";
import { createBoundPaperAllocationSource } from "./allocation-paper-source.js";
import {
  createStandbyAllocationPreparation,
  ALLOCATED_FISCAL_STANDBY,
} from "./allocated-standby.js";
import type { DeclaredRegisterHistory } from "./paper-register-protocol.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
  target = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const time = "2026-10-16T00:00:00.000Z";
function checkpoint(prefix: "S" | "P", floor = 42): DeclaredRegisterHistory {
  const scope = {
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
  };
  return {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    registerId: "known-checkpoint",
    scope,
    mode: "checkpoint",
    originals: [],
    checkpoint: {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "typed-42",
      scope,
      sHighWater: prefix === "S" ? floor : 0,
      pHighWater: prefix === "P" ? floor : 0,
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: time,
      },
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: time,
    },
    revisions: [],
  };
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db.insert(invoiceSeries).values(bases.map((b) => ({ ...b, nodeId: primary.nodeId })));
});
const refusal = { code: "sif.allocation_invalid", params: { reason: "reservation_mismatch" } };
function source(
  f: ReturnType<typeof allocationFixture>,
  action: string,
  history: DeclaredRegisterHistory,
) {
  const request = f.request(action);
  const c = request.confirmation as Record<string, unknown>;
  return createAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: {
      allocationId: f.allocation.allocationId,
      incidentEvidence: c.incidentEvidence as string,
      requiredBases: bases,
      priorActivation: "none",
      authority: {
        kind: "paper",
        trust: f.custodian,
        recipientVenueId: c.recipientVenueId as string,
        generationId: c.generationId as string,
        blockId: c.blockId as string,
        currentRegisterConfirmed: true,
        consumptionConfirmed: true,
        currentEntryState: "consumed-for-event",
        knownHistory: history,
      },
    },
  }));
}
async function attempt(
  f: ReturnType<typeof allocationFixture>,
  action: string,
  history: DeclaredRegisterHistory,
) {
  const req = f.request(action);
  return withOperationAuthority(req.binding, req.operatorId, (authority) =>
    source(f, action, history).prepare(
      { binding: req.binding, authority, input: req.input },
      (op) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(tx, action === "promote" ? target : primary, op),
        ),
    ),
  );
}
it.each(["setup", "restore", "re-register"])(
  "%s refuses a signed old40 below the independently known burn42, and permits43",
  async (action) => {
    const prefix = action === "setup" ? "S" : "P",
      history = checkpoint(prefix);
    const old = allocationFixture({ node: primary, bases, identity: `${prefix}000040` });
    await expect(attempt(old, action, history)).rejects.toMatchObject(refusal);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    const fresh = allocationFixture({ node: primary, bases, identity: `${prefix}000043` });
    const result = await attempt(fresh, action, history);
    expect(result.series.map((x) => x.code)).toEqual([
      `A-${prefix}000043`,
      `FF-${prefix}000043`,
      `R-${prefix}000043`,
    ]);
  },
);
async function registerPrimary() {
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, { nodeId: primary.nodeId, nif: "89890001K", idSistemaInformatico: "W1" }),
  );
}
function standby(
  f: ReturnType<typeof allocationFixture>,
  action: "reserve" | "establish",
  history: DeclaredRegisterHistory,
) {
  const req = f.request(action),
    c = req.confirmation as Record<string, unknown>;
  const preparation = createStandbyAllocationPreparation(async (scope) => ({
    ...scope,
    evidence: {
      trust: f.custodian,
      allocationId: f.allocation.allocationId,
      incidentEvidence: c.incidentEvidence as string,
      recipientVenueId: c.recipientVenueId as string,
      generationId: c.generationId as string,
      blockId: c.blockId as string,
      currentRegisterConfirmed: true,
      reservationConfirmed: true,
      currentEntryState: "reserved",
      knownHistory: history,
    },
  }));
  return withOperationAuthority(req.binding, req.operatorId, (authority) =>
    preparation.prepare({ binding: req.binding, authority, input: req.input }, (op) =>
      withTransaction<unknown>(suite.db, (tx) =>
        action === "reserve"
          ? ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)
          : ALLOCATED_FISCAL_STANDBY.establish!(tx, target, f.state, op),
      ),
    ),
  );
}
it.each(["reserve", "establish"] as const)(
  "standby %s refuses signed P40 below burn42 and permits P43",
  async (action) => {
    await registerPrimary();
    const history = checkpoint("P");
    const old = allocationFixture({ node: target, primary, bases, identity: "P000040" });
    await expect(standby(old, action, history)).rejects.toMatchObject(refusal);
    expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
    const fresh = allocationFixture({ node: target, primary, bases, identity: "P000043" });
    const result = await standby(fresh, action, history);
    if (action === "establish")
      expect((await suite.db.select().from(fiscalReservations))[0]?.installationIdentity).toBe(
        "P000043",
      );
    else expect(result).toMatchObject({ state: { version: 1, evidence: fresh.state.evidence } });
  },
);
it.each([40, 43])(
  "promotion of signed dormant P%d checks the fresh known burn floor",
  async (serial) => {
    await registerPrimary();
    const f = allocationFixture({
      node: target,
      primary,
      bases,
      identity: `P${String(serial).padStart(6, "0")}`,
    });
    await f.transaction(suite.db, "establish", (tx, operation) =>
      ALLOCATED_FISCAL_STANDBY.establish!(tx, target, f.state, operation),
    );
    if (serial === 40) {
      await expect(attempt(f, "promote", checkpoint("P"))).rejects.toMatchObject(refusal);
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
    } else
      expect((await attempt(f, "promote", checkpoint("P"))).series.map((x) => x.code)).toEqual([
        "A-P000043",
        "FF-P000043",
        "R-P000043",
      ]);
  },
);
it("the bound source retains independently held history alongside current signed confirmation", async () => {
  const f = allocationFixture({ node: primary, bases, identity: "P000043" }),
    req = f.request("restore");
  const source = createBoundPaperAllocationSource({
    environment: {},
    readPublicEvidence: async () => ({
      trust: f.custodian,
      current: { ...req.confirmation, knownHistory: checkpoint("P") },
    }),
  });
  expect(
    (await source({ binding: req.binding, operatorId: req.operatorId })).evidence.authority,
  ).toMatchObject({ knownHistory: checkpoint("P") });
});
it.each(["old", "fresh", "missing known file", "malformed known file"])(
  "ordinary file preparation uses a separate known-history file: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "known-paper-"));
    try {
      const f = allocationFixture({
          node: primary,
          bases,
          identity: mode === "old" ? "P000040" : "P000043",
        }),
        req = f.request("restore");
      const custodianPath = join(root, "key.json"),
        confirmationPath = join(root, "confirmation.json"),
        knownHistoryPath = join(root, "known.json");
      await writeFile(custodianPath, JSON.stringify(f.custodian));
      await writeFile(confirmationPath, JSON.stringify(req.confirmation));
      if (mode !== "missing known file")
        await writeFile(
          knownHistoryPath,
          mode === "malformed known file" ? "{}" : JSON.stringify(checkpoint("P")),
        );
      const config = {
        custodianPath,
        confirmationPath,
        knownHistoryPath,
        confirmedFingerprint: f.custodian.fingerprint,
      };
      const preparation = createPaperAllocationPreparation(config);
      const run = () =>
        withOperationAuthority(req.binding, req.operatorId, (authority) =>
          preparation.prepare({ binding: req.binding, authority, input: req.input }, (op) =>
            withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, op)),
          ),
        );
      if (mode === "fresh")
        expect((await run()).series.map((x) => x.code)).toEqual([
          "A-P000043",
          "FF-P000043",
          "R-P000043",
        ]);
      else {
        await expect(run()).rejects.toMatchObject(refusal);
        expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
it("conflicting known checkpoints cannot replace the higher floor with a lower file", async () => {
  const root = await mkdtemp(join(tmpdir(), "paper-known-conflict-"));
  try {
    const f = allocationFixture({ node: primary, bases, identity: "P000043" }),
      req = f.request("restore");
    const custodianPath = join(root, "key.json"),
      confirmationPath = join(root, "current.json"),
      knownHistoryPath = join(root, "known.json");
    await writeFile(custodianPath, JSON.stringify(f.custodian));
    await writeFile(
      confirmationPath,
      JSON.stringify({ ...req.confirmation, knownHistory: checkpoint("P", 99) }),
    );
    await writeFile(knownHistoryPath, JSON.stringify(checkpoint("P", 42)));
    const preparation = createPaperAllocationPreparation({
      custodianPath,
      confirmationPath,
      knownHistoryPath,
      confirmedFingerprint: f.custodian.fingerprint,
    });
    await expect(
      withOperationAuthority(req.binding, req.operatorId, (authority) =>
        preparation.prepare({ binding: req.binding, authority, input: req.input }, (op) =>
          withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, op)),
        ),
      ),
    ).rejects.toMatchObject(refusal);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each([40, 43])(
  "a configured bound restore checks independently retained burn42 for P%d",
  async (serial) => {
    const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
    const f = allocationFixture({
        node: primary,
        bases,
        identity: `P${String(serial).padStart(6, "0")}`,
      }),
      req = f.request("restore");
    const preparation = FISCAL_OPERATIONS.configure!({
      environment: {},
      readPublicEvidence: async () => ({
        trust: f.custodian,
        current: { ...req.confirmation, knownHistory: checkpoint("P") },
      }),
    });
    const run = () =>
      withOperationAuthority(req.binding, req.operatorId, (authority) =>
        preparation.prepare({ binding: req.binding, authority, input: req.input }, (op) =>
          withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, primary, op)),
        ),
      );
    if (serial === 40) await expect(run()).rejects.toMatchObject(refusal);
    else
      expect((await run()).series.map((x) => x.code)).toEqual([
        "A-P000043",
        "FF-P000043",
        "R-P000043",
      ]);
  },
);
it.each(["setup", "restore"])(
  "%s also refuses the exact signed burn-floor value42",
  async (action) => {
    const prefix = action === "setup" ? "S" : "P",
      f = allocationFixture({ node: primary, bases, identity: `${prefix}000042` });
    await expect(attempt(f, action, checkpoint(prefix))).rejects.toMatchObject(refusal);
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);

it.each(
  ["reserve", "establish"].flatMap((action) => [40, 43].map((serial) => [action, serial] as const)),
)("configured signed %s excludes retired public P42 for serial %s", async (action, serial) => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  await registerPrimary();
  const root = await mkdtemp(join(tmpdir(), "retired-signed-standby-"));
  try {
    const f = allocationFixture({
      node: target,
      primary,
      bases,
      identity: `P${String(serial).padStart(6, "0")}`,
    });
    const req = f.request(action),
      custodianPath = join(root, "trust.json"),
      confirmationPath = join(root, "current.json");
    await writeFile(custodianPath, JSON.stringify(f.custodian));
    await writeFile(confirmationPath, JSON.stringify(req.confirmation));
    const preparation = FISCAL_OPERATIONS.configure!({
      environment: {
        WAITRON_FISCAL_CUSTODIAN_FILE: custodianPath,
        WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: f.custodian.fingerprint,
        WAITRON_FISCAL_CONFIRMATION_FILE: confirmationPath,
      },
      readPublicEvidence: async () => undefined,
      readRetiredSetup: async () => [
        {
          context: {
            attemptId: "retired",
            binding: {
              module: "fiscal-verifactu",
              action: "setup",
              eventId: "retired-event",
              sourceId: "first-setup:retired",
              targetNodeId: "retired-node",
            },
            administratorId: "retired-admin",
            country: "ES",
            taxId: "89890001K",
            environment: "preproduction",
            recipientVenueId: "first-setup:retired",
            bases,
          },
          input: undefined,
          publicEvidence: [{ knownHistory: checkpoint("P") }],
        },
      ],
    });
    const run = () =>
      withOperationAuthority(req.binding, req.operatorId, (authority) =>
        preparation.prepare({ binding: req.binding, authority, input: req.input }, (op) =>
          withTransaction<unknown>(suite.db, (tx) =>
            action === "reserve"
              ? ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)
              : ALLOCATED_FISCAL_STANDBY.establish!(tx, target, f.state, op),
          ),
        ),
      );
    if (serial === 40) {
      await expect(run()).rejects.toMatchObject(refusal);
      expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
    } else {
      const result = await run();
      if (action === "reserve") expect(result).toEqual({ state: f.state });
      else
        expect((await suite.db.select().from(fiscalReservations))[0]?.installationIdentity).toBe(
          "P000043",
        );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
