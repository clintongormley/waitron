import { randomBytes, randomUUID } from "node:crypto";
import { loadKeyRing } from "@waitron/credentials";
import { expect, it } from "vitest";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedPinnedChain } from "../test/drain-fixtures.js";
import { recordTakeover } from "../test/takeover-fixture.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { createReconciliationSweep, type ReconciliationSweepResult } from "./reconcile-sweep.js";
import { createRuntimeReconciliation, reconciliationScope } from "./reconcile-runtime.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const START = new Date("2027-02-01T12:00:00Z");

it("the runtime sweep's scope covers the box this one took over from", async () => {
  const old = await seedPendingEnvios(suite.db, { count: 1 });
  const { chain: spare } = await seedPinnedChain(suite.db, old, {
    sifId: randomUUID(),
    firstSecuencia: 50,
    rows: [],
  });
  await recordTakeover(suite.db, old.nodeId, spare.nodeId);

  const scope = await reconciliationScope(suite.db, {
    nodeId: spare.nodeId,
    taxpayerId: old.nif,
    environment: "production",
  });

  expect(scope).toEqual({
    nodeId: spare.nodeId,
    historyNodeIds: [spare.nodeId, old.nodeId],
    taxpayerId: old.nif,
    environment: "production",
  });
  const sweep = createReconciliationSweep({
    db: suite.db,
    clock: old.clock,
    retryMs: 300_000,
    scope,
    resolveClient: staticResolver(createFakeAeat({ serverNow: START }).client()),
  });
  expect((await sweep(START)).periods.map(({ year, month }) => `${year}-${month}`)).toEqual([
    "2026-07",
  ]);
});

it("the runtime reconciliation checks a month only the box it took over from filed in", async () => {
  const old = await seedPendingEnvios(suite.db, { count: 1 });
  const { chain: spare } = await seedPinnedChain(suite.db, old, {
    sifId: randomUUID(),
    firstSecuencia: 50,
    rows: [],
  });
  await recordTakeover(suite.db, old.nodeId, spare.nodeId);
  const reconciliation = createRuntimeReconciliation({
    db: suite.db,
    ring: loadKeyRing({ WAITRON_CREDENTIALS_KEY: randomBytes(32).toString("base64") }),
    environment: "production",
    skipRetryMs: 300_000,
    nodeId: spare.nodeId,
    clock: old.clock,
  });

  // No certificate is installed, so the lookup itself fails; the month is still asked about.
  const result = (await reconciliation(START)) as ReconciliationSweepResult;

  expect(
    result.periods.map(({ year, month, outcome, errorCode }) => ({
      period: `${year}-${month}`,
      outcome,
      errorCode,
    })),
  ).toEqual([{ period: "2026-07", outcome: "unknown", errorCode: "credentials.missing" }]);
});
