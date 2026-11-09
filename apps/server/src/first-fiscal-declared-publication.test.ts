import { vi } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readRecoveryKeyVerifier } from "@waitron/node-db";
import { verifySecretAsync } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { parseModuleConfig } from "@waitron/module";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { fiscalAllocations } from "@waitron/fiscal-verifactu/src/schema/allocations.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { ALL_MODULES } from "@waitron/composition";
import { provisionVenue, recoverProvisionedVenue, venueModuleConfig } from "./provision.js";
import { establishNodeIdentity } from "./node-identity.js";
import { seedTermZeroMembership } from "./membership-seed.js";
import { activateFirstFiscal } from "./first-fiscal-activation.js";
import type { SetupDeps } from "./setup-api.js";
import { createFakeTimersHourClock } from "./testing/hour-test-clock.js";
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const fixtures: Awaited<ReturnType<typeof hourFirstFiscalFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture(certificate?: { pfxBase64: string; passphrase: string; certKind: string }) {
  const modules = ALL_MODULES.filter((module) =>
    ["core", "fiscal-verifactu", "fiscal-none"].includes(module.name),
  ).map((m) =>
    m.name !== "fiscal-verifactu" || certificate !== undefined
      ? m
      : {
          ...m,
          fiscal: {
            ...m.fiscal!,
            provisioningSecret: { required: () => false, validate: () => {}, seal: async () => {} },
          },
        },
  );
  const f = await hourFirstFiscalFixture({
    clock: createFakeTimersHourClock(),
    database: () => suite.db,
    modules,
  });
  fixtures.push(f);
  const { host, staged } = f;
  const ring = loadKeyRing({ WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64") });
  let activations = 0,
    publications = 0;
  const deps: SetupDeps = {
    environment: "production",
    db: suite.db,
    node: suite.node,
    ring,
    firstFiscal: host,
    provision: async (req, beforeTransaction) => {
      activations++;
      return provisionVenue(
        {
          ownerDb: suite.db,
          stateDir: f.stateDir,
          database: "synthetic",
          moduleConfig: venueModuleConfig(
            parseModuleConfig({}, f.modules),
            req.venue.fiscalTerritory,
          ),
          beforeTransaction,
        },
        req,
        host.modules,
      );
    },
    recoverProvision: (req) => recoverProvisionedVenue(suite.db, req, host.modules),
    assertFiscalReady: async () => {},
    establishIdentity: (nodeId) =>
      establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring }, nodeId),
    seedMembership: (nodeId) =>
      seedTermZeroMembership(
        { db: suite.db, node: suite.node, ring },
        nodeId,
        "https://test.example",
      ),
    persistTrading: async () => {
      const verifier = await readRecoveryKeyVerifier(suite.node, staged.key.nodeId);
      expect(verifier).not.toBeNull();
      expect(await verifySecretAsync(staged.key.secret, verifier!)).toBe(true);
      publications++;
    },
  };
  const body = {
    mode: "live",
    ...(certificate === undefined ? {} : { aeatCert: certificate }),
    email: {
      server: "smtp.example.test",
      port: 465,
      encryption: "tls",
      user: "",
      password: "",
      from: "venue@example.test",
    },
  };
  const activate = (owner = f.ownerAttempt) =>
    host.coordinator.run((hold) => activateFirstFiscal(host, deps, owner, body, hold));
  return {
    ...f,
    host,
    staged,
    activate,
    counts: () => ({ activations, publications }),
  };
}
it("installs the staged named verifier after exact fiscal commit and before trading", async () => {
  const f = await fixture();
  const result = await f.activate();
  expect(result.nodeId).toBe(f.staged.key.nodeId);
  expect(f.counts()).toEqual({ activations: 1, publications: 1 });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("browser setup records a readable certificate against its committed node", async () => {
  const { makeAuthority } = await import("@waitron/fiscal-verifactu/test/certificate-fixtures.js");
  const { fiscalCertificateInstalls } =
    await import("@waitron/fiscal-verifactu/src/schema/index.js");
  const candidate = makeAuthority().issue();
  const f = await fixture({
    pfxBase64: candidate.pfx.toString("base64"),
    passphrase: candidate.passphrase,
    certKind: "sello",
  });
  const result = await f.activate();
  const rows = await suite.db.select().from(fiscalCertificateInstalls);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    nodeId: result.nodeId,
    fingerprint: candidate.fingerprint,
    source: "setup",
    personId: null,
    kind: "sello",
  });
});
