import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { deployment, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ThrowawayAllocation } from "@waitron/module";
import { locationId } from "@waitron/shared";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { createHourThrowawayAllocation } from "./hour-throwaway-allocation.js";
import { FISCAL_PROVISIONING } from "./provisioning.js";
import { registroSif } from "./schema/sif.js";
import { fiscalAllocations } from "./schema/allocations.js";
const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const node = { nodeId: TENANT_A.nodeId, locationId: locationId(TENANT_A.locationId) };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "a/B_1.2-3", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const operator = "administrator";
const input = () => ({
  environments: ["preproduction"] as const,
  taxpayerNif: "89890001K",
  bases: structuredClone(bases),
  nodeId: node.nodeId,
  administratorId: operator,
});
const at = () => new Date("2026-10-16T11:40:00.000Z");
const fresh = () => createHourThrowawayAllocation({ now: at }).prepare(input());
async function activate(
  prepared: ReturnType<ThrowawayAllocation["prepare"]>,
  change: {
    operator?: string;
    eventId?: string;
    input?: unknown;
    action?: string;
    nodeId?: string;
  } = {},
) {
  const binding = {
    module: "fiscal-verifactu",
    action: change.action ?? "setup",
    eventId: change.eventId ?? prepared.eventId,
    sourceId: prepared.sourceId,
    targetNodeId: change.nodeId ?? node.nodeId,
  };
  return withOperationAuthority(binding, change.operator ?? operator, (authority) =>
    prepared.operations.prepare(
      { binding, authority, input: change.input ?? prepared.input },
      (operation) =>
        withTransaction(suite.db, async (tx) => {
          await FISCAL_PROVISIONING.seed!.run(tx, node, operation);
          return FISCAL_PROVISIONING.seed!.series!.resolve(tx, node, bases);
        }),
    ),
  );
}
beforeEach(async () => {
  await seedTenants(suite.db);
  await suite.db.insert(deployment).values({ id: 1, environment: "preproduction" });
});
it("disposable preparation activates every exact hour base through the unchanged writer without paper evidence", async () => {
  const prepared = fresh();
  expect(prepared.input).toMatchObject({
    allocation: { source: "hour", installationIdentity: "06RB", reservationEvidence: null },
  });
  const series = await activate(prepared);
  expect(series.map(({ code, purpose }) => ({ code, purpose }))).toEqual([
    { code: "A-06RB", purpose: "standard" },
    { code: "FF-06RB", purpose: "full" },
    { code: "R-06RB", purpose: "rectificative" },
    { code: "a/B_1.2-3-06RB", purpose: "standard" },
  ]);
  const [sif] = await suite.db.select().from(registroSif);
  expect(sif!.numeroInstalacion).toBe("06RB");
  expect(JSON.stringify(sif)).not.toMatch(/throwaway|custodian|privateKey/);
  const [row] = await suite.db.select().from(fiscalAllocations);
  expect(row!.allocationKey).toMatch(/^throwaway-/);
  expect(row!.allocation).toMatchObject({ environment: "preproduction", source: "hour" });
  expect(JSON.stringify(prepared.input)).not.toMatch(
    /signature|custodian|blockId|privateKey|document/,
  );
});
it("keeps separate disposable operation identities even during the same UTC hour", () => {
  const first = fresh(),
    second = fresh();
  expect(first.eventId).not.toBe(second.eventId);
  const a = first.input as { allocation: { allocationId: string; installationIdentity: string } };
  const b = second.input as typeof a;
  expect(a.allocation.allocationId).not.toBe(b.allocation.allocationId);
  expect(a.allocation.installationIdentity).toBe("06RB");
  expect(b.allocation.installationIdentity).toBe("06RB");
});
it.each([
  [[], "none"],
  [["production"], "production"],
  [["preproduction", "production"], "production"],
  [["production", "preproduction"], "production"],
  [["dev"], "dev"],
  [[""], ""],
  [[null], "null"],
  [[Object.create(null)], "object"],
] as const)("refuses environments %j before reading the clock", (environments, reported) => {
  let clockReads = 0;
  const seat = createHourThrowawayAllocation({
    now: () => {
      clockReads++;
      return at();
    },
  });
  expect(() =>
    seat.prepare({
      ...input(),
      environments: environments as unknown as readonly "preproduction"[],
    }),
  ).toThrowError(
    expect.objectContaining({
      code: "sif.throwaway_allocation_refused",
      params: { environment: reported },
    }),
  );
  expect(clockReads).toBe(0);
});
it("cannot activate disposable input on a production-stamped database", async () => {
  await suite.db.update(deployment).set({ environment: "production" });
  await expect(activate(fresh())).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "environment_mismatch" },
  });
  expect(await suite.db.select().from(registroSif)).toEqual([]);
  expect(await suite.db.select().from(invoiceSeries)).toEqual([]);
});
it.each([
  { operator: "foreign" },
  { eventId: randomUUID() },
  { action: "restore" },
  { nodeId: randomUUID() },
])("cannot borrow disposable preparation for %j", async (change) => {
  await expect(activate(fresh(), change)).rejects.toMatchObject({ code: "sif.allocation_invalid" });
  expect(await suite.db.select().from(registroSif)).toEqual([]);
});
it("cannot replace the internally prepared input even with newly authenticated authority", async () => {
  const prepared = fresh();
  const changed = structuredClone(prepared.input) as { allocation: { allocationId: string } };
  changed.allocation.allocationId = "throwaway-forged";
  await expect(activate(prepared, { input: changed })).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  expect(await suite.db.select().from(registroSif)).toEqual([]);
});
it("detaches caller base values before returning its operation", async () => {
  const supplied = input();
  const prepared = createHourThrowawayAllocation({ now: at }).prepare(supplied);
  supplied.bases[0]!.code = "changed";
  const series = await activate(prepared);
  expect(series.map(({ code }) => code)).toEqual(["A-06RB", "FF-06RB", "R-06RB", "a/B_1.2-3-06RB"]);
});

it.each(["2025-12-31T23:59:59.999Z", "2145-08-15T16:00:00.000Z", "not-a-date"])(
  "refuses an unrepresentable disposable clock at %s before producing activation material",
  (instant) => {
    const seat = createHourThrowawayAllocation({ now: () => new Date(instant) });
    expect(() => seat.prepare(input())).toThrowError(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "clock_unconfirmed" },
      }),
    );
  },
);
it("the default clock records the actual preparation time in its disposable input", () => {
  const before = Date.now();
  const prepared = createHourThrowawayAllocation().prepare(input());
  const after = Date.now();
  const value = prepared.input as {
    allocation: { issuedAt: string; installationIdentity: string };
    approval: { confirmedAt: string };
  };
  expect(Date.parse(value.allocation.issuedAt)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(value.allocation.issuedAt)).toBeLessThanOrEqual(after);
  expect(value.approval.confirmedAt).toBe(value.allocation.issuedAt);
  expect(value.allocation.installationIdentity).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
});
