import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  locations,
  readDeploymentEnvironment,
  stampDeployment,
  tenants,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  readMirrorLink,
  readNodeMode,
  readPinnedPrimaryKey,
  readRecoveryKeyName,
} from "@waitron/node-db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { isEnabled, type ModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  putCredential,
  readNodeSigningKey,
} from "@waitron/credentials";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import {
  adoptFromPrimary,
  type AdoptCredential,
  type AdoptHooks,
  type PersistTradingArgs,
} from "./adopt.js";
import { ALL_MODULES } from "./modules.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import type { StandbyIdentity } from "./reserved-identity.js";
import type { PendingAdoption } from "./finish-adoption.js";
import { verifyBreakGlass } from "./break-glass.js";
import { keyRingEnv, writeCredentialsRing } from "./box-secrets.js";
import { parseEnvFile } from "./env-file.js";

vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return {
    ...actual,
    ALL_MODULES: actual.ALL_MODULES.map((module) =>
      module.name === "fiscal-verifactu" ? { ...module, operations: undefined } : module,
    ),
  };
});

// One identity for every adopt, so a fixture can endorse the identity the box sends.
vi.mock("./reserved-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reserved-identity.js")>();
  return { ...actual, generateStandbyIdentity: () => STANDBY };
});

// Cases depend on `useVenueDb`'s default `resetPerTest`: each starts from an unstamped `deployment`
// and an empty `tenants`.

// Adopt never reads these ids back from the database, so a fixed set is enough.
const DESIGNATED = {
  locationId: "22222222-2222-4222-8222-222222222222",
  nodeId: "44444444-4444-4444-8444-444444444444",
} as const;

const PRIMARY_KEYS = generateNodeKeyPair();
const STANDBY: StandbyIdentity = {
  nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ...generateNodeKeyPair(),
};

const RESERVED: ReservedIdentity = {
  modules: {
    "fiscal-verifactu": { nif: "90000001K", idSistemaInformatico: "WS", numeroInstalacion: 7 },
  },
  series: [{ code: "SA-7", purpose: "standard" }],
  endorsement: endorseKey(
    STANDBY.nodeId,
    STANDBY.publicKey,
    DESIGNATED.nodeId,
    PRIMARY_KEYS.privateKey,
  ),
};

// The main box's ring, distinct from the spare's own `RING`.
// Same version as `RING`, so opening under the wrong one fails on the key, not the version.
const BUNDLE_RING = { key: Buffer.alloc(32, 0x6b).toString("base64"), version: 1 };
const CA_KEY_PEM = "-----BEGIN PRIVATE KEY-----\nfake-authority\n-----END PRIVATE KEY-----\n";

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
    primaryPublicKey: PRIMARY_KEYS.publicKey,
    credentialsRing: BUNDLE_RING,
    boxCaKeyPem: CA_KEY_PEM,
    ...over,
  };
}

const CREDENTIAL: AdoptCredential = {
  personId: "99999999-9999-4999-8999-999999999999",
  password: "dashPass123",
};
const REQ = { primaryUrl: "https://primary.test/", credential: CREDENTIAL } as const;
const ADVERTISED_ORIGIN = "https://standby.deli.test";
const NO_HOOKS: AdoptHooks = { beforeFirstWrite: async () => {} };
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x5a).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let stateDir: string;

beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-adopt-state-"));
});

afterEach(async () => {
  const dir = stateDir;
  stateDir = undefined as unknown as string;
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
});

function deps(
  extra: {
    persistTrading?: (a: PersistTradingArgs) => Promise<void>;
    persistModuleConfig?: (c: ModuleConfig) => Promise<void>;
    fetchBundle?: (
      url: string,
      c: AdoptCredential,
      s: { nodeId: string; publicKey: string; contactUrl: string },
      confirmedCaPem?: string,
    ) => Promise<MirrorBundle>;
    environment?: "production" | "preproduction";
    persistCredentialsRing?: (ring: MirrorBundle["credentialsRing"]) => Promise<void>;
  } = {},
) {
  return {
    ownerDb: suite.db,
    ownerNode: suite.node,
    ring: RING,
    advertisedOrigin: ADVERTISED_ORIGIN,
    environment: extra.environment ?? ("preproduction" as const),
    fetchBundle: extra.fetchBundle ?? (async () => makeBundle()),
    persistTrading: extra.persistTrading ?? (async () => {}),
    persistModuleConfig: extra.persistModuleConfig ?? (async () => {}),
    persistCredentialsRing:
      extra.persistCredentialsRing ?? ((ring) => writeCredentialsRing(stateDir, ring)),
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
      NO_HOOKS,
    );

    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    const ownNodeId = persistedTrading[0]!.nodeId;
    expect((await readNodeMode(suite.node, ownNodeId)).mode).toBe("mirror");
    const cfg = (await readMirrorLink(suite.node, ownNodeId))!;
    expect(cfg.relayUrl).toBe("https://relay.test:9000/");
    expect(cfg.originNodeId).toBe(DESIGNATED.nodeId);

    // The venue's ids, but the mirror's OWN node id.
    expect(persistedTrading).toHaveLength(1);
    expect(persistedTrading[0]).not.toHaveProperty("seriesId");
    expect(persistedTrading[0]).toMatchObject({
      locationId: DESIGNATED.locationId,
      nodeId: capturedStandby!.nodeId,
      environment: "preproduction",
    });
    expect(persistedTrading[0]!.nodeId).not.toBe(DESIGNATED.nodeId);
    expect("syncDatabaseUrl" in persistedTrading[0]!).toBe(false);

    expect(persistedModules).toHaveLength(1);
    expect(isEnabled(persistedModules[0]!, ALL_MODULES[0]!.name)).toBe(true);
    expect(result.breakGlassSecret).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await verifyBreakGlass(suite.node, ownNodeId, result.breakGlassSecret)).toBe(true);
  });

  it("hands the confirmed authority to the bundle fetch", async () => {
    let confirmed: string | undefined;
    await adoptFromPrimary(
      deps({
        fetchBundle: async (_u, _c, _s, ca) => {
          confirmed = ca;
          return makeBundle();
        },
      }),
      { ...REQ, confirmedCaPem: "CONFIRMED-PEM" },
      NO_HOOKS,
    );
    expect(confirmed).toBe("CONFIRMED-PEM");
  });

  it("leaves no mirror role behind when its link cannot be written", async () => {
    await suite.node.execute(
      sql.raw(`create trigger refuse_mirror_link before insert on node_mirror_link
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), REQ, NO_HOOKS)).rejects.toThrow();
      const roles = await suite.node.execute(sql`select node_id, mode from node_mode`);
      expect(roles.rows).toEqual([]);
    } finally {
      await suite.node.execute(sql`drop trigger if exists refuse_mirror_link`);
    }
  });

  it("leaves no mirror role or link behind when its signing key cannot be sealed", async () => {
    await suite.node.execute(
      sql.raw(`create trigger refuse_signing_key before insert on node_signing_key
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), REQ, NO_HOOKS)).rejects.toThrow("refused by test");
      expect((await suite.node.execute(sql`select node_id from node_mode`)).rows).toEqual([]);
      expect((await suite.node.execute(sql`select node_id from node_mirror_link`)).rows).toEqual(
        [],
      );
    } finally {
      await suite.node.execute(sql`drop trigger if exists refuse_signing_key`);
    }
  });

  it("hands over the stored name with the recovery key", async () => {
    let ownNodeId = "";
    const result = await adoptFromPrimary(
      deps({
        persistTrading: async (args) => {
          ownNodeId = args.nodeId;
        },
      }),
      REQ,
      NO_HOOKS,
    );
    expect(result).toHaveProperty(
      "breakGlassKeyName",
      await readRecoveryKeyName(suite.node, ownNodeId),
    );
    expect((result as unknown as { breakGlassKeyName: string }).breakGlassKeyName).toMatch(
      /^\d{4}-\d{2}-\d{2} · [34679ACDEFHJKMNPQRTUVWXY]{4}$/,
    );
    expect(await verifyBreakGlass(suite.node, ownNodeId, result.breakGlassSecret)).toBe(true);
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
      NO_HOOKS,
    );
    const pending = JSON.parse(
      await readFile(join(stateDir, "pending-adoption.json"), "utf8"),
    ) as PendingAdoption;
    expect(pending).not.toHaveProperty("locationId");
    expect(pending.originNodeId).toBe(DESIGNATED.nodeId);
    expect(pending.standby.nodeId).toBe(capturedStandby!.nodeId);
    expect(pending.standby.publicKey).toBe(capturedStandby!.publicKey);
    expect(pending.standby).not.toHaveProperty("privateKey");
    expect(pending.nodeName).toBe("Caja 1 (standby)");
    expect(pending.filingModule).toBe("fiscal-verifactu");
    expect(pending.reserved).toEqual(RESERVED);
  });

  it("seals the spare's own key in node.db at adopt, and the latch holds no private key", async () => {
    let sent: { nodeId: string; publicKey: string } | undefined;
    await adoptFromPrimary(
      deps({
        fetchBundle: async (_u, _c, s) => {
          sent = s;
          return makeBundle();
        },
      }),
      REQ,
      NO_HOOKS,
    );
    const sealed = await readNodeSigningKey(
      suite.node,
      loadKeyRing(keyRingEnv(BUNDLE_RING)),
      sent!.nodeId,
    );
    expect(sealed).not.toBeNull();
    expect(nodeSigningPublicKey(sealed!)).toBe(sent!.publicKey);
    const latch = await readFile(join(stateDir, "pending-adoption.json"), "utf8");
    expect(latch).not.toContain(sealed!);
    expect(await suite.db.execute(sql`select 1 from tenant_credentials`)).toMatchObject({
      rows: [],
    });
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
      NO_HOOKS,
    );
    expect(capturedStandby!.contactUrl).toBe(ADVERTISED_ORIGIN);
  });

  it("calls beforeFirstWrite once, before the deployment is stamped", async () => {
    const stampedWhenCalled: (string | null)[] = [];
    await adoptFromPrimary(deps(), REQ, {
      beforeFirstWrite: async () => {
        stampedWhenCalled.push(await readDeploymentEnvironment(suite.db));
      },
    });
    expect(stampedWhenCalled).toEqual([null]);
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
  });

  it("writes nothing when beforeFirstWrite throws", async () => {
    const error = await adoptFromPrimary(deps(), REQ, {
      beforeFirstWrite: async () => {
        throw new Error("could not record progress");
      },
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("could not record progress");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("never calls beforeFirstWrite for an environment mismatch or a foreign tenant", async () => {
    const beforeFirstWrite = vi.fn(async () => {});
    const mismatch = await adoptFromPrimary(
      deps({ fetchBundle: async () => makeBundle({ environment: "production" }) }),
      REQ,
      { beforeFirstWrite },
    ).catch((e: unknown) => e);
    expect(isAppError(mismatch) && mismatch.code).toBe("mirror.environment_mismatch");

    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "99999999R", legalName: "Incumbent SL" });
    const foreign = await adoptFromPrimary(deps(), REQ, { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(foreign) && foreign.code).toBe("provisioning.foreign_tenant");

    expect(beforeFirstWrite).not.toHaveBeenCalled();
  });

  it("never calls beforeFirstWrite for an unknown module or a same-tenant venue", async () => {
    const beforeFirstWrite = vi.fn(async () => {});
    const unknown = await adoptFromPrimary(
      deps({
        fetchBundle: async () => makeBundle({ moduleOverrides: { "no-such": false } }),
      }),
      REQ,
      { beforeFirstWrite },
    ).catch((e: unknown) => e);
    expect(isAppError(unknown) && unknown.code).toBe("module.config_unknown");
    expect(beforeFirstWrite).not.toHaveBeenCalled();

    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Incumbent SL" });
    await suite.db.insert(locations).values({
      name: "Existing venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Hospitality",
    });
    const secondVenue = await adoptFromPrimary(deps(), REQ, { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(secondVenue) && secondVenue.code).toBe("provisioning.second_venue");
    expect(beforeFirstWrite).not.toHaveBeenCalled();
  });

  it("never calls beforeFirstWrite for a database stamped for the other environment", async () => {
    await stampDeployment(suite.db, "production");
    const beforeFirstWrite = vi.fn(async () => {});
    const error = await adoptFromPrimary(deps(), REQ, { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("deployment.already_stamped");
    expect(isAppError(error) && error.params).toEqual({
      stamped: "production",
      requested: "preproduction",
    });
    expect(beforeFirstWrite).not.toHaveBeenCalled();
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("adopts into a database already stamped for the same environment", async () => {
    await stampDeployment(suite.db, "preproduction");
    const beforeFirstWrite = vi.fn(async () => {});
    const persistedTrading: PersistTradingArgs[] = [];
    await adoptFromPrimary(
      deps({
        persistTrading: async (a) => {
          persistedTrading.push(a);
        },
      }),
      REQ,
      { beforeFirstWrite },
    );
    expect(beforeFirstWrite).toHaveBeenCalledTimes(1);
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    expect((await readNodeMode(suite.node, persistedTrading[0]!.nodeId)).mode).toBe("mirror");
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
      NO_HOOKS,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("mirror.environment_mismatch");
    expect(isAppError(error) && error.params).toMatchObject({
      expected: "preproduction",
      actual: "production",
    });
    expect(tradingPersisted).toBe(false);
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a FOREIGN tenant before any mutation (§5, one tenant per database)", async () => {
    // Through the table definition: a raw insert reaches no `$defaultFn` (`tenants.created_at`).
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "99999999R", legalName: "Incumbent SL" });
    const error = await adoptFromPrimary(deps(), REQ, NO_HOOKS).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");
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
    const error = await adoptFromPrimary(deps(), REQ, NO_HOOKS).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.second_venue");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses (fail-closed) a bundle naming an unknown module, before any mutation", async () => {
    const error = await adoptFromPrimary(
      deps({
        fetchBundle: async () => makeBundle({ moduleOverrides: { "no-such": false } }),
      }),
      REQ,
      NO_HOOKS,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("module.config_unknown");
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
      NO_HOOKS,
    );
    expect(persisted).toBeDefined();
    expect(isEnabled(persisted!, toggleable)).toBe(false);
  });
  it("installs the main box's ring before sealing its own key", async () => {
    let sent: { nodeId: string; publicKey: string } | undefined;
    await adoptFromPrimary(
      deps({
        fetchBundle: async (_u, _c, s) => {
          sent = s;
          return makeBundle();
        },
      }),
      REQ,
      NO_HOOKS,
    );
    const secretsFile = join(stateDir, "secrets.env");
    const env = parseEnvFile(await readFile(secretsFile, "utf8"));
    expect(env).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect((await stat(secretsFile)).mode & 0o777).toBe(0o600);
    const sealed = await readNodeSigningKey(suite.node, loadKeyRing(env), sent!.nodeId);
    expect(nodeSigningPublicKey(sealed!)).toBe(sent!.publicKey);
    const underOldRing = await readNodeSigningKey(suite.node, RING, sent!.nodeId).catch(
      (e: unknown) => e,
    );
    expect(isAppError(underOldRing) && underOldRing.code).toBe("credentials.decrypt_failed");
  });

  it("writes the previous key's two variables when the bundle carries one", async () => {
    const previous = { key: Buffer.alloc(32, 0x6c).toString("base64"), version: 2 };
    await adoptFromPrimary(
      deps({
        fetchBundle: async () => makeBundle({ credentialsRing: { ...BUNDLE_RING, previous } }),
      }),
      REQ,
      NO_HOOKS,
    );
    expect(parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8"))).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: previous.key,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2",
    });
  });

  it("keeps the main box's authority certificate and key as venue-ca files, 0600", async () => {
    await adoptFromPrimary(deps(), REQ, NO_HOOKS);
    const crt = join(stateDir, "tls", "venue-ca.crt");
    const key = join(stateDir, "tls", "venue-ca.key");
    expect(await readFile(crt, "utf8")).toBe(makeBundle().boxCaPem);
    expect(await readFile(key, "utf8")).toBe(CA_KEY_PEM);
    expect((await stat(crt)).mode & 0o777).toBe(0o600);
    expect((await stat(key)).mode & 0o777).toBe(0o600);
  });

  it("pins the main box's public key", async () => {
    let ownNodeId = "";
    await adoptFromPrimary(
      deps({
        persistTrading: async (args) => {
          ownNodeId = args.nodeId;
        },
      }),
      REQ,
      NO_HOOKS,
    );
    expect(await readPinnedPrimaryKey(suite.node, ownNodeId)).toEqual({
      primaryNodeId: DESIGNATED.nodeId,
      publicKey: PRIMARY_KEYS.publicKey,
    });
  });

  it("writes no role, key or pin when the main box's ring cannot be saved", async () => {
    const error = await adoptFromPrimary(
      deps({
        persistCredentialsRing: async () => {
          throw new Error("disk refused");
        },
      }),
      REQ,
      NO_HOOKS,
    ).catch((e: unknown) => e);
    expect((error as Error).message).toBe("disk refused");
    for (const table of ["node_mode", "node_signing_key", "node_primary_key"]) {
      expect((await suite.node.execute(sql.raw(`select node_id from ${table}`))).rows).toEqual([]);
    }
  });

  async function writtenNothing(): Promise<void> {
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
    for (const table of [
      "node_mode",
      "node_mirror_link",
      "node_signing_key",
      "node_recovery_key",
      "node_primary_key",
    ]) {
      expect((await suite.node.execute(sql.raw(`select node_id from ${table}`))).rows).toEqual([]);
    }
    expect(await readdir(stateDir)).toEqual([]);
  }

  it.each([
    [
      "signed by a key other than the main box's",
      { primaryPublicKey: generateNodeKeyPair().publicKey },
    ],
    [
      "naming an endorser other than the main box",
      {
        reservedIdentity: {
          ...RESERVED,
          endorsement: {
            ...RESERVED.endorsement,
            endorsedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          },
        },
      },
    ],
    [
      "whose endorsed key was changed",
      {
        reservedIdentity: {
          ...RESERVED,
          endorsement: { ...RESERVED.endorsement, publicKey: "OTHER_PUB" },
        },
      },
    ],
  ] as const)(
    "refuses a bundle whose endorsement does not verify (%s), writing nothing",
    async (_case, over) => {
      const beforeFirstWrite = vi.fn(async () => {});
      const error = await adoptFromPrimary(
        deps({ fetchBundle: async () => makeBundle(over as Partial<MirrorBundle>) }),
        REQ,
        { beforeFirstWrite },
      ).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
      expect(isAppError(error) && error.params).toEqual({});
      expect(beforeFirstWrite).not.toHaveBeenCalled();
      await writtenNothing();
    },
  );

  it("refuses mirror.vault_not_empty, writing nothing", async () => {
    await suite.db
      .insert(tenants)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Same taxpayer SL" });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        purpose: "payments.sumup",
        value: {
          apiKey: "sup_sk_x",
          merchantCode: "MABC123",
          affiliateAppId: "-",
          affiliateKey: "-",
        },
      }),
    );
    const beforeFirstWrite = vi.fn(async () => {});
    const error = await adoptFromPrimary(deps(), REQ, { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("mirror.vault_not_empty");
    expect(isAppError(error) && error.params).toEqual({});
    expect(JSON.stringify(error)).not.toContain(BUNDLE_RING.key);
    expect(beforeFirstWrite).not.toHaveBeenCalled();
    await writtenNothing();
  });

  it.each([
    [
      "another node id",
      endorseKey(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        STANDBY.publicKey,
        DESIGNATED.nodeId,
        PRIMARY_KEYS.privateKey,
      ),
    ],
    [
      "another public key",
      endorseKey(
        STANDBY.nodeId,
        generateNodeKeyPair().publicKey,
        DESIGNATED.nodeId,
        PRIMARY_KEYS.privateKey,
      ),
    ],
  ] as const)(
    "refuses a main box's endorsement of %s than this box sent, writing nothing",
    async (_case, endorsement) => {
      const error = await adoptFromPrimary(
        deps({
          fetchBundle: async () => makeBundle({ reservedIdentity: { ...RESERVED, endorsement } }),
        }),
        REQ,
        NO_HOOKS,
      ).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
      expect(isAppError(error) && error.params).toEqual({});
      await writtenNothing();
    },
  );

  it.each([
    ["a key that is not 32 bytes", { key: "abc", version: 1 }, "credentials.key_invalid"],
    [
      "a previous key on the same version",
      { ...BUNDLE_RING, previous: { key: Buffer.alloc(32, 0x6c).toString("base64"), version: 1 } },
      "credentials.key_ring_version_collision",
    ],
  ] as const)(
    "refuses a main box's ring with %s, writing nothing",
    async (_case, credentialsRing, code) => {
      const error = await adoptFromPrimary(
        deps({ fetchBundle: async () => makeBundle({ credentialsRing }) }),
        REQ,
        NO_HOOKS,
      ).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe(code);
      await writtenNothing();
    },
  );

  it("writes nothing to node.db when the main box's authority files cannot be written", async () => {
    // A file where the `tls` folder goes refuses the authority's write.
    await writeFile(join(stateDir, "tls"), "not a folder");
    await expect(adoptFromPrimary(deps(), REQ, NO_HOOKS)).rejects.toMatchObject({
      code: "EEXIST",
    });
    for (const table of [
      "node_mode",
      "node_mirror_link",
      "node_signing_key",
      "node_recovery_key",
      "node_primary_key",
    ]) {
      expect((await suite.node.execute(sql.raw(`select node_id from ${table}`))).rows).toEqual([]);
    }
  });

  it("keeps the box's own secrets.env, byte for byte, when the deployment cannot be stamped", async () => {
    const own = "WAITRON_CREDENTIALS_KEY=b3du\nWAITRON_CREDENTIALS_KEY_VERSION=1\n";
    await writeFile(join(stateDir, "secrets.env"), own, { mode: 0o600 });
    await suite.db.execute(
      sql.raw(`create trigger refuse_stamp before insert on deployment
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), REQ, NO_HOOKS)).rejects.toThrow("refused by test");
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(own);
    } finally {
      await suite.db.execute(sql`drop trigger if exists refuse_stamp`);
    }
  });

  it("leaves no role, signing key, recovery key or link behind when the main box's key cannot be pinned", async () => {
    await suite.node.execute(
      sql.raw(`create trigger refuse_pin before insert on node_primary_key
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), REQ, NO_HOOKS)).rejects.toThrow("refused by test");
      for (const table of [
        "node_mode",
        "node_signing_key",
        "node_recovery_key",
        "node_mirror_link",
      ]) {
        expect((await suite.node.execute(sql.raw(`select node_id from ${table}`))).rows).toEqual(
          [],
        );
      }
    } finally {
      await suite.node.execute(sql`drop trigger if exists refuse_pin`);
    }
  });

  it("replaces secrets.env whole: a variable the old file held is gone, and the file is 0600", async () => {
    await writeFile(
      join(stateDir, "secrets.env"),
      "WAITRON_CREDENTIALS_KEY=b3du\nWAITRON_CREDENTIALS_KEY_VERSION=1\nREVIEW_EXTRA=1\n",
      { mode: 0o644 },
    );
    await adoptFromPrimary(deps(), REQ, NO_HOOKS);
    const secretsFile = join(stateDir, "secrets.env");
    expect(parseEnvFile(await readFile(secretsFile, "utf8"))).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect((await stat(secretsFile)).mode & 0o777).toBe(0o600);
  });
});
