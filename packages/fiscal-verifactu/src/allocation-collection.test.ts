import { generateKeyPairSync } from "node:crypto";
import { deployment, invoiceSeries, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationInput,
  type OperationBinding,
  type OperationOperator,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import * as allocation from "./allocation-operation.js";
import type { AllocationOperationEvidence } from "./allocation-operation.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";
import { fiscalAllocations, type ActivationResult } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";
import { drawEmergencyIdentity } from "./allocation-envelope.js";

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
type Request = { readonly binding: OperationBinding; readonly operatorId: OperationOperator };
type Receipt = Request & { readonly evidence: AllocationOperationEvidence };
type Source = ((request: Request) => Promise<Receipt | null>) | undefined;
type Activate = (tx: Transaction, target: typeof node) => Promise<ActivationResult>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function collect<T>(
  operation: ModuleOperationInput,
  source: Source,
  run: (activate: Activate) => Promise<T>,
): Promise<T> {
  return allocation.withCollectedModuleAllocation(operation, source, run);
}

function attempt(source: Source, supplied: unknown = input) {
  return withOperationAuthority(binding, operator, (authority) =>
    collect({ binding, authority, input: supplied }, source, (activate) =>
      withTransaction(suite.db, (tx) => activate(tx, node)),
    ),
  );
}

function receipt(): Receipt {
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

async function snapshot() {
  return {
    sifs: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    activations: await suite.db.select().from(fiscalAllocations),
  };
}

it("activates the complete signed set from independently collected evidence", async () => {
  const result = await withOperationAuthority(binding, operator, (authority) =>
    collect(
      { binding, authority, input },
      async (request) => {
        expect(request).toEqual({ binding, operatorId: operator });
        return { ...request, evidence };
      },
      (activate) => withTransaction(suite.db, (tx) => activate(tx, node)),
    ),
  );
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ]);
  const retained = await snapshot();
  expect(retained.sifs).toHaveLength(1);
  expect(retained.series.filter((row) => row.retiredAt === null)).toHaveLength(3);
  expect(retained.series.filter((row) => row.retiredAt !== null)).toHaveLength(3);
  expect(retained.activations).toHaveLength(1);
  expect(retained.activations[0]?.approval.operatorId).toEqual(operator);
});

it.each([undefined, async () => null])(
  "refuses an unavailable source before entering the operation callback %#",
  async (source) => {
    const before = await snapshot();
    let entered = false;
    await expect(
      withOperationAuthority(binding, operator, (authority) =>
        collect({ binding, authority, input }, source, async () => {
          entered = true;
        }),
      ),
    ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
    expect(entered).toBe(false);
    expect(await snapshot()).toEqual(before);
  },
);

it.each(["module", "action", "eventId", "sourceId", "targetNodeId"] as const)(
  "refuses current evidence collected for a different %s",
  async (field) => {
    const before = await snapshot();
    const wrong = receipt();
    Object.assign(wrong, { binding: { ...wrong.binding, [field]: "different" } });
    await expect(attempt(async () => wrong)).rejects.toMatchObject(refusal("event_mismatch"));
    expect(await snapshot()).toEqual(before);
  },
);

it("refuses evidence naming another operator", async () => {
  const before = await snapshot();
  await expect(
    attempt(async () => ({ ...receipt(), operatorId: "different-administrator" })),
  ).rejects.toMatchObject(refusal("event_mismatch"));
  expect(await snapshot()).toEqual(before);
});

it("does not collect for fabricated in-process authority", async () => {
  let called = false;
  await expect(
    collect(
      { binding, authority: {} as ModuleOperationInput["authority"], input },
      async () => {
        called = true;
        return receipt();
      },
      (activate) => withTransaction(suite.db, (tx) => activate(tx, node)),
    ),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
  expect(called).toBe(false);
  expect((await snapshot()).activations).toEqual([]);
});

it("rechecks authentication after outside collection settles", async () => {
  const before = await snapshot();
  const answer = deferred<Receipt | null>();
  let pending!: Promise<unknown>;
  let entered = false;
  await withOperationAuthority(binding, operator, async (authority) => {
    pending = collect(
      { binding, authority, input },
      () => answer.promise,
      async () => {
        entered = true;
      },
    );
  });
  const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  answer.resolve(receipt());
  await rejected;
  expect(entered).toBe(false);
  expect(await snapshot()).toEqual(before);
});

it("revokes a captured activation callback when its collection attempt ends", async () => {
  await withOperationAuthority(binding, operator, async (authority) => {
    let captured!: Activate;
    await collect(
      { binding, authority, input },
      async () => receipt(),
      async (activate) => {
        captured = activate;
      },
    );
    const before = await snapshot();
    await expect(withTransaction(suite.db, (tx) => captured(tx, node))).rejects.toMatchObject(
      refusal("reauthentication_required"),
    );
    expect(await snapshot()).toEqual(before);
  });
});

it("revokes a captured activation callback after the host refuses the attempt", async () => {
  await withOperationAuthority(binding, operator, async (authority) => {
    let captured!: Activate;
    const hostFailure = new Error("host refused");
    await expect(
      collect(
        { binding, authority, input },
        async () => receipt(),
        async (activate) => {
          captured = activate;
          throw hostFailure;
        },
      ),
    ).rejects.toBe(hostFailure);
    const before = await snapshot();
    await expect(withTransaction(suite.db, (tx) => captured(tx, node))).rejects.toMatchObject(
      refusal("reauthentication_required"),
    );
    expect(await snapshot()).toEqual(before);
  });
});

it("refuses a queued transaction after the original authentication expires", async () => {
  const ready = deferred<void>();
  const proceed = deferred<void>();
  let pending!: Promise<ActivationResult>;
  await withOperationAuthority(binding, operator, async (authority) => {
    pending = collect(
      { binding, authority, input },
      async () => receipt(),
      async (activate) => {
        ready.resolve(undefined);
        await proceed.promise;
        return withTransaction(suite.db, (tx) => activate(tx, node));
      },
    );
    await ready.promise;
  });
  const before = await snapshot();
  const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  proceed.resolve(undefined);
  await rejected;
  expect(await snapshot()).toEqual(before);
});

it("rolls back after authentication expires while the final audit write is awaiting completion", async () => {
  const written = deferred<void>();
  const proceed = deferred<void>();
  let pending!: Promise<ActivationResult>;
  const before = await snapshot();
  await withOperationAuthority(binding, operator, async (authority) => {
    pending = collect(
      { binding, authority, input },
      async () => receipt(),
      (activate) =>
        withTransaction(suite.db, async (tx) => {
          const paused = new Proxy(tx, {
            get(target, property) {
              if (property !== "insert") return Reflect.get(target, property);
              return (table: Parameters<Transaction["insert"]>[0]) => {
                const insertion = target.insert(table);
                if (table !== fiscalAllocations) return insertion;
                return new Proxy(insertion, {
                  get(builder, key) {
                    if (key !== "values") return Reflect.get(builder, key);
                    return async (...values: unknown[]) => {
                      await Reflect.apply(builder.values, builder, values);
                      written.resolve(undefined);
                      await proceed.promise;
                    };
                  },
                });
              };
            },
          });
          return activate(paused, node);
        }),
    );
    await written.promise;
  });
  const rejected = expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  proceed.resolve(undefined);
  await rejected;
  expect(await snapshot()).toEqual(before);
});

it.each(["binding", "operatorId"] as const)(
  "a source cannot rewrite its %s request to change host authority",
  async (field) => {
    const before = await snapshot();
    await expect(
      attempt(async (request) => {
        if (field === "binding") Object.assign(request.binding, { eventId: "different" });
        else Object.assign(request.operatorId, { eventId: "different" });
        return { ...request, evidence };
      }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
    expect(binding.eventId).toBe("recovery-collection");
    expect(operator.eventId).toBe("recovery-collection");
    expect(await snapshot()).toEqual(before);
  },
);

it.each([null, undefined])("refuses a source receipt with no evidence value %#", async (value) => {
  const before = await snapshot();
  await expect(
    attempt(async () => ({ ...receipt(), evidence: value }) as unknown as Receipt),
  ).rejects.toMatchObject(refusal("outside_confirmation_missing"));
  expect(await snapshot()).toEqual(before);
});

it("snapshots submitted bytes and host scope before waiting for outside collection", async () => {
  const supplied = structuredClone(input);
  const changingBinding = { ...binding };
  await expect(
    withOperationAuthority(binding, operator, (authority) =>
      collect(
        { binding: changingBinding, authority, input: supplied },
        async (request) => {
          supplied.allocation.installationIdentity = "P000043";
          changingBinding.eventId = "different";
          await Promise.resolve();
          return { ...request, evidence };
        },
        (activate) => withTransaction(suite.db, (tx) => activate(tx, node)),
      ),
    ),
  ).resolves.toHaveProperty("activationEventId", "recovery-collection");
  const retained = await snapshot();
  expect(retained.activations[0]?.installationIdentity).toBe("P000042");
  expect(retained.activations[0]?.eventKey).toBe("recovery-collection");
  expect(retained.activations[0]?.allocation).toEqual(input.allocation);
});

it("detaches collected evidence before handing control to the transaction owner", async () => {
  const outside = receipt();
  await expect(
    withOperationAuthority(binding, operator, (authority) =>
      collect(
        { binding, authority, input },
        async () => outside,
        async (activate) => {
          Object.assign(outside.evidence.requiredBases![0]!, { code: "wrong" });
          if (outside.evidence.authority.kind === "paper")
            Object.assign(outside.evidence.authority, { currentRegisterConfirmed: false });
          return withTransaction(suite.db, (tx) => activate(tx, node));
        },
      ),
    ),
  ).resolves.toHaveProperty("activationEventId", "recovery-collection");
  expect(
    (await snapshot()).series
      .filter((row) => row.retiredAt === null)
      .map((row) => row.code)
      .sort(),
  ).toEqual(["A-P000042", "FF-P000042", "R-P000042"]);
});

it.each([null, undefined, {}])("refuses an absent evidence receipt %#", async (value) => {
  const before = await snapshot();
  await expect(attempt(async () => value as Receipt)).rejects.toMatchObject(
    refusal("outside_confirmation_missing"),
  );
  expect(await snapshot()).toEqual(before);
});

it.each([{ module: "another-module" }, { action: "inspect" }])(
  "does not collect for an unrelated authenticated operation %#",
  async (change) => {
    const unrelated = { ...binding, ...change };
    let collected = false;
    await expect(
      withOperationAuthority(unrelated, operator, (authority) =>
        collect(
          { binding: unrelated, authority, input },
          async (request) => {
            collected = true;
            return { ...request, evidence };
          },
          (activate) => withTransaction(suite.db, (tx) => activate(tx, node)),
        ),
      ),
    ).rejects.toMatchObject(refusal("reauthentication_required"));
    expect(collected).toBe(false);
    expect((await snapshot()).activations).toEqual([]);
  },
);

it("propagates outside-source failure without entering the local operation", async () => {
  const before = await snapshot();
  const unavailable = new Error("outside source unavailable");
  let entered = false;
  await expect(
    withOperationAuthority(binding, operator, (authority) =>
      collect(
        { binding, authority, input },
        () => Promise.reject(unavailable),
        async () => {
          entered = true;
        },
      ),
    ),
  ).rejects.toBe(unavailable);
  expect(entered).toBe(false);
  expect(await snapshot()).toEqual(before);
});

it("allows another writer to commit while outside collection is waiting", async () => {
  const answer = deferred<Receipt | null>();
  const requested = deferred<void>();
  const pending = attempt(() => {
    requested.resolve(undefined);
    return answer.promise;
  });
  await requested.promise;
  try {
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(invoiceSeries).values({
        nodeId: node.nodeId,
        code: "writer",
        purpose: "standard",
        retiredAt: new Date("2026-10-13T11:30:00.000Z"),
      });
    });
    expect((await snapshot()).series.some((row) => row.code === "writer")).toBe(true);
    expect((await snapshot()).activations).toEqual([]);
  } finally {
    answer.resolve(receipt());
    await pending;
  }
  expect((await snapshot()).activations).toHaveLength(1);
});

it.each([
  ["currentRegisterConfirmed", false, "outside_confirmation_missing"],
  ["consumptionConfirmed", false, "outside_confirmation_missing"],
  ["trust", null, "reservation_untrusted"],
  ["currentEntryState", "reserved", "reservation_not_consumed"],
  ["currentEntryState", "consumed-elsewhere", "allocation_consumed"],
  ["currentEntryState", "retired", "allocation_retired"],
  ["currentEntryState", "abandoned", "reservation_abandoned"],
] as const)(
  "submitted confirmation cannot override outside %s=%s",
  async (field, value, reason) => {
    const before = await snapshot();
    const current = receipt();
    Object.assign(current.evidence.authority, { [field]: value });
    await expect(attempt(async () => current)).rejects.toMatchObject(refusal(reason));
    expect(await snapshot()).toEqual(before);
  },
);

it("looks up current outside evidence again for replay rather than keeping the first receipt", async () => {
  const first = await attempt(async () => receipt());
  const before = await snapshot();
  await expect(attempt(async () => null)).rejects.toMatchObject(
    refusal("outside_confirmation_missing"),
  );
  const abandoned = receipt();
  Object.assign(abandoned.evidence, { priorActivation: "committed" });
  Object.assign(abandoned.evidence.authority, { currentEntryState: "abandoned" });
  await expect(attempt(async () => abandoned)).rejects.toMatchObject(
    refusal("reservation_abandoned"),
  );
  expect(await snapshot()).toEqual(before);
  const replayed = await attempt(async () => ({
    ...receipt(),
    evidence: { ...evidence, priorActivation: "committed" },
  }));
  expect(replayed).toEqual(first);
  expect(await snapshot()).toEqual(before);
});

it("a later host refusal rolls back allocation while leaving the outside receipt consumed", async () => {
  const before = await snapshot();
  const outside = receipt();
  const saved = structuredClone(outside);
  const hostFailure = new Error("role change refused");
  await expect(
    withOperationAuthority(binding, operator, (authority) =>
      collect(
        { binding, authority, input },
        async () => outside,
        (activate) =>
          withTransaction(suite.db, async (tx) => {
            await activate(tx, node);
            throw hostFailure;
          }),
      ),
    ),
  ).rejects.toBe(hostFailure);
  expect(await snapshot()).toEqual(before);
  expect(outside).toEqual(saved);
});

it("refuses submitted secrets and forged evidence before collecting outside facts", async () => {
  const before = await snapshot();
  const submitted = { ...input, evidence, secret: "secret-must-not-leave-host" };
  let collected = false;
  await expect(
    attempt(async () => {
      collected = true;
      return receipt();
    }, submitted),
  ).rejects.toMatchObject(refusal("malformed_allocation"));
  expect(collected).toBe(false);
  expect(await snapshot()).toEqual(before);
});

it("rejects uncloneable submitted state before consulting the outside register", async () => {
  let collected = false;
  await expect(
    attempt(
      async () => {
        collected = true;
        return receipt();
      },
      { ...input, hook: () => undefined },
    ),
  ).rejects.toMatchObject(refusal("malformed_allocation"));
  expect(collected).toBe(false);
  expect((await snapshot()).activations).toEqual([]);
});

it.each([
  Object.assign({ ...input }, { [Symbol("extra")]: "hidden" }),
  Object.defineProperty({ ...input }, "extra", { value: "hidden", enumerable: false }),
])("does not let snapshotting erase forbidden submitted fields %#", async (submitted) => {
  const before = await snapshot();
  await expect(attempt(async () => receipt(), submitted)).rejects.toMatchObject(
    refusal("malformed_allocation"),
  );
  expect(await snapshot()).toEqual(before);
});

it.each([null, []])(
  "preserves the host's genuine emergency draw when outside history is %s",
  async (knownIdentities) => {
    const draw = drawEmergencyIdentity();
    const emergency = {
      allocation: {
        ...candidate,
        allocationId: "emergency-collection",
        source: "emergency",
        installationIdentity: draw.identity,
        series: bases.map((base) => ({ ...base, code: `${base.code}-${draw.identity}` })),
        reservationEvidence: { checksum: draw.checksum },
      },
      approval,
    };
    const host: AllocationOperationEvidence = {
      ...evidence,
      authority: {
        kind: "emergency",
        draw,
        knownIdentities,
        incidentRecorded: true,
        uncertaintyRecorded: true,
      },
    };
    const result = await attempt(async (request) => ({ ...request, evidence: host }), emergency);
    expect(result.series).toHaveLength(3);
    expect((await snapshot()).activations[0]?.installationIdentity).toBe(draw.identity);
    expect((await snapshot()).activations[0]?.allocation.reservationEvidence).toEqual({
      checksum: draw.checksum,
    });
  },
);
