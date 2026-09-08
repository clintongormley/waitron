import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMembershipTrustSet, stampDeployment, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { loadKeyRing, type KeyRing } from "@waitron/credentials";
import { hashPassword, hashPin } from "@waitron/identity";
import { canonicalize, generateNodeKeyPair, verifyBytes } from "@waitron/membership";
import { parseModuleConfig } from "@waitron/module";
import { applyVenue, planVenue, type AdoptResult } from "@waitron/provisioning";
import type { ReplicationConfig } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { writeModuleConfig } from "./module-config.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";

// Real Postgres, not PGlite: assembleMirrorBundle reads the venue's tenant + node rows as `app_user`
// (PGlite connects as a superuser holding every privilege, so it could not prove app_user actually
// holds SELECT on those parent tables) and runs each module's reservation as that role. CLAUDE.md §4.
const LOCALE = "es-ES";

// The box vault key for `establishNodeIdentity` / `readNodeIdentityKey` — `assembleMirrorBundle`
// unseals the primary's identity key to endorse the standby.
const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The standby's identity key the primary vouches for — a real Ed25519 SPKI public key.
const STANDBY_PUB = generateNodeKeyPair().publicKey;

// This primary's own native-replication credential + advertise address (swap step 4), the value the
// bundle carries so the mirror's subscription can dial the primary as `waitron_repl`.
const REPLICATION: ReplicationConfig = {
  password: "repl-pw-abc",
  advertiseHost: "primary.internal",
  advertisePort: 6543,
};
const PRIMARY_DATABASE = "waitron_pp";

const suite = useTemplateDb({ template: "manifest" });
// A second, never-stamped clone for the null-environment branch.
const unstamped = useTemplateDb({ template: "manifest" });

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(80_000_000 + nifCounter).padStart(8, "0")}K`;
}

let stateDir: string;
let caPem: string;
let appDb: Database; // app_login → app_user: reads the venue rows in this database

/** Provision a fresh venue (as the owner), stamp its database `preproduction`, and return the five
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
        },
      },
      ALL_MODULES,
    ),
    { db: suite.admin, modules: ALL_MODULES },
  );
  const designated: AdoptResult = {
    tenantId: venue.tenantId,
    locationId: venue.locationId,
    tillId: venue.tillId,
    nodeId: venue.nodeId,
    seriesId: venue.seriesIds[0]!,
  };
  await establishNodeIdentity(
    { ownerDb: suite.admin, ring: RING },
    designated.tenantId,
    designated.nodeId,
  );
  return designated;
}

function baseDeps() {
  return {
    appDb,
    ring: RING,
    stateDir,
    relayUrl: "https://relay.test:9000/",
    boxHostname: "waitron.local",
    replication: REPLICATION,
    database: PRIMARY_DATABASE,
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

  await stampDeployment(suite.admin, "preproduction");
  appDb = await suite.pg.connectAs("app_login", "app_pw");
}, 180_000);

afterAll(async () => {
  if (appDb !== undefined) await appDb.close();
  if (stateDir !== undefined) await rm(stateDir, { recursive: true, force: true });
});

describe("assembleMirrorBundle (primary side, real Postgres)", () => {
  it("assembles a bundle carrying tenant + node identity, connection details, and the replication credential", async () => {
    const designated = await setupVenue();
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const bundle = await assembleMirrorBundle({ ...baseDeps(), designated, standby });

    // The connection handshake passes through verbatim; NO parent rows and NO sync token (swap step 4).
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

    // The replication CONNECTION the mirror's subscription dials — advertise host/port, the primary's
    // database name, and the `waitron_repl` password (secret, but it must travel for the mirror to
    // subscribe). The `user` is the well-known REPLICATION_ROLE and is not carried.
    expect(bundle.replication).toEqual({
      host: "primary.internal",
      port: 6543,
      database: "waitron_pp",
      password: "repl-pw-abc",
    });

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
        designated: await setupVenue(),
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
      designated: await setupVenue(),
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
    });
    expect(bundle.moduleOverrides).toEqual({});
  });

  it("carries a WireGuard public key when one is provided, and omits it otherwise (swap S2)", async () => {
    const withKey = await assembleMirrorBundle({
      ...baseDeps(),
      designated: await setupVenue(),
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      wireguardPublicKey: "PUBKEY==",
    });
    expect(withKey.wireguardPublicKey).toBe("PUBKEY==");

    const withoutKey = await assembleMirrorBundle({
      ...baseDeps(),
      designated: await setupVenue(),
      standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
    });
    expect(withoutKey.wireguardPublicKey).toBeUndefined();
  });

  it("throws mirror.not_provisioned when the database carries no deployment stamp", async () => {
    const designated = await setupVenue();
    const unstampedApp = await unstamped.pg.connectAs("app_login", "app_pw");
    try {
      await expect(
        assembleMirrorBundle({
          ...baseDeps(),
          appDb: unstampedApp,
          designated,
          standby: { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
        }),
      ).rejects.toMatchObject({ code: "mirror.not_provisioned" });
    } finally {
      await unstampedApp.close();
    }
  });
});
