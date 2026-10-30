import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTransaction, deployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationHost } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { createHostedHourPreparation } from "./hour-preparation.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";

const outside = vi.hoisted(() => ({ internet: vi.fn(), release: vi.fn() }));
vi.mock("./hour-clock-internet.js", () => ({ observeInternetHourClock: outside.internet }));
vi.mock("./hour-release.js", () => ({ readHourRelease: outside.release }));
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = Date.parse("2026-10-16T11:40:00Z");
const binding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "owned-hour",
  sourceId: "first-setup:owned-attempt",
  targetNodeId: TENANT_A.nodeId,
};
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  // Two minutes early: a setup's settle wait then ends at NOW, whose name the cases expect.
  vi.setSystemTime(NOW - 120_000);
  outside.release.mockReturnValue({ instantMs: NOW - 86_400_000 });
  outside.internet.mockImplementation(async () => {
    const mono = performance.now();
    return {
      source: "internet",
      result: "usable",
      instantMs: Date.now(),
      uncertaintyMs: 500,
      wallStartedMs: Date.now(),
      wallFinishedMs: Date.now(),
      monotonicStartedMs: mono,
      monotonicFinishedMs: mono,
    };
  });
});
afterEach(() => {
  vi.useRealTimers();
  outside.internet.mockReset();
  outside.release.mockReset();
});
function fixture() {
  let value: unknown = null;
  const history: unknown[] = [];
  let key = "owned-frozen-context";
  const host: ModuleOperationHost = {
    environment: {},
    readPublicEvidence: async () => undefined,
    withPreparationState: async (_binding, run) =>
      run({
        get value() {
          return structuredClone(value);
        },
        history: structuredClone(history),
        async replace(next) {
          value = structuredClone(next);
          history.push(structuredClone(next));
        },
      }),
    readSetupFacts: async () => ({
      contextKey: key,
      localHistory: { reference: "venue", complete: true, records: [] },
      context: {
        attemptId: "owned-attempt",
        binding,
        administratorId: "administrator",
        country: "ES",
        taxId: "89890001K",
        environment: "preproduction",
        recipientVenueId: binding.sourceId,
        bases,
      },
    }),
  };
  const preparation = createHostedHourPreparation(host);
  return {
    preparation,
    history,
    context(next: string) {
      key = next;
    },
    select: (comparisonId: string) =>
      withOperationAuthority(binding, "administrator", (authority) =>
        preparation.select({ binding, authority, comparisonId }),
      ),
  };
}
it("the default host clock provider reaches the unchanged real activation writer", async () => {
  const f = fixture();
  const compare = async () => {
    const challenge = await f.preparation.clockChallenge(binding);
    return f.preparation.compareClocks(
      binding,
      { challengeId: challenge.id, instantMs: Date.now() },
      { onBox: false },
    );
  };
  const comparison = await compare();
  expect(comparison.clock.usable.map((row) => row.source)).toEqual(["browser", "internet", "box"]);
  const waiting = await f.select(comparison.id);
  expect(waiting).toMatchObject({ status: "waiting", targetMs: NOW, remainingMs: 120_000 });
  vi.advanceTimersByTime(120_000);
  const selected = await f.select((await compare()).id);
  expect(selected).toMatchObject({ status: "selected", identity: "0CNNW" });
  if (selected.status !== "selected") throw new Error("expected selected hour");
  await withOperationAuthority(binding, "administrator", (authority) =>
    f.preparation.prepare({ binding, authority, input: selected.input }, (operation) =>
      withTransaction(suite.db, (tx) =>
        activatePreparedModuleAllocation(
          tx,
          { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) },
          operation,
        ),
      ),
    ),
  );
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([
    expect.objectContaining({
      installationIdentity: "0CNNW",
      environment: "preproduction",
      allocationKey: "hour/owned-hour",
    }),
  ]);
  expect(f.history).toHaveLength(2);
});
it("the default release provider refuses when the artifact has no embedded floor", async () => {
  const f = fixture();
  outside.release.mockReturnValue(null);
  const compared = await f.preparation.compareClocks(binding, null, { onBox: true });
  await expect(f.select(compared.id)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_unconfirmed" },
  });
  expect(f.history).toEqual([]);
});
it("evicted frozen scopes cannot reuse their old clock reading", async () => {
  const f = fixture();
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const ids: string[] = [];
  for (let index = 0; index < 65; index++) {
    f.context(`scope-${index}`);
    ids.push((await f.preparation.compareClocks(binding, null, { onBox: true })).id);
  }
  f.context("scope-0");
  await expect(f.select(ids[0]!)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  expect(f.history).toEqual([]);
});
