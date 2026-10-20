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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
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
    select: () =>
      withOperationAuthority(binding, "administrator", (authority) =>
        preparation.select({ binding, authority, answer: "no" }),
      ),
  };
}
it("the default host clock provider reaches the unchanged real activation writer", async () => {
  const f = fixture();
  const challenge = await f.preparation.clockChallenge(binding);
  const comparison = await f.preparation.compareClocks(binding, {
    challengeId: challenge.id,
    instantMs: NOW,
  });
  expect(comparison.clock.usable.map((row) => row.source)).toEqual(["browser", "internet", "box"]);
  const selected = await f.select();
  expect(selected).toMatchObject({ status: "selected", identity: "06RB" });
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
      installationIdentity: "06RB",
      environment: "preproduction",
      allocationKey: "hour/owned-hour",
    }),
  ]);
  expect(f.history).toHaveLength(1);
});
it("the default release provider refuses when the artifact has no embedded floor", async () => {
  const f = fixture();
  outside.release.mockReturnValue(null);
  const displayed = await f.preparation.compareClocks(binding, null);
  await f.preparation.confirmClock(binding, displayed.id);
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_unconfirmed" },
  });
  expect(f.history).toEqual([]);
});
it("a new browser comparison invalidates the old operator confirmation", async () => {
  const f = fixture();
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const displayed = await f.preparation.compareClocks(binding, null);
  await f.preparation.confirmClock(binding, displayed.id);
  const challenge = await f.preparation.clockChallenge(binding);
  await f.preparation.compareClocks(binding, {
    challengeId: challenge.id,
    instantMs: NOW + 300_000,
  });
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_unconfirmed" },
  });
  expect(f.history).toEqual([]);
});
it("evicted frozen scopes cannot reuse their old displayed-clock confirmation", async () => {
  const f = fixture();
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  for (let index = 0; index < 65; index++) {
    f.context(`scope-${index}`);
    const displayed = await f.preparation.compareClocks(binding, null);
    await f.preparation.confirmClock(binding, displayed.id);
  }
  f.context("scope-0");
  await expect(f.select()).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "clock_stale" },
  });
  expect(f.history).toEqual([]);
});
