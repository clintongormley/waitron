import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deployment, invoiceSeries, nodes, tenants, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  withOperationAuthority,
  type ModuleOperationHost,
  type OperationBinding,
  type ModuleOperationInput,
} from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { seedFixtureSif } from "../test/sif-fixture.js";
import { FISCAL_OPERATIONS } from "./allocation-configuration.js";
import { ALLOCATED_FISCAL_STANDBY } from "./allocated-standby.js";
import { registroSif } from "./schema/sif.js";
import { cadenas } from "./schema/cadenas.js";
import { fiscalAllocations } from "./schema/allocations.js";
import { fiscalReservations } from "./schema/reservations.js";
import { createHourDormantPreparation, readRetainedHourDormant } from "./hour-dormant-standby.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const primary = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const standby = { ...primary, nodeId: TENANT_A.nodeId2 };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
  { code: "a/B_1.2-3", purpose: "standard" },
];
const reserveBinding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "reserve",
  eventId: "dormant-join",
  sourceId: primary.nodeId,
  targetNodeId: standby.nodeId,
};
let value: unknown;
let history: unknown[];
let host: ModuleOperationHost;
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  await withTransaction(suite.db, (tx) =>
    seedFixtureSif(tx, {
      nodeId: primary.nodeId,
      nif: "89890001K",
      idSistemaInformatico: "W1",
    }),
  );
  await suite.db
    .insert(invoiceSeries)
    .values(bases.map((base) => ({ ...base, nodeId: primary.nodeId })));
  value = null;
  history = [];
  host = {
    environment: {},
    readPublicEvidence: async () => undefined,
    withPreparationState: async (_binding, run) =>
      run({
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
      }),
  };
});
async function rows() {
  return {
    sif: await suite.db.select().from(registroSif),
    series: await suite.db.select().from(invoiceSeries),
    chains: await suite.db.select().from(cadenas),
    allocations: await suite.db.select().from(fiscalAllocations),
    reservations: await suite.db.select().from(fiscalReservations),
  };
}
async function reserve() {
  return withOperationAuthority(reserveBinding, "administrator", (authority) =>
    FISCAL_OPERATIONS.configure!(host).prepare(
      {
        binding: reserveBinding,
        authority,
        input: { kind: "hour-dormant", version: 1 },
      },
      (prepared) =>
        withTransaction(suite.db, (tx) =>
          ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, prepared),
        ),
    ),
  );
}
async function establish(state: unknown, override: Partial<OperationBinding> = {}) {
  const binding = { ...reserveBinding, action: "establish", ...override };
  return withOperationAuthority(binding, "administrator", (authority) =>
    FISCAL_OPERATIONS.configure!(host).prepare({ binding, authority, input: state }, (prepared) =>
      withTransaction(suite.db, (tx) =>
        ALLOCATED_FISCAL_STANDBY.establish(tx, standby, state, prepared),
      ),
    ),
  );
}

it("admits a dormant standby with complete configuration and no fiscal name or hour intent", async () => {
  const before = await rows();
  const reserved = await reserve();
  expect(reserved.series).toBeUndefined();
  expect(reserved.state).toEqual({
    kind: "hour-dormant",
    version: 1,
    binding: reserveBinding,
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    locationId: primary.locationId,
    bases,
  });
  expect(history).toEqual([]);
  await establish(reserved.state);
  expect(await rows()).toEqual(before);
  expect(value).toEqual({ version: 1, entries: [], dormant: [reserved.state] });
  const retained = structuredClone(value);
  await establish(reserved.state);
  expect(value).toEqual(retained);
  expect(history).toHaveLength(1);
});

it.each(["bases", "taxpayer", "environment", "source", "target", "event", "location"])(
  "refuses a dormant %s mismatch without fiscal changes or durable admission",
  async (fault) => {
    const reserved = await reserve();
    const state = structuredClone(reserved.state) as {
      bases: typeof bases;
      scope: { taxpayerNif: string; environment: string };
      binding: OperationBinding;
      locationId: string;
    };
    if (fault === "bases") state.bases.pop();
    if (fault === "taxpayer") state.scope.taxpayerNif = "different";
    if (fault === "environment") state.scope.environment = "production";
    if (fault === "source") state.binding = { ...state.binding, sourceId: "different" };
    if (fault === "target") state.binding = { ...state.binding, targetNodeId: primary.nodeId };
    if (fault === "event") state.binding = { ...state.binding, eventId: "different" };
    if (fault === "location") state.locationId = "different";
    const before = await rows();
    await expect(establish(state)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
    expect(await rows()).toEqual(before);
    expect(history).toEqual([]);
  },
);

it.each(["sif", "series"])("refuses admitting an already active standby %s", async (fault) => {
  if (fault === "sif")
    await withTransaction(suite.db, (tx) =>
      seedFixtureSif(tx, {
        nodeId: standby.nodeId,
        nif: "89890001K",
        idSistemaInformatico: "W1",
      }),
    );
  else await suite.db.insert(invoiceSeries).values({ nodeId: standby.nodeId, code: "OTHER" });
  const before = await rows();
  await expect(reserve()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "standby_already_active" },
  });
  expect(await rows()).toEqual(before);
  expect(history).toEqual([]);
});

it("refuses a changed primary configuration before establishment", async () => {
  const reserved = await reserve();
  await suite.db
    .update(invoiceSeries)
    .set({ purpose: "rectificative" })
    .where(eq(invoiceSeries.code, "a/B_1.2-3"));
  await expect(establish(reserved.state)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  expect(history).toEqual([]);
});

it("refuses a missing standby at establishment", async () => {
  const reserved = await reserve();
  await suite.db.delete(nodes).where(eq(nodes.id, standby.nodeId));
  await expect(establish(reserved.state)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "node_mismatch" },
  });
  expect(history).toEqual([]);
});

it.each([
  "kind",
  "version",
  "extra",
  "scope",
  "blank-nif",
  "environment",
  "binding",
  "blank-event",
  "same-node",
  "empty-location",
  "bases",
  "base-shape",
  "bad-base",
  "no-full",
])("refuses malformed dormant configuration %s before establishment", async (fault) => {
  const state = structuredClone((await reserve()).state) as Record<string, unknown>;
  const scope = state.scope as Record<string, unknown>;
  const bound = state.binding as Record<string, unknown>;
  if (fault === "kind") state.kind = "other";
  if (fault === "version") state.version = 2;
  if (fault === "extra") state.extra = true;
  if (fault === "scope") state.scope = null;
  if (fault === "blank-nif") scope.taxpayerNif = " ";
  if (fault === "environment") scope.environment = "dev";
  if (fault === "binding") state.binding = [];
  if (fault === "blank-event") bound.eventId = " ";
  if (fault === "same-node") bound.sourceId = bound.targetNodeId;
  if (fault === "empty-location") state.locationId = "";
  if (fault === "bases") state.bases = null;
  if (fault === "base-shape") state.bases = [{ code: "A", purpose: "standard", extra: true }];
  if (fault === "bad-base") state.bases = [...bases, { code: "bad label", purpose: "standard" }];
  if (fault === "no-full") state.bases = bases.filter((base) => base.purpose !== "full");
  const before = await rows();
  await expect(establish(state)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await rows()).toEqual(before);
  expect(history).toEqual([]);
});

it("reads one retained dormant configuration across a later hour-intent revision", async () => {
  const reserved = await reserve();
  await establish(reserved.state);
  expect(
    readRetainedHourDormant([...history, { version: 1, entries: [] }], {
      ...reserveBinding,
      action: "promote",
    }),
  ).toEqual(reserved.state);
});

it.each(["missing", "source", "target", "malformed", "conflict"])(
  "refuses %s retained dormant evidence",
  async (fault) => {
    const reserved = await reserve();
    await establish(reserved.state);
    const values = structuredClone(history);
    const bound = { ...reserveBinding, action: "promote" };
    if (fault === "missing") values.length = 0;
    if (fault === "source") bound.sourceId = "changed";
    if (fault === "target") bound.targetNodeId = "changed";
    if (fault === "malformed") values.push({ version: 1, entries: [], dormant: {} });
    if (fault === "conflict")
      values.push({
        version: 1,
        entries: [],
        dormant: [{ ...(reserved.state as object), locationId: "different" }],
      });
    expect(() => readRetainedHourDormant(values, bound)).toThrow(
      expect.objectContaining({ code: "sif.allocation_invalid" }),
    );
  },
);

it("does not replace an earlier dormant configuration for the same node", async () => {
  const reserved = await reserve();
  await establish(reserved.state);
  const changed = structuredClone(reserved.state) as { binding: OperationBinding };
  changed.binding = { ...changed.binding, eventId: "second-admission" };
  const before = structuredClone(history);
  await expect(establish(changed, { eventId: "second-admission" })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  expect(history).toEqual(before);
});

it("leaves the journal untouched when a prepared callback does not establish a node", async () => {
  const state = (await reserve()).state;
  const binding = { ...reserveBinding, action: "establish" };
  await withOperationAuthority(binding, "administrator", (authority) =>
    createHourDormantPreparation(host).prepare(
      { binding, authority, input: state },
      async () => "no write",
    ),
  );
  expect(history).toEqual([]);
});

it("requires a durable host before exposing an establishment token", async () => {
  const state = (await reserve()).state;
  const binding = { ...reserveBinding, action: "establish" };
  await expect(
    withOperationAuthority(binding, "administrator", (authority) =>
      createHourDormantPreparation().prepare(
        { binding, authority, input: state },
        async () => "unexpected",
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "outside_confirmation_missing" },
  });
});

it.each(["action", "module", "operator", "reserve-input"])(
  "refuses a raw dormant %s mismatch",
  async (fault) => {
    const binding = {
      ...reserveBinding,
      ...(fault === "action" ? { action: "promote" } : {}),
      ...(fault === "module" ? { module: "other-module" } : {}),
    };
    const operator =
      fault === "operator"
        ? { kind: "recovery-key" as const, nodeId: standby.nodeId, eventId: binding.eventId }
        : "administrator";
    await expect(
      withOperationAuthority(binding, operator, (authority) =>
        createHourDormantPreparation(host).prepare(
          {
            binding,
            authority,
            input: { kind: "hour-dormant", version: fault === "reserve-input" ? 2 : 1 },
          },
          async () => "unexpected",
        ),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: {
        reason:
          fault === "operator"
            ? "reauthentication_required"
            : fault === "reserve-input"
              ? "reservation_mismatch"
              : "event_mismatch",
      },
    });
    expect(history).toEqual([]);
  },
);

it.each(["expired", "substituted", "node"])("refuses a %s dormant token", async (fault) => {
  let held!: ModuleOperationInput;
  const preparation = createHourDormantPreparation(host);
  if (fault === "expired") {
    await withOperationAuthority(reserveBinding, "administrator", (authority) =>
      preparation.prepare(
        { binding: reserveBinding, authority, input: { kind: "hour-dormant", version: 1 } },
        async (operation) => {
          held = operation;
        },
      ),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, held),
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "reauthentication_required" },
    });
  } else
    await withOperationAuthority(reserveBinding, "administrator", (authority) =>
      preparation.prepare(
        { binding: reserveBinding, authority, input: { kind: "hour-dormant", version: 1 } },
        async (operation) => {
          if (fault === "substituted")
            await withOperationAuthority(reserveBinding, "other-administrator", (other) =>
              expect(
                withTransaction(suite.db, (tx) =>
                  ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, {
                    ...operation,
                    authority: other,
                  }),
                ),
              ).rejects.toMatchObject({
                code: "sif.allocation_invalid",
                params: { reason: "event_mismatch" },
              }),
            );
          else
            await expect(
              withTransaction(suite.db, (tx) =>
                ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, primary, operation),
              ),
            ).rejects.toMatchObject({
              code: "sif.allocation_invalid",
              params: { reason: "node_mismatch" },
            });
        },
      ),
    );
});

it.each(["taxpayer", "country", "environment", "primary-sif", "sif-nif"])(
  "refuses unusable primary %s facts",
  async (fault) => {
    if (fault === "taxpayer") await suite.db.delete(tenants);
    if (fault === "country") await suite.db.update(tenants).set({ country: "FR" });
    if (fault === "environment") await suite.db.delete(deployment);
    if (fault === "primary-sif") await suite.db.update(registroSif).set({ revocadoEn: new Date() });
    if (fault === "sif-nif") await suite.db.update(registroSif).set({ nif: "50000000R" });
    const before = await rows();
    await expect(reserve()).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: {
        reason:
          fault === "environment"
            ? "environment_unstamped"
            : fault === "primary-sif"
              ? "primary_not_registered"
              : fault === "sif-nif"
                ? "scope_mismatch"
                : "taxpayer_missing",
      },
    });
    expect(await rows()).toEqual(before);
    expect(history).toEqual([]);
  },
);

it("rejects a primary passed as its own standby before returning configuration", async () => {
  await expect(
    withOperationAuthority(reserveBinding, "administrator", (authority) =>
      createHourDormantPreparation(host).prepare(
        { binding: reserveBinding, authority, input: { kind: "hour-dormant", version: 1 } },
        (operation) =>
          withTransaction(suite.db, (tx) =>
            ALLOCATED_FISCAL_STANDBY.reserve(tx, standby, standby, operation),
          ),
      ),
    ),
  ).rejects.toMatchObject({ code: "sif.allocation_invalid", params: { reason: "node_mismatch" } });
});

it("rejects changed establishment state beside an authentic prepared operation", async () => {
  const state = (await reserve()).state;
  const binding = { ...reserveBinding, action: "establish" };
  await expect(
    withOperationAuthority(binding, "administrator", (authority) =>
      createHourDormantPreparation(host).prepare(
        { binding, authority, input: state },
        (operation) =>
          withTransaction(suite.db, (tx) =>
            ALLOCATED_FISCAL_STANDBY.establish(
              tx,
              standby,
              { ...(state as object), locationId: "different" },
              operation,
            ),
          ),
      ),
    ),
  ).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reservation_mismatch" },
  });
  expect(history).toEqual([]);
});

it("rejects a live preparation token after its authenticating callback has ended", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const atGate = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let pending!: Promise<unknown>;
  await withOperationAuthority(reserveBinding, "administrator", async (authority) => {
    pending = createHourDormantPreparation(host).prepare(
      { binding: reserveBinding, authority, input: { kind: "hour-dormant", version: 1 } },
      async (operation) => {
        entered();
        await gate;
        return withTransaction(suite.db, (tx) =>
          ALLOCATED_FISCAL_STANDBY.reserve(tx, primary, standby, operation),
        );
      },
    );
    await atGate;
  });
  const refusal = expect(pending).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "reauthentication_required" },
  });
  release();
  await refusal;
  expect(history).toEqual([]);
});
