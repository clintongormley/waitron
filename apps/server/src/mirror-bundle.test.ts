import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readMembershipTrustSet, stampDeployment, type Database } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import { canonicalize, generateNodeKeyPair, verifyBytes } from "@waitron/membership";
import { parseModuleConfig, type WaitronModule } from "@waitron/module";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { writeModuleConfig } from "./module-config.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";

// The module list, as a mutable copy of the real one: the one case that needs a module the shipped
// list does not have adds it for its own duration.
vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return { ...actual, ALL_MODULES: [...actual.ALL_MODULES] };
});

/**
 * `assembleMirrorBundle`, the primary side, on the engine the box now runs.
 *
 * ## What went with PostgreSQL, and is replaced by nothing
 *
 * **The role is gone and nothing replaces it.** SQLite has no roles and `pg.connectAs` has no
 * counterpart. The `appDb` dependency is now handed the suite's own handle, so nothing here checks
 * that the deployment role holds SELECT on the parent tables. NO case was deleted for it: every
 * case asserts the SHAPE of the assembled bundle, not a refusal, so each converts with its
 * assertions untouched.
 *
 * The second, never-stamped database stays a second database. It is what the `mirror.not_provisioned`
 * case needs — an unstamped `deployment` row — and `useVenueDb` gives a file as many as it asks for.
 */
const LOCALE = "es-ES";

// The box vault key for `establishNodeIdentity` / `readNodeIdentityKey` — `assembleMirrorBundle`
// unseals the primary's identity key to endorse the standby.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The standby's identity key the primary vouches for — a real Ed25519 SPKI public key.
const STANDBY_PUB = generateNodeKeyPair().publicKey;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
// A second, never-stamped database for the null-environment branch.
const unstamped = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let caPem: string;
let db: Database;
// One tenant per database: the venue is provisioned ONCE in beforeAll and every test reuses it. The
// suite does not reset between tests (resetPerTest:false), so a per-test `setupVenue()` would
// accumulate tenants in a database whose vault holds one credential per purpose.
let designated: AdoptResult;

/** Provision a fresh venue (as the owner), stamp its database `preproduction`, and return the four
 * designated ids in AdoptResult shape. */
async function setupVenue(): Promise<AdoptResult> {
  const venue = await applyVenue(
    planVenue(
      {
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
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  await establishNodeIdentity({ ownerDb: db, ring: RING }, designated.nodeId);
  return designated;
}

function baseDeps() {
  return {
    appDb: db,
    ring: RING,
    stateDir,
    relayUrl: "https://relay.test:9000/",
    boxHostname: "waitron.local",
    accountKey: Buffer.alloc(32, 9).toString("base64"),
  };
}

beforeAll(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "waitron-mirror-bundle-state-"));
  await mkdir(join(stateDir, "tls"), { recursive: true });
  caPem = mintSelfSignedServerCert({
    hostnames: ["waitron.local"],
    ipAddresses: [],
    now: new Date(),
  }).caCertPem;
  await writeFile(join(stateDir, "tls", "ca.crt"), caPem);

  db = suite.db;
  await stampDeployment(db, "preproduction");
  designated = await setupVenue();
}, 180_000);

afterAll(async () => {
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("assembleMirrorBundle (primary side)", () => {
  it("assembles a bundle carrying tenant + node identity and the box's connection details", async () => {
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const bundle = await assembleMirrorBundle({ ...baseDeps(), designated, standby });

    // The connection handshake passes through verbatim; NO parent rows and NO per-peer credential.
    expect(bundle.designated).toEqual(designated);
    expect(bundle.environment).toBe("preproduction");
    expect(bundle.boxHostname).toBe("waitron.local");
    expect(bundle.boxCaPem).toContain("BEGIN CERTIFICATE");
    expect(bundle.relayUrl).toBe("https://relay.test:9000/");
    expect("rows" in bundle).toBe(false);
    expect("syncToken" in bundle).toBe(false);

    // The venue's tenant identity (for the mirror's foreign-tenant guard) and the designated node's
    // descriptor (for the reserved standby node row).
    expect(bundle.tenant.country).toBe("ES");
    expect(bundle.tenant.taxId).toMatch(/^\d{8}K$/);
    // Provisioning names the node after the LOCATION (venue-plan `create-node`).
    expect(bundle.primaryNode.name).toBe("Sala principal");
    expect(bundle.primaryNode.filingModule).toBe("verifactu");

    // The reserved identity: a fresh installation number, disjoint series, and an endorsement of the
    // standby's key by the primary node.
    const r = bundle.reservedIdentity;
    const fiscal = r.modules["fiscal-verifactu"] as {
      nif: string;
      idSistemaInformatico: string;
      numeroInstalacion: number;
    };
    expect(fiscal.numeroInstalacion).toBeGreaterThan(0);
    expect(fiscal.idSistemaInformatico).toBe("W1");
    expect(r.series.map((s) => s.code).sort()).toEqual(
      [`FA-${fiscal.numeroInstalacion}`, `RF-${fiscal.numeroInstalacion}`].sort(),
    );
    expect(r.endorsement.nodeId).toBe(standby.nodeId);
    expect(r.endorsement.endorsedBy).toBe(designated.nodeId);
    const primaryPub = (await readMembershipTrustSet(db))[designated.nodeId]!;
    expect(
      verifyBytes(
        canonicalize({ nodeId: standby.nodeId, publicKey: standby.publicKey }),
        r.endorsement.signature,
        primaryPub,
      ),
    ).toBe(true);
  });

  it("carries the primary's on-box module overrides", async () => {
    const toggleable = ALL_MODULES.find((m) => m.tier === "toggleable")!.name;
    await writeModuleConfig(
      stateDir,
      parseModuleConfig({ modules: { [toggleable]: false } }, ALL_MODULES),
    );
    try {
      const bundle = await assembleMirrorBundle({
        ...baseDeps(),
        designated,
        standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      });
      expect(bundle.moduleOverrides).toEqual({ [toggleable]: false });
    } finally {
      await rm(join(stateDir, "modules.json"), { force: true });
    }
  });

  it("carries {} when the primary has no modules.json", async () => {
    const bundle = await assembleMirrorBundle({
      ...baseDeps(),
      designated,
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
    });
    expect(bundle.moduleOverrides).toEqual({});
  });

  it("carries a WireGuard public key when one is provided, and omits it otherwise (swap S2)", async () => {
    const withKey = await assembleMirrorBundle({
      ...baseDeps(),
      designated,
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      wireguardPublicKey: "PUBKEY==",
    });
    expect(withKey.wireguardPublicKey).toBe("PUBKEY==");

    const withoutKey = await assembleMirrorBundle({
      ...baseDeps(),
      designated,
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
    });
    expect(withoutKey.wireguardPublicKey).toBeUndefined();
  });

  it("carries a reserving module's state even when it reserves no invoice series", async () => {
    const seriesless = {
      name: "test-standby-without-series",
      tier: "toggleable",
      provisioning: {
        standby: {
          reserve: async () => ({ state: { marker: "reserved" } }),
          establish: async () => {},
        },
      },
    } as unknown as WaitronModule;
    (ALL_MODULES as WaitronModule[]).push(seriesless);
    try {
      const bundle = await assembleMirrorBundle({
        ...baseDeps(),
        designated,
        standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      });
      const r = bundle.reservedIdentity;
      expect(r.modules["test-standby-without-series"]).toEqual({ marker: "reserved" });
      const fiscal = r.modules["fiscal-verifactu"] as { numeroInstalacion: number };
      expect(r.series.map((s) => s.code).sort()).toEqual(
        [`FA-${fiscal.numeroInstalacion}`, `RF-${fiscal.numeroInstalacion}`].sort(),
      );
    } finally {
      (ALL_MODULES as WaitronModule[]).splice(ALL_MODULES.indexOf(seriesless), 1);
    }
  });

  it("throws mirror.not_provisioned when the database carries no deployment stamp", async () => {
    await expect(
      assembleMirrorBundle({
        ...baseDeps(),
        appDb: unstamped.db,
        designated,
        standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      }),
    ).rejects.toMatchObject({ code: "mirror.not_provisioned" });
  });
});
