import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { NodeId, SeriesId, TillId } from "@waitron/shared";
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

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
});

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` from `now()` alone; `recordSale` calls nothing else on it. */
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
 * Degraded, and carrying `warning` as the real clock does, because `recordSale` forwards
 * `now.warning` rather than building one. Reads `tillId` lazily, after `beforeEach` has set it.
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
    // sum(amount) 16.31 = total 14.41 + tip 1.90.
    settlement: {
      kind: "immediate",
      tenders: [{ method: "card", amount: "16.31", tipAmount: "1.90", settledAt: BASE }],
    },
    clock: steadyClock,
    ...overrides,
  };
}

/** A backend whose `checkIntegrity` reports one issue on the current test's node. */
function failingChain(): FakeFiscalBackend {
  const backend = new FakeFiscalBackend(suite.db);
  backend.breakIntegrity(nodeId, {
    code: "predecessor-hash-mismatch",
    params: { sequence: 7, expected: "ABC" },
  });
  return backend;
}

/**
 * Registers the node with the backend, then sells, in one transaction: the fake refuses
 * `recordSale` for a node it has not registered.
 */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, input(overrides));
  });
}

/** Scoped to one till: several cases seed a second till and read only that one's rows. */
async function incidentsForTill(till: TillId) {
  return suite.db.select().from(incidents).where(eq(incidents.tillId, till));
}

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
    // Both halves matter: asserting only the incident would pass an implementation that recorded
    // it and then aborted.
    expect(await suite.db.select().from(sales).where(eq(sales.id, saleId))).toHaveLength(1);
    expect(await backend.recordsFor(nodeId)).toHaveLength(1);
  });

  it("carries the module's structured issue detail, not a rendered message", async () => {
    // One stable code, with the module's own issues nested under `params.issues`.
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
    // Two issues for one sale. `incidents_open_dedup` allows one open incident per
    // (till, code, sale), so one row per issue would lose the second; both must be carried in the
    // one incident's `params.issues`.
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
    // Both issues, in order.
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
    // Force a rollback after recordSale returns: neither the incident nor the sale may survive.
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
    // At error severity it would share a channel with chain failures and train staff to ignore
    // both.
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
    // Without this, an implementation that always records an incident passes every test above.
    await sell(new FakeFiscalBackend(suite.db));
    expect(await incidentsForTill(tillId)).toHaveLength(0);
  });
});

describe("recordIncident — no sale attached", () => {
  it("records an incident with a null sale_id when the caller supplies no saleId", async () => {
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
      // Acknowledges the fixture rows, so the read below has something to exclude.
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
});

describe("recordIncidentOnce", () => {
  // `packages/core` does not depend on the packages that register the reconcile or payment codes,
  // so these cases use `chain.verification_failed` and `clock.degraded`; the dedup key needs only
  // two distinct real codes.

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
      // The caller stamps `acknowledged_at`; only "not null" matters here.
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
    // Two real sales (`incidents.sale_id` is a foreign key): the key is per sale, not per till.
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
