import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  locations,
  readDeploymentEnvironment,
  readDeploymentMode,
  readMirrorConfig,
  tenants,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { isEnabled, type ModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { adoptFromPrimary, type AdoptCredential, type PersistTradingArgs } from "./adopt.js";
import { ALL_MODULES } from "./modules.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import type { PendingAdoption } from "./finish-adoption.js";
import { verifyBreakGlass } from "./break-glass.js";

// One migrated venue database for the whole file; `useVenueDb` empties the data after every case, so
// each one starts from an unstamped `deployment` and an empty `tenants`.
//
// It reached this engine as a per-case clone of a shared PostgreSQL template, opened TWICE: an
// owner connection for the stamp/`mirror_config`/verifier writes, and a second connection logged in
// as `app_login` → `app_user` that the break-glass read-back was taken on. That second connection
// is gone with the roles and the grants, and one file has one writer here, so every case runs on
// the single handle.
//
// LOST with it, and covered by nothing: that the application role may READ the break-glass verifier
// while holding none of the writes adopt makes — the split `adopt.ts:40` still describes. The round
// trip itself survives below and is not vacuous: with `+ "x"` appended to the secret the assertion
// reads `expected false to be true`, so the stored scrypt verifier is genuinely being checked. It is
// only the "on a connection that is NOT the owner" half that no longer has a subject.
//
// Per-case independence now rests on `useVenueDb`'s default `resetPerTest`, not on a fresh clone.
// Measured with `resetPerTest: false` as the control: five cases go red. Three read
// `expected 'preproduction' to be null`, because the first case's stamp survives into them; the
// same-tenant case dies earlier still, on `UNIQUE constraint failed: tenants.id` from the previous
// case's seed; and the module-overrides case throws `provisioning.foreign_tenant`, on the foreign
// tenant a case three earlier left behind.

// The four ids the mirror mirrors — a hand-built `AdoptResult` (adopt inserts no rows any more, so no
// venue provisioning is needed here). A fixed set is enough: adopt never reads these back from the DB.
const DESIGNATED = {
  locationId: "22222222-2222-4222-8222-222222222222",
  tillId: "33333333-3333-4333-8333-333333333333",
  nodeId: "44444444-4444-4444-8444-444444444444",
  seriesId: "55555555-5555-4555-8555-555555555555",
} as const;

const RESERVED: ReservedIdentity = {
  modules: {
    "fiscal-verifactu": { nif: "90000001K", idSistemaInformatico: "WS", numeroInstalacion: 7 },
  },
  series: [{ code: "SA-7", purpose: "standard" }],
  endorsement: {
    nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    publicKey: "STANDBY_PUB",
    endorsedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    signature: "SIG",
  },
};

function makeBundle(over: Partial<MirrorBundle> = {}): MirrorBundle {
  return {
    designated: DESIGNATED,
    tenant: { country: "ES", taxId: "80000001K" },
    primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
    environment: "preproduction",
    boxHostname: "waitron.local",
    boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
    relayUrl: "https://relay.test:9000/",
    accountKey: Buffer.alloc(32, 9).toString("base64"),
    reservedIdentity: RESERVED,
    moduleOverrides: {},
    ...over,
  };
}

const CREDENTIAL: AdoptCredential = {
  personId: "99999999-9999-4999-8999-999999999999",
  password: "dashPass123",
};
const REQ = { primaryUrl: "https://primary.test/", credential: CREDENTIAL } as const;
const ADVERTISED_ORIGIN = "https://standby.deli.test";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// Still per-case: `pending-adoption.json` is the one thing adopt writes outside the database, and a
// case reads it back by path.
let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-adopt-state-"));
});

afterEach(async () => {
  const dir = stateDir;
  stateDir = undefined as unknown as string;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

/** Build the AdoptDeps for a run, with capture buffers. */
function deps(
  extra: {
    persistTrading?: (a: PersistTradingArgs) => Promise<void>;
    persistModuleConfig?: (c: ModuleConfig) => Promise<void>;
    fetchBundle?: (
      url: string,
      c: AdoptCredential,
      s: { nodeId: string; publicKey: string; contactUrl: string },
    ) => Promise<MirrorBundle>;
    environment?: "production" | "preproduction";
  } = {},
) {
  return {
    ownerDb: suite.db,
    advertisedOrigin: ADVERTISED_ORIGIN,
    environment: extra.environment ?? ("preproduction" as const),
    fetchBundle: extra.fetchBundle ?? (async () => makeBundle()),
    persistTrading: extra.persistTrading ?? (async () => {}),
    persistModuleConfig: extra.persistModuleConfig ?? (async () => {}),
    stateDir,
    database: "mirror_db",
  };
}

describe("adoptFromPrimary (mirror adopt)", () => {
  it("stamps the mirror, writes its config and returns the break-glass secret", async () => {
    const persistedTrading: PersistTradingArgs[] = [];
    const persistedModules: ModuleConfig[] = [];
    let capturedStandby: { nodeId: string; publicKey: string; contactUrl: string } | undefined;

    const result = await adoptFromPrimary(
      deps({
        persistTrading: async (a) => {
          persistedTrading.push(a);
        },
        persistModuleConfig: async (c) => {
          persistedModules.push(c);
        },
        fetchBundle: async (_u, _c, s) => {
          capturedStandby = s;
          return makeBundle();
        },
      }),
      REQ,
    );

    // The mirror is stamped + flipped, mirror_config written with the PRIMARY's node as the origin.
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    expect(await readDeploymentMode(suite.db)).toBe("mirror");
    const cfg = (await readMirrorConfig(suite.db))!;
    expect(cfg.relayUrl).toBe("https://relay.test:9000/");
    expect(cfg.originNodeId).toBe(DESIGNATED.nodeId);

    // trading.env carries the shared venue's ids but the mirror's OWN node id (the minted standby),
    // NOT the primary's, and no sync-pool env (the outbox is gone).
    expect(persistedTrading).toHaveLength(1);
    expect(persistedTrading[0]).toMatchObject({
      locationId: DESIGNATED.locationId,
      tillId: DESIGNATED.tillId,
      seriesId: DESIGNATED.seriesId,
      nodeId: capturedStandby!.nodeId,
      environment: "preproduction",
    });
    expect(persistedTrading[0]!.nodeId).not.toBe(DESIGNATED.nodeId);
    expect("syncDatabaseUrl" in persistedTrading[0]!).toBe(false);

    // The module set was persisted (SP-1d), and the break-glass secret is returned once + verifiable.
    expect(persistedModules).toHaveLength(1);
    expect(isEnabled(persistedModules[0]!, ALL_MODULES[0]!.name)).toBe(true);
    expect(result.breakGlassSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await verifyBreakGlass(suite.db, result.breakGlassSecret)).toBe(true);
  });

  it("writes the pending-adoption latch (dormant identity for the boot finish worker)", async () => {
    let capturedStandby: { nodeId: string; publicKey: string } | undefined;
    await adoptFromPrimary(
      deps({
        fetchBundle: async (_u, _c, s) => {
          capturedStandby = s;
          return makeBundle();
        },
      }),
      REQ,
    );
    // Deletion-proof: drop `writePendingAdoption` in adopt.ts and this file never appears, so the boot
    // finish worker would never establish the reserved identity.
    const pending = JSON.parse(
      await readFile(join(stateDir, "pending-adoption.json"), "utf8"),
    ) as PendingAdoption;
    expect(pending.locationId).toBe(DESIGNATED.locationId);
    expect(pending.originNodeId).toBe(DESIGNATED.nodeId);
    expect(pending.standby.nodeId).toBe(capturedStandby!.nodeId);
    expect(pending.standby.publicKey).toBe(capturedStandby!.publicKey);
    // The private key is persisted for the finish worker to seal (never sent to the primary).
    expect(typeof pending.standby.privateKey).toBe("string");
    expect(pending.standby.privateKey.length).toBeGreaterThan(0);
    expect(pending.nodeName).toBe("Caja 1 (standby)");
    expect(pending.filingModule).toBe("fiscal-verifactu");
    expect(pending.reserved).toEqual(RESERVED);
  });

  it("threads this node's advertised origin to the primary as the standby's contactUrl", async () => {
    let capturedStandby: { contactUrl: string } | undefined;
    await adoptFromPrimary(
      deps({
        fetchBundle: async (_u, _c, s) => {
          capturedStandby = s;
          return makeBundle();
        },
      }),
      REQ,
    );
    expect(capturedStandby!.contactUrl).toBe(ADVERTISED_ORIGIN);
  });

  it("refuses a bundle for a DIFFERENT environment before any stamp", async () => {
    let tradingPersisted = false;
    const error = await adoptFromPrimary(
      deps({
        environment: "preproduction",
        persistTrading: async () => {
          tradingPersisted = true;
        },
        fetchBundle: async () => makeBundle({ environment: "production" }),
      }),
      REQ,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("mirror.environment_mismatch");
    expect(isAppError(error) && error.params).toMatchObject({
      expected: "preproduction",
      actual: "production",
    });
    // Nothing ran: nothing stamped, no trading persisted.
    expect(tradingPersisted).toBe(false);
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a FOREIGN tenant before any mutation (§5, one tenant per database)", async () => {
    // Seed a DIFFERENT tenant into the mirror, then adopt a bundle for our tenant identity: refused.
    // Through the table definition, like every other fixture row in this package: a raw insert
    // reaches no `$defaultFn` generator (`tenants.created_at` is one), and the sibling location
    // insert below carried `array[...]`, which this engine refuses at prepare.
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "99999999R", legalName: "Incumbent SL" });
    const error = await adoptFromPrimary(deps(), REQ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");
    // Refused before any mutation: the database carries no deployment stamp.
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a same-tenant venue before any mutation", async () => {
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Incumbent SL" });
    await suite.db.insert(locations).values({
      name: "Existing venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const error = await adoptFromPrimary(deps(), REQ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.second_venue");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses (fail-closed) a bundle naming an unknown module, before any mutation", async () => {
    const error = await adoptFromPrimary(
      deps({
        fetchBundle: async () => makeBundle({ moduleOverrides: { "no-such": false } }),
      }),
      REQ,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("module.config_unknown");
    // Validated up-front, before any mutation.
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("bootstraps the mirror's module set from the bundle overrides", async () => {
    const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
    let persisted: ModuleConfig | undefined;
    await adoptFromPrimary(
      deps({
        persistModuleConfig: async (c) => {
          persisted = c;
        },
        fetchBundle: async () => makeBundle({ moduleOverrides: { [toggleable]: false } }),
      }),
      REQ,
    );
    expect(persisted).toBeDefined();
    expect(isEnabled(persisted!, toggleable)).toBe(false);
  });
});
