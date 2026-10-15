import { createHash, generateKeyPairSync } from "node:crypto";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  configureModuleOperations,
  withOperationAuthority,
  withPreparedModuleOperations,
  type InitialSetupContext,
  type ModuleOperationHost,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { activateModuleAllocation } from "./allocation-operation.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { FISCAL_INITIAL_SETUP } from "./initial-setup.js";
import { validatePaperCandidates } from "./initial-paper-candidates.js";
import { declaredHistoryBytes } from "./paper-register-history.js";
import type { DeclaredReservation, DeclaredRegisterHistory } from "./paper-register-protocol.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import type { AllocationContext } from "./allocation-envelope.js";
import { validateAllocationEnvelope } from "./allocation-envelope.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";

const load = () => import("./declared-paper-preparation.js");
const admission = () => import("./declared-paper-evidence.js");
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const time = "2026-10-16T00:00:00.000Z";
const bases = [
  { code: "A", purpose: "standard" },
  { code: "B", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const digest = (v: unknown) => createHash("sha256").update(declaredHistoryBytes(v)).digest("hex");
const invalid = expect.objectContaining({ code: "sif.allocation_invalid" });

function fixture(prefix: "S" | "P" = "S") {
  const binding = {
    module: "fiscal-verifactu",
    action: prefix === "S" ? "setup" : "restore",
    eventId: "declared-event",
    sourceId: prefix === "S" ? "first-setup:declared-attempt" : "backup-42",
    targetNodeId: node.nodeId,
  };
  const operator =
    prefix === "S"
      ? "administrator"
      : {
          kind: "recovery-key" as const,
          nodeId: node.nodeId,
          eventId: binding.eventId,
        };
  const context: InitialSetupContext = {
    attemptId: "declared-attempt",
    binding,
    administratorId: "administrator",
    country: "ES",
    taxId: "89890001K",
    environment: "preproduction",
    recipientVenueId: binding.sourceId,
    bases,
  };
  const selected = validatePaperCandidates(context, prefix, [43]);
  const candidate = selected.candidates[0]!;
  const reservation: DeclaredReservation = {
    kind: "reserve",
    allocation: candidate,
    recipientVenueId: context.recipientVenueId,
    binding,
    reservedAt: time,
  };
  const consumption = {
    kind: "consume" as const,
    allocationId: candidate.allocationId,
    reservationDigest: digest(reservation),
    eventId: binding.eventId,
    operatorId: operator,
    sourceId: binding.sourceId,
    targetNodeId: binding.targetNodeId,
    incidentEvidence: "public/declared-event",
    consumedAt: time,
  };
  const history: DeclaredRegisterHistory = {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    scope: { taxpayerNif: context.taxId, softwareId: "W1", environment: context.environment },
    registerId: "register-43",
    mode: "complete",
    originals: [],
    revisions: [
      {
        version: 2,
        registerId: "register-43",
        scope: { taxpayerNif: context.taxId, softwareId: "W1", environment: context.environment },
        revision: "1",
        previousDigest: "0".repeat(64),
        createdAt: time,
        sHighWater: prefix === "S" ? 43 : 0,
        pHighWater: prefix === "P" ? 43 : 0,
        events: [reservation, consumption],
      },
    ],
  };
  const input = {
    allocation: {
      ...candidate,
      reservationEvidence: {
        kind: "paper-declared-evidence",
        version: 2,
        historyDigest: digest(history),
        reservation,
        consumption,
        reservationDigest: digest(reservation),
        consumptionDigest: digest(consumption),
      },
    },
    approval: {
      version: 1 as const,
      eventId: binding.eventId,
      operatorId: operator,
      sourceId: binding.sourceId,
      targetNodeId: binding.targetNodeId,
      oldMachineOffline: prefix === "P",
      oldMachineAbsent: prefix === "S",
      noParallelRecovery: true,
      confirmedAt: time,
      incidentEvidence: consumption.incidentEvidence,
    },
  };
  const facts = {
    kind: "paper-declared-confirmation" as const,
    version: 2 as const,
    binding,
    operatorId: operator,
    input,
    history,
    known: {
      scope: history.scope,
      sHighWater: 0,
      pHighWater: 0,
      sBurnFloor: 0,
      pBurnFloor: 0,
      currentHead: null,
      retainedHeads: [],
      originals: [],
      retiredBindings: [],
    },
    current: {
      currentRegisterConfirmed: true as const,
      noParallelPaperAllocation: true as const,
      confirmedAt: time,
    },
    recipientVenueId: context.recipientVenueId,
    requiredBases: bases,
    priorActivation: "none" as const,
    phase: "activate" as const,
    delivery: {
      kept: true as const,
      documentDigest: "a".repeat(64),
      historyDigest: digest(history),
    },
  };
  return { binding, operator, context, selected, input, facts };
}
type Fixture = ReturnType<typeof fixture>;

beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: node.nodeId })));
});

async function attempt(f = fixture(), change?: (value: Fixture["facts"]) => void) {
  const api = await load();
  return withOperationAuthority(f.binding, f.operator, (authority) =>
    api
      .createDeclaredPaperPreparation(async () => {
        const facts = structuredClone(f.facts);
        change?.(facts);
        return facts;
      })
      .prepare({ binding: f.binding, authority, input: f.input }, (prepared) =>
        withTransaction(suite.db, (tx) => activatePreparedModuleAllocation(tx, node, prepared)),
      ),
  );
}
async function noWrites() {
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect((await suite.db.select().from(invoiceSeries)).map((x) => x.code)).toEqual([
    "A",
    "B",
    "FF",
    "R",
  ]);
}

it.each(["S", "P"] as const)(
  "activates unsigned %s through real preparation and the unchanged writer",
  async (prefix) => {
    const f = fixture(prefix),
      result = await attempt(f);
    expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
      { code: `A-${prefix}000043`, purpose: "standard" },
      { code: `B-${prefix}000043`, purpose: "standard" },
      { code: `FF-${prefix}000043`, purpose: "full" },
      { code: `R-${prefix}000043`, purpose: "rectificative" },
    ]);
    const [retained] = await suite.db.select().from(fiscalAllocations);
    expect(retained?.allocation).toEqual(f.input.allocation);
    expect(retained?.approval).toEqual(f.input.approval);
    expect(retained?.result).toEqual(result);
  },
);

it.each([
  [
    "scope",
    (x: Fixture["facts"]) => {
      Object.assign(x.history.scope, { taxpayerNif: "B12345674" });
    },
  ],
  [
    "environment",
    (x: Fixture["facts"]) => {
      Object.assign(x.history.scope, { environment: "production" });
    },
  ],
  [
    "operator",
    (x: Fixture["facts"]) => {
      x.operatorId = "other";
    },
  ],
  [
    "source",
    (x: Fixture["facts"]) => {
      x.binding.sourceId = "other";
    },
  ],
  [
    "target",
    (x: Fixture["facts"]) => {
      Object.assign(x.binding, { targetNodeId: "other" });
    },
  ],
  [
    "full purpose",
    (x: Fixture["facts"]) => {
      x.requiredBases = bases.filter((b) => b.purpose !== "full");
    },
  ],
  [
    "second standard base",
    (x: Fixture["facts"]) => {
      x.requiredBases = bases.filter((b) => b.code !== "B");
    },
  ],
  [
    "declaration",
    (x: Fixture["facts"]) => {
      Object.assign(x.current, { currentRegisterConfirmed: false });
    },
  ],
  [
    "parallel declaration",
    (x: Fixture["facts"]) => {
      Object.assign(x.current, { noParallelPaperAllocation: false });
    },
  ],
  [
    "delivery",
    (x: Fixture["facts"]) => {
      Object.assign(x.delivery, { kept: false });
    },
  ],
  [
    "delivery history",
    (x: Fixture["facts"]) => {
      x.delivery.historyDigest = "b".repeat(64);
    },
  ],
  [
    "phase",
    (x: Fixture["facts"]) => {
      Object.assign(x, { phase: "retired" });
    },
  ],
  [
    "known floor",
    (x: Fixture["facts"]) => {
      x.known.sBurnFloor = 43;
    },
  ],
  [
    "retired binding",
    (x: Fixture["facts"]) => {
      Object.assign(x.known, { retiredBindings: [x.binding] });
    },
  ],
  [
    "unknown fact",
    (x: Fixture["facts"]) => {
      Object.assign(x, { validated: true });
    },
  ],
  [
    "reservation digest",
    (x: Fixture["facts"]) => {
      x.input.allocation.reservationEvidence.reservationDigest = "b".repeat(64);
    },
  ],
  [
    "consumption digest",
    (x: Fixture["facts"]) => {
      x.input.allocation.reservationEvidence.consumptionDigest = "b".repeat(64);
    },
  ],
  [
    "history digest",
    (x: Fixture["facts"]) => {
      x.input.allocation.reservationEvidence.historyDigest = "b".repeat(64);
    },
  ],
  [
    "recipient",
    (x: Fixture["facts"]) => {
      x.recipientVenueId = "different venue";
    },
  ],
] as const)("refuses changed %s before writing fiscal state", async (_name, change) => {
  await expect(attempt(fixture(), change)).rejects.toThrowError(invalid);
  await noWrites();
});

it("dispatches explicit unsigned host facts through the actual configured module seat", async () => {
  const f = fixture();
  const modules = configureModuleOperations(
    [fakeModule(f.binding.module, { operations: FISCAL_OPERATIONS })],
    {
      environment: {},
      readPublicEvidence: async () => ({ trust: null, current: f.facts }),
    },
  );
  const result = await withOperationAuthority(f.binding, f.operator, (authority) =>
    withPreparedModuleOperations(
      modules,
      new Map([[f.binding.module, { binding: f.binding, authority, input: f.input }]]),
      node.nodeId,
      "setup",
      (ready) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(tx, node, ready.get(f.binding.module)!),
        ),
    ),
  );
  expect(result.series.map((s) => s.code)).toEqual([
    "A-S000043",
    "B-S000043",
    "FF-S000043",
    "R-S000043",
  ]);
});

it("public inspection and confirmation accept the explicit format without custody enrolment", async () => {
  const f = fixture(),
    context = { ...f.context, request: FISCAL_INITIAL_SETUP.request(f.context, f.selected) };
  const imported = FISCAL_INITIAL_SETUP.inspect(context, f.input);
  expect(imported.summary).toMatchObject({
    integrity: "owner-declared",
    installationIdentity: "S000043",
  });
  expect(FISCAL_INITIAL_SETUP.confirmation(context, imported, f.facts)).toEqual(f.facts);
  expect(
    await withTransaction(suite.db, (tx) => FISCAL_INITIAL_SETUP.committed(tx, context, f.input)),
  ).toBeNull();
  const result = await attempt(f);
  expect(
    await withTransaction(suite.db, (tx) => FISCAL_INITIAL_SETUP.committed(tx, context, f.input)),
  ).toEqual(result);
});

it.each(["copied", "cloned", "forged", "expired"])(
  "refuses a %s admission token while keeping the real token usable",
  async (mode) => {
    const f = fixture(),
      api = await admission();
    await withOperationAuthority(f.binding, f.operator, async (authority) => {
      const operation = { binding: f.binding, authority, input: f.input };
      let expired: object;
      await api.withDeclaredPaperAdmission({ operation, facts: f.facts }, async (token) => {
        expired = token;
      });
      await api.withDeclaredPaperAdmission({ operation, facts: f.facts }, async (token) => {
        const wrong =
          mode === "expired"
            ? expired!
            : mode === "forged"
              ? { validated: true }
              : mode === "copied"
                ? { ...token }
                : structuredClone(token);
        const evidence = {
          incidentEvidence: f.input.approval.incidentEvidence,
          priorActivation: "none" as const,
          requiredBases: bases,
          authority: { kind: "paper-declared" as const, token: wrong },
        };
        await expect(
          withTransaction(suite.db, (tx) =>
            activateModuleAllocation(tx, node, operation, evidence),
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "outside_confirmation_missing" },
        });
        await noWrites();
        const result = await withTransaction(suite.db, (tx) =>
          activateModuleAllocation(tx, node, operation, {
            ...evidence,
            authority: { kind: "paper-declared", token },
          }),
        );
        expect(result.series).toHaveLength(4);
      });
    });
  },
);

it("JSON validated:true cannot establish live module authority", async () => {
  const f = fixture(),
    api = await load();
  await expect(
    api
      .createDeclaredPaperPreparation(async () => f.facts)
      .prepare(
        {
          binding: f.binding,
          authority: { validated: true } as never,
          input: f.input,
        },
        async () => "unauthorised",
      ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  await noWrites();
});

it("old evidence with signatures stripped never selects unsigned admission", async () => {
  const f = fixture(),
    api = await load();
  Object.assign(f.input.allocation, {
    reservationEvidence: { block: { payload: {} }, consumption: { payload: {} } },
  });
  await expect(attempt(f)).rejects.toThrowError(invalid);
  await withOperationAuthority(f.binding, f.operator, async (authority) => {
    await expect(
      api
        .createDeclaredPaperPreparation(async () => null)
        .prepare({ binding: f.binding, authority, input: f.input }, async () => "fallback"),
    ).rejects.toThrowError(invalid);
  });
  await noWrites();
});

it.each([undefined, { trust: null, current: { ...fixture().facts, phase: "retired" } }])(
  "an unbound or retired first-setup attempt never falls back to file configuration %#",
  async (publicEvidence) => {
    const f = fixture();
    const host: ModuleOperationHost = {
      environment: {
        WAITRON_FISCAL_CUSTODIAN_FILE: "/must-not-read",
        WAITRON_FISCAL_CONFIRMATION_FILE: "/must-not-read",
        WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: "0".repeat(64),
      },
      readPublicEvidence: async () => publicEvidence,
    };
    await withOperationAuthority(f.binding, f.operator, async (authority) => {
      await expect(
        FISCAL_OPERATIONS.configure!(host).prepare(
          { binding: f.binding, authority, input: f.input },
          async () => "fallback",
        ),
      ).rejects.toThrowError(invalid);
    });
    await noWrites();
  },
);

it("an unsigned restore without host evidence cannot fall back to legacy signed files", async () => {
  const f = fixture("P");
  const host: ModuleOperationHost = {
    environment: {
      WAITRON_FISCAL_CUSTODIAN_FILE: "/must-not-read",
      WAITRON_FISCAL_CONFIRMATION_FILE: "/must-not-read",
      WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: "0".repeat(64),
    },
    readPublicEvidence: async () => undefined,
  };
  await withOperationAuthority(f.binding, f.operator, async (authority) => {
    await expect(
      FISCAL_OPERATIONS.configure!(host).prepare(
        { binding: f.binding, authority, input: f.input },
        async () => "fallback",
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "outside_confirmation_missing" },
    });
  });
  await noWrites();
});

it("an admission cannot authorise an edited approval timestamp", async () => {
  const f = fixture(),
    api = await admission();
  await withOperationAuthority(f.binding, f.operator, async (authority) => {
    const operation = { binding: f.binding, authority, input: f.input };
    await api.withDeclaredPaperAdmission({ operation, facts: f.facts }, async (token) => {
      await expect(
        withTransaction(suite.db, (tx) =>
          activateModuleAllocation(
            tx,
            node,
            {
              ...operation,
              input: {
                ...f.input,
                approval: { ...f.input.approval, confirmedAt: "2026-10-16T00:01:00.000Z" },
              },
            },
            {
              incidentEvidence: f.input.approval.incidentEvidence,
              priorActivation: "none",
              requiredBases: bases,
              authority: { kind: "paper-declared", token },
            },
          ),
        ),
      ).rejects.toMatchObject({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      });
    });
  });
  await noWrites();
});

it("ending the source authentication while it reads cannot mint an admission", async () => {
  const f = fixture(),
    api = await load();
  let release!: () => void, reading!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let pending!: Promise<unknown>;
  await withOperationAuthority(f.binding, f.operator, async (authority) => {
    pending = api
      .createDeclaredPaperPreparation(async () => {
        reading();
        await barrier;
        return f.facts;
      })
      .prepare({ binding: f.binding, authority, input: f.input }, async () => "unauthorised");
    await reached;
  });
  release();
  await expect(pending).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  await noWrites();
});

it("replay requires fresh committed confirmation and returns the exact retained result", async () => {
  const f = fixture(),
    first = await attempt(f);
  await expect(attempt(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
  const replay = await attempt(f, (x) => Object.assign(x, { priorActivation: "committed" }));
  expect(replay).toEqual(first);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it.each([
  [
    "input fields",
    (f: Fixture["facts"]) => {
      Object.assign(f.input, { validated: true });
    },
  ],
  [
    "approval fields",
    (f: Fixture["facts"]) => {
      Object.assign(f.input.approval, { signature: "made up" });
    },
  ],
  [
    "known fields",
    (f: Fixture["facts"]) => {
      Object.assign(f.known, { extra: true });
    },
  ],
  [
    "approval operator",
    (f: Fixture["facts"]) => {
      f.input.approval.operatorId = "someone else";
    },
  ],
  [
    "consumption source",
    (f: Fixture["facts"]) => {
      const proof = f.input.allocation.reservationEvidence;
      proof.consumption.sourceId = "different backup";
      proof.consumptionDigest = digest(proof.consumption);
    },
  ],
  [
    "reservation action",
    (f: Fixture["facts"]) => {
      const proof = f.input.allocation.reservationEvidence;
      Object.assign(proof.reservation.binding, { action: "reserve" });
      proof.consumption.reservationDigest = digest(proof.reservation);
      proof.reservationDigest = digest(proof.reservation);
      proof.consumptionDigest = digest(proof.consumption);
    },
  ],
] as const)("refuses malformed or inconsistent %s", async (_name, change) => {
  await expect(attempt(fixture(), change)).rejects.toThrowError(invalid);
  await noWrites();
});

it("keeps matching retained history in a fresh source confirmation", async () => {
  const f = fixture();
  const result = await attempt(f, (x) => Object.assign(x.known, { history: x.history }));
  expect(result.series).toHaveLength(4);
});

it.each(["input", "operator"])(
  "an independently valid source cannot replace the operation's %s",
  async (field) => {
    const f = fixture(),
      api = await admission();
    const supplied = structuredClone(f.input);
    if (field === "input") supplied.approval.confirmedAt = "2026-10-16T00:01:00.000Z";
    await withOperationAuthority(
      f.binding,
      field === "operator" ? "other manager" : f.operator,
      async (authority) => {
        await expect(
          api.withDeclaredPaperAdmission(
            { operation: { binding: f.binding, authority, input: supplied }, facts: f.facts },
            async () => "unauthorised",
          ),
        ).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "event_mismatch" },
        });
      },
    );
    await noWrites();
  },
);

function validationContext(f: Fixture, token: object): AllocationContext {
  return {
    ...f.facts.history.scope,
    mode: f.binding.action === "setup" ? "initial-setup" : "recovery",
    eventId: f.binding.eventId,
    operatorId: f.operator,
    sourceId: f.binding.sourceId,
    targetNodeId: f.binding.targetNodeId,
    incidentEvidence: f.input.approval.incidentEvidence,
    requiredBases: bases,
    reauthentication: { operatorId: f.operator, eventId: f.binding.eventId },
    priorActivation: "none",
    authority: { kind: "paper-declared", token },
  };
}

it.each([
  "sourceId",
  "targetNodeId",
  "eventId",
  "operatorId",
  "taxpayerNif",
  "environment",
  "requiredBases",
  "replay",
])("a live token cannot be used for a different %s", async (field) => {
  const f = fixture(),
    api = await admission();
  await withOperationAuthority(f.binding, f.operator, (authority) =>
    api.withDeclaredPaperAdmission(
      { operation: { binding: f.binding, authority, input: f.input }, facts: f.facts },
      async (token) => {
        const context = validationContext(f, token);
        const changed = {
          ...context,
          ...(field === "replay"
            ? {}
            : { [field]: field === "requiredBases" ? bases.slice(1) : "other" }),
        };
        expect(
          api.validateDeclaredPaperEvidence(f.input.allocation, changed, field === "replay"),
        ).toEqual({ ok: false, reason: "reservation_mismatch" });
        expect(api.validateDeclaredPaperEvidence(f.input.allocation, context, false)).toEqual({
          ok: true,
          allocation: f.input.allocation,
          approval: f.input.approval,
        });
      },
    ),
  );
});

it("a legacy paper authority cannot be reinterpreted as an unsigned token", async () => {
  const f = fixture(),
    api = await admission();
  const context = { ...validationContext(f, {}), authority: { kind: "cloud" as const } };
  expect(api.validateDeclaredPaperEvidence(f.input.allocation, context, false)).toEqual({
    ok: false,
    reason: "reservation_untrusted",
  });
});

it("ending operation authentication invalidates a token even inside its admission callback", async () => {
  const f = fixture(),
    api = await admission();
  let release!: () => void, reading!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    reading = resolve;
  });
  let pending!: Promise<unknown>;
  await withOperationAuthority(f.binding, f.operator, async (authority) => {
    pending = api.withDeclaredPaperAdmission(
      { operation: { binding: f.binding, authority, input: f.input }, facts: f.facts },
      async (token) => {
        reading();
        await barrier;
        expect(
          api.validateDeclaredPaperEvidence(f.input.allocation, validationContext(f, token), false),
        ).toEqual({ ok: false, reason: "reauthentication_required" });
      },
    );
    await reached;
  });
  release();
  await pending;
  await noWrites();
});

it.each(["reservationDigest", "consumptionDigest"] as const)(
  "matching host and submitted bytes cannot bypass a corrupt %s",
  async (field) => {
    const f = fixture();
    f.input.allocation.reservationEvidence[field] = "b".repeat(64);
    await expect(attempt(f)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reservation_mismatch" },
    });
    await noWrites();
  },
);

it.each(["action", "sourceId"] as const)(
  "inspection rejects a recomputed proof with the wrong reservation %s",
  async (field) => {
    const f = fixture(),
      api = await admission();
    const proof = f.input.allocation.reservationEvidence;
    Object.assign(proof.reservation.binding, { [field]: "other" });
    proof.consumption.reservationDigest = digest(proof.reservation);
    proof.reservationDigest = digest(proof.reservation);
    proof.consumptionDigest = digest(proof.consumption);
    expect(() => api.readDeclaredPaperInput(f.input)).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "event_mismatch" },
      }),
    );
  },
);

it("stripping real valid legacy signatures cannot enter either admission branch", async () => {
  const f = fixture();
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const trust = enrolPaperCustodian("legacy", publicKey, paperCustodianFingerprint(publicKey))!;
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "legacy",
      generationId: "legacy-generation",
      blockId: "legacy-block",
      packVersion: 1,
      recipientVenueId: f.context.recipientVenueId,
      allocations: f.selected.candidates,
    },
    privateKey,
  );
  const consumption = signPaperConsumptionForBlock(
    block,
    f.input.allocation.allocationId,
    {
      eventId: f.binding.eventId,
      operatorId: f.operator,
      sourceId: f.binding.sourceId,
      targetNodeId: f.binding.targetNodeId,
      incidentEvidence: f.input.approval.incidentEvidence,
      consumedAt: time,
    },
    privateKey,
  );
  const context: AllocationContext = {
    ...validationContext(f, {}),
    authority: {
      kind: "paper",
      trust,
      recipientVenueId: f.context.recipientVenueId,
      generationId: "legacy-generation",
      blockId: "legacy-block",
      currentRegisterConfirmed: true,
      consumptionConfirmed: true,
      currentEntryState: "consumed-for-event",
    },
  };
  const signed = { ...f.input.allocation, reservationEvidence: { block, consumption } };
  expect(validateAllocationEnvelope(signed, f.input.approval, context)).toEqual({
    ok: true,
    allocation: signed,
    approval: f.input.approval,
  });
  const stripped = {
    ...signed,
    reservationEvidence: {
      block: { payload: block.payload },
      consumption: { payload: consumption.payload },
    },
  };
  expect(validateAllocationEnvelope(stripped, f.input.approval, context)).toEqual({
    ok: false,
    reason: "reservation_missing",
  });
  Object.assign(f.input, { allocation: stripped });
  await expect(attempt(f)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  await noWrites();
});
