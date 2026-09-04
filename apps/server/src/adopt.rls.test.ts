import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { hashPassword, hashPin } from "@waitron/identity";
import {
  applyVenue,
  planVenue,
  type AdoptResult,
  type AdoptVenueRows,
} from "@waitron/provisioning";
import { adoptFromPrimary, type AdoptCredential, type PersistTradingArgs } from "./adopt.js";
import type { MirrorBundle, ReservedIdentity } from "./mirror-bundle.js";
import { readMirrorToken } from "./mirror-token.js";
import { readNodeIdentityKey } from "./node-identity.js";

// Real Postgres, not PGlite: adopt inserts the parent rows and stamps deployment/mirror_config on the
// OWNER connection, seals the token into FORCE-RLS `tenant_credentials`, and the read-back runs as
// `app_user` under RLS — none of which PGlite's superuser-only connection can prove. CLAUDE.md §4.
const LOCALE = "es-ES";

// The mirror's own box key — the token is sealed under it and read back under it.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x2c).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The SOURCE database supplies the primary's real parent rows; the MIRROR database is a fresh,
// never-stamped clone that adopt provisions. Two independent clones of the same template.
const source = useTemplateDb({ template: "manifest" });
const mirror = useTemplateDb({ template: "manifest" });

let sourceApp: Database; // app_login → app_user on the source: reads the venue's parent rows under RLS
let mirrorApp: Database; // app_login → app_user on the mirror: the boot-time token read path

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

// The dormant fiscal + membership identity the primary reserves for the standby (design §6 R2), the
// `bundle.reservedIdentity` the primary mints in Task 4. The mirror DB is shared across this suite's
// tests, so each reservation needs its OWN (nif, idSistemaInformatico, numeroInstalacion) — the global
// `registro_sif_instalacion_uq` (never-reuse per NIF) 23505s a duplicate — and its own series codes.
// The endorsement is stored VERBATIM on the standby's node row (jsonb); adopt performs no signature
// check, so a representative shape suffices here (the real signing round-trip lives in mirror-bundle-*).
let reservedCounter = 0;
function nextReservedIdentity(): ReservedIdentity {
  reservedCounter += 1;
  return {
    nif: `${String(90_000_000 + reservedCounter).padStart(8, "0")}K`,
    idSistemaInformatico: "WAITRON-STANDBY",
    numeroInstalacion: reservedCounter,
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
    planVenue({
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
    }),
    { db: source.admin },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  // Read the parent rows as app_user under withTenant (RLS scopes them), the same read
  // `assembleMirrorBundle` performs — column-for-column rows ready to insert verbatim on the mirror.
  const rows: AdoptVenueRows = await withTenant(sourceApp, designated.tenantId, async (tx) => ({
    tenant: (
      await tx
        .select()
        .from(tenants)
        .where(sql`${tenants.id} = ${designated.tenantId}`)
    )[0]!,
    locations: await tx.select().from(locations),
    nodes: await tx.select().from(nodes),
    tills: await tx.select().from(tills),
    invoiceSeries: await tx.select().from(invoiceSeries),
  }));
  return { rows, designated };
}

beforeAll(async () => {
  sourceApp = await source.pg.connectAs("app_login", "app_pw");
  mirrorApp = await mirror.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (sourceApp !== undefined) await sourceApp.close();
  if (mirrorApp !== undefined) await mirrorApp.close();
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
    };

    const persisted: PersistTradingArgs[] = [];
    let fetchArgs: { primaryUrl: string; credential: AdoptCredential } | undefined;
    let capturedStandby: { nodeId: string; publicKey: string } | undefined;
    const credential: AdoptCredential = {
      personId: "99999999-9999-9999-9999-999999999999",
      password: "dashPass123",
    };

    const result = await adoptFromPrimary(
      {
        ownerDb: mirror.admin,
        ring: RING,
        fetchBundle: async (primaryUrl, cred, standby) => {
          fetchArgs = { primaryUrl, credential: cred };
          capturedStandby = standby;
          return bundle;
        },
        persistTrading: async (a) => {
          persisted.push(a);
        },
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
      },
      { primaryUrl: "https://primary.test/", credential },
    );

    // The orchestrator returns the adopted tenant and forwarded the operator's inputs to the fetcher.
    expect(result.tenantId).toBe(designated.tenantId);
    expect(fetchArgs).toEqual({ primaryUrl: "https://primary.test/", credential });

    // Environment stamped to the primary's value, mode flipped to mirror.
    expect(await readDeploymentEnvironment(mirror.admin)).toBe("preproduction");
    expect(await readDeploymentMode(mirror.admin)).toBe("mirror");

    // Connection config persisted; the token sealed under the mirror's key and readable as app_user.
    expect((await readMirrorConfig(mirror.admin))!.relayUrl).toBe(bundle.relayUrl);
    expect(await readMirrorToken(mirrorApp, RING, designated.tenantId)).toBe(bundle.syncToken);

    // trading.env got the five designated ids + the environment + the DB URLs, including the mirror's
    // OWN sync-pool URL — without WAITRON_SYNC_DATABASE_URL in trading.env the next (mirror) boot's
    // `loadMirrorSyncConfig` throws `server.config_missing` and never enters mirror mode.
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      tillId: designated.tillId,
      nodeId: designated.nodeId,
      seriesId: designated.seriesId,
      environment: "preproduction",
      databaseUrl: "postgres://app@mirror/db",
      migrationsDatabaseUrl: "postgres://owner@mirror/db",
      syncDatabaseUrl: "postgres://sync@mirror/db",
    });

    // The parent rows landed on the mirror (adoptVenue ran).
    const t = await mirror.admin.execute(
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
    // Stamp the primary's node on the SOURCE as the owner (setNodePublicKey is owner-role), then re-read
    // the `nodes` rows as app_user under RLS — the same read `assembleMirrorBundle` performs — so the
    // key rides the bundle through a real app-pool read on BOTH sides, not a hand-set field.
    await setNodePublicKey(source.admin, designated.tenantId, designated.nodeId, PRIMARY_PUB);
    rows.nodes = await withTenant(sourceApp, designated.tenantId, (tx) => tx.select().from(nodes));
    const bundle: MirrorBundle = {
      rows,
      designated,
      environment: "preproduction",
      boxHostname: "waitron.local",
      boxCaPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
      relayUrl: "https://relay.test:9000/",
      syncToken: "peer-token-adopt-002",
      reservedIdentity: nextReservedIdentity(),
    };

    let standby: { nodeId: string; publicKey: string } | undefined;
    await adoptFromPrimary(
      {
        ownerDb: mirror.admin,
        ring: RING,
        fetchBundle: async (_url, _cred, s) => {
          standby = s;
          return bundle;
        },
        persistTrading: async () => {},
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
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
    };

    let capturedStandby: { nodeId: string; publicKey: string } | undefined;
    await adoptFromPrimary(
      {
        ownerDb: mirror.admin,
        ring: RING,
        fetchBundle: async (_url, _cred, standby) => {
          capturedStandby = standby;
          return bundle;
        },
        persistTrading: async () => {},
        databaseUrl: "postgres://app@mirror/db",
        migrationsDatabaseUrl: "postgres://owner@mirror/db",
        syncDatabaseUrl: "postgres://sync@mirror/db",
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
    const reservedSif = await mirror.admin.execute<{ numero_instalacion: number; node_id: string }>(
      sql`select numero_instalacion, node_id from registro_sif
          where revocado_en is null and tenant_id = ${designated.tenantId}`,
    );
    expect(reservedSif.rows).toHaveLength(1);
    expect(reservedSif.rows[0]!.node_id).toBe(capturedStandby!.nodeId);
    expect(reservedSif.rows[0]!.node_id).not.toBe(designated.nodeId);
    expect(reservedSif.rows[0]!.numero_instalacion).toBe(reservedIdentity.numeroInstalacion);

    // The primary's endorsement of the standby's key is stored on the standby's node row, verbatim.
    const endorsement = await readNodeEndorsement(
      mirrorApp,
      designated.tenantId,
      capturedStandby!.nodeId,
    );
    expect(endorsement).toEqual(reservedIdentity.endorsement);
  });
});
