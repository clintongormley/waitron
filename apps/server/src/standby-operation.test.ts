import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  type Transaction,
  invoiceSeries,
  locations,
  nodes,
  readDeploymentMode,
  readSingletonRole,
  setDeploymentMode,
  stampDeployment,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CREDENTIALS_MIGRATIONS, loadKeyRing, tryGetCredential } from "@waitron/credentials";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  readOperationAuthority,
  withOperationAuthority,
  type ModuleOperationInput,
  type ProvisionedNode,
  type StandbyProvisioning,
  type WaitronModule,
} from "@waitron/module";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import { establishNodeIdentity } from "./node-identity.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
import { promoteMirrorToPrimary } from "./promote.js";
import { createDeploymentHolders } from "./deployment-holders.js";
import { withRecoveryKeyOperation } from "./operation-authentication.js";
import { mintBreakGlassSecret } from "./break-glass.js";

const modules = vi.hoisted(() => [] as WaitronModule[]);
vi.mock("./modules.js", () => ({ ALL_MODULES: modules }));
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });
const LOCATION = "e0000000-0000-4000-8000-000000000001";
const PRIMARY = "e0000000-0000-4000-8000-000000000002";
const TARGET = "e0000000-0000-4000-8000-000000000003";
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const input = { outsideEvidence: "opaque" };
const binding = {
  module: "test-regime",
  action: "reserve",
  eventId: "join-1",
  sourceId: PRIMARY,
  targetNodeId: TARGET,
};
let stateDir: string | undefined;

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-standby-operation-"));
  await mkdir(join(stateDir, "tls"));
  await writeFile(join(stateDir, "tls", "ca.crt"), "public-test-ca");
});
afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});
beforeEach(async () => {
  modules.length = 0;
  await seedTenant(suite.db);
  await suite.db.insert(locations).values({
    id: LOCATION,
    name: "Restaurant",
    invoiceLocales: ["es"],
    operationDescription: "Venta",
  });
  await suite.db.insert(nodes).values({ id: PRIMARY, locationId: LOCATION, name: "Primary" });
  await stampDeployment(suite.db, "preproduction");
});

function regime(
  reserve: (
    tx: Transaction,
    primary: ProvisionedNode,
    standby: ProvisionedNode | undefined,
    operation: ModuleOperationInput | undefined,
  ) => ReturnType<StandbyProvisioning["reserve"]>,
  establish: StandbyProvisioning["establish"] = async () => {},
  activate?: StandbyProvisioning["activate"],
) {
  return fakeModule(binding.module, {
    provisioning: { standby: { reserve, establish, activate } },
  });
}
function bundleDeps() {
  return {
    appDb: suite.db,
    ring: RING,
    stateDir: stateDir!,
    relayUrl: "https://relay.test",
    boxHostname: "waitron.local",
    accountKey: "public-test",
    designated: { nodeId: PRIMARY, locationId: LOCATION },
    standby: { nodeId: TARGET, publicKey: generateNodeKeyPair().publicKey },
  };
}
function adoptionArgs(standby = generateStandbyIdentity()) {
  return {
    locationId: LOCATION,
    standby,
    nodeName: "Standby",
    filingModule: null,
    taxModule: null,
    modules,
    reserved: {
      modules: { [binding.module]: { reserved: true } },
      series: [],
      endorsement: {
        nodeId: standby.nodeId,
        publicKey: standby.publicKey,
        endorsedBy: PRIMARY,
        signature: "test",
      },
    },
  };
}
function operations(authority: ModuleOperationInput["authority"], scope = binding) {
  return new Map([[scope.module, { input, binding: scope, authority }]]);
}

it("collects the standby's current outside input before the promotion transaction", async () => {
  const scope = { ...binding, action: "promote" };
  const deps = await mirror(async (tx, node, operation) => {
    expect(operation?.input).toEqual({ collected: "current-standby" });
    expect((await tx.select().from(locations))[0]?.name).toBe("outside-confirmed");
    await activateSeries(tx, node);
  });
  const prepared = {
    ...deps.modules[0]!,
    operations: {
      async prepare<T>(
        operation: ModuleOperationInput,
        run: (ready: ModuleOperationInput) => Promise<T>,
      ) {
        await withTransaction(suite.db, (tx) =>
          tx.update(locations).set({ name: "outside-confirmed" }),
        );
        return run({ ...operation, input: { collected: "current-standby" } });
      },
    },
  };
  const result = await withOperationAuthority(scope, "admin", (authority) =>
    promoteMirrorToPrimary(
      { ...deps, modules: [prepared], moduleOperations: operations(authority, scope) },
      { oldNodeNeutralised: true },
    ),
  );
  expect(result.alreadyPrimary).toBe(false);
  expect(await readDeploymentMode(suite.db, TARGET)).toBe("primary");
  expect(await readSingletonRole(suite.db, TARGET)).toBe("primary");
  expect((await suite.db.select().from(invoiceSeries)).map((row) => row.purpose).sort()).toEqual([
    "full",
    "rectificative",
    "standard",
  ]);
});

it("does not promote or open series after the standby's outside source refuses", async () => {
  const scope = { ...binding, action: "promote" };
  const deps = await mirror(async (tx, node) => {
    await activateSeries(tx, node);
  });
  const prepared = {
    ...deps.modules[0]!,
    operations: {
      async prepare() {
        throw new Error("current-register-refused");
      },
    },
  };
  await withOperationAuthority(scope, "admin", async (authority) => {
    await expect(
      promoteMirrorToPrimary(
        { ...deps, modules: [prepared], moduleOperations: operations(authority, scope) },
        { oldNodeNeutralised: true },
      ),
    ).rejects.toThrow("current-register-refused");
  });
  expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
  expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});

async function mirror(activate: StandbyProvisioning["activate"]) {
  await suite.db.insert(nodes).values({ id: TARGET, locationId: LOCATION, name: "Standby" });
  await setDeploymentMode(suite.db, TARGET, "mirror");
  await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, TARGET);
  return {
    db: suite.db,
    ring: RING,
    nodeId: TARGET,
    holders: createDeploymentHolders("mirror", "secondary"),
    log: () => {},
    persistTradingEnv: async () => {},
    modules: [
      regime(
        async () => ({ state: {} }),
        async () => {},
        activate,
      ),
    ],
  };
}
async function activateSeries(tx: Transaction, node: ProvisionedNode) {
  await tx.insert(invoiceSeries).values(
    ["standard", "full", "rectificative"].map((purpose) => ({
      nodeId: node.nodeId,
      code: purpose + "-P000042",
      purpose,
    })),
  );
}

describe("opaque authenticated standby carriers", () => {
  it("delivers the named standby and reserve authority to its module", async () => {
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, PRIMARY);
    let received: ModuleOperationInput | undefined;
    modules.push(
      regime(async (_tx, primary, standby, operation) => {
        expect(primary.nodeId).toBe(PRIMARY);
        expect(standby).toEqual({ nodeId: TARGET, locationId: LOCATION });
        received = operation;
        expect(operation).toBeDefined();
        expect(operation!.input).toBe(input);
        expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
          operatorId: "admin",
        });
        return { state: { reservation: "signed-public-evidence" } };
      }),
    );
    await withOperationAuthority(binding, "admin", async (authority) => {
      const result = await assembleMirrorBundle({
        ...bundleDeps(),
        moduleOperations: operations(authority),
      });
      expect(result.reservedIdentity.modules).toEqual({
        [binding.module]: { reservation: "signed-public-evidence" },
      });
      expect(result.reservedIdentity.series).toEqual([]);
    });
    expect(readOperationAuthority(received!.authority, received!.binding)).toBeUndefined();
  });

  it.each(["module", "action", "targetNodeId"] as const)(
    "rejects mismatched reserve %s before module writes",
    async (key) => {
      await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, PRIMARY);
      let entered = false;
      modules.push(
        regime(async () => {
          entered = true;
          return { state: {} };
        }),
      );
      const wrong = { ...binding, [key]: "wrong" };
      await withOperationAuthority(wrong, "admin", async (authority) => {
        await expect(
          assembleMirrorBundle({
            ...bundleDeps(),
            moduleOperations: new Map([[binding.module, { input, binding: wrong, authority }]]),
          }),
        ).rejects.toMatchObject({ code: "module.operation_invalid" });
      });
      expect(entered).toBe(false);
    },
  );

  it("delivers freshly scoped establishment input without creating live invoice series", async () => {
    const args = adoptionArgs();
    const scope = { ...binding, action: "establish", targetNodeId: args.standby.nodeId };
    modules.push(
      regime(
        async () => ({ state: {} }),
        async (tx, node, state, operation) => {
          expect(node.nodeId).toBe(args.standby.nodeId);
          expect(state).toEqual({ reserved: true });
          expect(operation).toBeDefined();
          expect(operation!.input).toBe(input);
          expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
            operatorId: "admin",
          });
          await tx.update(nodes).set({ name: "Dormant" }).where(eq(nodes.id, node.nodeId));
        },
      ),
    );
    await withOperationAuthority(scope, "admin", (authority) =>
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        { ...args, moduleOperations: operations(authority, scope) },
      ),
    );
    expect(
      (await suite.db.select().from(nodes).where(eq(nodes.id, args.standby.nodeId)))[0]!.name,
    ).toBe("Dormant");
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
  });

  it("rolls back the node and sealed key when establishment authority is stale", async () => {
    const args = adoptionArgs();
    const scope = { ...binding, action: "establish", targetNodeId: args.standby.nodeId };
    const authority = await withOperationAuthority(scope, "admin", async (token) => token);
    let entered = false;
    modules.push(
      regime(
        async () => ({ state: {} }),
        async () => {
          entered = true;
        },
      ),
    );
    await expect(
      establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        { ...args, moduleOperations: operations(authority, scope) },
      ),
    ).rejects.toMatchObject({ code: "module.operation_invalid" });
    expect(entered).toBe(false);
    expect(await suite.db.select().from(nodes).where(eq(nodes.id, args.standby.nodeId))).toEqual(
      [],
    );
    expect(
      await withTransaction(suite.db, (tx) =>
        tryGetCredential(tx, RING, { purpose: "membership.node_key" }),
      ),
    ).toBeNull();
  });

  it("activates a dormant module before reading series and commits with the role change", async () => {
    await suite.db.insert(nodes).values({ id: TARGET, locationId: LOCATION, name: "Standby" });
    await setDeploymentMode(suite.db, TARGET, "mirror");
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, TARGET);
    const scope = { ...binding, action: "promote" };
    const module = regime(
      async () => ({ state: {} }),
      async () => {},
      async (tx, node, operation) => {
        expect(operation).toBeDefined();
        expect(operation!.input).toBe(input);
        expect(readOperationAuthority(operation!.authority, operation!.binding)).toEqual({
          operatorId: "admin",
        });
        await tx.insert(invoiceSeries).values(
          ["standard", "full", "rectificative"].map((purpose) => ({
            nodeId: node.nodeId,
            code: purpose + "-P000042",
            purpose,
          })),
        );
      },
    );
    const holders = createDeploymentHolders("mirror", "secondary");
    await withOperationAuthority(scope, "admin", async (authority) => {
      const result = await promoteMirrorToPrimary(
        {
          db: suite.db,
          ring: RING,
          nodeId: TARGET,
          holders,
          log: () => {},
          persistTradingEnv: async () => {},
          modules: [module],
          moduleOperations: operations(authority, scope),
        },
        { oldNodeNeutralised: true },
      );
      expect(result.alreadyPrimary).toBe(false);
      expect(
        (
          await suite.db.select().from(invoiceSeries).where(eq(invoiceSeries.id, result.seriesId))
        )[0]!.purpose,
      ).toBe("standard");
    });
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("primary");
    expect(await readSingletonRole(suite.db, TARGET)).toBe("primary");
    expect(holders.mode.current).toBe("primary");
  });

  it("uses the authenticated host's transaction for activation and the role change", async () => {
    const scope = { ...binding, action: "promote" };
    const deps = await mirror(async (tx, node, operation) => {
      expect(operation).toBeDefined();
      expect(readOperationAuthority(operation!.authority, scope)).toEqual({
        operatorId: { kind: "recovery-key", nodeId: TARGET, eventId: scope.eventId },
      });
      await activateSeries(tx, node);
    });
    const key = await mintBreakGlassSecret(suite.db, TARGET);
    const result = await promoteMirrorToPrimary(
      {
        ...deps,
        withModuleOperations: ({ db, node }, run) =>
          withRecoveryKeyOperation({ db, nodeId: node.nodeId }, scope, key, (tx, authority) =>
            run(tx, operations(authority, scope)),
          ),
      },
      { oldNodeNeutralised: true },
    );
    expect(result.alreadyPrimary).toBe(false);
    expect(await readSingletonRole(suite.db, TARGET)).toBe("primary");
  });

  it("refuses a recovery key replaced while the host prepares promotion", async () => {
    const scope = { ...binding, action: "promote" };
    let entered = false;
    const deps = await mirror(async (tx, node) => {
      entered = true;
      await activateSeries(tx, node);
    });
    const key = await mintBreakGlassSecret(suite.db, TARGET);
    await expect(
      promoteMirrorToPrimary(
        {
          ...deps,
          withModuleOperations: async ({ db, node }, run) => {
            await mintBreakGlassSecret(db, node.nodeId);
            return withRecoveryKeyOperation(
              { db, nodeId: node.nodeId },
              scope,
              key,
              (tx, authority) => run(tx, operations(authority, scope)),
            );
          },
        },
        { oldNodeNeutralised: true },
      ),
    ).rejects.toMatchObject({ code: "promotion.break_glass_invalid" });
    expect(entered).toBe(false);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
    expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
  });

  it("rolls back activation when the module omits the full-purpose series", async () => {
    const deps = await mirror(async (tx, node) => {
      await tx
        .insert(invoiceSeries)
        .values({ nodeId: node.nodeId, code: "A-P000042", purpose: "standard" });
    });
    let persisted = false;
    await expect(
      promoteMirrorToPrimary(
        {
          ...deps,
          persistTradingEnv: async () => {
            persisted = true;
          },
        },
        { oldNodeNeutralised: true },
      ),
    ).rejects.toMatchObject({ code: "series.no_full_for_node" });
    expect(persisted).toBe(false);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
    expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
  });

  it("rolls back activation when the membership write refuses", async () => {
    const deps = await mirror(activateSeries);
    await suite.db.execute(
      sql`create trigger refuse_chart before insert on node_membership begin select raise(abort, 'test chart refusal'); end`,
    );
    try {
      await expect(promoteMirrorToPrimary(deps, { oldNodeNeutralised: true })).rejects.toThrow(
        "test chart refusal",
      );
      expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
      expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
      expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
    } finally {
      await suite.db.execute(sql`drop trigger refuse_chart`);
    }
  });

  it("keeps the submitted promotion scope while an earlier transaction delays preparation", async () => {
    const scope = { ...binding, action: "promote" };
    const suppliedScope = { ...scope };
    const deps = await mirror(async (tx, node, operation) => {
      expect(operation).toBeDefined();
      expect(operation!.binding).toEqual(scope);
      await activateSeries(tx, node);
    });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = withTransaction(suite.db, async () => {
      enter();
      await released;
    });
    await entered;
    await withOperationAuthority(scope, "admin", async (authority) => {
      const supplied = operations(authority, suppliedScope);
      const pending = promoteMirrorToPrimary(
        { ...deps, moduleOperations: supplied },
        { oldNodeNeutralised: true },
      );
      supplied.clear();
      suppliedScope.eventId = "changed";
      release();
      await blocker;
      expect((await pending).alreadyPrimary).toBe(false);
    });
    expect(await readSingletonRole(suite.db, TARGET)).toBe("primary");
  });

  it("snapshots freshly authenticated host entries before the first activation hook", async () => {
    const scope = { ...binding, action: "promote" };
    const deps = await mirror(async (tx, node, operation) => {
      expect(operation).toBeDefined();
      expect(operation!.binding).toEqual(scope);
      await activateSeries(tx, node);
    });
    await withOperationAuthority(scope, "admin", async (authority) => {
      const suppliedScope = { ...scope };
      const supplied = operations(authority, suppliedScope);
      const earlier = fakeModule("other-regime", {
        provisioning: {
          standby: {
            reserve: async () => ({ state: {} }),
            establish: async () => {},
            activate: async () => {
              supplied.clear();
              suppliedScope.eventId = "changed";
            },
          },
        },
      });
      const result = await promoteMirrorToPrimary(
        {
          ...deps,
          modules: [earlier, ...deps.modules],
          withModuleOperations: ({ db }, run) => withTransaction(db, (tx) => run(tx, supplied)),
        },
        { oldNodeNeutralised: true },
      );
      expect(result.alreadyPrimary).toBe(false);
    });
  });

  it("rechecks expired promotion authority after an awaited module write", async () => {
    const scope = { ...binding, action: "promote" };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = await mirror(async (tx, node) => {
      await activateSeries(tx, node);
      enter();
      await released;
    });
    let persisted = false;
    let pending!: Promise<unknown>;
    await withOperationAuthority(scope, "admin", async (authority) => {
      pending = promoteMirrorToPrimary(
        {
          ...deps,
          moduleOperations: operations(authority, scope),
          persistTradingEnv: async () => {
            persisted = true;
          },
        },
        { oldNodeNeutralised: true },
      );
      await entered;
    });
    const refused = expect(pending).rejects.toMatchObject({ code: "module.operation_invalid" });
    release();
    await refused;
    expect(persisted).toBe(false);
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
  });

  it("refuses authority revoked during the trading-settings write", async () => {
    const scope = { ...binding, action: "promote" };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps = await mirror(activateSeries);
    let pending!: Promise<unknown>;
    await withOperationAuthority(scope, "admin", async (authority) => {
      pending = promoteMirrorToPrimary(
        {
          ...deps,
          moduleOperations: operations(authority, scope),
          persistTradingEnv: async () => {
            enter();
            await released;
          },
        },
        { oldNodeNeutralised: true },
      );
      await entered;
    });
    const refused = expect(pending).rejects.toMatchObject({ code: "module.operation_invalid" });
    release();
    await refused;
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
  });

  it("snapshots reserve input before waiting for a prior transaction", async () => {
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, PRIMARY);
    modules.push(
      regime(async (_tx, _primary, _standby, operation) => {
        expect(operation).toBeDefined();
        expect(operation!.binding).toEqual(binding);
        expect(operation).toBeDefined();
        expect(operation!.input).toBe(input);
        return { state: { reserved: true } };
      }),
    );
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocker = withTransaction(suite.db, async () => {
      enter();
      await released;
    });
    await entered;
    await withOperationAuthority(binding, "admin", async (authority) => {
      const scope = { ...binding };
      const supplied = operations(authority, scope);
      const pending = assembleMirrorBundle({ ...bundleDeps(), moduleOperations: supplied });
      scope.eventId = "changed";
      supplied.clear();
      release();
      await blocker;
      expect((await pending).reservedIdentity.modules).toEqual({
        [binding.module]: { reserved: true },
      });
    });
  });

  it("rolls back a reservation write when authority expires during its await", async () => {
    await establishNodeIdentity({ ownerDb: suite.db, ring: RING }, PRIMARY);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    modules.push(
      regime(async (tx) => {
        await tx.update(locations).set({ name: "Changed" });
        enter();
        await released;
        return { state: { reserved: true } };
      }),
    );
    let pending!: Promise<unknown>;
    await withOperationAuthority(binding, "admin", async (authority) => {
      pending = assembleMirrorBundle({ ...bundleDeps(), moduleOperations: operations(authority) });
      await entered;
    });
    const refused = expect(pending).rejects.toMatchObject({ code: "module.operation_invalid" });
    release();
    await refused;
    expect((await suite.db.select().from(locations))[0]!.name).toBe("Restaurant");
  });

  it("rolls back establishment writes when authority expires during its await", async () => {
    const args = adoptionArgs();
    const scope = { ...binding, action: "establish", targetNodeId: args.standby.nodeId };
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    modules.push(
      regime(
        async () => ({ state: {} }),
        async (tx) => {
          await tx.update(locations).set({ name: "Changed" });
          enter();
          await released;
        },
      ),
    );
    let pending!: Promise<unknown>;
    await withOperationAuthority(scope, "admin", async (authority) => {
      pending = establishReservedStandbyIdentity(
        { ownerDb: suite.db, ring: RING },
        { ...args, moduleOperations: operations(authority, scope) },
      );
      await entered;
    });
    const refused = expect(pending).rejects.toMatchObject({ code: "module.operation_invalid" });
    release();
    await refused;
    expect((await suite.db.select().from(locations))[0]!.name).toBe("Restaurant");
    expect(await suite.db.select().from(nodes).where(eq(nodes.id, args.standby.nodeId))).toEqual(
      [],
    );
    expect(
      await withTransaction(suite.db, (tx) =>
        tryGetCredential(tx, RING, { purpose: "membership.node_key" }),
      ),
    ).toBeNull();
  });

  it("rolls back promotion if the trading-settings write fails", async () => {
    const deps = await mirror(activateSeries);
    await expect(
      promoteMirrorToPrimary(
        {
          ...deps,
          persistTradingEnv: async () => {
            throw new Error("settings write refused");
          },
        },
        { oldNodeNeutralised: true },
      ),
    ).rejects.toThrow("settings write refused");
    expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
    expect(await readSingletonRole(suite.db, TARGET)).toBe("secondary");
  });

  it.each(["module", "action", "targetNodeId"] as const)(
    "refuses mismatched promotion %s before activation",
    async (key) => {
      let entered = false;
      const deps = await mirror(async (tx, node) => {
        entered = true;
        await activateSeries(tx, node);
      });
      const scope = { ...binding, action: "promote", [key]: "wrong" };
      await withOperationAuthority(scope, "admin", async (authority) => {
        await expect(
          promoteMirrorToPrimary(
            {
              ...deps,
              moduleOperations: new Map([[binding.module, { input, binding: scope, authority }]]),
            },
            { oldNodeNeutralised: true },
          ),
        ).rejects.toMatchObject({ code: "module.operation_invalid" });
      });
      expect(entered).toBe(false);
      expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
      expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
    },
  );

  it("refuses a mirror whose configured node has no venue row", async () => {
    await setDeploymentMode(suite.db, TARGET, "mirror");
    await expect(
      promoteMirrorToPrimary(
        {
          db: suite.db,
          ring: RING,
          nodeId: TARGET,
          holders: createDeploymentHolders("mirror", "secondary"),
          log: () => {},
          persistTradingEnv: async () => {},
        },
        { oldNodeNeutralised: true },
      ),
    ).rejects.toMatchObject({ code: "node.not_found", params: { id: TARGET } });
    expect(await readDeploymentMode(suite.db, TARGET)).toBe("mirror");
  });
});
