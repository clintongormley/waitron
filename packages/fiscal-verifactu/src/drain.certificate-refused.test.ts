import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { loadKeyRing, rotateCredentials, type KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import { createClient } from "@waitron/verifactu";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { makeAuthority, type Candidate } from "../test/certificate-fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { appendPendingAlta, seedPendingEnvios } from "../test/drain-fixtures.js";
import { aeatClientResolver } from "./aeat-transport.js";
import { certificateAlerts } from "./certificate-alerts.js";
import { readCertificateCard } from "./certificate-card.js";
import { drain, DEFAULT_SKIP_RETRY_MS } from "./drain.js";
import { sealAeatSecret } from "./provisioning-secret.js";
import "./errors.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS, timeoutMs: 120_000 });
const at = (minute: number) => new Date(Date.UTC(2026, 6, 21, 0, minute));

type Answer = "refused" | "network" | "accepted";

function transport() {
  const authority = createFakeAeat({ serverNow: at(0) });
  const state: { answer: Answer; fingerprint: string | null | undefined; reads: number } = {
    answer: "refused",
    fingerprint: "AA:01",
    reads: 0,
  };
  const client = createClient({
    endpoint: "https://example.test/soap",
    fetch: async (input, init) => {
      if (state.answer === "refused") {
        throw new AppError("fiscal.certificate_not_accepted", { page: "erro4011.html" });
      }
      if (state.answer === "network") throw new Error("network down");
      return authority.fetch(input, init);
    },
  });
  const deps = {
    db: suite.db,
    environment: "production" as const,
    skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    resolveClient: async () => {
      const fingerprint = state.fingerprint;
      return fingerprint === undefined
        ? client
        : {
            ...client,
            certificateFingerprint: () => {
              state.reads += 1;
              return fingerprint;
            },
          };
    },
  };
  return { state, deps };
}

async function mark() {
  const { rows } = await suite.db.execute<{
    certificate_refused_fingerprint: string | null;
    certificate_refused_at: string | null;
  }>(sql`
    select certificate_refused_fingerprint, certificate_refused_at from verifactu_sending_state
  `);
  return rows;
}

it("stores the refused certificate's fingerprint with the pass's time, keeping the first time for the same certificate", async () => {
  const seeded = await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();

  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: "AA:01", certificate_refused_at: at(1).toISOString() },
  ]);

  await appendPendingAlta(suite.db, seeded, 2);
  await drain(t.deps, at(30));
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: "AA:01", certificate_refused_at: at(1).toISOString() },
  ]);

  t.state.fingerprint = "BB:02";
  await drain(t.deps, at(59));
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: "BB:02", certificate_refused_at: at(59).toISOString() },
  ]);
});

it("clears the mark when AEAT answers", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  await drain(t.deps, at(1));
  expect((await mark())[0]?.certificate_refused_fingerprint).toBe("AA:01");

  t.state.answer = "accepted";
  const accepted = await drain(t.deps, at(30));
  expect(accepted.recordsAccepted).toBe(1);
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: null, certificate_refused_at: null },
  ]);
});

it("stores no mark, and opens no certificate, for a failure that does not carry the refusal", async () => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  t.state.answer = "network";
  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: null, certificate_refused_at: null },
  ]);
  expect(t.state.reads).toBe(0);
});

it.each([
  ["names no certificate", undefined],
  ["cannot open its certificate", null],
])("stores no mark when the client %s", async (_name, fingerprint) => {
  await seedPendingEnvios(suite.db, { count: 1 });
  const t = transport();
  t.state.fingerprint = fingerprint;
  await drain(t.deps, at(1));
  expect(await mark()).toEqual([
    { certificate_refused_fingerprint: null, certificate_refused_at: null },
  ]);
});

describe("the mark as the card and the alerts read it", () => {
  const authority = makeAuthority();
  const refusedCertificate = authority.issue({ notAfter: new Date("2028-01-01T00:00:00Z") });
  const K1 = Buffer.alloc(32, 1).toString("base64");
  const RING_V1 = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: K1,
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  const RING_BOTH = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 2).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "2",
    WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
    WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
  });

  function refusingDeps(ring: KeyRing) {
    const resolver = aeatClientResolver({
      db: suite.db,
      ring,
      endpointFor: () => "https://example.test/soap",
      fetchFor: () => ({
        fetch: async () => {
          throw new AppError("fiscal.certificate_not_accepted", { page: "erro4011.html" });
        },
        close: async () => {},
      }),
    });
    return {
      db: suite.db,
      environment: "production" as const,
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      resolveClient: resolver.resolve,
    };
  }

  async function install(nodeId: string, ring: KeyRing, file: Candidate, installedAt: Date) {
    await sealAeatSecret(
      { db: suite.db, ring, nodeId, now: () => installedAt },
      { pfxBase64: file.pfx.toString("base64"), passphrase: file.passphrase, certKind: "sello" },
    );
  }

  async function shown(nodeId: string, now: Date) {
    const card = await readCertificateCard(
      { db: suite.db, nodeId, authorize: async () => {}, nameOf: async () => null },
      now,
    );
    const alerts = await withTransaction(suite.db, (tx) => certificateAlerts(tx, { nodeId }, now));
    return {
      notAcceptedAt: card.installed?.notAcceptedAt,
      alert: alerts.find((alert) => alert.code === "fiscal.certificate_not_accepted")?.since,
    };
  }

  it("keeps the first refusal on the card and in the alerts after the vault key is rotated", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await install(seeded.nodeId, RING_V1, refusedCertificate, at(0));
    await drain(refusingDeps(RING_V1), at(1));
    expect(await shown(seeded.nodeId, at(2))).toEqual({
      notAcceptedAt: at(1).toISOString(),
      alert: at(1).toISOString(),
    });

    await rotateCredentials(suite.db, RING_BOTH, suite.node);
    expect(await shown(seeded.nodeId, at(3))).toEqual({
      notAcceptedAt: at(1).toISOString(),
      alert: at(1).toISOString(),
    });

    await appendPendingAlta(suite.db, seeded, 2);
    await drain(refusingDeps(RING_BOTH), at(59));
    expect(await shown(seeded.nodeId, at(59))).toEqual({
      notAcceptedAt: at(1).toISOString(),
      alert: at(1).toISOString(),
    });
  });

  it("hides the refusal once another certificate is installed", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    await install(seeded.nodeId, RING_V1, refusedCertificate, at(0));
    await drain(refusingDeps(RING_V1), at(1));
    expect((await shown(seeded.nodeId, at(2))).notAcceptedAt).toBe(at(1).toISOString());

    const replacement = authority.issue({ notAfter: new Date("2028-01-01T00:00:00Z") });
    await install(seeded.nodeId, RING_V1, replacement, at(3));
    expect(await shown(seeded.nodeId, at(4))).toEqual({
      notAcceptedAt: undefined,
      alert: undefined,
    });
  });
});
