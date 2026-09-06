import { sql } from "drizzle-orm";
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  readDeploymentEnvironment,
  readDeploymentMode,
  readMembershipTrustSet,
  readMirrorConfig,
  readNodeEndorsement,
  setNodePublicKey,
  tenants,
  tills,
  withTenant,
  type Database,
} from "@waitron/db";
import {
  cloneTemplate,
  nextCloneName,
  pickTemplate,
  resolveSharedHandle,
  useTemplateDb,
} from "@waitron/db/testing/lifecycle.js";
import { type RealPostgres } from "@waitron/db/testing/postgres.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { isEnabled, type ModuleConfig } from "@waitron/module";
import { isAppError } from "@waitron/shared";
import {
  applyVenue,
  planVenue,
  type AdoptResult,
  type AdoptVenueRows,
} from "@waitron/provisioning";
import { adoptFromPrimary, type AdoptCredential, type PersistTradingArgs } from "./adopt.js";
import { ALL_MODULES } from "./modules.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import { readMirrorToken } from "./mirror-token.js";
import { readNodeIdentityKey } from "./node-identity.js";

// Real Postgres, not PGlite: adopt inserts the parent rows and stamps deployment/mirror_config on the
// OWNER connection while the read-back runs as `app_user` — a two-role split PGlite's superuser-only
// connection cannot model, and where a missing GRANT would pass on PGlite and fail at runtime.
// CLAUDE.md §4.
const LOCALE = "es-ES";

// The mirror's own box key — the token is sealed under it and read back under it.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x2c).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// This mirror's own advertised origin (`config.advertisedOrigin` in boot) — adopt sends it to the
// primary as the joining node's `contactUrl`, the address a rerouting till dials (till-reroute §3.3).
const ADVERTISED_ORIGIN = "https://standby.deli.test";

// The SOURCE database supplies the primary's real parent rows; it is shared across the suite (a
// fresh venue with its own NIF per test accumulates there harmlessly — nothing guards the source).
const source = useTemplateDb({ template: "manifest" });

// The MIRROR is cloned FRESH PER TEST, not shared: `adoptFromPrimary` now refuses a foreign obligado
// (assertNoForeignObligado, one obligado per database, §5), and each test adopts a DIFFERENT obligado,
// so a shared mirror would make the second adopt throw `provisioning.foreign_obligado`. A per-test
// clone is exactly the production shape anyway — adopt runs against a fresh, never-stamped instance.
let mirror: RealPostgres;
let mirrorAdmin: Database; // owner connection to the fresh mirror clone
let mirrorApp: Database; // app_login → app_user on the mirror: the boot-time token read path

let sourceApp: Database; // app_login → app_user on the source: reads the venue's parent rows

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

// The dormant fiscal + membership identity the primary reserves for the standby (design §6 R2), the
// `bundle.reservedIdentity` the primary mints in Task 4. Each reservation gets its OWN
// (nif, idSistemaInformatico, numeroInstalacion) + series codes: the mirror is fresh per test, but the
// SOURCE venue (built from `nextNif`) is shared, so distinct identities keep both sides collision-free.
// The endorsement is stored VERBATIM on the standby's node row (jsonb); adopt performs no signature
// check, so a representative shape suffices here (the real signing round-trip lives in mirror-bundle-*).
let reservedCounter = 0;
function nextReservedIdentity(): ReservedIdentity {
  reservedCounter += 1;
  return {
    modules: {
      fiscal: {
        nif: `${String(90_000_000 + reservedCounter).padStart(8, "0")}K`,
        // Two characters: `establish` applies the same `id_sistema_informatico` length rule as
        // `registerSif`, and refuses a longer reservation with `sif.reservation_invalid`.
        idSistemaInformatico: "WS",
        numeroInstalacion: reservedCounter,
      },
    },
    series: [
      { code: `SA-${reservedCounter}`, purpose: "standard" },
      { code: `SR-${reservedCounter}`, purpose: "rectificative" },
    ],
    endorsement: {
      nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      publicKey: "STANDBY_PUB",
      endorsedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      signature: "ENDORSEMENT_SIG",
    },
  };
}

/** Provision a fresh venue on the source (as the owner) and read back its five parent-row sets +
 * designated ids in the `AdoptVenueRows`/`AdoptResult` shape the bundle carries. */
async function buildBundleParts(): Promise<{ rows: AdoptVenueRows; designated: AdoptResult }> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Adopt Orchestrator SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        tillName: "Caja 1",
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
        },
      },
      ALL_MODULES,
    ),
    { db: source.admin, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  // Read the bundle parent rows through the application transaction.
  const rows: AdoptVenueRows = await withTenant(sourceApp, designated.tenantId, async (tx) => ({
    tenant: (
      await tx
        .select()
        .from(tenants)
        .where(sql`${tenants.id} = ${designated.tenantId}`)
    )[0]!,
    locations: await tx
      .select()
      .from(locations)
      .where(sql`${locations.tenantId} = ${designated.tenantId}`),
    nodes: await tx
      .select()
      .from(nodes)
      .where(sql`${nodes.tenantId} = ${designated.tenantId}`),
    tills: await tx
      .select()
      .from(tills)
      .where(sql`${tills.tenantId} = ${designated.tenantId}`),
    invoiceSeries: await tx
      .select()
      .from(invoiceSeries)
      .where(sql`${invoiceSeries.tenantId} = ${designated.tenantId}`),
  }));
  return { rows, designated };
}

beforeAll(async () => {
  sourceApp = await source.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (sourceApp !== undefined) await sourceApp.close();
});

// A fresh mirror clone per test (see the declarations above): clone from the shared container's
// pre-migrated `manifest` template (~26ms), open the owner + app connections. The clone and both
// connections are torn down in afterEach, each guard checked (a failed clone/connect must not throw
// a second TypeError over the real error — `scripts/guarded-teardowns.test.ts`).
beforeEach(async () => {
  const handle = resolveSharedHandle(undefined);
  mirror = await cloneTemplate(handle.uri, pickTemplate(handle, "manifest"), nextCloneName());
  mirrorAdmin = await mirror.connect();
  mirrorApp = await mirror.connectAs("app_login", "app_pw");
});

afterEach(async () => {
  const app = mirrorApp;
  const admin = mirrorAdmin;
  const clone = mirror;
  mirrorApp = undefined as unknown as Database;
  mirrorAdmin = undefined as unknown as Database;
  mirror = undefined as unknown as RealPostgres;
  if (app !== undefined) await app.close();
  if (admin !== undefined) await admin.close();
  if (clone !== undefined) await clone.stop();
});

describe("adoptFromPrimary (mirror-side orchestrator, real Postgres)", () => {
  it("adopts: inserts parents, stamps env + mirror mode, seals the token, writes mirror_config, persists trading.env", async () => {
    const { rows, designated } = await buildBundleParts();
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      relayUrl: "https://relay.test:9000/",
      syncToken: "peer-token-adopt-001",
      reservedIdentity: nextReservedIdentity(),
      moduleOverrides: {},
    };

    const persisted: PersistTradingArgs[] = [];
    const persistedModuleConfigs: ModuleConfig[] = [];
    let fetchArgs: { primaryUrl: string; credential: AdoptCredential } | undefined;
    let capturedStandby: { nodeId: string; publicKey: string; contactUrl: string } | undefined;
    const credential: AdoptCredential = {
      personId: "99999999-9999-9999-9999-999999999999",
      password: "dashPass123",
    };

    const result = await adoptFromPrimary(
      {
        ownerDb: mirrorAdmin,
        ring: RING,
        advertisedOrigin: ADVERTISED_ORIGIN,
        fetchBundle: async (primaryUrl, cred, standby) => {
          fetchArgs = { primaryUrl, credential: cred };
          capturedStandby = standby;
          return bundle;
        },
        persistTrading: async (a) => {
          persisted.push(a);
        },
        persistModuleConfig: async (c) => {
          persistedModuleConfigs.push(c);
        },
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
        database: "mirror_db",
      },
      { primaryUrl: "https://primary.test/", credential },
    );

    // The orchestrator returns the adopted tenant and forwarded the operator's inputs to the fetcher.
    expect(result.tenantId).toBe(designated.tenantId);
    expect(fetchArgs).toEqual({ primaryUrl: "https://primary.test/", credential });
    // This node's OWN advertised origin travelled with the standby identity: the primary records it as
    // the joining node's `contactUrl` in the membership document (till-reroute §3.3).
    expect(capturedStandby!.contactUrl).toBe(ADVERTISED_ORIGIN);

    // Environment stamped to the primary's value, mode flipped to mirror.
    expect(await readDeploymentEnvironment(mirrorAdmin)).toBe("preproduction");
    expect(await readDeploymentMode(mirrorAdmin)).toBe("mirror");

    // Connection config persisted; the token sealed under the mirror's key and readable as app_user.
    // `origin_node_id` is the PRIMARY's node — the origin the mirror will pull, split from its own id
    // (membership promotion R3a).
    const persistedConfig = (await readMirrorConfig(mirrorAdmin))!;
    expect(persistedConfig.relayUrl).toBe(bundle.relayUrl);
    expect(persistedConfig.originNodeId).toBe(designated.nodeId);
    expect(await readMirrorToken(mirrorApp, RING, designated.tenantId)).toBe(bundle.syncToken);

    // trading.env got the shared venue's four designated ids (tenant/location/till/series) + the
    // environment + the DB URLs, but `nodeId` is the mirror's OWN id (the standby minted in memory and
    // threaded to the fetch), NOT `designated.nodeId` — R3a runs the mirror under its own identity.
    // Without WAITRON_SYNC_DATABASE_URL in trading.env the next (mirror) boot's `loadMirrorSyncConfig`
    // throws `server.config_missing` and never enters mirror mode.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      tillId: designated.tillId,
      nodeId: capturedStandby!.nodeId,
      seriesId: designated.seriesId,
      environment: "preproduction",
      databaseUrl: "postgres://app@mirror/db",
      migrationsDatabaseUrl: "postgres://owner@mirror/db",
      syncDatabaseUrl: "postgres://sync@mirror/db",
    });
    expect(persisted[0]!.nodeId).not.toBe(designated.nodeId);

    // The mirror inherited the primary's (empty) module set — an unconditional write even for `{}`, so
    // the mirror's set is explicitly the primary's and a re-adopt is an idempotent overwrite (SP-1d).
    expect(persistedModuleConfigs).toHaveLength(1);
    expect(isEnabled(persistedModuleConfigs[0]!, ALL_MODULES[0]!.name)).toBe(true);

    // The parent rows landed on the mirror (adoptVenue ran).
    const t = await mirrorAdmin.execute(
      sql`select id from tenants where id = ${designated.tenantId}`,
    );
    expect(t.rows).toHaveLength(1);

    // R2: the orchestrator generated the standby identity in memory and threaded it into the fetch, so
    // the primary could reserve + endorse it. (The dormant-identity outcomes are asserted in full by the
    // dedicated test below.)
    expect(capturedStandby?.nodeId).toBeDefined();
    expect(capturedStandby?.publicKey).toBeDefined();
  });

  it("a mirror inherits the primary's trust anchor through the replicated node row (no adopt change)", async () => {
    // Owner Decision 2, proven end-to-end: the adopt path itself needs NO membership code. The primary
    // stamps its node's public key (as establishNodeIdentity does on provision); adoptVenue replicates
    // the `nodes` row column-for-column; `readMembershipTrustSet` on the mirror's OWN app pool reads it
    // back. So a mirror trusts the primary with nothing but the row it already copies.
    const PRIMARY_PUB = "PRIMARY_PUB";
    const { rows, designated } = await buildBundleParts();
    // Stamp the source node key as owner, then read it through the same app connection
    // used to assemble a mirror bundle.
    await setNodePublicKey(source.admin, designated.tenantId, designated.nodeId, PRIMARY_PUB);
    rows.nodes = await withTenant(sourceApp, designated.tenantId, (tx) =>
      tx
        .select()
        .from(nodes)
        .where(sql`${nodes.tenantId} = ${designated.tenantId}`),
    );
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      relayUrl: "https://relay.test:9000/",
      syncToken: "peer-token-adopt-002",
      reservedIdentity: nextReservedIdentity(),
      moduleOverrides: {},
    };

    let standby: { nodeId: string; publicKey: string; contactUrl: string } | undefined;
    await adoptFromPrimary(
      {
        ownerDb: mirrorAdmin,
        ring: RING,
        advertisedOrigin: ADVERTISED_ORIGIN,
        fetchBundle: async (_url, _cred, s) => {
          standby = s;
          return bundle;
        },
        persistTrading: async () => {},
        persistModuleConfig: async () => {},
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
        database: "mirror_db",
      },
      {
        primaryUrl: "https://primary.test/",
        credential: {
          personId: "99999999-9999-9999-9999-999999999999",
          password: "dashPass123",
        },
      },
    );

    // The mirror's app pool now reads the primary's key back as the venue's trust anchor — proof the
    // trust anchor inherited through replication alone. Assert the VALUE (not mere presence) so a dropped
    // or mis-replicated `public_key` fails here. R2 adds the standby's OWN dormant node to the same set
    // (its public key rides `reservedIdentity`), so the set now carries both — the primary as the anchor,
    // and the standby the venue will trust once promoted.
    const trust = await readMembershipTrustSet(mirrorApp, designated.tenantId);
    expect(trust).toEqual({
      [designated.nodeId]: PRIMARY_PUB,
      [standby!.nodeId]: standby!.publicKey,
    });
  });

  it("establishes the standby's dormant identity from the bundle's reservedIdentity", async () => {
    // R2 round-trip (design §6): adopt mints the standby identity in memory, sends it to the primary for
    // reservation + endorsement, then persists the returned `reservedIdentity` as a DORMANT identity on
    // the mirror — a sealed private key, its own node row carrying the endorsement, a reserved SIF keyed
    // to its OWN nodeId (never `designated.nodeId`, so no sale resolves it), and reserved series. None of
    // it makes the mirror sellable; it lies inert until an R3 promotion.
    const { rows, designated } = await buildBundleParts();
    const reservedIdentity = nextReservedIdentity();
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      relayUrl: "https://relay.test:9000/",
      syncToken: "peer-token-adopt-003",
      reservedIdentity,
      moduleOverrides: {},
    };

    let capturedStandby: { nodeId: string; publicKey: string; contactUrl: string } | undefined;
    await adoptFromPrimary(
      {
        ownerDb: mirrorAdmin,
        ring: RING,
        advertisedOrigin: ADVERTISED_ORIGIN,
        fetchBundle: async (_url, _cred, standby) => {
          capturedStandby = standby;
          return bundle;
        },
        persistTrading: async () => {},
        persistModuleConfig: async () => {},
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
        database: "mirror_db",
      },
      {
        primaryUrl: "https://primary.test/",
        credential: {
          personId: "99999999-9999-9999-9999-999999999999",
          password: "dashPass123",
        },
      },
    );

    // The standby identity crossed to the fetcher (a fresh nodeId, distinct from the designated node).
    expect(capturedStandby).toBeDefined();
    expect(capturedStandby!.nodeId).not.toBe(designated.nodeId);

    // The standby's private key is sealed on the mirror under `membership.node_key` — `readNodeIdentityKey`
    // returns it (throwing `credentials.missing` if it were never established), so a non-empty string here
    // proves the seal.
    const sealedKey = await readNodeIdentityKey(mirrorApp, RING, designated.tenantId);
    expect(typeof sealedKey).toBe("string");
    expect(sealedKey.length).toBeGreaterThan(0);

    // Exactly ONE reserved (dormant) registro_sif for this tenant, keyed to the standby's OWN nodeId with
    // the primary-allocated number — NOT `designated.nodeId`, so the mirror still has no LIVE selling SIF
    // and forks no chain (CLAUDE.md §5). Scoped by tenant_id: the mirror DB is shared across this suite.
    const reservedSif = await mirrorAdmin.execute<{ numero_instalacion: number; node_id: string }>(
      sql`select numero_instalacion, node_id from registro_sif
          where revocado_en is null and tenant_id = ${designated.tenantId}`,
    );
    expect(reservedSif.rows).toHaveLength(1);
    expect(reservedSif.rows[0]!.node_id).toBe(capturedStandby!.nodeId);
    expect(reservedSif.rows[0]!.node_id).not.toBe(designated.nodeId);
    expect(reservedSif.rows[0]!.numero_instalacion).toBe(
      (reservedIdentity.modules.fiscal as { numeroInstalacion: number }).numeroInstalacion,
    );

    // The primary's endorsement of the standby's key is stored on the standby's node row, verbatim.
    const endorsement = await readNodeEndorsement(
      mirrorApp,
      designated.tenantId,
      capturedStandby!.nodeId,
    );
    expect(endorsement).toEqual(reservedIdentity.endorsement);
  });

  it("bootstraps the mirror's module set from the bundle's overrides", async () => {
    const { rows, designated } = await buildBundleParts();
    const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "x",
      relayUrl: "https://relay.test/",
      syncToken: "peer-token-modcfg",
      reservedIdentity: nextReservedIdentity(),
      moduleOverrides: { [toggleable]: false },
    };
    let persisted: ModuleConfig | undefined;
    await adoptFromPrimary(
      {
        ownerDb: mirrorAdmin,
        ring: RING,
        advertisedOrigin: ADVERTISED_ORIGIN,
        fetchBundle: async () => bundle,
        persistTrading: async () => {},
        persistModuleConfig: async (c) => {
          persisted = c;
        },
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
        database: "mirror_db",
      },
      {
        primaryUrl: "https://primary.test/",
        credential: { personId: "99999999-9999-9999-9999-999999999999", password: "p" },
      },
    );
    expect(persisted).toBeDefined();
    expect(isEnabled(persisted!, toggleable)).toBe(false);
  });

  it("refuses adopt (fail-closed) when the bundle names an unknown module, before persistTrading", async () => {
    const { rows, designated } = await buildBundleParts();
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "x",
      relayUrl: "https://relay.test/",
      syncToken: "peer-token-bad",
      reservedIdentity: nextReservedIdentity(),
      moduleOverrides: { "no-such-module": false },
    };
    let tradingPersisted = false;
    await expect(
      adoptFromPrimary(
        {
          ownerDb: mirrorAdmin,
          ring: RING,
          advertisedOrigin: ADVERTISED_ORIGIN,
          fetchBundle: async () => bundle,
          persistTrading: async () => {
            tradingPersisted = true;
          },
          persistModuleConfig: async () => {},
          databaseUrl: "postgres://app@mirror/db",
          migrationsDatabaseUrl: "postgres://owner@mirror/db",
          syncDatabaseUrl: "postgres://sync@mirror/db",
          database: "mirror_db",
        },
        {
          primaryUrl: "https://primary.test/",
          credential: { personId: "99999999-9999-9999-9999-999999999999", password: "p" },
        },
      ),
    ).rejects.toMatchObject({ code: "module.config_unknown" });
    expect(tradingPersisted).toBe(false);
    // The up-front validation ran BEFORE any DB side effect, so `adoptVenue` never inserted this
    // bundle's (fresh) tenant — no half-adopted mirror for a set we reject (Copilot/review fail-fast
    // fix). Move the `parseModuleOverrides` call back to its old late position and this row appears.
    const orphanTenant = await mirrorAdmin.execute(
      sql`select id from tenants where id = ${designated.tenantId}`,
    );
    expect(orphanTenant.rows).toHaveLength(0);
  });

  it("refuses adopt (fail-closed) when the mirror database already holds a DIFFERENT obligado (§5)", async () => {
    // adoptFromPrimary shares the same `assertNoForeignObligado` guard as the provision paths (§5).
    // Adopt obligado A, then a DIFFERENT obligado B into the SAME mirror: B is refused before any side
    // effect. Deletion-proof: drop the guard in adopt.ts and B is ADOPTED (the same-environment re-stamp
    // is idempotent, so nothing else stops it) — two obligados in one database, the leak §5 forbids.
    const deps = (bundle: MirrorBundle, onPersistTrading?: () => void) => ({
      ownerDb: mirrorAdmin,
      ring: RING,
      advertisedOrigin: ADVERTISED_ORIGIN,
      fetchBundle: async () => bundle,
      persistTrading: async () => onPersistTrading?.(),
      persistModuleConfig: async () => {},
      databaseUrl: "postgres://app@mirror/db",
      migrationsDatabaseUrl: "postgres://owner@mirror/db",
      syncDatabaseUrl: "postgres://sync@mirror/db",
      database: "mirror_db",
    });
    const req = {
      primaryUrl: "https://primary.test/",
      credential: { personId: "99999999-9999-9999-9999-999999999999", password: "dashPass123" },
    } as const;
    const common = {
      environment: "preproduction" as const,
      boxHostname: "waitron.local",
      boxCaPem: "x",
      relayUrl: "https://relay.test/",
      moduleOverrides: {},
    };

    // Obligado A adopted — the mirror now serves it.
    const a = await buildBundleParts();
    await adoptFromPrimary(
      deps({
        ...common,
        rows: a.rows,
        designated: a.designated,
        syncToken: "peer-token-a",
        reservedIdentity: nextReservedIdentity(),
      }),
      req,
    );

    // A DIFFERENT obligado B (fresh NIF) adopted into the same mirror — refused.
    const b = await buildBundleParts();
    let tradingPersistedForB = false;
    const error = await adoptFromPrimary(
      deps(
        {
          ...common,
          rows: b.rows,
          designated: b.designated,
          syncToken: "peer-token-b",
          reservedIdentity: nextReservedIdentity(),
        },
        () => {
          tradingPersistedForB = true;
        },
      ),
      req,
    ).catch((e: unknown) => e);
    expect(isAppError(error) && error.code).toBe("provisioning.foreign_obligado");
    // Refused before any side effect: trading.env not written, B's tenant never inserted, A still alone.
    expect(tradingPersistedForB).toBe(false);
    const bRow = await mirrorAdmin.execute(
      sql`select id from tenants where id = ${b.designated.tenantId}`,
    );
    expect(bRow.rows).toHaveLength(0);
    const count = await mirrorAdmin.execute<{ n: number }>(
      sql`select count(*)::int as n from tenants`,
    );
    expect(count.rows[0]!.n).toBe(1);
  });
});
