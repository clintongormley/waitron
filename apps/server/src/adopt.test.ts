import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { Socket } from "node:net";
import { TLSSocket } from "node:tls";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  masterKeys,
  readDeploymentEnvironment,
  stampDeployment,
  taxpayer,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedVenue } from "@waitron/db/testing/seed.js";
import {
  NODE_CLASSIFICATION,
  nodeHandoverEvents,
  readMirrorLink,
  readNodeMode,
  readPairLink,
  readPinnedPrimaryKey,
  readRecoveryKey,
} from "@waitron/node-db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { isEnabled, type ModuleConfig } from "@waitron/module";
import { AppError, isAppError, nodeId as asNodeId } from "@waitron/shared";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  putCredential,
  readNodeSigningKey,
  readPairSecret,
  keyRingEnv,
} from "@waitron/credentials";
import { endorseKey, generateNodeKeyPair } from "@waitron/membership";
import {
  adoptFromPrimary,
  nodeTablesAdoptLeaves,
  type AdoptHooks,
  type PersistTradingArgs,
} from "./adopt.js";
import type { JoinedBox } from "./box-join-attempt.js";
import { ALL_MODULES } from "./modules.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import type { StandbyIdentity } from "./reserved-identity.js";
import type { PendingAdoption } from "./finish-adoption.js";

import { writeCredentialsRing } from "./box-secrets.js";
import { parseEnvFile } from "./env-file.js";
import { keyRingVariables, loadBoxEnv } from "./box-env.js";
import { MAIN_AUTHORITY } from "./testing/main-authority.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { tlsSetMatches } from "./testing/box-tls.js";
import { runStagedReset, stageResetRequest } from "./reset-request.js";
import { replaceBackupSettings } from "./backup-env-writer.js";
import { readBackupSettings } from "./backup-env-writer.js";
import { readOfferSettings } from "./handover-manifest.js";
import { createSetupOperationStore } from "./setup-operation.js";
import { PAIR_BUNDLE_FIELDS, PAIR_STORE } from "./testing/pair-bundle.js";
import { mintMasterKey, WRONG_MASTER_KEY } from "./testing/master-key.js";
import { TOTP_KEY_RING } from "./testing/authenticator.js";
import { mountPromoteApi } from "./promote-api.js";
import { mountBackupRecoveryPackMakeApi } from "./backup-recovery-pack-api.js";
import { createTurns } from "./backup-turns.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import { setFreshManagementSignIn } from "./testing/fresh-management-sign-in.js";
import { openManagementSession } from "@waitron/identity/test/fixtures.js";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";

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
// and an empty `taxpayer`.

// Adopt never reads these ids back from the database, so a fixed set is enough.
const DESIGNATED = {
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
const CA_KEY_PEM = MAIN_AUTHORITY.caKeyPem;

function makeBundle(over: Partial<MirrorBundle> = {}): MirrorBundle {
  return {
    designated: DESIGNATED,
    taxpayer: { country: "ES", taxId: "80000001K" },
    primaryNode: { name: "Caja 1", filingModule: "fiscal-verifactu", taxModule: null },
    environment: "preproduction",
    boxHostname: "waitron.local",
    boxCaPem: MAIN_AUTHORITY.caCertPem,
    ...PAIR_BUNDLE_FIELDS,

    reservedIdentity: RESERVED,
    moduleOverrides: {},
    primaryPublicKey: PRIMARY_KEYS.publicKey,
    credentialsRing: BUNDLE_RING,
    backupSettings: null,
    boxCaKeyPem: CA_KEY_PEM,
    ...over,
  };
}

/** Not the address `deps()` would give, so a pair link holding it was taken from the attempt. */
const HELLO_STORE_URL = "https://box-aaaa.waitron.local:7600";
const joined = (bundle = makeBundle(), identity = STANDBY): JoinedBox => ({
  identity,
  bundle,
  storeUrl: HELLO_STORE_URL,
});
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
    assertStartsWith?: (a: PersistTradingArgs) => void;
    persistModuleConfig?: (c: ModuleConfig) => Promise<void>;
    environment?: "production" | "preproduction" | null;
    persistCredentialsRing?: (ring: MirrorBundle["credentialsRing"]) => Promise<void>;
    baseEnv?: NodeJS.ProcessEnv;
  } = {},
) {
  return {
    ownerDb: suite.db,
    ownerNode: suite.node,
    ring: RING,
    environmentKeys: keyRingVariables(extra.baseEnv ?? {}),
    environment: extra.environment === undefined ? ("preproduction" as const) : extra.environment,
    persistTrading: extra.persistTrading ?? (async () => {}),
    assertStartsWith: extra.assertStartsWith ?? (() => {}),
    persistModuleConfig: extra.persistModuleConfig ?? (async () => {}),
    persistBackupSettings: (settings: Record<string, string> | null) =>
      replaceBackupSettings(stateDir, settings),
    persistCredentialsRing:
      extra.persistCredentialsRing ?? ((ring) => writeCredentialsRing(stateDir, ring)),
    stateDir,
    database: "mirror_db",
    listIpv4: () => [],
    now: () => new Date(),
  };
}

describe("adoptFromPrimary (mirror adopt)", () => {
  it("stamps the mirror and writes its config", async () => {
    const persistedTrading: PersistTradingArgs[] = [];
    const persistedModules: ModuleConfig[] = [];

    await adoptFromPrimary(
      deps({
        persistTrading: async (a) => {
          persistedTrading.push(a);
        },
        persistModuleConfig: async (c) => {
          persistedModules.push(c);
        },
      }),
      joined(),
      NO_HOOKS,
    );

    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
    const ownNodeId = persistedTrading[0]!.nodeId;
    expect((await readNodeMode(suite.node, ownNodeId)).mode).toBe("mirror");
    expect(
      await suite.node
        .select({
          nodeId: nodeHandoverEvents.nodeId,
          operationId: nodeHandoverEvents.operationId,
          kind: nodeHandoverEvents.kind,
          detail: nodeHandoverEvents.detail,
          envelope: nodeHandoverEvents.envelope,
        })
        .from(nodeHandoverEvents),
    ).toEqual([
      {
        nodeId: ownNodeId,
        operationId: null,
        kind: "box.role_changed",
        detail: { mode: "mirror", singletonRole: "secondary", cause: "adopt" },
        envelope: null,
      },
    ]);
    const cfg = (await readMirrorLink(suite.node, ownNodeId))!;
    expect(cfg.originUrl).toBe("https://box.deli.test");
    expect(cfg.originNodeId).toBe(DESIGNATED.nodeId);

    expect(persistedTrading).toHaveLength(1);
    expect(persistedTrading[0]).not.toHaveProperty("seriesId");
    expect(persistedTrading[0]).toMatchObject({
      nodeId: STANDBY.nodeId,
      environment: "preproduction",
    });
    expect(persistedTrading[0]!.nodeId).not.toBe(DESIGNATED.nodeId);
    expect("syncDatabaseUrl" in persistedTrading[0]!).toBe(false);

    expect(persistedModules).toHaveLength(1);
    expect(isEnabled(persistedModules[0]!, ALL_MODULES[0]!.name)).toBe(true);
  });

  it("a spare with no key of its own promotes with the venue's master key, then makes a new master key", async () => {
    let ownNodeId = "";
    const answer = await adoptFromPrimary(
      deps({
        persistTrading: async (args) => {
          ownNodeId = args.nodeId;
        },
      }),
      joined(),
      NO_HOOKS,
    );
    expect(answer).toBeUndefined();
    expect(await readRecoveryKey(suite.node, ownNodeId)).toBeNull();

    // Stands for the master key row the spare's copy of venue.db carries.
    const { secret: key, name: firstMasterKey } = await mintMasterKey(suite.db);
    const run = vi.fn(async () => ({ alreadyPrimary: false, restarting: true }));
    const app = new Hono();
    mountPromoteApi(app, {
      appDb: suite.db,
      nodeDb: suite.node,
      nodeId: ownNodeId,
      run,
      credentialKeyRing: TOTP_KEY_RING,
      requestFromBox: () => false,
    });
    const socket = new TLSSocket(new Socket());
    const promote = async (breakGlass: string) =>
      app.request(
        "https://box.test/management-api/promote",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ oldNodeNeutralised: true, breakGlass }),
        },
        { incoming: { socket } },
      );
    try {
      const refused = await promote(WRONG_MASTER_KEY);
      expect([refused.status, await refused.json()]).toEqual([
        401,
        { error: { code: "promotion.break_glass_invalid", params: {} } },
      ]);
      expect(run).not.toHaveBeenCalled();

      const promoted = await promote(key);
      expect([promoted.status, await promoted.json()]).toEqual([
        200,
        { alreadyPrimary: false, restarting: true },
      ]);
      expect(run).toHaveBeenCalledTimes(1);

      // Backups' Make a new master key on the promoted box, which still holds no box key.
      expect(await readRecoveryKey(suite.node, ownNodeId)).toBeNull();
      await seedVenue(suite.db, { name: "Sala" });
      const admin = await openManagementSession(suite.db, "admin");
      await withTransaction(suite.db, (tx) => setFreshManagementSignIn(tx, admin.token));
      const backups = new Hono();
      mountBackupRecoveryPackMakeApi(
        backups,
        {
          db: suite.db,
          nodeDb: suite.node,
          ring: RING,
          node: { nodeId: asNodeId(ownNodeId) },
          modules: [
            {
              ...fakeModule("test-regime"),
              backup: {
                recoveryPackPage: async () => ({ page: { title: "", rows: [], notes: [] } }),
              },
            },
          ],
          turns: createTurns(),
          readBoxEnv: async () => ({}),
          backups: () => ({ schedule: undefined, retention: undefined, recoveryKey: undefined }),
          documentEvidence: async () => ({}),
          loadFonts: loadRecoveryPackFonts,
          now: () => new Date("2026-11-24T09:00:00.000Z"),
        },
        () => {},
      );
      const made = await backups.request(
        "https://box.test/api/backup/recovery-pack",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `waitron_management_session=${admin.token}`,
          },
          body: JSON.stringify({ locale: "en", newServerKey: true }),
        },
        { incoming: { socket } },
      );
      expect(made.status).toBe(200);
      const shownName = decodeURIComponent(made.headers.get("x-waitron-master-key-name") ?? "");
      expect(made.headers.get("x-waitron-master-key")).toMatch(/^(?:\S{4} ){6}\S{4}$/);
      await made.arrayBuffer();
      expect(
        (await suite.db.select().from(masterKeys).orderBy(masterKeys.number)).map((row) => [
          row.number,
          row.name,
        ]),
      ).toEqual([
        [1, firstMasterKey],
        [2, shownName],
      ]);
      expect(await readRecoveryKey(suite.node, ownNodeId)).toBeNull();
    } finally {
      socket.destroy();
    }
  });

  it("leaves no mirror role behind when its link cannot be written", async () => {
    await suite.node.execute(
      sql.raw(`create trigger refuse_mirror_link before update of mirror_origin_url on box
        when new.mirror_origin_url is not null
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), joined(), NO_HOOKS)).rejects.toThrow("refused by test");
      const roles = await suite.node.execute(sql`select node_id, mode from box`);
      expect(roles.rows).toEqual([]);
    } finally {
      await suite.node.execute(sql`drop trigger if exists refuse_mirror_link`);
    }
  });

  it("leaves no mirror role or link behind when its signing key cannot be sealed", async () => {
    await suite.node.execute(
      sql.raw(`create trigger refuse_signing_key before update of signing_key_ciphertext on box
        when new.signing_key_ciphertext is not null
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), joined(), NO_HOOKS)).rejects.toThrow("refused by test");
      expect((await suite.node.execute(sql`select node_id from box`)).rows).toEqual([]);
    } finally {
      await suite.node.execute(sql`drop trigger if exists refuse_signing_key`);
    }
  });

  it("writes the pending-adoption latch (dormant identity for the boot finish worker)", async () => {
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const pending = JSON.parse(
      await readFile(join(stateDir, "pending-adoption.json"), "utf8"),
    ) as PendingAdoption;
    expect(pending.originNodeId).toBe(DESIGNATED.nodeId);
    expect(pending.standby.nodeId).toBe(STANDBY.nodeId);
    expect(pending.standby.publicKey).toBe(STANDBY.publicKey);
    expect(pending.standby).not.toHaveProperty("privateKey");
    expect(pending.nodeName).toBe("Caja 1 (standby)");
    expect(pending.filingModule).toBe("fiscal-verifactu");
    expect(pending.reserved).toEqual(RESERVED);
  });

  it("seals the spare's own key in node.db at adopt, and the latch holds no private key", async () => {
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const sealed = await readNodeSigningKey(
      suite.node,
      loadKeyRing(keyRingEnv(BUNDLE_RING)),
      STANDBY.nodeId,
    );
    expect(sealed).not.toBeNull();
    expect(nodeSigningPublicKey(sealed!)).toBe(STANDBY.publicKey);
    const latch = await readFile(join(stateDir, "pending-adoption.json"), "utf8");
    expect(latch).not.toContain(sealed!);
    expect(await suite.db.execute(sql`select 1 from venue_credentials`)).toMatchObject({
      rows: [],
    });
  });

  it("keeps the pair's key sealed in node.db, opening under the venue's ring", async () => {
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const bundle = makeBundle();
    expect(await readPairLink(suite.node, STANDBY.nodeId)).toMatchObject({
      role: "serves",
      state: "awaiting_copy",
      peerNodeId: DESIGNATED.nodeId,
      peerPublicKey: PRIMARY_KEYS.publicKey,
      storeUrl: HELLO_STORE_URL,
      venueId: PAIR_STORE.venueId,
      accessKeyId: PAIR_STORE.accessKeyId,
      ringVersion: BUNDLE_RING.version,
    });
    expect(
      await readPairSecret(suite.node, loadKeyRing(keyRingEnv(BUNDLE_RING)), STANDBY.nodeId),
    ).toBe(bundle.store.secretAccessKey);
    // Control: the box's own ring, which the main box's replaces, does not open it.
    await expect(readPairSecret(suite.node, RING, STANDBY.nodeId)).rejects.toMatchObject({
      code: "credentials.decrypt_failed",
    });
    const raw = await suite.node.execute(sql`select * from node_pair_link`);
    expect(JSON.stringify(raw.rows)).not.toContain(bundle.store.secretAccessKey);
  });

  it("a second join under a new id removes the first attempt's node.db rows", async () => {
    const first: StandbyIdentity = {
      nodeId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      ...generateNodeKeyPair(),
    };
    await adoptFromPrimary(
      deps(),
      joined(
        makeBundle({
          reservedIdentity: {
            ...RESERVED,
            endorsement: endorseKey(
              first.nodeId,
              first.publicKey,
              DESIGNATED.nodeId,
              PRIMARY_KEYS.privateKey,
            ),
          },
        }),
        first,
      ),
      NO_HOOKS,
    );
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);

    for (const table of ["box", "node_pair_link"]) {
      expect(
        (await suite.node.execute(sql.raw(`select node_id from ${table}`))).rows,
        table,
      ).toEqual([{ node_id: STANDBY.nodeId }]);
    }
  });

  it("the spare holds the main box's backup settings once it has joined", async () => {
    const mainState = await mkdtemp(join(tmpdir(), "waitron-adopt-main-"));
    try {
      await writeFile(
        join(mainState, "backup.env"),
        "WAITRON_BACKUP_RECOVERY_KEY=recovery-0123456789abcdef\nWAITRON_BACKUP_KEY_ROTATED_AT=2026-11-01T00:00:00.000Z\n",
      );
      const backupSettings = await readBackupSettings(mainState);
      await adoptFromPrimary(deps(), joined(makeBundle({ backupSettings })), NO_HOOKS);
      const digest = async (dir: string) =>
        (await readOfferSettings(dir, RING, "handover.settings_unreadable", suite.db))
          .backupSettings;
      expect(await digest(mainState)).not.toBeNull();
      expect(await digest(stateDir)).toBe(await digest(mainState));
    } finally {
      await rm(mainState, { recursive: true, force: true });
    }
  });

  it("a second join under a main box with no settings leaves none", async () => {
    const first: StandbyIdentity = {
      nodeId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ...generateNodeKeyPair(),
    };
    await adoptFromPrimary(
      deps(),
      joined(
        makeBundle({
          backupSettings: { WAITRON_BACKUP_RECOVERY_KEY: "recovery-0123456789abcdef" },
          reservedIdentity: {
            ...RESERVED,
            endorsement: endorseKey(
              first.nodeId,
              first.publicKey,
              DESIGNATED.nodeId,
              PRIMARY_KEYS.privateKey,
            ),
          },
        }),
        first,
      ),
      NO_HOOKS,
    );
    expect(await readBackupSettings(stateDir)).not.toBeNull();
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    expect(existsSync(join(stateDir, "backup.env"))).toBe(false);
  });

  it("every node.db table is either swept by adopt or named as kept", () => {
    const tables = NODE_CLASSIFICATION.map((entry) => entry.table);
    expect(nodeTablesAdoptLeaves(tables)).toEqual([]);
    // Control: a table with neither a sweep nor a kept name is reported.
    expect(nodeTablesAdoptLeaves([...tables, "node_new_table"])).toEqual(["node_new_table"]);
  });

  it("calls beforeFirstWrite once, before the deployment is stamped", async () => {
    const stampedWhenCalled: (string | null)[] = [];
    await adoptFromPrimary(deps(), joined(), {
      beforeFirstWrite: async () => {
        stampedWhenCalled.push(await readDeploymentEnvironment(suite.db));
      },
    });
    expect(stampedWhenCalled).toEqual([null]);
    expect(await readDeploymentEnvironment(suite.db)).toBe("preproduction");
  });

  it("writes nothing when beforeFirstWrite throws", async () => {
    const error = await adoptFromPrimary(deps(), joined(), {
      beforeFirstWrite: async () => {
        throw new Error("could not record progress");
      },
    }).catch((e: unknown) => e);
    expect((error as Error).message).toBe("could not record progress");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("never calls beforeFirstWrite for an environment mismatch or a foreign taxpayer", async () => {
    const beforeFirstWrite = vi.fn(async () => {});
    const mismatch = await adoptFromPrimary(
      deps(),
      joined(makeBundle({ environment: "production" })),
      { beforeFirstWrite },
    ).catch((e: unknown) => e);
    expect(isAppError(mismatch) && mismatch.code).toBe("mirror.environment_mismatch");

    await suite.db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "99999999R", legalName: "Incumbent SL" });
    const foreign = await adoptFromPrimary(deps(), joined(), { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(foreign) && foreign.code).toBe("provisioning.foreign_taxpayer");

    expect(beforeFirstWrite).not.toHaveBeenCalled();
  });

  it("never calls beforeFirstWrite for an unknown module or a same-taxpayer venue", async () => {
    const beforeFirstWrite = vi.fn(async () => {});
    const unknown = await adoptFromPrimary(
      deps(),
      joined(makeBundle({ moduleOverrides: { "no-such": false } })),
      { beforeFirstWrite },
    ).catch((e: unknown) => e);
    expect(isAppError(unknown) && unknown.code).toBe("module.config_unknown");
    expect(beforeFirstWrite).not.toHaveBeenCalled();

    await suite.db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Incumbent SL" });
    await seedVenue(suite.db, {
      name: "Existing venue",
      invoiceLocales: ["en-GB"],
    });
    const secondVenue = await adoptFromPrimary(deps(), joined(), { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(secondVenue) && secondVenue.code).toBe("provisioning.second_venue");
    expect(beforeFirstWrite).not.toHaveBeenCalled();
  });

  it("never calls beforeFirstWrite for a database stamped for the other environment", async () => {
    await stampDeployment(suite.db, "production");
    const beforeFirstWrite = vi.fn(async () => {});
    const error = await adoptFromPrimary(deps(), joined(), { beforeFirstWrite }).catch(
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
      joined(),
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
      }),
      joined(makeBundle({ environment: "production" })),
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

  it("takes the main box's environment when this box's was never set, and hands it to the hook and persistTrading", async () => {
    const persistedTrading: PersistTradingArgs[] = [];
    const announced: string[] = [];
    await adoptFromPrimary(
      deps({
        environment: null,
        persistTrading: async (a) => {
          persistedTrading.push(a);
        },
      }),
      joined(makeBundle({ environment: "production" })),
      {
        beforeFirstWrite: async (environment) => {
          announced.push(environment);
        },
      },
    );
    expect(announced).toEqual(["production"]);
    expect(persistedTrading.map((a) => a.environment)).toEqual(["production"]);
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("refuses a join this box could not start after, before its first write", async () => {
    const checked: PersistTradingArgs[] = [];
    let wrote = false;
    const error = await adoptFromPrimary(
      deps({
        environment: null,
        assertStartsWith: (a) => {
          checked.push(a);
          throw new AppError("server.config_missing", { variable: "WAITRON_MANAGEMENT_RP_ID" });
        },
        persistTrading: async () => {
          wrote = true;
        },
      }),
      joined(makeBundle({ environment: "production" })),
      {
        beforeFirstWrite: async () => {
          wrote = true;
        },
      },
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("server.config_missing");
    expect(checked).toEqual([{ nodeId: expect.any(String), environment: "production" }]);
    expect(wrote).toBe(false);
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a foreign taxpayer without stamping the local deployment", async () => {
    // Through the table definition: a raw insert reaches no `$defaultFn` (`taxpayer.created_at`).
    await suite.db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "99999999R", legalName: "Incumbent SL" });
    const error = await adoptFromPrimary(deps(), joined(), NO_HOOKS).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_taxpayer");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a same-taxpayer venue without stamping the local deployment", async () => {
    await suite.db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Incumbent SL" });
    await seedVenue(suite.db, {
      name: "Existing venue",
      invoiceLocales: ["en-GB"],
    });
    const error = await adoptFromPrimary(deps(), joined(), NO_HOOKS).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.second_venue");
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
  });

  it("refuses a bundle naming an unknown module without stamping the local deployment", async () => {
    const error = await adoptFromPrimary(
      deps(),
      joined(makeBundle({ moduleOverrides: { "no-such": false } })),
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
      }),
      joined(makeBundle({ moduleOverrides: { [toggleable]: false } })),
      NO_HOOKS,
    );
    expect(persisted).toBeDefined();
    expect(isEnabled(persisted!, toggleable)).toBe(false);
  });
  it("installs the main box's ring before sealing its own key", async () => {
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const secretsFile = join(stateDir, "secrets.env");
    const env = parseEnvFile(await readFile(secretsFile, "utf8"));
    expect(env).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect((await stat(secretsFile)).mode & 0o777).toBe(0o600);
    const sealed = await readNodeSigningKey(suite.node, loadKeyRing(env), STANDBY.nodeId);
    expect(nodeSigningPublicKey(sealed!)).toBe(STANDBY.publicKey);
    const underOldRing = await readNodeSigningKey(suite.node, RING, STANDBY.nodeId).catch(
      (e: unknown) => e,
    );
    expect(isAppError(underOldRing) && underOldRing.code).toBe("credentials.decrypt_failed");
  });

  it("writes the previous key's two variables when the bundle carries one", async () => {
    const previous = { key: Buffer.alloc(32, 0x6c).toString("base64"), version: 2 };
    await adoptFromPrimary(
      deps(),
      joined(makeBundle({ credentialsRing: { ...BUNDLE_RING, previous } })),
      NO_HOOKS,
    );
    expect(parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8"))).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: previous.key,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2",
    });
  });

  it("installs the main box's authority as this box's own, 0600, with a leaf it signed", async () => {
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const tls = join(stateDir, "tls");
    expect(await readFile(join(tls, "ca.crt"), "utf8")).toBe(makeBundle().boxCaPem);
    expect(await readFile(join(tls, "ca.key"), "utf8")).toBe(CA_KEY_PEM);
    for (const name of ["ca.crt", "ca.key", "server.pem"]) {
      expect((await stat(join(tls, name))).mode & 0o777).toBe(0o600);
    }
    expect(await tlsSetMatches(stateDir)).toBe(true);
    const leaf = new X509Certificate(await readFile(join(tls, "server.pem"), "utf8"));
    expect(leaf.subjectAltName).toContain("DNS:box-aaaa.waitron.local");
  });

  it("the joined marker is written before the main box's key ring", async () => {
    let markedWhenRingWritten: boolean | undefined;
    await adoptFromPrimary(
      deps({
        persistCredentialsRing: async (ring) => {
          markedWhenRingWritten = existsSync(join(stateDir, "tls", "joined.json"));
          await writeCredentialsRing(stateDir, ring);
        },
      }),
      joined(),
      NO_HOOKS,
    );
    expect(markedWhenRingWritten).toBe(true);
    expect(JSON.parse(await readFile(join(stateDir, "tls", "joined.json"), "utf8"))).toEqual({
      originNodeId: DESIGNATED.nodeId,
    });
  });

  it("a join stopped just after the key ring was written leaves the marker, so the staged reset removes the ring", async () => {
    const venueDir = join(stateDir, "venue");
    await mkdir(venueDir);
    const operations = createSetupOperationStore(stateDir);
    const joinAndStage = async (stopBeforeFirstWrite: boolean) => {
      const stopped = await operations
        .run("adopt", "a-request", (operation) =>
          adoptFromPrimary(
            deps({
              persistCredentialsRing: async (ring) => {
                await writeCredentialsRing(stateDir, ring);
                throw new Error("stopped after the ring");
              },
            }),
            joined(),
            {
              beforeFirstWrite: async () => {
                if (stopBeforeFirstWrite) throw new Error("stopped");
                await operation.advance("venue_committed", { environment: "preproduction" });
              },
            },
          ),
        )
        .catch((e: unknown) => e);
      expect(stopped).toBeInstanceOf(Error);
      const record = await operations.read();
      if (record !== null) await stageResetRequest(stateDir, record.id);
      return record;
    };

    const record = await joinAndStage(false);
    expect(parseEnvFile(await readFile(join(stateDir, "secrets.env"), "utf8"))).toMatchObject({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
    });
    expect(existsSync(join(stateDir, "tls", "joined.json"))).toBe(true);
    expect(record?.phase).toBe("venue_committed");
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(true);
    expect(existsSync(join(stateDir, "secrets.env"))).toBe(false);
    expect(existsSync(join(stateDir, "tls"))).toBe(false);

    // Control: a join stopped before its first write leaves no marker, and no record past "started",
    // so the reset route offers no reset.
    await rm(join(stateDir, "flows/setup/operation.json"), { force: true });
    const own = "WAITRON_CREDENTIALS_KEY=b3du\nWAITRON_CREDENTIALS_KEY_VERSION=1\n";
    await writeFile(join(stateDir, "secrets.env"), own, { mode: 0o600 });
    const control = await joinAndStage(true);
    expect(control).toBeNull();
    expect(existsSync(join(stateDir, "tls", "joined.json"))).toBe(false);
    expect(await runStagedReset({ stateDir, venueDir, log: () => {} })).toBe(false);
    expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(own);
  });

  it("pins the main box's public key", async () => {
    let ownNodeId = "";
    await adoptFromPrimary(
      deps({
        persistTrading: async (args) => {
          ownNodeId = args.nodeId;
        },
      }),
      joined(),
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
      joined(),
      NO_HOOKS,
    ).catch((e: unknown) => e);
    expect((error as Error).message).toBe("disk refused");
    expect((await suite.node.execute(sql`select node_id from box`)).rows).toEqual([]);
  });

  async function writtenNothing(): Promise<void> {
    expect(await readDeploymentEnvironment(suite.db)).toBeNull();
    for (const table of ["box", "node_pair_link"]) {
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
        deps(),
        joined(makeBundle(over as Partial<MirrorBundle>)),
        { beforeFirstWrite },
      ).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
      expect(isAppError(error) && error.params).toEqual({});
      expect(beforeFirstWrite).not.toHaveBeenCalled();
      await writtenNothing();
    },
  );

  it("refuses a bundle whose authority certificate and key are from different authorities, writing nothing", async () => {
    const other = mintSelfSignedServerCert({
      hostnames: ["waitron.local"],
      ipAddresses: [],
      now: new Date(),
    });
    const beforeFirstWrite = vi.fn(async () => {});
    const error = await adoptFromPrimary(
      deps(),
      joined(makeBundle({ boxCaKeyPem: other.caKeyPem })),
      { beforeFirstWrite },
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("mirror.bundle_fetch_failed");
    expect(isAppError(error) && error.params).toEqual({});
    expect(beforeFirstWrite).not.toHaveBeenCalled();
    await writtenNothing();
  });

  it("refuses mirror.vault_not_empty, writing nothing", async () => {
    await suite.db
      .insert(taxpayer)
      .values({ id: 1, country: "ES", taxId: "80000001K", legalName: "Same taxpayer SL" });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING, {
        personId: null,
        purpose: "payments.sumup",
        value: {
          apiKey: "sup_sk_x",
          merchantCode: "MABC123",
        },
      }),
    );
    const beforeFirstWrite = vi.fn(async () => {});
    const error = await adoptFromPrimary(deps(), joined(), { beforeFirstWrite }).catch(
      (e: unknown) => e,
    );
    expect(isAppError(error) && error.code).toBe("mirror.vault_not_empty");
    expect(isAppError(error) && error.params).toEqual({});
    expect(JSON.stringify(error)).not.toContain(BUNDLE_RING.key);
    expect(beforeFirstWrite).not.toHaveBeenCalled();
    await writtenNothing();
  });

  const OTHER_KEY = Buffer.alloc(32, 0x7c).toString("base64");
  it.each([
    ["another key", { WAITRON_CREDENTIALS_KEY: OTHER_KEY }],
    [
      "the main box's key under another version",
      { WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key, WAITRON_CREDENTIALS_KEY_VERSION: "3" },
    ],
    ["only another version", { WAITRON_CREDENTIALS_KEY_VERSION: "3" }],
    [
      "a previous key the main box's ring does not hold",
      { WAITRON_CREDENTIALS_KEY_PREVIOUS: OTHER_KEY },
    ],
    [
      "a previous version the main box's ring does not hold",
      { WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "2" },
    ],
    [
      "the main box's key with one byte more",
      {
        WAITRON_CREDENTIALS_KEY: Buffer.concat([
          Buffer.from(BUNDLE_RING.key, "base64"),
          Buffer.of(0x6b),
        ]).toString("base64"),
      },
    ],
    ["a version that is not a whole number", { WAITRON_CREDENTIALS_KEY_VERSION: "1.5" }],
  ] as const)(
    "refuses mirror.vault_key_differs when the environment sets %s, writing nothing",
    async (_case, baseEnv) => {
      const beforeFirstWrite = vi.fn(async () => {});
      const error = await adoptFromPrimary(deps({ baseEnv }), joined(), { beforeFirstWrite }).catch(
        (e: unknown) => e,
      );
      expect(isAppError(error) && error.code).toBe("mirror.vault_key_differs");
      expect(isAppError(error) && error.params).toEqual({});
      expect(JSON.stringify(error)).not.toContain(BUNDLE_RING.key);
      expect(JSON.stringify(error)).not.toContain(OTHER_KEY);
      expect(beforeFirstWrite).not.toHaveBeenCalled();
      await writtenNothing();
    },
  );

  it.each([
    [
      "the main box's key and version",
      { WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key, WAITRON_CREDENTIALS_KEY_VERSION: "1" },
    ],
    [
      "the main box's key and empty values elsewhere",
      {
        WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
        WAITRON_CREDENTIALS_KEY_VERSION: "",
        WAITRON_CREDENTIALS_KEY_PREVIOUS: "",
      },
    ],
  ] as const)(
    "joins when the environment sets %s, and the spare's key opens under the ring the next start loads",
    async (_case, baseEnv) => {
      await adoptFromPrimary(deps({ baseEnv }), joined(), NO_HOOKS);
      const nextStart = loadKeyRing(await loadBoxEnv(baseEnv, stateDir));
      const sealed = await readNodeSigningKey(suite.node, nextStart, STANDBY.nodeId);
      expect(sealed).not.toBeNull();
      expect(nodeSigningPublicKey(sealed!)).toBe(STANDBY.publicKey);
    },
  );

  // 0xfb bytes encode with both `+` and `/`, so the URL-safe alphabet spells this key differently.
  const SLASHED_RING = { key: Buffer.alloc(32, 0xfb).toString("base64"), version: 4 };
  const urlSafe = (key: string) => key.replaceAll("+", "-").replaceAll("/", "_");
  it.each([
    ["the version with a leading zero", { WAITRON_CREDENTIALS_KEY_VERSION: "04" }],
    ["the key in the URL-safe alphabet", { WAITRON_CREDENTIALS_KEY: urlSafe(SLASHED_RING.key) }],
    [
      "the key broken across two lines",
      {
        WAITRON_CREDENTIALS_KEY: `${SLASHED_RING.key.slice(0, 20)}\n${SLASHED_RING.key.slice(20)}`,
      },
    ],
  ] as const)(
    "joins when the environment spells the main box's ring otherwise: %s",
    async (_case, baseEnv) => {
      await adoptFromPrimary(
        deps({ baseEnv }),
        joined(makeBundle({ credentialsRing: SLASHED_RING })),
        NO_HOOKS,
      );
      const nextStart = loadKeyRing(await loadBoxEnv(baseEnv, stateDir));
      const sealed = await readNodeSigningKey(suite.node, nextStart, STANDBY.nodeId);
      expect(sealed).not.toBeNull();
      expect(nodeSigningPublicKey(sealed!)).toBe(STANDBY.publicKey);
    },
  );

  it("refuses mirror.vault_key_differs for another key in the URL-safe alphabet, writing nothing", async () => {
    const baseEnv = { WAITRON_CREDENTIALS_KEY: urlSafe(Buffer.alloc(32, 0xfe).toString("base64")) };
    const error = await adoptFromPrimary(
      deps({ baseEnv }),
      joined(makeBundle({ credentialsRing: SLASHED_RING })),
      NO_HOOKS,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("mirror.vault_key_differs");
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
        deps(),
        joined(makeBundle({ reservedIdentity: { ...RESERVED, endorsement } })),
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
        deps(),
        joined(makeBundle({ credentialsRing })),
        NO_HOOKS,
      ).catch((e: unknown) => e);
      expect(isAppError(error) && error.code).toBe(code);
      await writtenNothing();
    },
  );

  it("writes nothing to node.db when the main box's authority files cannot be written", async () => {
    // A file where the `tls` folder goes refuses the authority's write.
    await writeFile(join(stateDir, "tls"), "not a folder");
    await expect(adoptFromPrimary(deps(), joined(), NO_HOOKS)).rejects.toMatchObject({
      code: "EEXIST",
    });
    for (const table of ["box", "node_pair_link"]) {
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
      await expect(adoptFromPrimary(deps(), joined(), NO_HOOKS)).rejects.toThrow("refused by test");
      expect(await readFile(join(stateDir, "secrets.env"), "utf8")).toBe(own);
    } finally {
      await suite.db.execute(sql`drop trigger if exists refuse_stamp`);
    }
  });

  it("leaves no role, signing key or link behind when the main box's key cannot be pinned", async () => {
    // Refuses only the pin: the role, signing key and links are written first and must roll back.
    await suite.node.execute(
      sql.raw(`create trigger refuse_pin before update of primary_node_id on box
        when new.primary_node_id is not null
        begin select raise(abort, 'refused by test'); end`),
    );
    try {
      await expect(adoptFromPrimary(deps(), joined(), NO_HOOKS)).rejects.toThrow("refused by test");
      // The role, signing key, mirror link and pin are all columns of the one `box` row.
      for (const table of ["box", "node_pair_link"]) {
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
    await adoptFromPrimary(deps(), joined(), NO_HOOKS);
    const secretsFile = join(stateDir, "secrets.env");
    expect(parseEnvFile(await readFile(secretsFile, "utf8"))).toEqual({
      WAITRON_CREDENTIALS_KEY: BUNDLE_RING.key,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    expect((await stat(secretsFile)).mode & 0o777).toBe(0o600);
  });
});
