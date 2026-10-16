import { createHash } from "node:crypto";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationInput } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { ALLOCATED_FISCAL_STANDBY } from "./allocated-standby.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { createDeclaredPaperPreparation } from "./declared-paper-preparation.js";
import { declaredHistoryBytes } from "./paper-register-history.js";
import type { DeclaredRegisterHistory, DeclaredReservation } from "./paper-register-protocol.js";
import { validatePaperCandidates } from "./initial-paper-candidates.js";
import { fiscalReservations } from "./schema/reservations.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { createDeclaredPaperStandbyPreparation } from "./declared-paper-standby.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
  target = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const time = "2026-10-16T00:00:00.000Z";
const digest = (v: unknown) => createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
function fixture(serial = 43) {
  const binding = {
    module: "fiscal-verifactu",
    action: "reserve",
    eventId: `join-${serial}`,
    sourceId: primary.nodeId,
    targetNodeId: target.nodeId,
  };
  const scope = {
    taxpayerNif: "89890001K",
    softwareId: "W1",
    environment: "preproduction" as const,
  };
  const candidate = validatePaperCandidates(
    {
      attemptId: `join-${serial}`,
      binding,
      administratorId: "manager",
      country: "ES",
      taxId: scope.taxpayerNif,
      environment: scope.environment,
      recipientVenueId: "venue",
      bases,
    },
    "P",
    [serial],
  ).candidates[0]!;
  const reservation: DeclaredReservation = {
    kind: "reserve",
    allocation: candidate,
    binding,
    recipientVenueId: "venue",
    reservedAt: time,
  };
  const history: DeclaredRegisterHistory = {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    registerId: `register-${serial}`,
    scope,
    mode: "complete",
    originals: [],
    revisions: [
      {
        version: 2,
        registerId: `register-${serial}`,
        scope,
        revision: "1",
        previousDigest: "0".repeat(64),
        createdAt: time,
        sHighWater: 0,
        pHighWater: serial,
        events: [reservation],
      },
    ],
  };
  const input = {
    kind: "paper-declared-reservation",
    version: 2,
    reservation,
    reservationDigest: digest(reservation),
    historyDigest: digest(history),
  };
  const known = {
    scope,
    sHighWater: 0,
    pHighWater: 0,
    sBurnFloor: 0,
    pBurnFloor: 0,
    currentHead: null,
    retainedHeads: [],
    originals: [],
    retiredBindings: [],
  };
  const facts = {
    kind: "paper-declared-standby-confirmation",
    version: 2,
    binding,
    operatorId: "manager",
    input,
    history,
    known,
    current: { currentRegisterConfirmed: true, noParallelPaperAllocation: true, confirmedAt: time },
    delivery: { kept: true, documentDigest: "a".repeat(64), historyDigest: digest(history) },
  };
  return { binding, candidate, reservation, history, input, facts };
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db.insert(invoiceSeries).values(bases.map((b) => ({ ...b, nodeId: primary.nodeId })));
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, { nodeId: primary.nodeId, nif: "89890001K", idSistemaInformatico: "W1" }),
  );
});
async function prepare(
  f = fixture(),
  action = "reserve",
  change?: (facts: ReturnType<typeof fixture>["facts"]) => void,
) {
  const binding = { ...f.binding, action };
  return withOperationAuthority(binding, "manager", (authority) =>
    createDeclaredPaperStandbyPreparation(async () => {
      const facts = structuredClone({ ...f.facts, binding });
      change?.(facts);
      return facts;
    }).prepare({ binding, authority, input: f.input }, (op) =>
      withTransaction<unknown>(suite.db, (tx) =>
        action === "reserve"
          ? ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)
          : ALLOCATED_FISCAL_STANDBY.establish!(tx, target, { version: 1, evidence: f.input }, op),
      ),
    ),
  );
}
it("reserves and establishes exact unsigned dormant evidence without active fiscal writes", async () => {
  const f = fixture();
  expect(await prepare(f)).toEqual({ state: { version: 1, evidence: f.input } });
  await prepare(f, "establish");
  await prepare(f, "establish");
  const rows = await suite.db.select().from(fiscalReservations);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    eventKey: "join-43",
    installationIdentity: "P000043",
    evidence: f.input,
    bases,
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it.each([
  "floor",
  "operator",
  "input",
  "history",
  "current",
  "kept",
  "digest",
  "known",
  "retired",
  "source",
  "target",
  "action",
])("refuses unsigned standby %s before persistence", async (why) => {
  const f = fixture();
  await expect(
    prepare(f, "establish", (facts) => {
      if (why === "floor") facts.known.pBurnFloor = 43;
      if (why === "operator") facts.operatorId = "other";
      if (why === "input") facts.input.reservationDigest = "b".repeat(64);
      if (why === "history") Object.assign(facts.history, { revisions: [] });
      if (why === "current") facts.current.currentRegisterConfirmed = false;
      if (why === "kept") facts.delivery.kept = false;
      if (why === "digest") facts.delivery.historyDigest = "b".repeat(64);
      if (why === "known") Object.assign(facts.known, { extra: true });
      if (why === "retired") Object.assign(facts.known, { retiredBindings: [f.binding] });
      if (why === "source") Object.assign(facts.binding, { sourceId: "other" });
      if (why === "target") Object.assign(facts.binding, { targetNodeId: "other" });
      if (why === "action") facts.binding.action = "promote";
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
});
it("JSON cannot fabricate or retain standby preparation authority", async () => {
  const f = fixture();
  await expect(
    createDeclaredPaperStandbyPreparation(async () => f.facts).prepare(
      { binding: f.binding, authority: {} as never, input: f.input },
      async () => "unauthorised",
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  await withOperationAuthority(f.binding, "manager", async (authority) => {
    let captured: ModuleOperationInput | undefined;
    await createDeclaredPaperStandbyPreparation(async () => f.facts).prepare(
      { binding: f.binding, authority, input: f.input },
      async (op) => {
        captured = op;
      },
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, captured),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
});
function consumption(f: ReturnType<typeof fixture>) {
  const binding = { ...f.binding, action: "promote", eventId: "promote-43" },
    operator = { kind: "recovery-key" as const, nodeId: target.nodeId, eventId: "promote-43" };
  const consumed = {
    kind: "consume" as const,
    allocationId: f.candidate.allocationId,
    reservationDigest: f.input.reservationDigest,
    eventId: binding.eventId,
    operatorId: operator,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    incidentEvidence: "public/promotion",
    consumedAt: time,
  };
  const history = {
    ...f.history,
    revisions: [
      ...f.history.revisions,
      {
        ...f.history.revisions[0]!,
        revision: "2",
        previousDigest: digest(f.history.revisions[0]!),
        events: [consumed],
      },
    ],
  };
  const input = {
    allocation: {
      ...f.candidate,
      reservationEvidence: {
        kind: "paper-declared-evidence",
        version: 2,
        historyDigest: digest(history),
        reservation: f.reservation,
        consumption: consumed,
        reservationDigest: f.input.reservationDigest,
        consumptionDigest: digest(consumed),
      },
    },
    approval: {
      version: 1,
      eventId: binding.eventId,
      operatorId: operator,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      oldMachineOffline: true,
      oldMachineAbsent: false,
      noParallelRecovery: true,
      confirmedAt: time,
      incidentEvidence: consumed.incidentEvidence,
    },
  };
  const facts = {
    kind: "paper-declared-confirmation",
    version: 2,
    binding,
    operatorId: operator,
    input,
    history,
    known: { ...f.facts.known, history: f.history },
    current: f.facts.current,
    recipientVenueId: "venue",
    requiredBases: bases,
    priorActivation: "none",
    phase: "activate",
    delivery: { kept: true, documentDigest: "a".repeat(64), historyDigest: digest(history) },
  };
  return { binding, operator, input, facts };
}
async function promote(
  f = fixture(),
  change?: (facts: ReturnType<typeof consumption>["facts"]) => void,
) {
  const p = consumption(f);
  return withOperationAuthority(p.binding, p.operator, (authority) =>
    createDeclaredPaperPreparation(async () => {
      const facts = structuredClone(p.facts);
      change?.(facts);
      return facts;
    }).prepare(
      {
        binding: p.binding,
        authority,
        input: { ...p.input, reservationEventId: f.binding.eventId },
      },
      (op) => withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, target, op)),
    ),
  );
}
it("promotes the exact retained unsigned reservation with fresh current consumption", async () => {
  const f = fixture();
  await prepare(f, "establish");
  const result = await promote(f);
  expect(result.series.map((x) => x.code)).toEqual(["A-P000043", "FF-P000043", "R-P000043"]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
it("known burn floors still refuse promotion of an unsigned dormant reservation", async () => {
  const f = fixture();
  await prepare(f, "establish");
  await expect(
    promote(f, (facts) => {
      facts.known.pBurnFloor = 43;
    }),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it("fresh consumption cannot promote an unretained unsigned reservation", async () => {
  await expect(promote()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it("history distinguishes standby reservation from its later authenticated promotion", async () => {
  const { projectDeclaredHistory } = await import("./paper-register-history.js");
  const f = fixture(),
    p = consumption(f);
  expect(() => projectDeclaredHistory(p.facts.history, p.facts.known)).not.toThrow();
  const history = structuredClone(p.facts.history);
  Object.assign(history.revisions[0]!.events[0]!, { binding: { ...f.binding, action: "restore" } });
  await expect(
    Promise.resolve().then(() => projectDeclaredHistory(history, p.facts.known)),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
});
it("refuses a damaged retained reservation even with fresh valid consumed history", async () => {
  const f = fixture();
  await suite.db.insert(fiscalReservations).values({
    eventKey: f.binding.eventId,
    allocationKey: f.candidate.allocationId,
    nodeId: target.nodeId,
    sourceNodeId: primary.nodeId,
    taxpayerNif: f.candidate.taxpayerNif,
    softwareId: "W1",
    environment: "preproduction",
    installationIdentity: f.candidate.installationIdentity,
    evidence: { ...f.input, reservationDigest: "b".repeat(64) },
    bases,
  });
  await expect(promote(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_untrusted" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});
it("the venue's complete bases bound unsigned standby reservation", async () => {
  const { eq } = await import("drizzle-orm");
  await suite.db.update(invoiceSeries).set({ code: "OTHER" }).where(eq(invoiceSeries.code, "A"));
  await expect(prepare()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
});
it("the actual configured standby seat uses explicit unsigned host facts", async () => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const f = fixture();
  const preparation = FISCAL_OPERATIONS.configure!({
    environment: {},
    readPublicEvidence: async () => ({ trust: null, current: f.facts }),
  });
  const result = await withOperationAuthority(f.binding, "manager", (authority) =>
    preparation.prepare({ binding: f.binding, authority, input: f.input }, (op) =>
      withTransaction(suite.db, (tx) => ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)),
    ),
  );
  expect(result).toEqual({ state: { version: 1, evidence: f.input } });
});
it("an unsigned standby upload cannot fall back to legacy file authority", async () => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const f = fixture();
  const preparation = FISCAL_OPERATIONS.configure!({
    environment: {
      WAITRON_FISCAL_CUSTODIAN_FILE: "/must-not-read",
      WAITRON_FISCAL_CONFIRMATION_FILE: "/must-not-read",
      WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: "0".repeat(64),
    },
    readPublicEvidence: async () => undefined,
  });
  await expect(
    withOperationAuthority(f.binding, "manager", (authority) =>
      preparation.prepare(
        { binding: f.binding, authority, input: f.input },
        async () => "fallback",
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});
it("changing the caller's authority cannot replace the expired authority that began standby preparation", async () => {
  const f = fixture();
  let release!: () => void, reading!: () => void;
  const waiting = new Promise<void>((r) => {
      release = r;
    }),
    reached = new Promise<void>((r) => {
      reading = r;
    });
  let pending!: Promise<unknown>, operation!: ModuleOperationInput;
  await withOperationAuthority(f.binding, "manager", async (authority) => {
    operation = { binding: f.binding, authority, input: f.input };
    pending = createDeclaredPaperStandbyPreparation(async () => {
      reading();
      await waiting;
      return f.facts;
    }).prepare(operation, (op) =>
      withTransaction(suite.db, (tx) => ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)),
    );
    await reached;
  });
  await withOperationAuthority(f.binding, "another manager", async (authority) => {
    Object.assign(operation, { authority });
    release();
    await expect(pending).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
  });
  expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
});
it("a freshly confirmed committed unsigned promotion returns the exact result without a second activation", async () => {
  const f = fixture();
  await prepare(f, "establish");
  const first = await promote(f);
  const replay = await promote(f, (facts) => {
    facts.priorActivation = "committed";
  });
  expect(replay).toEqual(first);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

function retiredSetup(prefix: "S" | "P", floor: number) {
  const f = fixture();
  const scope = f.facts.history.scope;
  const history = {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    registerId: "retired-register",
    scope,
    mode: "checkpoint",
    originals: [],
    revisions: [],
    checkpoint: {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "retired-42",
      scope,
      sHighWater: prefix === "S" ? floor : 0,
      pHighWater: prefix === "P" ? floor : 0,
      current: f.facts.current,
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: time,
    },
  };
  return {
    context: {
      attemptId: "old-setup",
      binding: {
        module: "fiscal-verifactu",
        action: "setup",
        eventId: "old-setup-event",
        sourceId: "first-setup:old-setup",
        targetNodeId: "old-setup-node",
      },
      administratorId: "old-admin",
      country: "ES",
      taxId: scope.taxpayerNif,
      environment: scope.environment,
      recipientVenueId: "first-setup:old-setup",
      bases,
    },
    input: undefined,
    publicEvidence: [{ knownHistory: history }],
  };
}
it.each(
  ["reserve", "establish", "promote"].flatMap((action) =>
    [41, 42, 43].map((serial) => [action, serial] as const),
  ),
)("configured unsigned %s checks serial %s against retired public P42", async (action, serial) => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  {
    const f = fixture(serial);
    const p = consumption(f);
    if (action === "promote") await prepare(f, "establish");
    const binding = action === "promote" ? p.binding : { ...f.binding, action };
    const input =
      action === "promote" ? { ...p.input, reservationEventId: f.binding.eventId } : f.input;
    const current = action === "promote" ? p.facts : { ...f.facts, binding };
    const preparation = FISCAL_OPERATIONS.configure!({
      environment: {},
      readPublicEvidence: async () => ({ trust: null, current }),
      readRetiredSetup: async () => [retiredSetup("P", 42)],
    });
    const run = () =>
      withOperationAuthority(binding, action === "promote" ? p.operator : "manager", (authority) =>
        preparation.prepare({ binding, authority, input }, (op) =>
          withTransaction<unknown>(suite.db, (tx) =>
            action === "reserve"
              ? ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)
              : action === "establish"
                ? ALLOCATED_FISCAL_STANDBY.establish!(
                    tx,
                    target,
                    { version: 1, evidence: f.input },
                    op,
                  )
                : activatePreparedModuleAllocation(tx, target, op),
          ),
        ),
      );
    if (serial <= 42) {
      await expect(run()).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "reservation_mismatch" },
      });
      expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
      if (action !== "promote")
        expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
    } else {
      const result = await run();
      if (action === "reserve")
        expect(result).toEqual({ state: { version: 1, evidence: f.input } });
      else if (action === "promote")
        expect((result as { series: { code: string }[] }).series.map((s) => s.code)).toEqual([
          "A-P000043",
          "FF-P000043",
          "R-P000043",
        ]);
    }
  }
});

it.each(["eventId", "targetNodeId"] as const)(
  "a fresh P43 allocation cannot reuse the retired setup %s",
  async (field) => {
    const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
    const f = fixture(),
      retired = retiredSetup("P", 42);
    retired.context.binding[field] = f.binding[field];
    const preparation = FISCAL_OPERATIONS.configure!({
      environment: {},
      readPublicEvidence: async () => ({ trust: null, current: f.facts }),
      readRetiredSetup: async () => [retired],
    });
    await expect(
      withOperationAuthority(f.binding, "manager", (authority) =>
        preparation.prepare({ binding: f.binding, authority, input: f.input }, (op) =>
          withTransaction(suite.db, (tx) =>
            ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op),
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
  },
);

it("retirement checks preserve the domain refusal for a malformed signed block", async () => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const f = fixture();
  const preparation = FISCAL_OPERATIONS.configure!({
    environment: {},
    readPublicEvidence: async () => undefined,
    readRetiredSetup: async () => [retiredSetup("P", 42)],
  });
  await expect(
    withOperationAuthority(f.binding, "manager", (authority) =>
      preparation.prepare(
        {
          binding: f.binding,
          authority,
          input: {
            block: { payload: { allocations: [null] } },
            reservation: { payload: { allocationId: "x" } },
          },
        },
        async () => "must refuse",
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});

it("retirement reads preserve the input that began preparation across caller mutation", async () => {
  const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
  const f = fixture(),
    current = structuredClone(f.facts);
  let reached!: () => void, release!: () => void;
  const reading = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const preparation = FISCAL_OPERATIONS.configure!({
    environment: {},
    readPublicEvidence: async () => ({ trust: null, current }),
    readRetiredSetup: async () => {
      reached();
      await waiting;
      return [retiredSetup("P", 42)];
    },
  });
  const result = await withOperationAuthority(f.binding, "manager", async (authority) => {
    const pending = preparation.prepare({ binding: f.binding, authority, input: f.input }, (op) =>
      withTransaction(suite.db, (tx) => ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op)),
    );
    await reading;
    Object.assign(f.input, fixture(41).input);
    release();
    return pending;
  });
  expect(result).toEqual({ state: { version: 1, evidence: current.input } });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["symbol", "non-enumerable", "function"])(
  "the asynchronous retirement snapshot cannot discard an input's forbidden %s field",
  async (which) => {
    const { FISCAL_OPERATIONS } = await import("./allocation-configuration.js");
    const f = fixture(),
      current = structuredClone(f.facts);
    Object.defineProperty(f.input, which === "symbol" ? Symbol("injected") : "injected", {
      value: which === "function" ? () => true : true,
      enumerable: which !== "non-enumerable",
    });
    const preparation = FISCAL_OPERATIONS.configure!({
      environment: {},
      readPublicEvidence: async () => ({ trust: null, current }),
      readRetiredSetup: async () => [retiredSetup("P", 42)],
    });
    await expect(
      withOperationAuthority(f.binding, "manager", (authority) =>
        preparation.prepare({ binding: f.binding, authority, input: f.input }, (op) =>
          withTransaction(suite.db, (tx) =>
            ALLOCATED_FISCAL_STANDBY.reserve!(tx, primary, target, op),
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await suite.db.select().from(fiscalReservations)).toEqual([]);
  },
);
