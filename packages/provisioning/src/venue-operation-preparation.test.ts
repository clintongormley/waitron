import { expect, it } from "vitest";
import { withTransaction, nodes, tenants } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readOperationAuthority, withOperationAuthority } from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { applyVenue } from "./venue-apply.js";
import { planVenue, type VenueRequest } from "./venue-plan.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const request: VenueRequest = {
  country: "ES",
  taxId: "B12345678",
  legalName: "Restaurant SL",
  location: {
    name: "Restaurant",
    fiscalTerritory: "ES-common",
    invoiceLocales: ["es-ES"],
    operationDescription: "Venta",
    addressLine1: "Calle Mayor 1",
    addressLine2: null,
    postalCode: "28013",
    city: "Madrid",
    province: "Madrid",
    timeZone: "Europe/Madrid",
    dayCutover: "06:00:00",
  },
  seriesCode: "A",
  fullSeriesCode: "FF",
  rectificativeSeriesCode: "R",
  admin: {
    displayName: "Owner",
    pinHash: "hash",
    passwordHash: "hash",
    email: "owner@example.test",
  },
};
const input = { allocation: { opaque: true }, operatorId: "submitted-other-person" };
const setup = { eventId: "setup-1", sourceId: "new-venue-1", input };

const NODE = "d0000000-0000-4000-8000-000000000001";
const ADMIN = "d0000000-0000-4000-8000-000000000002";
function regime(prepare: import("@waitron/module").ModuleOperationPreparation["prepare"]) {
  return fakeModule("test-regime", {
    operations: { prepare },
    provisioning: {
      seed: {
        summary: "initial source",
        run: async (tx, node, operation) => {
          expect(operation?.input).toBe("current-outside-input");
          expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
            operatorId: ADMIN,
          });
          expect(node.nodeId).toBe(NODE);
          const [admin] = await tx.select().from(persons);
          expect(admin?.id).toBe(ADMIN);
          return "initial allocation qualified";
        },
      },
    },
  });
}
function apply(
  module: import("@waitron/module").WaitronModule,
  beforeCommit?: import("./venue-apply.js").VenueApplyDeps["beforeCommit"],
) {
  return applyVenue(planVenue(request, [module]), {
    db: suite.db,
    modules: [module],
    initialNodeId: NODE,
    initialAdministratorId: ADMIN,
    moduleInputs: new Map([[module.name, setup]]),
    beforeCommit,
  });
}

it("refuses a prepared authority issued to another administrator before creating the venue", async () => {
  let seeded = false;
  const owner = fakeModule("test-regime", {
    operations: {
      prepare: (operation, run) =>
        withOperationAuthority(
          operation.binding,
          "d0000000-0000-4000-8000-000000000099",
          (authority) => run({ ...operation, authority }),
        ),
    },
    provisioning: {
      seed: {
        summary: "initial source",
        run: async () => {
          seeded = true;
          return "unexpected setup";
        },
      },
    },
  });
  await expect(apply(owner)).rejects.toMatchObject({ code: "module.operation_invalid" });
  expect(seeded).toBe(false);
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("prepares the initial signed input before the venue transaction, then binds the created account", async () => {
  const owner = regime(async (operation, run) => {
    expect(operation.binding).toEqual({
      module: "test-regime",
      action: "setup",
      eventId: "setup-1",
      sourceId: "new-venue-1",
      targetNodeId: NODE,
    });
    expect(readOperationAuthority(operation.authority, operation.binding)).toEqual({
      operatorId: ADMIN,
    });
    expect(await suite.db.select().from(persons)).toEqual([]);
    await withTransaction(suite.db, (tx) =>
      tx
        .insert(tenants)
        .values({ id: 1, country: "ES", taxId: "B12345678", legalName: "outside-writer" }),
    );
    return run({ ...operation, input: "current-outside-input" });
  });
  const result = await apply(owner);
  expect(result.nodeId).toBe(NODE);
  expect(result.seeded).toEqual([
    { module: "test-regime", report: "initial allocation qualified" },
  ]);
  expect((await suite.db.select().from(tenants))[0]?.legalName).toBe("outside-writer");
});

it("does not create the initial account or venue after the outside source refuses", async () => {
  const owner = regime(async () => {
    throw new Error("current-source-refused");
  });
  await expect(apply(owner)).rejects.toThrow("current-source-refused");
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("does not attribute initial collection to an already-existing administrator", async () => {
  await suite.db.insert(persons).values({ id: ADMIN, displayName: "Existing", role: "admin" });
  let consulted = false;
  const owner = regime(async (operation, run) => {
    consulted = true;
    return run(operation);
  });
  await expect(apply(owner)).rejects.toMatchObject({
    code: "provisioning.initial_operator_required",
  });
  expect(consulted).toBe(false);
  expect(await suite.db.select().from(nodes)).toEqual([]);
});

it("does not recollect outside input when repeating the committed venue", async () => {
  let consultations = 0;
  const owner = regime(async (operation, run) => {
    consultations++;
    return run({ ...operation, input: "current-outside-input" });
  });
  const first = await apply(owner);
  const repeated = await apply(owner);
  expect(repeated.nodeId).toBe(first.nodeId);
  expect(repeated.seriesIds).toEqual(first.seriesIds);
  expect(repeated.seeded).toEqual([]);
  expect(consultations).toBe(1);
  expect(await suite.db.select().from(persons)).toHaveLength(1);
});

it("rolls back the initial account and node when the last host write refuses", async () => {
  const owner = regime(async (operation, run) =>
    run({ ...operation, input: "current-outside-input" }),
  );
  await expect(
    apply(owner, async () => {
      throw new Error("last-host-write-refused");
    }),
  ).rejects.toThrow("last-host-write-refused");
  expect(await suite.db.select().from(persons)).toEqual([]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("refuses a competing administrator created during outside collection", async () => {
  const owner = regime(async (operation, run) => {
    await withTransaction(suite.db, (tx) =>
      tx.insert(persons).values({ id: ADMIN, displayName: "Concurrent owner", role: "admin" }),
    );
    return run({ ...operation, input: "current-outside-input" });
  });
  await expect(apply(owner)).rejects.toMatchObject({
    code: "provisioning.initial_operator_required",
  });
  expect((await suite.db.select().from(persons)).map((row) => row.displayName)).toEqual([
    "Concurrent owner",
  ]);
  expect(await suite.db.select().from(nodes)).toEqual([]);
  expect(await suite.db.select().from(tenants)).toEqual([]);
});

it("keeps the planned account fields when the source mutates the caller's action list", async () => {
  const owner = regime(async (operation, run) => {
    const admin = actions.find((action) => action.kind === "seed-admin")!;
    admin.displayName = "Substituted";
    admin.email = "substituted@example.test";
    return run({ ...operation, input: "current-outside-input" });
  });
  const actions = planVenue(request, [owner]);
  await applyVenue(actions, {
    db: suite.db,
    modules: [owner],
    initialNodeId: NODE,
    initialAdministratorId: ADMIN,
    moduleInputs: new Map([[owner.name, setup]]),
  });
  const [admin] = await suite.db.select().from(persons);
  expect(admin?.displayName).toBe("Owner");
  expect(admin?.email).toBe("owner@example.test");
});

it("refuses initial preparation when the plan supplies no new administrator", async () => {
  let consulted = false;
  const owner = regime(async (operation, run) => {
    consulted = true;
    return run(operation);
  });
  await expect(
    applyVenue(
      planVenue(request, [owner]).filter((action) => action.kind !== "seed-admin"),
      {
        db: suite.db,
        modules: [owner],
        initialNodeId: NODE,
        initialAdministratorId: ADMIN,
        moduleInputs: new Map([[owner.name, setup]]),
      },
    ),
  ).rejects.toMatchObject({ code: "provisioning.initial_operator_required" });
  expect(consulted).toBe(false);
  expect(await suite.db.select().from(nodes)).toEqual([]);
});
