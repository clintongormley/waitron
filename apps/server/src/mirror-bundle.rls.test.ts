import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMembershipTrustSet, stampDeployment, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import { canonicalize, generateNodeKeyPair, verifyBytes } from "@waitron/membership";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import { authenticatePeer } from "@waitron/sync";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";

// Real Postgres, not PGlite: assembleMirrorBundle reads the venue's parent rows as `app_user` under
// FORCE RLS (PGlite connects as a superuser and bypasses RLS, so it could not prove app_user actually
// holds SELECT on all five parent tables — the whole point here) and mints the token as a
// `sync_retention` member (`sync_pruner`), a non-superuser INSERT on sync_peers. CLAUDE.md §4.
const LOCALE = "es-ES";

// The box vault key for `establishNodeIdentity` / `readNodeIdentityKey` — a fixed test ring, exactly
// as node-identity.test.ts uses. `assembleMirrorBundle` now unseals the primary's identity key to
// endorse the standby.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The standby's identity key the primary vouches for — a real Ed25519 SPKI public key.
const STANDBY_PUB = generateNodeKeyPair().publicKey;

const suite = useTemplateDb({ template: "manifest" });
// A second, never-stamped clone for the null-environment branch: `suite` is stamped in beforeAll, so
// proving `readDeploymentEnvironment` returns null needs a database that was never stamped.
const unstamped = useTemplateDb({ template: "manifest" });

// Tenants accumulate for the life of the shared container and `tenants_country_tax_id_key` is unique,
// so each provisioned venue needs its own NIF — the per-suite counter the sibling rls tests use.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let caPem: string;
let appDb: Database; // app_login → app_user: reads the venue rows under RLS
let retentionDb: Database; // sync_pruner → sync_retention: mints the peer token

/** Provision a fresh venue (as the owner), stamp its database `preproduction`, and return the five
 * designated ids in AdoptResult shape (seriesId = the standard series, first of applyVenue's seriesIds). */
async function setupVenue(): Promise<AdoptResult> {
  const venue = await applyVenue(
    planVenue({
      country: "ES",
      taxId: nextNif(),
      legalName: "Mirror Bundle SL",
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
      seriesCode: "FA",
      rectificativeSeriesCode: "RF",
      admin: {
        displayName: "Administradora",
        pinHash: hashPin("1234"),
        passwordHash: hashPassword("dashPass123"),
      },
    }),
    { db: suite.admin },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  // Establish the primary's membership identity so assembleMirrorBundle can unseal it and endorse the
  // standby (mirrors node-identity.test.ts).
  await establishNodeIdentity(
    { ownerDb: suite.admin, ring: RING },
    designated.tenantId,
    designated.nodeId,
  );
  return designated;
}

beforeAll(async () => {
  // The bundle's stateDir must carry tls/ca.crt (the box CA path caCertPath resolves to). Mint a real
  // self-signed CA and write it there, so boxCaPem reads back a genuine PEM.
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  caPem = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  }).caCertPem;
  await writeFile(join(stateDir, "tls", "ca.crt"), caPem);

  // The deployment stamp is a whole-DB fact, so one stamp on the shared template serves every venue this
  // suite provisions. app_login → app_user for the RLS reads; sync_pruner → sync_retention for enrolPeer.
  await stampDeployment(suite.admin, "preproduction");
  appDb = await suite.pg.connectAs("app_login", "app_pw");
  retentionDb = await suite.pg.connectAs("sync_pruner", "pp");
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
  if (retentionDb !== undefined) await retentionDb.close();
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("assembleMirrorBundle (primary side, real Postgres)", () => {
  it("assembles a bundle carrying the venue rows, connection details, and a fresh token", async () => {
    const designated = await setupVenue();
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const bundle = await assembleMirrorBundle({
      appDb,
      retentionDb,
      ring: RING,
      stateDir,
      relayUrl: "https://relay.test:9000/",
      boxHostname: "waitron.local",
      designated,
      standby,
    });

    // The venue's parent rows are present and tenant-scoped.
    expect(bundle.rows.tenant.id).toBe(designated.tenantId);
    expect(bundle.rows.invoiceSeries.length).toBeGreaterThanOrEqual(1);
    expect(bundle.rows.locations.length).toBeGreaterThanOrEqual(1);
    expect(bundle.rows.nodes.length).toBeGreaterThanOrEqual(1);
    expect(bundle.rows.tills.length).toBeGreaterThanOrEqual(1);

    // The connection handshake passes through verbatim.
    expect(bundle.designated).toEqual(designated);
    expect(bundle.environment).toBe("preproduction");
    expect(bundle.boxHostname).toBe("waitron.local");
    expect(bundle.boxCaPem).toContain("BEGIN CERTIFICATE");
    expect(bundle.relayUrl).toBe("https://relay.test:9000/");

    // The reserved identity: a fresh installation number, disjoint series (FA/RF suffixed with it,
    // purpose preserved), and an endorsement of the standby's key by the primary node.
    const r = bundle.reservedIdentity;
    expect(r.numeroInstalacion).toBeGreaterThan(0);
    // The primary's own IdSistemaInformatico — applyVenue registers the SIF under WAITRON_ID_SISTEMA ("W1").
    expect(r.idSistemaInformatico).toBe("W1");
    expect(r.series.map((s) => s.code).sort()).toEqual(
      [`FA-${r.numeroInstalacion}`, `RF-${r.numeroInstalacion}`].sort(),
    );
    const byCode = new Map(r.series.map((s) => [s.code, s.purpose]));
    expect(byCode.get(`FA-${r.numeroInstalacion}`)).toBe("standard");
    expect(byCode.get(`RF-${r.numeroInstalacion}`)).toBe("rectificative");
    expect(r.endorsement.nodeId).toBe(standby.nodeId);
    expect(r.endorsement.publicKey).toBe(standby.publicKey);
    expect(r.endorsement.endorsedBy).toBe(designated.nodeId);
    const primaryPub = (await readMembershipTrustSet(suite.admin, designated.tenantId))[
      designated.nodeId
    ]!;
    expect(
      verifyBytes(
        canonicalize({ nodeId: standby.nodeId, publicKey: standby.publicKey }),
        r.endorsement.signature,
        primaryPub,
      ),
    ).toBe(true);

    // The minted token authenticates as a real peer, resolving to the STANDBY's OWN node id — the
    // identity the mirror pulls as from membership promotion R3a (NOT the designated/primary node).
    // Round-trips through authenticatePeer on the same retention pool.
    const auth = await authenticatePeer(retentionDb, bundle.syncToken);
    expect(auth.subscriberId).toBe(standby.nodeId);
    expect(auth.subscriberId).not.toBe(designated.nodeId);
  });

  it("isolates the rows to the designated tenant (RLS differential — a second venue's rows never leak)", async () => {
    // Two independent venues on the shared database. The bundle for A must carry A's tenant row and none
    // of B's location/node/till/series rows: the reads run as app_user under withTenant, so RLS is the
    // only thing scoping them (there is no explicit tenant filter on the location/node/till/series reads).
    const a = await setupVenue();
    const b = await setupVenue();

    const bundleA = await assembleMirrorBundle({
      appDb,
      retentionDb,
      ring: RING,
      stateDir,
      relayUrl: "https://relay.test:9000/",
      boxHostname: "waitron.local",
      designated: a,
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
    });

    expect(bundleA.rows.tenant.id).toBe(a.tenantId);
    expect(bundleA.rows.locations.map((r) => r.id)).toContain(a.locationId);
    expect(bundleA.rows.locations.map((r) => r.id)).not.toContain(b.locationId);
    expect(bundleA.rows.nodes.map((r) => r.id)).not.toContain(b.nodeId);
    expect(bundleA.rows.tills.map((r) => r.id)).not.toContain(b.tillId);
    expect(bundleA.rows.invoiceSeries.map((r) => r.id)).not.toContain(b.seriesId);
  });

  it("throws mirror.not_provisioned when the database carries no deployment stamp", async () => {
    // The never-stamped clone: readDeploymentEnvironment returns null (the deployment table is empty), so
    // there is nothing to mirror and the assembly refuses rather than shipping a bundle with no
    // environment. The rows read (which precedes the environment check) simply comes back empty on this
    // clone, so the throw is what the caller observes.
    const designated = await setupVenue();
    const unstampedApp = await unstamped.pg.connectAs("app_login", "app_pw");
    try {
      await expect(
        assembleMirrorBundle({
          appDb: unstampedApp,
          retentionDb,
          ring: RING,
          stateDir,
          relayUrl: "https://relay.test:9000/",
          boxHostname: "waitron.local",
          designated,
          standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
        }),
      ).rejects.toMatchObject({ code: "mirror.not_provisioned" });
    } finally {
      await unstampedApp.close();
    }
  });
});
