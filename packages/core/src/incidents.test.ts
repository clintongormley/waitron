import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
// See record-sale.test.ts's identical deviation note: there is no `@waitron/fiscal/testing`
// subpath. `packages/fiscal/src/index.ts`'s own closing comment states the real path.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { CORE_MIGRATIONS, incidents, nowIso, sales, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  findIncident,
  listHandledIncidents,
  listOpenIncidents,
  markIncidentHandled,
  openIncidents,
  recordIncident,
  recordIncidentOnce,
} from "./incidents.js";
import type { RecordIncidentInput } from "./incidents.js";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;

// `timeoutMs` restates the 60s the helper applies by default
// (`packages/db/src/testing/venue-db.ts:12`) and replaces `vitest.config.ts`'s `hookTimeout` — the
// same as record-sale.test.ts, which carries the pointer to the receipt.
const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/**
 * Builds a `TrustedClock` from a `now()` implementation alone, matching record-sale.test.ts's
 * and record-void.test.ts's identical helper: the real `TrustedClock` interface also requires
 * `anchor`/`currentAnchor`, which `recordSale` never calls.
 */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

/** Confident, fixed, +01:00 — the ordinary case. */
const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

/**
 * Degraded, fixed. Reads `tillId` lazily (inside `now()`, invoked only once a test's own
 * `beforeEach` has already set it) rather than capturing it at module-eval time.
 *
 * Carries `warning` itself, exactly as `packages/fiscal`'s real `createTrustedClock` would
 * construct it (`clock.ts`'s own `now()`) — `recordSale` forwards `now.warning` verbatim (see
 * `./record-sale.ts`), so a fixture that omitted it would test a codepath `recordSale` never
 * actually takes with a real clock.
 */
const degradedClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: false,
  confidence: "degraded",
  anchorAgeSeconds: 999,
  warning: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
}));

function input(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
  return {
    tillId,
    nodeId,
    seriesId,
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    total: "14.41",
    lines: [
      {
        lineNo: 1,
        name: "Café solo",
        descriptions: { "es-ES": "Café solo" },
        quantity: "2",
        unitPrice: "5.00",
        vatRate: "21.00",
        lineTotal: "10.00",
      },
      {
        lineNo: 2,
        name: "Agua",
        descriptions: { "es-ES": "Agua" },
        quantity: "1",
        unitPrice: "2.10",
        vatRate: "10.00",
        lineTotal: "2.10",
      },
    ],
    // Immediate settlement with the tip on the tender (design D2): sum(amount) 16.31 = total 14.41 +
    // tip 1.90, the coverage identity settleSale enforces inside recordSale's immediate half.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}

/**
 * A backend whose `checkIntegrity` reports one failed issue on the current test's `nodeId` (the
 * chain is keyed by node after the node-id rekey; the incident it produces stays till-keyed).
 *
 * **Deviation from the brief.** The brief's `failingChain()` set `backend.chainVerification =
 * { ok: false, error: new AppError(...) }` — not a real affordance on `FakeFiscalBackend`, and
 * itself contradicted by this same task's own governing dispatch, which states the real
 * `IntegrityReport` shape is `{ ok, checked, issues }`. The actual test-only control is
 * `breakIntegrity(nodeId, issue)`, taking a plain `IntegrityIssue` (`{ code, params, recordId? }`)
 * — the identical substitution record-sale.test.ts's and record-void.test.ts's own
 * "no fiscal condition blocks a sale"/"no fiscal condition blocks a void" tests already made.
 */
function failingChain(): FakeFiscalBackend {
  const backend = new FakeFiscalBackend(suite.db);
  backend.breakIntegrity(nodeId, {
    code: "predecessor-hash-mismatch",
    params: { sequence: 7, expected: "ABC" },
  });
  return backend;
}

/**
 * Runs the write path exactly as the application will: registers the node with the injected
 * backend, then sells inside one transaction — mirrors record-sale.test.ts's own
 * `run` helper (registration is required; `FakeFiscalBackend` refuses `recordSale` for a node
 * with no prior `registerNode`, exactly like a real backend).
 */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, input(overrides));
  });
}

/**
 * Scoped to the CURRENT test's own till, never the bare table, because several cases below seed a
 * SECOND till inside one test (`seedTillForIncidents`, just under this) and then assert on that
 * one's rows alone — a bare `select` over `incidents` could not tell the two tills apart. It is
 * not about leakage between tests: `useVenueDb` empties every data table after each one
 * (`resetPerTest`, its default, which this suite does not turn off).
 */
async function incidentsForTill(till: TillId) {
  return suite.db.select().from(incidents).where(eq(incidents.tillId, till));
}

/**
 * The open-dedup suite below needs its own till per test (rather than the module-level
 * `tillId` `beforeEach` already seeds) purely so each test's assertions read against
 * an isolated till — reuses `seedTenant`'s exact seeding path, narrowed to the one id these
 * tests care about.
 */
async function seedTillForIncidents(): Promise<{ tillId: TillId }> {
  const seeded = await seedTenant(suite.db);
  return { tillId: seeded.tillId };
}

describe("incidents — chain verification failure", () => {
  it("records an incident and still completes the sale", async () => {
    const backend = failingChain();
    const { saleId } = await sell(backend);

    const rows = await incidentsForTill(tillId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
    expect(rows[0]?.saleId).toBe(saleId);
    // The sale completed and the record was chained ANYWAY. Both halves matter: a suite
    // asserting only the incident row would pass against an implementation that recorded the
    // incident and then aborted.
    expect(await suite.db.select().from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
  });

  it("carries the module's structured issue detail, not a rendered message", async () => {
    // **Deviation from the brief.** The brief expected `row.params` to equal the injected issue's
    // OWN params flatly (`{ tillId, sequence, expected }`). This task's own dispatch resolves
    // Step 2's ambiguity explicitly: `chain.verification_failed` is the `ErrorCode` recordSale
    // maps a failed check onto when rendering an incident, not something `checkIntegrity` returns —
    // so every chain-verification incident carries this ONE stable, translatable code regardless
    // of which regime-specific issue kinds the module actually reported, with that call's issues
    // (their own code and params) nested underneath in `params.issues` for support to read. The
    // issues are AGGREGATED into one incident — never one row per issue — so they survive the
    // table-wide open-dedup index. See ./errors.ts's doc comment on this code.
    await sell(failingChain());
    const [row] = await incidentsForTill(tillId);
    expect(row?.params).toEqual({
      tillId,
      issues: [
        {
          issueCode: "predecessor-hash-mismatch",
          recordId: null,
          issueParams: { sequence: 7, expected: "ABC" },
        },
      ],
    });
  });

  it("aggregates multiple issues from one failed check into a SINGLE incident", async () => {
    // A doubly-corrupted predecessor: `verifyChain` can return TWO issues for one sale — e.g. a
    // `predecessor-hash-mismatch` AND a `predecessor-link-mismatch`, because the hash-mismatch push
    // does not early-return (packages/fiscal-verifactu/src/verify.ts). Modelled here by a fake whose
    // `checkIntegrity` reports two issues for this till (`breakIntegrity` appends). The table-wide
    // `incidents_open_dedup` index holds at most ONE open incident per (till, code, sale),
    // so emitting one incident row per issue — all sharing this sale + `chain.verification_failed`
    // — would silently drop the second under `ON CONFLICT DO NOTHING`. record-sale AGGREGATES all
    // issues into ONE incident whose `params.issues` carries BOTH: this is the proof the
    // aggregation preserves detail under the index.
    const backend = new FakeFiscalBackend(suite.db);
    backend.breakIntegrity(nodeId, {
      code: "predecessor-hash-mismatch",
      recordId: "rec-1",
      params: { expected: "ABC", found: "XYZ" },
    });
    backend.breakIntegrity(nodeId, {
      code: "predecessor-link-mismatch",
      recordId: "rec-1",
      params: { expected: "DEF", found: "GHI" },
    });
    const { saleId } = await sell(backend);

    const rows = await incidentsForTill(tillId);
    // EXACTLY one row — not two — even though two issues were reported for the one sale.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.saleId).toBe(saleId);
    // Both issues are carried, in order, under `params.issues` — no detail lost to the index.
    expect(rows[0]?.params).toEqual({
      tillId,
      issues: [
        {
          issueCode: "predecessor-hash-mismatch",
          recordId: "rec-1",
          issueParams: { expected: "ABC", found: "XYZ" },
        },
        {
          issueCode: "predecessor-link-mismatch",
          recordId: "rec-1",
          issueParams: { expected: "DEF", found: "GHI" },
        },
      ],
    });
  });

  it("writes the incident in the same transaction as the sale", async () => {
    // A separate connection would let an incident exist for a sale that rolled back, or a sale
    // exist for an incident that did. Force the rollback after recordSale returns and confirm
    // neither survives.
    const backend = failingChain();
    await expect(
      withTransaction(suite.db, async (tx) => {
        await backend.registerNode(tx, nodeId);
        await recordSale(tx, backend, input());
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash");

    expect(await incidentsForTill(tillId)).toHaveLength(0);
    expect(await suite.db.select().from(sales).where(eq(sales.tillId, tillId))).toHaveLength(0);
  });
});

describe("incidents — clock degradation", () => {
  it("records a warning, not an error", async () => {
    // Spec §4: clock confidence degraded is WARN ONLY. Recording it at error severity would put
    // it in the same visual channel as a chain failure and train staff to ignore both.
    await sell(new FakeFiscalBackend(suite.db), { clock: degradedClock });
    const [row] = await incidentsForTill(tillId);
    expect(row?.code).toBe("clock.degraded");
    expect(row?.severity).toBe("warning");
    expect(await suite.db.select().from(sales).where(eq(sales.tillId, tillId))).toHaveLength(1);
  });

  it("records both incidents when the chain fails and the clock is degraded", async () => {
    await sell(failingChain(), { clock: degradedClock });
    const rows = await incidentsForTill(tillId);
    expect(rows.map((r) => r.code).sort()).toEqual(["chain.verification_failed", "clock.degraded"]);
  });

  it("records nothing when verification passes and the clock is confident", async () => {
    // The negative case. Without it, an implementation that records an incident unconditionally
    // passes every test above.
    await sell(new FakeFiscalBackend(suite.db));
    expect(await incidentsForTill(tillId)).toHaveLength(0);
  });
});

describe("recordIncident — no sale attached", () => {
  it("records an incident with a null sale_id when the caller supplies no saleId", async () => {
    // `RecordIncidentInput.saleId` is optional: plan 3's drainer raises incidents (a submission
    // failure discovered hours after the sale) with no sale in hand at the call site — see
    // ./incidents.ts's own doc comment on `saleId`. Nothing in Task 18's own write path omits it
    // (`recordSale`/`recordVoid` always have one), so this is the one place that path is
    // exercised at all before plan 3 exists to call it for real.
    await withTransaction(suite.db, async (tx) => {
      await recordIncident(tx, {
        tillId,
        error: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
        severity: "warning",
        detectedAt: BASE,
      });
    });
    const [row] = await incidentsForTill(tillId);
    expect(row?.saleId).toBeNull();
  });
});

describe("openIncidents", () => {
  it("returns unacknowledged incidents for a till, newest first", async () => {
    // Two DISTINCT instants, not one fixed `BASE` shared by both sells: with an identical
    // `detected_at` on both rows, "newest first" is unverifiable rather than merely untested.
    const later: TrustedClock = fixedClock(() => ({
      instant: new Date(BASE.getTime() + 60_000),
      offsetMinutes: 60,
      confident: true,
      confidence: "anchored",
      anchorAgeSeconds: 0,
    }));
    await sell(failingChain());
    await sell(failingChain(), { clock: later });
    const rows = await withTransaction(suite.db, async (tx) => {
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.detectedAt.getTime()).toBeGreaterThan(rows[1]!.detectedAt.getTime());
  });

  it("excludes acknowledged incidents", async () => {
    await sell(failingChain());
    await withTransaction(suite.db, async (tx) => {
      // Acknowledges the fixture rows, so the read below has something to exclude. This used to
      // double as a privilege check — `app_user` held UPDATE on `acknowledged_at` alone, so a
      // column-level GRANT that omitted it would have failed right here. On this engine there are
      // no grants, so it is only a setup write now.
      await tx.update(incidents).set({ acknowledgedAt: new Date().toISOString() });
    });
    const rows = await withTransaction(suite.db, async (tx) => {
      return openIncidents(tx, tillId);
    });
    expect(rows).toHaveLength(0);
  });

  it("scopes incidents to one till", async () => {
    const other = await seedTenant(suite.db);
    await sell(failingChain());
    const rows = await withTransaction(suite.db, async (tx) => {
      return openIncidents(tx, other.tillId);
    });
    expect(rows).toHaveLength(0);
  });

  // DELETED with the storage switch: "refuses to rewrite an incident's code as the application
  // role". Its subject was a column-level GRANT — `app_user` held UPDATE on `acknowledged_at` and
  // `acknowledged_by` alone, and PostgreSQL refused any other column with
  // `permission denied for table incidents`. SQLite has no roles and no grants, so there is nothing
  // left to refuse it and the case passed only by asserting that a write it expected to fail did.
  //
  // It is NOT replaced. `scripts/write-path-tables.test.ts` (task P9) is the replacement for what
  // grants enforced, and it covers whole TABLES the application may not write, not one column of
  // one table — `CLAUDE.md` §3 says so of that guard in its own words, and `docs/backlog.md` → B9
  // is where the per-operation half is tracked. So "an incident is a record, not a note anyone may
  // rewrite" now rests on nobody writing the UPDATE, which is exactly what this case existed to
  // stop resting on.
});

describe("recordIncidentOnce", () => {
  // **Deviation from the brief.** The brief's sketch raised `fiscal.reconcile_no_trace` /
  // `fiscal.reconcile_drift_anulada` — codes that `packages/fiscal-verifactu/src/errors.ts` adds
  // to the shared `ErrorParams` registry by declaration merging. `packages/core` does not (and
  // must not) depend on `@waitron/fiscal-verifactu` — see record-sale.test.ts's own beforeAll
  // comment on the eslint boundary zone that forbids it even from a test file — so those codes
  // are not members of `ErrorCode` in this package's own typecheck program and using them here
  // would not compile. Using `chain.verification_failed` (registered in `./errors.ts`, this
  // package's own contribution) and `clock.degraded` (registered by `@waitron/fiscal`, already
  // reachable here — see the `warning` fixture above) instead: two real, distinct, in-boundary
  // codes are all `recordIncidentOnce`'s dedup key cares about, and every other test in this file
  // already builds incidents from exactly these two.
  //
  // The brief also seeded `saleId`/`otherSaleId` fixtures that do not exist in this file. Every
  // real write path (`recordSale`/`recordVoid`) always has a `saleId`, so the null-`saleId` case
  // is only exercised by `recordIncident` (see "no sale attached" above) and — for
  // `recordIncidentOnce` — by the dedup/ack/different-code tests below, which pass
  // `saleId: undefined` precisely because they don't need a real `sales` row (no FK to satisfy)
  // to prove the key. The "different sale" case gets its own test with two REAL sales via `sell`,
  // since `incidents.sale_id` has an FK to `sales.id`.

  function chainFailed(): RecordIncidentInput["error"] {
    return new AppError("chain.verification_failed", {
      tillId,
      issues: [
        {
          issueCode: "predecessor-hash-mismatch",
          recordId: null,
          issueParams: { sequence: 7, expected: "ABC" },
        },
      ],
    });
  }

  it("inserts the first time and returns true", async () => {
    await withTransaction(suite.db, async (tx) => {
      const inserted = await recordIncidentOnce(tx, {
        tillId,
        saleId: undefined,
        error: chainFailed(),
        severity: "error",
        detectedAt: BASE,
      });
      expect(inserted).toBe(true);
      expect(await openIncidents(tx, tillId)).toHaveLength(1);
    });
  });

  it("de-dups a second raise for the same open (till, code, sale) and returns false", async () => {
    await withTransaction(suite.db, async (tx) => {
      const input: RecordIncidentInput = {
        tillId,
        saleId: undefined,
        error: chainFailed(),
        severity: "error",
        detectedAt: BASE,
      };
      const first = await recordIncidentOnce(tx, input);
      expect(first).toBe(true);
      const second = await recordIncidentOnce(tx, {
        ...input,
        detectedAt: new Date(BASE.getTime() + 3_600_000),
      });
      expect(second).toBe(false);
      expect(await openIncidents(tx, tillId)).toHaveLength(1);
    });
  });

  it("raises a fresh one after the prior incident is acknowledged", async () => {
    await withTransaction(suite.db, async (tx) => {
      const input: RecordIncidentInput = {
        tillId,
        saleId: undefined,
        error: chainFailed(),
        severity: "error",
        detectedAt: BASE,
      };
      await recordIncidentOnce(tx, input);
      // The acknowledgement stamp is written by the CALLER on this engine — `acknowledged_at` is
      // an ISO string in a text column and SQLite has no `now()`. Only "not null" matters here.
      await tx.execute(
        sql`update incidents set acknowledged_at = ${nowIso()} where till_id = ${tillId}`,
      );
      const again = await recordIncidentOnce(tx, {
        ...input,
        detectedAt: new Date(BASE.getTime() + 2 * 3_600_000),
      });
      expect(again).toBe(true);
      // The acknowledged row stays acknowledged; only the fresh raise is open.
      expect(await openIncidents(tx, tillId)).toHaveLength(1);
    });
  });

  it("does not de-dup a different code for the same till", async () => {
    await withTransaction(suite.db, async (tx) => {
      const base = {
        tillId,
        saleId: undefined,
        severity: "error" as const,
        detectedAt: BASE,
      };
      const first = await recordIncidentOnce(tx, { ...base, error: chainFailed() });
      expect(first).toBe(true);
      const otherCode = await recordIncidentOnce(tx, {
        ...base,
        error: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
      });
      expect(otherCode).toBe(true);
      expect(await openIncidents(tx, tillId)).toHaveLength(2);
    });
  });

  it("does not de-dup the same code for a different sale", async () => {
    // Two REAL sales (the FK on incidents.sale_id requires it), each raising the same
    // `clock.degraded` code — proving `sale_id is not distinct from` scopes the key per sale
    // rather than deduping across the whole till.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId: saleA } = await sell(backend);
    const { saleId: saleB } = await sell(backend);

    await withTransaction(suite.db, async (tx) => {
      const error = new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 });
      const forSaleA = await recordIncidentOnce(tx, {
        tillId,
        saleId: saleA,
        error,
        severity: "warning",
        detectedAt: BASE,
      });
      expect(forSaleA).toBe(true);
      const forSaleB = await recordIncidentOnce(tx, {
        tillId,
        saleId: saleB,
        error,
        severity: "warning",
        detectedAt: BASE,
      });
      expect(forSaleB).toBe(true);
      expect(await openIncidents(tx, tillId)).toHaveLength(2);
    });
  });
});

describe("incidents open-dedup invariant (partial unique index)", () => {
  // **Deviation from the brief.** The brief's sketch called `recordIncident(asAppUser(tx), input)` /
  // `recordIncidentOnce(asAppUser(tx), input)` — but `asAppUser(tx): Promise<void>` (`@waitron/db`'s
  // `testing/roles.ts`) sets the role as a side effect and does not return `tx`; passing its result
  // as the `tx` argument does not type-check. Every other test in this file (see
  // `recordIncidentOnce`'s own describe above) awaits `asAppUser(tx)` as its own statement inside an
  // async callback and then uses `tx` directly — reusing that exact, already-established pattern here
  // instead.
  //
  // **Deviation from the brief.** The brief's orphan/ack tests used `payment.offline_forward_
  // declined`, an `AppError` code registered by `@waitron/payments`'s `errors.ts` via declaration
  // merging. `@waitron/core` does not depend on `@waitron/payments` (see this file's own
  // `recordIncidentOnce` describe block's identical note about `@waitron/fiscal-verifactu`'s
  // codes) so that code is not a member of `ErrorCode` in this package's typecheck program.
  // `clock.degraded` (registered by `@waitron/fiscal`, already used throughout this file) is used
  // in its place — the dedup key only cares that it is a real, distinct code.

  it("recordIncident (unconditional) de-dups a second OPEN same-key raise to one row", async () => {
    const { tillId } = await seedTillForIncidents(); // reuse the suite's existing seeding
    const input: RecordIncidentInput = {
      tillId,
      error: new AppError("chain.verification_failed", {
        tillId,
        issues: [
          {
            issueCode: "predecessor-hash-mismatch",
            recordId: null,
            issueParams: { sequence: 7, expected: "ABC" },
          },
        ],
      }),
      severity: "error",
      detectedAt: new Date("2026-07-24T10:00:00Z"),
    };
    await withTransaction(suite.db, async (tx) => {
      await recordIncident(tx, input);
    });
    await withTransaction(suite.db, async (tx) => {
      await recordIncident(tx, input);
    });
    const rows = await incidentsForTill(tillId);
    expect(rows).toHaveLength(1);
  });

  it("de-dups two orphan (sale_id NULL) raises via NULLS NOT DISTINCT", async () => {
    const { tillId } = await seedTillForIncidents();
    const raise = () =>
      withTransaction(suite.db, async (tx) => {
        return recordIncidentOnce(tx, {
          tillId,
          // no saleId — orphan
          error: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
          severity: "error",
          detectedAt: new Date("2026-07-24T10:00:00Z"),
        });
      });
    const first = await raise();
    const second = await raise();
    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await incidentsForTill(tillId);
    expect(rows.filter((r) => r.saleId === null)).toHaveLength(1);
  });

  it("frees the key after acknowledgement (a recurring condition resurfaces)", async () => {
    const { tillId } = await seedTillForIncidents();
    const input: RecordIncidentInput = {
      tillId,
      error: new AppError("clock.degraded", { tillId, anchorAgeSeconds: 999 }),
      severity: "error",
      detectedAt: new Date("2026-07-24T10:00:00Z"),
    };
    const raise = () =>
      withTransaction(suite.db, async (tx) => {
        return recordIncidentOnce(tx, input);
      });
    expect(await raise()).toBe(true);
    await suite.db.execute(
      sql`update incidents set acknowledged_at = ${nowIso()} where till_id = ${tillId}`,
    );
    expect(await raise()).toBe(true);
  });
});

describe("tenant incident reads", () => {
  function chainFailed(forTill: TillId): RecordIncidentInput["error"] {
    return new AppError("chain.verification_failed", {
      tillId: forTill,
      issues: [{ issueCode: "predecessor-hash-mismatch", recordId: null, issueParams: {} }],
    });
  }

  async function raise(forTill: TillId, detectedAt: Date): Promise<void> {
    await withTransaction(suite.db, async (tx) => {
      await recordIncident(tx, {
        tillId: forTill,
        error: chainFailed(forTill),
        severity: "error",
        detectedAt,
      });
    });
  }

  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTransaction(suite.db, async (tx) => {
      return fn(tx);
    });
  }

  it("lists this tenant's open incidents across tills, newest first", async () => {
    const secondTill = await seedTenant(suite.db);
    await raise(tillId, BASE);
    await raise(secondTill.tillId, new Date(BASE.getTime() + 60_000));
    const rows = await asApp((tx) => listOpenIncidents(tx));
    expect(rows.map((r) => r.tillId)).toEqual([secondTill.tillId, tillId]);
    expect(rows[0]).toMatchObject({ acknowledgedAt: null, acknowledgedBy: null });
  });

  it("finds an incident by id, and reads an unknown id as null", async () => {
    await raise(tillId, BASE);
    const [mine] = await asApp((tx) => listOpenIncidents(tx));
    expect((await asApp((tx) => findIncident(tx, mine!.id)))?.id).toBe(mine!.id);
    expect(
      await asApp((tx) => findIncident(tx, "00000000-0000-4000-8000-000000000000")),
    ).toBeNull();
  });

  it("marks an incident handled once; a second mark keeps the first time and person", async () => {
    await raise(tillId, BASE);
    const [open] = await asApp((tx) => listOpenIncidents(tx));
    const first = new Date(BASE.getTime() + 1_000);
    const firstPerson = "00000000-0000-4000-8000-000000000001";
    await asApp((tx) =>
      markIncidentHandled(tx, { id: open!.id, personId: firstPerson, handledAt: first }),
    );
    await asApp((tx) =>
      markIncidentHandled(tx, {
        id: open!.id,
        personId: "00000000-0000-4000-8000-000000000002",
        handledAt: new Date(BASE.getTime() + 9_000),
      }),
    );
    expect(await asApp((tx) => listOpenIncidents(tx))).toEqual([]);
    const handled = await asApp((tx) => findIncident(tx, open!.id));
    expect(handled?.acknowledgedAt?.toISOString()).toBe(first.toISOString());
    expect(handled?.acknowledgedBy).toBe(firstPerson);
  });

  it("lists handled incidents inside the window, newest handled first", async () => {
    const secondTill = await seedTenant(suite.db);
    const thirdTill = await seedTenant(suite.db);
    await raise(tillId, BASE);
    await raise(secondTill.tillId, BASE);
    await raise(thirdTill.tillId, BASE);
    const open = await asApp((tx) => listOpenIncidents(tx));
    const byTill = new Map(open.map((r) => [r.tillId, r.id]));
    const person = "00000000-0000-4000-8000-000000000001";
    const mark = (till: TillId, at: Date) =>
      asApp((tx) =>
        markIncidentHandled(tx, {
          id: byTill.get(till)!,
          personId: person,
          handledAt: at,
        }),
      );
    await mark(tillId, new Date("2026-03-10T10:00:00Z"));
    await mark(secondTill.tillId, new Date("2026-03-12T10:00:00Z"));
    await mark(thirdTill.tillId, new Date("2026-02-01T10:00:00Z"));
    const rows = await asApp((tx) => listHandledIncidents(tx, new Date("2026-03-01T00:00:00Z")));
    expect(rows.map((r) => r.tillId)).toEqual([secondTill.tillId, tillId]);
  });

  // Each call mints fresh ids, inserted in ascending order: a read with no second sort key tends to
  // hand tied rows back in that order, which fails the descending expectation.
  async function insertTied(acknowledgedAt: string | null): Promise<string[]> {
    const prefix = crypto.randomUUID().slice(0, -2);
    const ids = ["0a", "0b", "0c"].map((suffix) => `${prefix}${suffix}`);
    for (const [index, id] of ids.entries()) {
      await suite.db.insert(incidents).values({
        id,
        tillId,
        code: `test.tied_${index}`,
        params: {},
        severity: "error",
        detectedAt: BASE.toISOString(),
        acknowledgedAt,
        acknowledgedBy: acknowledgedAt === null ? null : "00000000-0000-4000-8000-000000000001",
      });
    }
    return ids;
  }

  it("orders open incidents detected at the same instant by id, highest first", async () => {
    const ids = await insertTied(null);
    const rows = await asApp((tx) => listOpenIncidents(tx));
    expect(rows.map((r) => r.id)).toEqual(ids.reverse());
  });

  it("orders incidents handled at the same instant by id, highest first", async () => {
    const ids = await insertTied("2026-03-10T10:00:00.000Z");
    const rows = await asApp((tx) => listHandledIncidents(tx, new Date("2026-03-01T00:00:00Z")));
    expect(rows.map((r) => r.id)).toEqual(ids.reverse());
  });

  it("includes an incident handled exactly at the cut-off and excludes one a millisecond before", async () => {
    const cutOff = new Date("2026-03-10T10:00:00.000Z");
    await raise(tillId, BASE);
    const secondTill = await seedTenant(suite.db);
    await raise(secondTill.tillId, BASE);
    const open = await asApp((tx) => listOpenIncidents(tx));
    const byTill = new Map(open.map((r) => [r.tillId, r.id]));
    const person = "00000000-0000-4000-8000-000000000001";
    await asApp((tx) =>
      markIncidentHandled(tx, {
        id: byTill.get(tillId)!,
        personId: person,
        handledAt: cutOff,
      }),
    );
    await asApp((tx) =>
      markIncidentHandled(tx, {
        id: byTill.get(secondTill.tillId)!,
        personId: person,
        handledAt: new Date(cutOff.getTime() - 1),
      }),
    );
    const rows = await asApp((tx) => listHandledIncidents(tx, cutOff));
    expect(rows.map((r) => r.tillId)).toEqual([tillId]);
  });
});
