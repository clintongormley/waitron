import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import { dayPeriod } from "./derive.js";
import { claimGap, claimRow, completeRun, enqueueSuccessor, readSnapshot } from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

const DUTY = "test.duty";
const NOW = new Date("2026-07-25T04:00:00Z");

const suite = useTemplateDb({ template: "core_scheduler" });

/**
 * The two racing writers, plus a third connection used only to observe them — never to write.
 *
 * These are this suite's own, not `useTemplateDb`'s single `admin`: the races below need each
 * side on its own backend process, which is what `RealPostgres.connect()` promises per call (see
 * its doc comment). `suite.admin` seeds the tenant and takes no part in any race.
 */
let a: Database;
let b: Database;
let probe: Database;
let tenantId: TenantId;

beforeAll(async () => {
  a = await suite.pg.connect();
  b = await suite.pg.connect();
  probe = await suite.pg.connect();
  tenantId = await seedTenant(suite.admin);
});

// Guarded so a beforeAll failure cannot mask itself: each teardown runs only if its resource was
// actually created. The clone database and `suite.admin` are torn down by `useTemplateDb` itself.
afterAll(async () => {
  if (a !== undefined) await a.close();
  if (b !== undefined) await b.close();
  if (probe !== undefined) await probe.close();
});

/**
 * A pair of promises: one that resolves when `signal()` is called, and the signal itself. Used to
 * hold a transaction open at an exact point rather than for an exact duration — a `setTimeout`
 * barrier is the same unsynchronised race in slower clothing.
 */
function gate(): { passed: Promise<void>; open: () => void } {
  let open!: () => void;
  const passed = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { passed, open };
}

/**
 * Blocks until some backend is WAITING on a lock it has not been granted.
 *
 * `pg_locks` rather than `pg_stat_activity`: it is readable by every role and needs no
 * `pg_read_all_stats`, and an ungranted entry is the literal fact we need — that the other
 * connection has issued its INSERT and is queued behind an uncommitted duplicate key.
 */
async function waitForABlockedBackend(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const waiting = await probe.execute<{ n: number }>(
      sql`select count(*)::int as n from pg_locks where not granted`,
    );
    if (Number(waiting.rows[0]!.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no backend ever blocked — the barrier this test depends on did not engage");
}

describe("two runners racing one gap", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-24T00:00:00Z"));
    const [first, second] = await Promise.all([
      withTenant(a, tenantId, (tx) => claimGap(tx, { tenantId, duty: DUTY, period, now: NOW })),
      withTenant(b, tenantId, (tx) => claimGap(tx, { tenantId, duty: DUTY, period, now: NOW })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);
  });
});

describe("two runners racing one failed row", () => {
  it("produces exactly one claim", async () => {
    const period = dayPeriod(new Date("2026-07-23T00:00:00Z"));
    const claimed = await withTenant(a, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(a, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "failed",
        summary: null,
        errorCode: "unknown",
        nextAttemptAt: NOW,
        now: NOW,
      }),
    );
    const later = new Date(NOW.getTime() + 60_000);
    const [first, second] = await Promise.all([
      withTenant(a, tenantId, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
      withTenant(b, tenantId, (tx) => claimRow(tx, { id: claimed!.id, now: later })),
    ]);
    expect([first, second].filter((r) => r !== null)).toHaveLength(1);

    // The loser must not have inflated the attempt count — a conditional UPDATE that matched
    // nothing changes nothing, which is what bounds retries.
    const snapshot = await withTenant(a, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(snapshot.rows.find((r) => r.id === claimed!.id)?.attempts).toBe(2);
  });
});

describe("two runners racing one successor enqueue", () => {
  it("inserts exactly one, and the loser reads the violation as already-enqueued", async () => {
    const period = dayPeriod(new Date("2026-07-22T00:00:00Z"));
    const claimed = await withTenant(a, tenantId, (tx) =>
      claimGap(tx, { tenantId, duty: DUTY, period, now: NOW }),
    );
    await withTenant(a, tenantId, (tx) =>
      completeRun(tx, {
        id: claimed!.id,
        startedAt: claimed!.startedAt,
        state: "succeeded",
        summary: {},
        errorCode: null,
        nextAttemptAt: null,
        now: NOW,
      }),
    );

    // Both must see zero unfinished rows and compute generation 1 BEFORE either commits — that is
    // the only state in which `isUniqueViolation` is ever reached. A bare `Promise.all` leaves
    // that to the scheduler: if B's SELECT lands after A commits, B sees A's `pending` row, the
    // `unfinished > 0` guard returns false first, and the violation branch simply does not run.
    // The assertion below still passes, so the miss is silent — but the branch goes uncovered, and
    // on a loaded runner that is a red build off a coverage floor with no code change behind it.
    //
    // So the overlap is forced rather than hoped for. A runs its whole enqueue and then HOLDS its
    // transaction open: under READ COMMITTED its uncommitted row is invisible to B, so B's SELECT
    // passes the guard exactly as a genuinely simultaneous runner's would, and B's INSERT then
    // queues behind A's duplicate key. A commits only once B is DEMONSTRABLY blocked — observed in
    // pg_locks, never a sleep — at which point B's insert resumes into the violation.
    const dueAt = new Date("2026-07-26T00:00:00Z");
    const held = gate();
    const aHasInserted = gate();

    const first = withTenant(a, tenantId, async (tx) => {
      const inserted = await enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt });
      aHasInserted.open();
      await held.passed;
      return inserted;
    });

    await aHasInserted.passed;
    const second = withTenant(b, tenantId, (tx) =>
      enqueueSuccessor(tx, { tenantId, duty: DUTY, period, dueAt }),
    );
    await waitForABlockedBackend();
    held.open();

    // Deterministic in BOTH directions now, so this asserts which one won rather than a count:
    // A's insert is the one that landed, and B's is the one that read its own violation as
    // "already enqueued" — the same fact, not an error.
    expect(await first).toBe(true);
    expect(await second).toBe(false);

    const rows = await withTenant(a, tenantId, (tx) =>
      readSnapshot(tx, { tenantId, duty: DUTY, horizonStart: new Date("2026-07-01T00:00:00Z") }),
    );
    expect(
      rows.rows.filter((r) => new Date(r.periodFrom).getTime() === period.from.getTime()),
    ).toHaveLength(2);
  });
});
