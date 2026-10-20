import { beforeEach, expect, it } from "vitest";
import { deployment, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationInput,
  type OperationBinding,
  type ModuleOperationHost,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { compareHourClocks, confirmHourClock } from "./hour-clock.js";
import {
  createHourSelection,
  type HourSelectionFacts,
  type HourSelectionStore,
} from "./hour-selection.js";
import { createHourPreparation, createHostedHourPreparation } from "./hour-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { registroSif } from "./schema/sif.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const instant = Date.parse("2026-10-16T11:40:00.000Z");
const bases = [
  { code: "A", purpose: "standard" },
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "owned-hour",
  sourceId: "first-setup:owned-attempt",
  targetNodeId: TENANT_A.nodeId,
};
const refuse = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
function clock(at = instant, browserAt = at) {
  return compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable" as const,
      instantMs: source === "box" ? at : browserAt,
      uncertaintyMs: 0,
      wallStartedMs: at,
      wallFinishedMs: at,
      monotonicStartedMs: 0,
      monotonicFinishedMs: 0,
    })),
    Date.parse("2026-10-15T00:00:00.000Z"),
  );
}
function fixture() {
  let value: unknown = null;
  const revisions: unknown[] = [];
  let held = false;
  let facts: HourSelectionFacts & { confirmation?: object } = {
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    bases,
    contextKey: "ES/ES-common/Europe-Madrid/module-v1/owner-1",
    clock: clock(),
    history: [{ reference: "empty-venue", complete: true, records: [] }],
  };
  const withState: HourSelectionStore = async (_binding, run) => {
    if (held) throw new Error("re-entered preparation exclusion");
    held = true;
    try {
      return await run({
        get value() {
          return structuredClone(value);
        },
        get history() {
          return structuredClone(revisions);
        },
        async replace(next) {
          value = structuredClone(next);
          revisions.push(structuredClone(next));
        },
      });
    } finally {
      held = false;
    }
  };
  const options = { withState, read: async () => facts, monotonicNow: () => 0 };
  const selection = createHourSelection(options);
  const preparation = createHourPreparation(options);
  return {
    withState,
    selection,
    preparation,
    revisions,
    get held() {
      return held;
    },
    get facts() {
      return facts;
    },
    set facts(next: typeof facts) {
      facts = next;
    },
    async select(answer: "no" | "yes" | "unknown" = "no") {
      return withOperationAuthority(binding, "administrator", (authority) =>
        preparation.select({ binding, authority, answer }),
      );
    },
    activate(input: unknown, selectedBinding = binding) {
      return withOperationAuthority(selectedBinding, "administrator", (authority) =>
        preparation.prepare({ binding: selectedBinding, authority, input }, (operation) =>
          withTransaction(suite.db, (tx) =>
            activatePreparedModuleAllocation(
              tx,
              {
                nodeId: TENANT_A.nodeId,
                locationId: locationId(TENANT_A.locationId),
              },
              operation,
            ),
          ),
        ),
      );
    },
  };
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});

it("requires an already persisted intent instead of letting activation prepare select an hour", async () => {
  const f = fixture();
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(f.selection.selected({ binding, authority })).rejects.toMatchObject(
      refuse("reservation_missing"),
    );
  });
  expect(f.revisions).toEqual([]);
});

it("builds signer-free activation material only after recording the complete selected hour", async () => {
  const f = fixture();
  const selected = await f.select();
  expect(selected.status).toBe("selected");
  expect(f.revisions).toHaveLength(1);
  expect(selected).toMatchObject({
    input: {
      allocation: {
        allocationId: "hour/owned-hour",
        installationIdentity: "06RB",
        source: "hour",
        environment: "preproduction",
        reservationEvidence: null,
        issuedAt: "2026-10-16T11:40:00.000Z",
        series: [
          { code: "A-06RB", purpose: "standard" },
          { code: "FF-06RB", purpose: "full" },
          { code: "R-06RB", purpose: "rectificative" },
          { code: "a/B_1.2-3-06RB", purpose: "standard" },
        ],
      },
      approval: {
        eventId: "owned-hour",
        operatorId: "administrator",
        oldMachineAbsent: true,
        oldMachineOffline: false,
        noParallelRecovery: true,
        confirmedAt: "2026-10-16T11:40:00.000Z",
      },
    },
  });
});

it("activates every exact base through the real prepared seed boundary without allocating again", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const result = await f.activate(selected.input);
  expect(result.series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-06RB", purpose: "standard" },
    { code: "FF-06RB", purpose: "full" },
    { code: "R-06RB", purpose: "rectificative" },
    { code: "a/B_1.2-3-06RB", purpose: "standard" },
  ]);
  expect(f.revisions).toHaveLength(1);
  expect((await suite.db.select().from(registroSif)).map((row) => row.numeroInstalacion)).toEqual([
    "06RB",
  ]);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it.each(["yes", "unknown"] as const)(
  "a pending %s wait supplies no activation input",
  async (answer) => {
    const f = fixture();
    const waiting = await f.select(answer);
    expect(waiting).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T12:00:00.000Z"),
      remainingMs: 1_200_000,
    });
    expect(waiting).not.toHaveProperty("input");
    await withOperationAuthority(binding, "administrator", async (authority) => {
      await expect(f.selection.selected({ binding, authority })).rejects.toMatchObject(
        refuse("reservation_missing"),
      );
    });
    expect(f.revisions).toHaveLength(1);
  },
);

it("preparation reuses an existing intent across an ordinary hour boundary", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  f.facts = { ...f.facts, clock: clock(Date.parse("2026-10-16T12:01:00.000Z")) };
  await f.activate(selected.input);
  expect(f.revisions).toHaveLength(1);
  expect((await suite.db.select().from(registroSif))[0]!.numeroInstalacion).toBe("06RB");
});

it.each(["bases", "scope", "contextKey"] as const)(
  "changed trusted %s invalidates a retained intent",
  async (field) => {
    const f = fixture();
    const selected = await f.select();
    if (selected.status !== "selected") throw new Error("selection did not finish");
    f.facts = {
      ...f.facts,
      [field]:
        field === "bases"
          ? bases.slice(0, 3)
          : field === "scope"
            ? { ...f.facts.scope, environment: "production" }
            : "changed-module-version",
    };
    await expect(f.activate(selected.input)).rejects.toMatchObject(refuse("event_mismatch"));
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  },
);

it("a changed uploaded identity cannot recreate selection authority", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const input = structuredClone(selected.input);
  input.allocation.installationIdentity = "06RC";
  await expect(f.activate(input)).rejects.toMatchObject(refuse("event_mismatch"));
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("a foreign event cannot use another event's retained hour", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  await expect(
    f.activate(selected.input, { ...binding, eventId: "foreign" }),
  ).rejects.toMatchObject(refuse("reservation_missing"));
  expect(f.revisions).toHaveLength(1);
});

it("keeps the shared exclusion held through the complete prepared callback", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  let retained!: ModuleOperationInput;
  await withOperationAuthority(binding, "administrator", (authority) =>
    f.preparation.prepare({ binding, authority, input: selected.input }, async (prepared) => {
      retained = prepared;
      expect(f.held).toBe(true);
      await Promise.resolve();
      expect(f.held).toBe(true);
    }),
  );
  expect(f.held).toBe(false);
  await expect(
    withTransaction(suite.db, (tx) =>
      activatePreparedModuleAllocation(
        tx,
        {
          nodeId: TENANT_A.nodeId,
          locationId: locationId(TENANT_A.locationId),
        },
        retained,
      ),
    ),
  ).rejects.toMatchObject(refuse("outside_confirmation_missing"));
});

it("requires a fresh trusted clock confirmation when preparation sees disagreement", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  f.facts = { ...f.facts, clock: clock(instant, instant + 121_000) };
  await expect(f.activate(selected.input)).rejects.toMatchObject(refuse("clock_unconfirmed"));
  f.facts = { ...f.facts, confirmation: confirmHourClock(f.facts.clock) };
  await f.activate(selected.input);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  expect(f.revisions).toHaveLength(1);
});

it("a different authenticated operator cannot adopt another operator's spent intent", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const input = structuredClone(selected.input);
  input.approval.operatorId = "other-administrator";
  await withOperationAuthority(binding, "other-administrator", async (authority) => {
    await expect(
      f.preparation.prepare({ binding, authority, input }, (prepared) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            {
              nodeId: TENANT_A.nodeId,
              locationId: locationId(TENANT_A.locationId),
            },
            prepared,
          ),
        ),
      ),
    ).rejects.toMatchObject(refuse("event_mismatch"));
  });
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(f.revisions).toHaveLength(1);
});

it("a recovery-key principal cannot spend an initial-setup hour", async () => {
  const f = fixture();
  await withOperationAuthority(
    binding,
    {
      kind: "recovery-key",
      nodeId: binding.targetNodeId,
      eventId: binding.eventId,
    },
    async (authority) => {
      await expect(
        f.preparation.select({ binding, authority, answer: "no" }),
      ).rejects.toMatchObject(refuse("reauthentication_required"));
    },
  );
  expect(f.revisions).toEqual([]);
});

it("a non-transferable uploaded input refuses with the domain code", async () => {
  const f = fixture();
  await f.select();
  await expect(f.activate({ allocation: () => undefined })).rejects.toMatchObject(
    refuse("malformed_allocation"),
  );
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it.each(["restore", "re-register", "promote", "reserve"])(
  "initial setup preparation cannot authorise %s",
  async (action) => {
    const f = fixture();
    const other = { ...binding, action };
    await withOperationAuthority(other, "administrator", async (authority) => {
      await expect(
        f.preparation.select({ binding: other, authority, answer: "no" }),
      ).rejects.toMatchObject(refuse("event_mismatch"));
      await expect(async () =>
        f.preparation.prepare({ binding: other, authority, input: null }, async () => undefined),
      ).rejects.toMatchObject(refuse("event_mismatch"));
    });
    expect(f.revisions).toEqual([]);
  },
);

it("expired authority cannot record a selection or inspect one during preparation", async () => {
  const f = fixture();
  const authority = await withOperationAuthority(binding, "administrator", async (value) => value);
  await expect(f.preparation.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
    refuse("reauthentication_required"),
  );
  await expect(async () =>
    f.preparation.prepare({ binding, authority, input: null }, async () => undefined),
  ).rejects.toMatchObject(refuse("reauthentication_required"));
  expect(f.revisions).toEqual([]);
});

it.each(["production", "preproduction"] as const)(
  "builds material only for the trusted %s target",
  async (environment) => {
    const f = fixture();
    f.facts = { ...f.facts, scope: { ...f.facts.scope, environment } };
    const selected = await f.select();
    expect(selected).toMatchObject({ input: { allocation: { environment } } });
    expect(f.revisions).toMatchObject([{ entries: [{ scope: { environment } }] }]);
  },
);

it("the general selector can resume the same authenticated recovery-key principal", async () => {
  const f = fixture();
  const recovery = { ...binding, action: "restore" };
  const principal = {
    kind: "recovery-key" as const,
    nodeId: recovery.targetNodeId,
    eventId: recovery.eventId,
  };
  await withOperationAuthority(recovery, principal, async (authority) => {
    const first = await f.selection.select({ binding: recovery, authority, answer: "no" });
    const resumed = await f.selection.selected({ binding: recovery, authority });
    expect(resumed).toEqual(first);
    expect(resumed.operatorId).toEqual(principal);
  });
  expect(f.revisions).toHaveLength(1);
});

it("a malformed retained operator cannot supply an activation intent", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const revision = structuredClone(f.revisions[0]) as { entries: { operatorId: unknown }[] };
  revision.entries[0]!.operatorId = null;
  f.revisions.push(revision);
  await expect(f.activate(selected.input)).rejects.toMatchObject(refuse("history_invalid"));
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("uploaded material without this host's durable intent cannot activate or spend an hour", async () => {
  const issuing = fixture();
  const selected = await issuing.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const target = fixture();
  await expect(target.activate(selected.input)).rejects.toMatchObject(
    refuse("reservation_missing"),
  );
  expect(target.revisions).toEqual([]);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("a changed approval cannot ride an otherwise matching saved selection", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  const input = structuredClone(selected.input);
  input.approval.confirmedAt = "2026-10-16T11:41:00.000Z";
  await expect(f.activate(input)).rejects.toMatchObject(refuse("event_mismatch"));
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
});

it("preparation re-reads a raised historical floor before the real writer can run", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("selection did not finish");
  f.facts = {
    ...f.facts,
    history: [
      {
        reference: "retired-workspace",
        complete: true,
        records: [
          {
            ...f.facts.scope,
            reference: "retired-other-node",
            kind: "retirement",
            softwareId: "OTHER",
            nodeId: "other-node",
            identity: "06RC",
            recordedAtMs: null,
          },
        ],
      },
    ],
  };
  await expect(f.activate(selected.input)).rejects.toMatchObject(refuse("hour_not_later"));
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([]);
  expect(f.revisions).toHaveLength(1);
});

it.each(["", "   "])(
  "an empty authenticated operator %j cannot leave an unusable spent intent",
  async (operatorId) => {
    const f = fixture();
    await withOperationAuthority(binding, operatorId, async (authority) => {
      await expect(
        f.preparation.select({ binding, authority, answer: "no" }),
      ).rejects.toMatchObject(refuse("reauthentication_required"));
    });
    expect(f.revisions).toEqual([]);
  },
);

it.each([false, true])(
  "the hosted adapter keeps the host scope separate from clock metadata (confirmed: %s)",
  async (confirmed) => {
    const f = fixture();
    const host: ModuleOperationHost = {
      environment: {},
      readPublicEvidence: async () => undefined,
      withPreparationState: f.withState,
      readSetupFacts: async () => ({
        context: {
          attemptId: "owned-attempt",
          binding,
          administratorId: "administrator",
          country: "ES",
          taxId: f.facts.scope.taxpayerNif,
          environment: f.facts.scope.environment,
          recipientVenueId: binding.sourceId,
          bases: structuredClone(bases),
        },
        contextKey: f.facts.contextKey,
        localHistory: f.facts.history[0],
      }),
    };
    const preparation = createHostedHourPreparation(host, {
      monotonicNow: () => 0,
      readClock: async (context) => {
        Object.assign(context, { taxId: "changed" });
        return {
          clock: f.facts.clock,
          ...(confirmed ? { confirmation: confirmHourClock(f.facts.clock) } : {}),
          scope: { taxpayerNif: "changed", environment: "production" },
        };
      },
    });
    const selected = await withOperationAuthority(binding, "administrator", (authority) =>
      preparation.select({ binding, authority, answer: "no" }),
    );
    expect(selected).toMatchObject({ status: "selected", scope: f.facts.scope });
    if (selected.status !== "selected") throw new Error("expected selected hour");
    await withOperationAuthority(binding, "administrator", (authority) =>
      preparation.prepare({ binding, authority, input: selected.input }, (operation) =>
        withTransaction(suite.db, (tx) =>
          activatePreparedModuleAllocation(
            tx,
            {
              nodeId: TENANT_A.nodeId,
              locationId: locationId(TENANT_A.locationId),
            },
            operation,
          ),
        ),
      ),
    );
    expect(await suite.db.select().from(fiscalAllocations)).toEqual([
      expect.objectContaining({
        taxpayerNif: f.facts.scope.taxpayerNif,
        environment: "preproduction",
        installationIdentity: "06RB",
      }),
    ]);
  },
);

it.each(["readSetupFacts", "withPreparationState"] as const)(
  "a hosted adapter requires %s",
  (missing) => {
    const host: ModuleOperationHost = {
      environment: {},
      readPublicEvidence: async () => undefined,
      readSetupFacts: async () => {
        throw new Error("must not read");
      },
      withPreparationState: async () => {
        throw new Error("must not enter");
      },
    };
    delete host[missing];
    expect(() =>
      createHostedHourPreparation(host, {
        monotonicNow: () => 0,
        readClock: async () => ({ clock: clock() }),
      }),
    ).toThrowError(expect.objectContaining(refuse("outside_confirmation_missing")));
  },
);
