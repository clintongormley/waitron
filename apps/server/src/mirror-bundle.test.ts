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
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue, type AdoptResult } from "@waitron/provisioning";
import { ALL_MODULES } from "./modules.js";
import { writeModuleConfig } from "./module-config.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import {
  standbyContract,
  allocatedStandbyModules,
  prepareStandbyDatabase,
  takenOverSeries,
} from "./testing/allocated-contract.js";
import { locationId, nodeId } from "@waitron/shared";

// A mutable copy, so one case can add a module for its own duration.
vi.mock("./modules.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modules.js")>();
  return { ...actual, ALL_MODULES: [...actual.ALL_MODULES] };
});

const LOCALE = "es-ES";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xc).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const STANDBY_PUB = generateNodeKeyPair().publicKey;

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  timeoutMs: 60_000,
});
const spare = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
// Never stamped, for `mirror.not_provisioned`.
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
// Provisioned once: the suite does not reset between tests, and a database holds one tenant.
let designated: AdoptResult;

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
    nodeId: venue.nodeId,
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
  it("carries no cached invoice series in the designated trading identity", async () => {
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };
    const stale = { ...designated, seriesId: "cached" };
    const { bundle } = await allocatedBundle(standby, { designated: stale });
    expect(bundle.designated).not.toHaveProperty("seriesId");
    expect(bundle.designated.nodeId).toBe(designated.nodeId);
    expect(bundle.designated.locationId).toBe(designated.locationId);
  });

  it("assembles a bundle carrying tenant + node identity and the box's connection details", async () => {
    const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };

    const { bundle, fixture } = await allocatedBundle(standby);

    expect(bundle.designated).toEqual(designated);
    expect(bundle.environment).toBe("preproduction");
    expect(bundle.boxHostname).toBe("waitron.local");
    expect(bundle.boxCaPem).toContain("BEGIN CERTIFICATE");
    expect(bundle.relayUrl).toBe("https://relay.test:9000/");
    expect("rows" in bundle).toBe(false);
    expect("syncToken" in bundle).toBe(false);

    expect(bundle.tenant.country).toBe("ES");
    expect(bundle.tenant.taxId).toMatch(/^\d{8}K$/);
    expect(bundle.primaryNode.name).toBe("Sala principal");
    expect(bundle.primaryNode.filingModule).toBe("verifactu");

    const r = bundle.reservedIdentity;
    const fiscal = r.modules["fiscal-verifactu"] as typeof fixture.state;
    const allocation = fiscal.evidence.block.payload.allocations[0]!;
    expect(allocation.installationIdentity).toBe("P000042");
    expect(allocation.taxpayerNif).toBe(bundle.tenant.taxId);
    expect(allocation.softwareId).toBe("W1");
    expect(fiscal).toEqual(fixture.state);
    expect(r.series).toEqual([]);
    expect(allocation.series).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "RF-P000042", purpose: "rectificative" },
    ]);
    await prepareStandbyDatabase(db, spare.db, primaryNode());
    expect(await takenOverSeries(spare.db, standby.nodeId, fixture, fiscal)).toEqual([
      { code: "FA-P000042", purpose: "standard" },
      { code: "FF-P000042", purpose: "full" },
      { code: "RF-P000042", purpose: "rectificative" },
    ]);
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
      const { bundle } = await allocatedBundle({
        nodeId: crypto.randomUUID(),
        publicKey: STANDBY_PUB,
      });
      expect(bundle.moduleOverrides).toEqual({ [toggleable]: false });
    } finally {
      await rm(join(stateDir, "modules.json"), { force: true });
    }
  });

  it("carries {} when the primary has no modules.json", async () => {
    const { bundle } = await allocatedBundle({
      nodeId: crypto.randomUUID(),
      publicKey: STANDBY_PUB,
    });
    expect(bundle.moduleOverrides).toEqual({});
  });

  it("carries a WireGuard public key when one is provided, and omits it otherwise (swap S2)", async () => {
    const { bundle: withKey } = await allocatedBundle(
      { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB },
      { wireguardPublicKey: "PUBKEY==" },
    );
    expect(withKey.wireguardPublicKey).toBe("PUBKEY==");

    const { bundle: withoutKey } = await allocatedBundle({
      nodeId: crypto.randomUUID(),
      publicKey: STANDBY_PUB,
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
      const standby = { nodeId: crypto.randomUUID(), publicKey: STANDBY_PUB };
      const { bundle, fixture } = await allocatedBundle(standby);
      const r = bundle.reservedIdentity;
      expect(r.modules["test-standby-without-series"]).toEqual({ marker: "reserved" });
      const fiscal = r.modules["fiscal-verifactu"] as typeof fixture.state;
      expect(fiscal).toEqual(fixture.state);
      expect(r.series).toEqual([]);
      expect(fiscal.evidence.block.payload.allocations[0]!.series).toEqual([
        { code: "FA-P000042", purpose: "standard" },
        { code: "FF-P000042", purpose: "full" },
        { code: "RF-P000042", purpose: "rectificative" },
      ]);
      await prepareStandbyDatabase(db, spare.db, primaryNode());
      expect(await takenOverSeries(spare.db, standby.nodeId, fixture, fiscal)).toEqual([
        { code: "FA-P000042", purpose: "standard" },
        { code: "FF-P000042", purpose: "full" },
        { code: "RF-P000042", purpose: "rectificative" },
      ]);
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

function primaryNode() {
  return { nodeId: nodeId(designated.nodeId), locationId: locationId(designated.locationId) };
}
async function allocatedBundle(
  standby: { nodeId: string; publicKey: string },
  extra: Partial<Parameters<typeof assembleMirrorBundle>[0]> = {},
) {
  const fixture = await standbyContract(db, primaryNode(), standby.nodeId, [
    { code: "FA", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "RF", purpose: "rectificative" },
  ]);
  const original = [...ALL_MODULES];
  (ALL_MODULES as WaitronModule[]).splice(
    0,
    ALL_MODULES.length,
    ...allocatedStandbyModules(ALL_MODULES, fixture),
  );
  try {
    const bundle = await fixture.authorised("reserve", (operation) =>
      assembleMirrorBundle({
        ...baseDeps(),
        designated,
        standby,
        ...extra,
        moduleOperations: new Map([["fiscal-verifactu", operation]]),
      }),
    );
    return { bundle, fixture };
  } finally {
    (ALL_MODULES as WaitronModule[]).splice(0, ALL_MODULES.length, ...original);
  }
}
