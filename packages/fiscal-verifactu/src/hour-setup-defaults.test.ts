import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { withTransaction, deployment } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withOperationAuthority, type ModuleOperationHost } from "@waitron/module";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenants, TENANT_A } from "../test/fixtures.js";
import { createHostedHourPreparation } from "./hour-preparation.js";
import { activatePreparedModuleAllocation } from "./allocation-preparation.js";
import { fiscalAllocations } from "./schema/allocations.js";

const outside = vi.hoisted(() => ({ internet: vi.fn(), release: vi.fn() }));
vi.mock("./hour-clock-time-service.js", () => ({ observeTimeServiceHourClock: outside.internet }));
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
  { code: "R", purpose: "corrective" },
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
function fixture(extra: Partial<ModuleOperationHost> = {}) {
  let value: unknown = null;
  const history: unknown[] = [];
  let key = "owned-frozen-context";
  let environment: "preproduction" | "production" = "preproduction";
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
        environment,
        recipientVenueId: binding.sourceId,
        bases,
      },
    }),
    ...extra,
  };
  let preparation = createHostedHourPreparation(host);
  return {
    get preparation() {
      return preparation;
    },
    /** A new server process over the same retained state. */
    restart() {
      preparation = createHostedHourPreparation(host);
    },
    history,
    context(next: string) {
      key = next;
    },
    setupEnvironment(next: typeof environment) {
      environment = next;
    },
    select: (comparisonId: string, confirmed?: true) =>
      withOperationAuthority(binding, "administrator", (authority) =>
        preparation.select({
          binding,
          authority,
          comparisonId,
          ...(confirmed === undefined ? {} : { confirmed }),
        }),
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
        activatePreparedModuleAllocation(tx, { nodeId: TENANT_A.nodeId }, operation),
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
it.each([
  [true, true],
  [false, false],
  [undefined, false],
] as const)(
  "a host's time service answering %s gives the comparison an internet clock: %s",
  async (answer, usable) => {
    const actual = await vi.importActual<typeof import("./hour-clock-time-service.js")>(
      "./hour-clock-time-service.js",
    );
    outside.internet.mockImplementation(actual.observeTimeServiceHourClock);
    const f = fixture(answer === undefined ? {} : { timeServiceSynchronised: async () => answer });
    const compared = await f.preparation.compareClocks(binding, null, { onBox: true });
    expect(compared.clock.usable.some((row) => row.source === "internet")).toBe(usable);
    expect(compared.clock.secondClock).toBe(usable);
  },
);

async function selectAfterSettle(
  f: ReturnType<typeof fixture>,
  compare: () => Promise<{ id: string }>,
  confirmed?: true,
) {
  expect(await f.select((await compare()).id, confirmed)).toMatchObject({ status: "waiting" });
  vi.advanceTimersByTime(120_000);
  const selected = await f.select((await compare()).id, confirmed);
  if (selected.status !== "selected") throw new Error("expected selected hour");
  return selected;
}
async function deviceCompare(f: ReturnType<typeof fixture>) {
  const challenge = await f.preparation.clockChallenge(binding);
  return f.preparation.compareClocks(
    binding,
    { challengeId: challenge.id, instantMs: Date.now() },
    { onBox: false },
  );
}
function timeServiceUnavailable() {
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
}
function activate(f: ReturnType<typeof fixture>, input: unknown) {
  return withOperationAuthority(binding, "administrator", (authority) =>
    f.preparation.prepare({ binding, authority, input }, (operation) =>
      withTransaction(suite.db, (tx) =>
        activatePreparedModuleAllocation(tx, { nodeId: TENANT_A.nodeId }, operation),
      ),
    ),
  );
}
async function expectRefusedUnwritten(activation: Promise<unknown>) {
  await expect(activation).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(0);
}
it("a synchronised time service lets activation run however long after the series step", async () => {
  const f = fixture();
  const selected = await selectAfterSettle(f, () =>
    f.preparation.compareClocks(binding, null, { onBox: true }),
  );
  vi.advanceTimersByTime(31_000);
  await activate(f, selected.input);
  expect(await suite.db.select().from(fiscalAllocations)).toEqual([
    expect.objectContaining({ allocationKey: "hour/owned-hour" }),
  ]);
});
it.each([
  [31_000, "refuses with no second clock", false],
  [10_000, "still uses the confirmed device reading", true],
] as const)(
  "without a time service, activation %i ms after a confirmed device reading %s",
  async (waitMs, _label, writes) => {
    timeServiceUnavailable();
    const f = fixture();
    const selected = await selectAfterSettle(f, () => deviceCompare(f), true);
    vi.advanceTimersByTime(waitMs);
    if (writes) await activate(f, selected.input);
    else await expectRefusedUnwritten(activate(f, selected.input));
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(writes ? 1 : 0);
  },
);
const sameBoot = (boot: { id: string | null } = { id: "boot-1" }) => ({
  readBoot: () => ({ id: boot.id, ms: performance.now() + 5_000_000 }),
});
it.each([
  ["the box ran on unchanged", "boot-1", () => {}, true],
  ["not after its clock was stepped", "boot-1", () => vi.setSystemTime(Date.now() + 5_000), false],
  ["not after a restart", "boot-1", (boot: { id: string | null }) => (boot.id = "boot-2"), false],
  ["not when the boot id cannot be read", null, () => {}, false],
] as const)(
  "without a time service, a confirmed device time counts two minutes later while %s",
  async (_label, bootId, change: (boot: { id: string | null }) => unknown, writes) => {
    timeServiceUnavailable();
    const boot: { id: string | null } = { id: bootId };
    const f = fixture(sameBoot(boot));
    const selected = await selectAfterSettle(f, () => deviceCompare(f), true);
    vi.advanceTimersByTime(120_000);
    change(boot);
    if (writes) await activate(f, selected.input);
    else await expectRefusedUnwritten(activate(f, selected.input));
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(writes ? 1 : 0);
  },
);
it("a name the time service alone admitted is not carried to a later Provision without it", async () => {
  const f = fixture(sameBoot());
  const selected = await selectAfterSettle(f, () =>
    f.preparation.compareClocks(binding, null, { onBox: true }),
  );
  timeServiceUnavailable();
  vi.advanceTimersByTime(120_000);
  await expectRefusedUnwritten(activate(f, selected.input));
});
it("a clock step while Provision waits for the time service ends the carried time", async () => {
  timeServiceUnavailable();
  const f = fixture(sameBoot());
  const selected = await selectAfterSettle(f, () => deviceCompare(f), true);
  vi.advanceTimersByTime(120_000);
  outside.internet.mockImplementationOnce(async () => {
    vi.setSystemTime(Date.now() + 5_000);
    return { source: "internet", result: "unavailable", reason: "tls" };
  });
  await expectRefusedUnwritten(activate(f, selected.input));
});
it("a fresh confirmed choice after a clock step renews the time Provision carries", async () => {
  timeServiceUnavailable();
  const f = fixture(sameBoot());
  const selected = await selectAfterSettle(f, () => deviceCompare(f), true);
  vi.setSystemTime(Date.now() + 5_000);
  expect(await f.select((await deviceCompare(f)).id, true)).toMatchObject({
    status: "selected",
    identity: selected.identity,
  });
  vi.advanceTimersByTime(120_000);
  await activate(f, selected.input);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});
it("a confirmed choice after the time service goes renews a time it alone admitted", async () => {
  const f = fixture(sameBoot());
  const selected = await selectAfterSettle(f, () =>
    f.preparation.compareClocks(binding, null, { onBox: true }),
  );
  timeServiceUnavailable();
  expect(await f.select((await deviceCompare(f)).id, true)).toMatchObject({
    status: "selected",
    identity: selected.identity,
  });
  vi.advanceTimersByTime(120_000);
  await activate(f, selected.input);
  expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
});

it("in development the box's clock alone, confirmed, passes the first setup's clock check", async () => {
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const f = fixture({ environment: { WAITRON_ENV: "dev" } });
  const comparison = await f.preparation.compareClocks(binding, null, { onBox: true });
  expect(comparison.clock.secondClock).toBe(true);
  expect(comparison.clock.usable.map((row) => row.source)).toEqual(["box"]);
  const waiting = await f.select(comparison.id, true);
  expect(waiting).toMatchObject({ status: "waiting", targetMs: NOW });
});

it("in development the box's clock alone still needs the person to confirm the time", async () => {
  outside.internet.mockResolvedValue({ source: "internet", result: "unavailable", reason: "tls" });
  const f = fixture({ environment: { WAITRON_ENV: "dev" } });
  const comparison = await f.preparation.compareClocks(binding, null, { onBox: true });
  await expect(f.select(comparison.id)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "confirmation_required" },
  });
});

it.each(["preproduction", "production", "", undefined])(
  "with WAITRON_ENV %s the box's clock alone is refused second_clock_missing",
  async (env) => {
    outside.internet.mockResolvedValue({
      source: "internet",
      result: "unavailable",
      reason: "tls",
    });
    const f = fixture({ environment: env === undefined ? {} : { WAITRON_ENV: env } });
    const comparison = await f.preparation.compareClocks(binding, null, { onBox: true });
    expect(comparison.clock.secondClock).toBe(false);
    await expect(f.select(comparison.id, true)).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "second_clock_missing" },
    });
  },
);

const dev = { environment: { WAITRON_ENV: "dev" } };
const boxCompare = (f: ReturnType<typeof fixture>) =>
  f.preparation.compareClocks(binding, null, { onBox: true });
// The server's boot reader on macOS, which has no /proc: no boot id.
const noBootId = { readBoot: () => ({ id: null, ms: performance.now() + 5_000_000 }) };
it("without a time service, a clock step after the confirmed choice refuses Provision in preproduction", async () => {
  timeServiceUnavailable();
  const f = fixture(sameBoot());
  const selected = await selectAfterSettle(f, () => deviceCompare(f), true);
  vi.advanceTimersByTime(120_000);
  vi.setSystemTime(Date.now() + 5_000);
  await expectRefusedUnwritten(activate(f, selected.input));
});
it.each([
  ["with no change", () => {}],
  ["after a server restart", (f: ReturnType<typeof fixture>) => f.restart()],
  ["after a clock step", () => vi.setSystemTime(Date.now() + 5_000)],
] as const)(
  "in development with no boot id, Provision two minutes after the box's clock alone was confirmed takes the box's clock, %s",
  async (_label, change) => {
    timeServiceUnavailable();
    const f = fixture({ ...dev, ...noBootId });
    const selected = await selectAfterSettle(f, () => boxCompare(f), true);
    vi.advanceTimersByTime(120_000);
    change(f);
    await activate(f, selected.input);
    expect(await suite.db.select().from(fiscalAllocations)).toHaveLength(1);
  },
);
it("in development, a setup frozen for production takes no clock alone as the second clock", async () => {
  timeServiceUnavailable();
  const f = fixture(dev);
  f.setupEnvironment("production");
  const comparison = await boxCompare(f);
  expect(comparison.clock.secondClock).toBe(false);
  await expect(f.select(comparison.id, true)).rejects.toMatchObject({
    code: "sif.allocation_invalid",
    params: { reason: "second_clock_missing" },
  });
});
