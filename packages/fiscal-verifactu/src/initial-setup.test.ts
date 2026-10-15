import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { locationId } from "@waitron/shared";
import type { InitialSetupContext } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { FISCAL_PROVISIONING } from "./provisioning.js";
import { activateAllocation } from "./allocation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { validateInitialPaperCandidates } from "./initial-paper-candidates.js";
import type { PaperConsumption } from "./paper-protocol.js";
import type { AllocationContext, FiscalAllocation } from "./allocation-envelope.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const context: InitialSetupContext = {
  attemptId: "attempt1",
  binding: {
    module: "fiscal-verifactu",
    action: "setup",
    eventId: "event1",
    sourceId: "first-setup:attempt1",
    targetNodeId: TENANT_A.nodeId,
  },
  administratorId: "admin1",
  country: "ES",
  taxId: "89890001K",
  environment: "production",
  recipientVenueId: "first-setup:attempt1",
  bases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
};
const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = paperCustodianFingerprint(publicKey)!;
const trust = enrolPaperCustodian("Elena", publicKey, fingerprint)!;
const invalid = expect.objectContaining({ code: "sif.allocation_invalid" });

function fixture(scope: InitialSetupContext = context, serials = [1, 2]) {
  const selected = validateInitialPaperCandidates(scope, serials);
  const request = FISCAL_INITIAL_SETUP.request(scope, selected);
  const held = { ...scope, request };
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "Elena",
      generationId: "g1",
      blockId: "b1",
      packVersion: 1,
      recipientVenueId: scope.recipientVenueId,
      allocations: selected.candidates,
    },
    privateKey,
  );
  const approval = {
    version: 1 as const,
    eventId: scope.binding.eventId,
    operatorId: scope.administratorId,
    sourceId: scope.binding.sourceId,
    targetNodeId: scope.binding.targetNodeId,
    oldMachineAbsent: true,
    oldMachineOffline: false,
    noParallelRecovery: true,
    confirmedAt: "2026-10-15T08:00:00.000Z",
    incidentEvidence: "master/event1",
  };
  const consumption = signPaperConsumptionForBlock(
    block,
    selected.candidates[0]!.allocationId,
    {
      eventId: approval.eventId,
      operatorId: approval.operatorId,
      sourceId: approval.sourceId,
      targetNodeId: approval.targetNodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  const input = {
    allocation: {
      ...selected.candidates[0]!,
      reservationEvidence: { block, consumption },
    } satisfies FiscalAllocation,
    approval,
  };
  const current = {
    version: 1,
    allocationId: input.allocation.allocationId,
    binding: scope.binding,
    operatorId: scope.administratorId,
    priorActivation: "none",
    incidentEvidence: approval.incidentEvidence,
    requiredBases: scope.bases,
    recipientVenueId: scope.recipientVenueId,
    generationId: "g1",
    blockId: "b1",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  };
  return { selected, request, held, block, input, current };
}

async function commit(f: ReturnType<typeof fixture>) {
  const activationContext: AllocationContext = {
    taxpayerNif: f.held.taxId,
    softwareId: "W1",
    environment: "production",
    mode: "initial-setup",
    eventId: f.held.binding.eventId,
    sourceId: f.held.binding.sourceId,
    targetNodeId: f.held.binding.targetNodeId,
    operatorId: f.held.administratorId,
    incidentEvidence: f.input.approval.incidentEvidence,
    requiredBases: f.held.bases,
    priorActivation: "none",
    reauthentication: { operatorId: f.held.administratorId, eventId: f.held.binding.eventId },
    authority: {
      kind: "paper",
      trust,
      recipientVenueId: f.held.recipientVenueId,
      generationId: "g1",
      blockId: "b1",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    },
  };
  return withTransaction(suite.db, (tx) =>
    activateAllocation(
      tx,
      { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
      f.input.allocation,
      f.input.approval,
      activationContext,
    ),
  );
}

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "production" });
});

describe("first fiscal setup public contribution", () => {
  it("is connected to the provisioning descriptor", () => {
    expect(FISCAL_PROVISIONING.initialSetup).toBe(FISCAL_INITIAL_SETUP);
  });
  it("freezes exact host candidates and public bindings without issuing custody authority", () => {
    const f = fixture();
    expect(f.request).toEqual({
      version: 1,
      kind: "first-fiscal-setup",
      attemptId: "attempt1",
      binding: context.binding,
      operatorId: "admin1",
      recipientVenueId: "first-setup:attempt1",
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "production",
      requiredBases: context.bases,
      candidates: f.selected.candidates,
      candidateDigest: f.selected.candidateDigest,
    });
    const imported = FISCAL_INITIAL_SETUP.inspect(f.held, f.input);
    expect(imported.input).toEqual(f.input);
    expect(imported.summary).toEqual({
      allocationId: f.input.allocation.allocationId,
      installationIdentity: "S000001",
      series: f.input.allocation.series,
      custodianId: "Elena",
      generationId: "g1",
      blockId: "b1",
    });
    expect(Object.keys(imported)).toEqual(["input", "summary"]);
    expect(Object.isFrozen(imported)).toBe(true);
    expect(FISCAL_INITIAL_SETUP.candidates(context, { serials: [999999] })).toMatchObject({
      candidates: [{ installationIdentity: "S999999" }],
    });
  });
  it.each([null, [], { serials: [1], validated: true }, { serials: "1" }])(
    "refuses candidate proposals with untrusted fields %j",
    (proposal) => {
      expect(() => FISCAL_INITIAL_SETUP.candidates(context, proposal)).toThrowError(invalid);
    },
  );
  it.each(["trust", "currentRegisterConfirmed", "privateKey", "validated"])(
    "rejects embedded %s rather than enrolling or stripping it",
    (field) => {
      const f = fixture();
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, { ...f.input, [field]: "sentinel" }),
      ).toThrowError(invalid);
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, {
          ...f.input,
          allocation: { ...f.input.allocation, [field]: "sentinel" },
        }),
      ).toThrowError(invalid);
    },
  );
  it.each([null, [], {}, "secret-sentinel", { allocation: {} }])(
    "refuses malformed public input without echoing %j",
    (value) => {
      const f = fixture();
      expect(() => FISCAL_INITIAL_SETUP.inspect(f.held, value)).toThrowError(invalid);
      try {
        FISCAL_INITIAL_SETUP.inspect(f.held, value);
      } catch (error) {
        expect(JSON.stringify(error)).not.toContain("secret-sentinel");
      }
    },
  );
  it.each(["not-a-date", "2026-02-30T08:00:00.000Z", "2026-99-15T08:00:00.000Z", null])(
    "refuses malformed approval timestamp %j",
    (confirmedAt) => {
      const f = fixture();
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, {
          ...f.input,
          approval: { ...f.input.approval, confirmedAt },
        }),
      ).toThrowError(invalid);
    },
  );
  it.each([
    null,
    { payload: {} },
    { payload: {}, signature: "bad" },
    { payload: {}, signature: "A".repeat(85) + "B" },
  ])("refuses malformed signed objects %j", (signed) => {
    const f = fixture();
    const evidence = f.input.allocation.reservationEvidence as {
      block: unknown;
      consumption: unknown;
    };
    for (const key of ["block", "consumption"]) {
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, {
          ...f.input,
          allocation: {
            ...f.input.allocation,
            reservationEvidence: { ...evidence, [key]: signed },
          },
        }),
      ).toThrowError(invalid);
    }
  });
  it("refuses cyclic or oversize public input without value-bearing exceptions", () => {
    const f = fixture();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [cyclic, { secret: "s".repeat(65537) }])
      expect(() => FISCAL_INITIAL_SETUP.inspect(f.held, value)).toThrowError(invalid);
  });
  it("requires the host's frozen request and refuses another attempt's request", () => {
    const f = fixture();
    expect(() => FISCAL_INITIAL_SETUP.inspect(context, f.input)).toThrowError(invalid);
    expect(() =>
      FISCAL_INITIAL_SETUP.inspect({ ...f.held, attemptId: "different" }, f.input),
    ).toThrowError(invalid);
    expect(() =>
      FISCAL_INITIAL_SETUP.inspect(
        { ...f.held, request: { ...(f.request as object), validated: true } },
        f.input,
      ),
    ).toThrowError(invalid);
  });
  it("rejects a re-signed alternate block rather than trusting its valid signatures", () => {
    const f = fixture();
    const other = fixture();
    expect(() => FISCAL_INITIAL_SETUP.inspect(f.held, other.input)).toThrowError(invalid);
    const partial = signPaperBlock(
      { ...f.block.payload, allocations: [f.selected.candidates[0]!] },
      privateKey,
    );
    const partialConsumption = signPaperConsumptionForBlock(
      partial,
      f.input.allocation.allocationId,
      {
        eventId: f.input.approval.eventId,
        operatorId: f.input.approval.operatorId,
        sourceId: f.input.approval.sourceId,
        targetNodeId: f.input.approval.targetNodeId,
        incidentEvidence: f.input.approval.incidentEvidence,
        consumedAt: f.input.approval.confirmedAt,
      },
      privateKey,
    );
    expect(() =>
      FISCAL_INITIAL_SETUP.inspect(f.held, {
        ...f.input,
        allocation: {
          ...f.input.allocation,
          reservationEvidence: {
            consumption: partialConsumption,
            block: partial,
          },
        },
      }),
    ).toThrowError(invalid);
  });
  it.each(["eventId", "sourceId", "targetNodeId", "operatorId", "incidentEvidence"])(
    "refuses changed approval %s",
    (field) => {
      const f = fixture();
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, {
          ...f.input,
          approval: { ...f.input.approval, [field]: "changed" },
        }),
      ).toThrowError(invalid);
    },
  );
  it.each(["oldMachineAbsent", "oldMachineOffline", "noParallelRecovery"])(
    "refuses changed setup condition %s",
    (field) => {
      const f = fixture();
      expect(() =>
        FISCAL_INITIAL_SETUP.inspect(f.held, {
          ...f.input,
          approval: {
            ...f.input.approval,
            [field]: !f.input.approval[field as keyof typeof f.input.approval],
          },
        }),
      ).toThrowError(invalid);
    },
  );
  it("enrols only a separately compared full public fingerprint", () => {
    expect(FISCAL_INITIAL_SETUP.enrol(context, trust, fingerprint)).toEqual(trust);
    expect(() => FISCAL_INITIAL_SETUP.enrol(context, trust, fingerprint.slice(0, 12))).toThrowError(
      invalid,
    );
    expect(() =>
      FISCAL_INITIAL_SETUP.enrol(context, { ...trust, privateKey: "sentinel" }, fingerprint),
    ).toThrowError(invalid);
  });
  it("checks signatures only with separately enrolled trust and the exact fresh statement", () => {
    const f = fixture();
    const imported = FISCAL_INITIAL_SETUP.inspect(f.held, f.input);
    expect(
      FISCAL_INITIAL_SETUP.confirmation(f.held, imported, { trust, current: f.current }),
    ).toEqual(f.current);
    expect(() => FISCAL_INITIAL_SETUP.confirmation(f.held, imported, f.current)).toThrowError(
      invalid,
    );
    for (const field of [
      "allocationId",
      "operatorId",
      "recipientVenueId",
      "generationId",
      "blockId",
      "incidentEvidence",
      "binding",
      "requiredBases",
      "consumptionConfirmed",
      "currentRegisterConfirmed",
      "currentEntryState",
      "priorActivation",
    ]) {
      expect(() =>
        FISCAL_INITIAL_SETUP.confirmation(f.held, imported, {
          trust,
          current: { ...f.current, [field]: "changed" },
        }),
      ).toThrowError(invalid);
    }
    const broken = structuredClone(f.input);
    const evidence = f.input.allocation.reservationEvidence as {
      consumption: { payload: PaperConsumption; signature: string };
    };
    broken.allocation.reservationEvidence = {
      block: f.block,
      consumption: {
        ...evidence.consumption,
        signature:
          (evidence.consumption.signature[0] === "A" ? "B" : "A") +
          evidence.consumption.signature.slice(1),
      },
    };
    expect(() =>
      FISCAL_INITIAL_SETUP.confirmation(
        f.held,
        { input: broken, summary: imported.summary },
        { trust, current: f.current },
      ),
    ).toThrowError(invalid);
  });
  it("reads the actual matching activation without activating or accepting a marker as a result", async () => {
    const f = fixture();
    expect(await FISCAL_INITIAL_SETUP.committed(suite.db, f.held, f.input)).toBeNull();
    const result = await commit(f);
    expect(await FISCAL_INITIAL_SETUP.committed(suite.db, f.held, f.input)).toEqual(result);
    const rows = await suite.db
      .select()
      .from(fiscalAllocations)
      .where(eq(fiscalAllocations.eventKey, context.binding.eventId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.result).toEqual(result);
    await expect(
      FISCAL_INITIAL_SETUP.committed(suite.db, f.held, {
        ...f.input,
        approval: { ...f.input.approval, confirmedAt: "2026-10-15T09:00:00.000Z" },
      }),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  });
  it("refuses an earlier matching event after another activation superseded it", async () => {
    const f = fixture();
    await commit(f);
    const nextScope = {
      ...context,
      attemptId: "attempt2",
      binding: { ...context.binding, eventId: "event2", sourceId: "first-setup:attempt2" },
      recipientVenueId: "first-setup:attempt2",
    };
    const next = fixture(nextScope, [3]);
    await commit(next);
    await expect(FISCAL_INITIAL_SETUP.committed(suite.db, f.held, f.input)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
    });
    expect(await FISCAL_INITIAL_SETUP.committed(suite.db, next.held, next.input)).toMatchObject({
      activationEventId: "event2",
    });
  });
});

it("the launch-configured collector activates a setup from independently bound host evidence", async () => {
  const { withOperationAuthority } = await import("@waitron/module");
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const { activatePreparedModuleAllocation } = await import("./allocation-preparation.js");
  const f = fixture();
  const operations = FISCAL_OPERATIONS.configure!({
    environment: {},
    readPublicEvidence: async () => ({ trust, current: f.current }),
  });
  const result = await withOperationAuthority(
    context.binding,
    context.administratorId,
    (authority) =>
      operations.prepare({ binding: context.binding, authority, input: f.input }, (prepared) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
            prepared,
          ),
        ),
      ),
  );
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-S000001", purpose: "standard" },
    { code: "FF-S000001", purpose: "full" },
    { code: "R-S000001", purpose: "rectificative" },
  ]);
  expect((await suite.db.select().from(fiscalAllocations))[0]?.allocation).toEqual(
    f.input.allocation,
  );
});
it("a claimed setup with no live host grant cannot fall back to valid configured paper files", async () => {
  const { withOperationAuthority } = await import("@waitron/module");
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "claimed-no-fallback-"));
  try {
    const f = fixture();
    const publicFile = join(dir, "public.json"),
      currentFile = join(dir, "current.json");
    await writeFile(publicFile, JSON.stringify(trust));
    await writeFile(currentFile, JSON.stringify(f.current));
    const operations = FISCAL_OPERATIONS.configure!({
      environment: {
        WAITRON_FISCAL_CUSTODIAN_FILE: publicFile,
        WAITRON_FISCAL_CONFIRMATION_FILE: currentFile,
        WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: fingerprint,
      },
      readPublicEvidence: async () => undefined,
    });
    await expect(
      withOperationAuthority(context.binding, context.administratorId, (authority) =>
        operations.prepare(
          { binding: context.binding, authority, input: f.input },
          async () => "admitted",
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("refuses a declared public fingerprint that disagrees with the independently compared key", () => {
  const declared = (fingerprint.startsWith("0") ? "1" : "0") + fingerprint.slice(1);
  expect(() =>
    FISCAL_INITIAL_SETUP.enrol(context, { ...trust, fingerprint: declared }, fingerprint),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_untrusted" },
    }),
  );
});
