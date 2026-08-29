import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadKeyRing } from "@waitron/credentials";
import {
  invoiceSeries,
  locations,
  nodes,
  readDeploymentEnvironment,
  readDeploymentMode,
  readMirrorConfig,
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
import type { MirrorBundle } from "./mirror-bundle.js";
import { readMirrorToken } from "./mirror-token.js";

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
    };

    const persisted: PersistTradingArgs[] = [];
    let fetchArgs: { primaryUrl: string; credential: AdoptCredential } | undefined;
    const credential: AdoptCredential = {
      personId: "99999999-9999-9999-9999-999999999999",
      password: "dashPass123",
    };

    const result = await adoptFromPrimary(
      {
        ownerDb: mirror.admin,
        ring: RING,
        fetchBundle: async (primaryUrl, cred) => {
          fetchArgs = { primaryUrl, credential: cred };
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
  });
});
