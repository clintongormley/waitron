import { sql } from "drizzle-orm";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readDeploymentEnvironment,
  readDeploymentMode,
  readMirrorConfig,
  type Database,
} from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
} from "@waitron/db/testing/lifecycle.js";
import { type RealPostgres } from "@waitron/db/testing/postgres.js";
import { isEnabled, type ModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import { adoptFromPrimary, type AdoptCredential, type PersistTradingArgs } from "./adopt.js";
import { ALL_MODULES } from "./modules.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import type { PendingAdoption } from "./finish-adoption.js";
import { verifyBreakGlass } from "./break-glass.js";

// Real Postgres, not PGlite: adopt stamps `deployment`, writes `mirror_config` and mints the
// break-glass verifier on the OWNER connection while the read-back / foreign-tenant guard run as the
// same owner — a two-role split PGlite's superuser-only connection cannot model. CLAUDE.md §4.

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

let mirror: RealPostgres;
let mirrorAdmin: Database; // owner connection to the fresh mirror clone
let mirrorApp: Database; // app_login → app_user: the break-glass verify path
let stateDir: string;

beforeEach(async () => {
  const handle = resolveSharedHandle(undefined);
  mirror = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
  mirrorAdmin = await mirror.connect();
  mirrorApp = await mirror.connectAs("app_login", "app_pw");
  stateDir = await mkdtemp(join(tmpdir(), "waitron-adopt-state-"));
});

afterEach(async () => {
  const app = mirrorApp;
  const admin = mirrorAdmin;
  const clone = mirror;
  const dir = stateDir;
  mirrorApp = undefined as unknown as Database;
  mirrorAdmin = undefined as unknown as Database;
  mirror = undefined as unknown as RealPostgres;
  if (app !== undefined) await app.close();
  if (admin !== undefined) await admin.close();
  if (clone !== undefined) await clone.stop();
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
    ownerDb: mirrorAdmin,
    advertisedOrigin: ADVERTISED_ORIGIN,
    environment: extra.environment ?? ("preproduction" as const),
    fetchBundle: extra.fetchBundle ?? (async () => makeBundle()),
    persistTrading: extra.persistTrading ?? (async () => {}),
    persistModuleConfig: extra.persistModuleConfig ?? (async () => {}),
    stateDir,
    database: "mirror_db",
  };
}

describe("adoptFromPrimary (mirror adopt, real Postgres)", () => {
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
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBe("preproduction");
    expect(await readDeploymentMode(mirrorAdmin)).toBe("mirror");
    const cfg = (await readMirrorConfig(mirrorAdmin))!;
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
    expect(await verifyBreakGlass(mirrorApp, result.breakGlassSecret)).toBe(true);
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
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBeNull();
  });

  it("refuses a FOREIGN tenant before any mutation (§5, one tenant per database)", async () => {
    // Seed a DIFFERENT tenant into the mirror, then adopt a bundle for our tenant identity: refused.
    await mirrorAdmin.execute(
      sql`insert into tenants (id, country, tax_id, legal_name)
          values (1, 'ES', '99999999R', 'Incumbent SL')`,
    );
    const error = await adoptFromPrimary(deps(), REQ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_tenant");
    // Refused before any mutation: the database carries no deployment stamp.
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBeNull();
  });

  it("refuses a same-tenant venue before any mutation", async () => {
    await mirrorAdmin.execute(sql`
      insert into tenants (id, country, tax_id, legal_name)
      values (1, 'ES', '80000001K', 'Incumbent SL')`);
    await mirrorAdmin.execute(sql`
      insert into locations (name, invoice_locales, operation_description)
      values ('Existing venue', array['en-GB'], 'Hospitality')`);
    const error = await adoptFromPrimary(deps(), REQ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.second_venue");
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBeNull();
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
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBeNull();
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
