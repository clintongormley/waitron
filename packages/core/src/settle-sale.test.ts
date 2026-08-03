import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  asAppUser,
  captureError,
  pgErrorCode,
  sales,
  saleSettlements,
  saleVoids,
  tenders,
  withTenant,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useRealPostgres } from "@waitron/db/testing/lifecycle.js";
import { AppError, saleId as brandSaleId, tenantId as brandTenantId } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TenantId, TillId } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import { settleSale } from "./settle-sale.js";
import type { SettleSaleInput } from "./settle-sale.js";
import { startRealPostgres } from "./testing/postgres.js";

// Real Postgres, not PGlite, for the whole suite — mandatory here (design §7, CLAUDE.md §4). The
// cross-tenant `not_found` path needs a non-superuser role that RLS is FORCED against, and the
// settlement race needs two callers on two backend processes; PGlite gives neither (its one
// superuser backend bypasses RLS and serialises every query).
const postgres = useRealPostgres({
  start: startRealPostgres,
  // The container image may be pulled cold on a fresh CI runner; the package's own real-PG suites
  // set 180s for the same reason (see `useRealPostgres`'s note on why there is no default).
  timeoutMs: 180_000,
});

const SETTLED_AT = new Date("2026-08-01T12:00:00Z");

/**
 * Inserts one `sales` row as the seeding (superuser) connection — RLS is bypassed there, exactly as
 * `test/fixtures.ts`'s `seedTenant` relies on for the tenant/till/node/series it seeds. Written on
 * the NEW schema: `total` is the only money column left (the tip moved to `tenders.tip_amount` and
 * `amount_charged` was dropped in migration 0012), and `node_id` is NOT NULL (node-id rekey).
 */
async function seedSale(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  overrides: { total?: string; invoiceNumber?: number } = {},
): Promise<SaleId> {
  const [row] = await db
    .insert(sales)
    .values({
      tenantId: seed.tenantId,
      tillId: seed.tillId,
      nodeId: seed.nodeId,
      seriesId: seed.seriesId,
      invoiceNumber: overrides.invoiceNumber ?? 1,
      issuedAt: new Date("2026-08-01T11:00:00Z").toISOString(),
      issuedOffsetMinutes: 0,
      total: overrides.total ?? "65.00",
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "fake",
      fiscalState: "recorded",
    })
    .returning({ id: sales.id });
  return brandSaleId(row!.id);
}

/**
 * Runs `settleSale` exactly as the application will: inside a tenant-scoped transaction, AS the
 * non-superuser app role. Both matter — `withTenant` sets `app.tenant_id`, `asAppUser` switches off
 * the superuser bypass — so a cross-tenant sale is genuinely hidden by RLS rather than merely
 * filtered by a predicate the superuser would ignore.
 */
function settle(db: Database, tenantId: TenantId, input: SettleSaleInput): Promise<void> {
  return withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    await settleSale(tx, input);
  });
}

describe("settleSale — the happy path", () => {
  it("writes tenders + a settlement row when tenders cover total + tips", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });

    // total 65.00 → 70.00 = 65.00 + 5.00 covers.
    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId,
      tenders: [{ method: "cash", amount: "70.00", tipAmount: "5.00", settledAt: SETTLED_AT }],
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(1);
    // The tender's own moment, round-tripped through Postgres. Compared as an instant rather than
    // as a string literal: a `timestamptz` read back through the driver is rendered in the session
    // timezone (`2026-08-01 12:00:00+00`), not as the ISO string it was written from — the same
    // reason `record-sale.test.ts` and `manual.test.ts` both wrap the read in `new Date(...)`.
    // **Deviation from the brief**, whose `toBe("2026-08-01T12:00:00.000Z")` assumes the ISO form.
    expect(new Date(settled[0]!.settledAt).getTime()).toBe(SETTLED_AT.getTime());

    const tenderRows = await postgres.admin
      .select()
      .from(tenders)
      .where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(1);
    expect(tenderRows[0]!.amount).toBe("70.00");
    expect(tenderRows[0]!.tipAmount).toBe("5.00");
  });

  it("settles a €0 comped sale with no tenders, stamped at the settlement instant (no raw TypeError)", async () => {
    // A fully-comped sale is €0 and has NO payment: `tenders_amount_ck` forbids a €0 tender, so a
    // comp is genuinely tenderless. The schema permits the settlement — `sales_total_ck` allows a
    // total of 0, and the coverage trigger's `coalesce(sum(amount),0)` makes `0 = 0 + 0` hold — so
    // `settleSale` must RECORD it, not crash on an empty `reduce`/empty `insert().values([])`. With
    // no tender to time it by, the settlement stamps its OWN instant (`new Date()`, like
    // `record-void.ts`), NOT the sale's `issued_at`: in invoice-first mode settlement runs long
    // after the invoice printed, and backdating an append-only row to issuance cannot be corrected.
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "0.00" });

    // Window the settle call so the stamped instant is pinned to the actual settlement moment, not
    // the seed's issued_at (11:00Z). `before`/`after` bracket the real `new Date()` inside settleSale.
    const before = new Date();
    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId,
      tenders: [],
    });
    const after = new Date();

    const [settled] = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toBeDefined();
    const settledAt = new Date(settled!.settledAt).getTime();
    // The settlement's own instant: within the call window …
    expect(settledAt).toBeGreaterThanOrEqual(before.getTime());
    expect(settledAt).toBeLessThanOrEqual(after.getTime());
    // … and strictly LATER than the seed's issued_at (11:00Z), proving it is the settlement instant
    // rather than the print instant a backdating implementation would have copied.
    expect(settledAt).toBeGreaterThan(new Date("2026-08-01T11:00:00Z").getTime());

    const tenderRows = await postgres.admin
      .select()
      .from(tenders)
      .where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(0);
  });

  it("stamps the settlement at the LATEST tender's settledAt, across a split payment", async () => {
    // Decision ⑤: settled_at is the moment the last tender landed. Two tenders settling at
    // different times prove the reduce picks the max rather than the first/last positionally.
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });
    const earlier = new Date("2026-08-01T12:00:00Z");
    const later = new Date("2026-08-01T18:30:00Z");

    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId,
      // 40.00 + 25.00 = 65.00 = total + 0 tips. `later` is supplied on the FIRST tender to prove
      // the max is by value, not by array position.
      tenders: [
        { method: "card", amount: "40.00", tipAmount: "0.00", settledAt: later },
        { method: "cash", amount: "25.00", tipAmount: "0.00", settledAt: earlier },
      ],
    });

    const [settled] = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(new Date(settled!.settledAt).getTime()).toBe(later.getTime());
  });
});

describe("settleSale — guards", () => {
  it("throws sale.tender_unsettled for a null settledAt", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });

    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId,
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: null }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_unsettled",
      params: { saleId, unsettledCount: 1 },
    });

    // Refused before any write: the sale stays unsettled and retryable.
    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(0);
  });

  it("throws sale.tender_shortfall when sum(amount) != total + sum(tip)", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });

    // 60.00 charged against a 65.00 due — under-coverage.
    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId,
        tenders: [{ method: "cash", amount: "60.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { saleId, due: "65.00", charged: "60.00" },
    });

    const tenderRows = await postgres.admin
      .select()
      .from(tenders)
      .where(eq(tenders.saleId, saleId));
    expect(tenderRows).toHaveLength(0);
  });

  it("throws sale.not_found for an unknown sale id", async () => {
    const seed = await seedTenant(postgres.admin);
    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId: brandSaleId("00000000-0000-4000-8000-000000000000"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("throws sale.not_found for a cross-tenant sale (RLS-hidden, not forbidden)", async () => {
    // The load-bearing RLS test, and why this suite is real-PG. The sale is real, but belongs to
    // another tenant; under `FORCE ROW LEVEL SECURITY` as `app_user`, `settleSale`'s own tenant-
    // unqualified `where(eq(sales.id, ...))` reads back zero rows, so it is genuinely not-found
    // rather than forbidden. As a superuser (PGlite) the same SELECT would return the row and this
    // test would fail — which is the point.
    const other = await seedTenant(postgres.admin);
    const foreignSaleId = await seedSale(postgres.admin, other, { total: "65.00" });
    const seed = await seedTenant(postgres.admin);

    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId: foreignSaleId,
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({ code: "sale.not_found", params: { saleId: foreignSaleId } });
  });

  it("throws sale.voided when the sale carries a sale_voids row", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });
    await postgres.admin.insert(saleVoids).values({
      tenantId: seed.tenantId,
      saleId,
      reason: "Wrong table",
      voidedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    });

    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId,
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({ code: "sale.voided", params: { saleId } });
  });

  it("throws sale.already_settled on a second (sequential) settle", async () => {
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });
    const input: SettleSaleInput = {
      tenantId: seed.tenantId,
      saleId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    };

    await settle(postgres.admin, seed.tenantId, input);
    // The second attempt is caught by the pre-check SELECT, not the UNIQUE violation (that is the
    // concurrent path below).
    await expect(settle(postgres.admin, seed.tenantId, input)).rejects.toMatchObject({
      code: "sale.already_settled",
      params: { saleId },
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, saleId));
    expect(settled).toHaveLength(1);
  });
});

describe("settleSale — the concurrent settlement race (real Postgres only)", () => {
  it("lets exactly one settlement win; the loser surfaces sale.already_settled", async () => {
    // The race the pre-check SELECT cannot arbitrate on its own — proving that `sale_settlements`'s
    // UNIQUE constraint is the real control (design decision ③). Two callers on DISTINCT backend
    // processes: PGlite serialises every query onto one backend, so this is a FALSE PASS there, not
    // a weak one — hence real-PG only (design §7, CLAUDE.md §4).
    //
    // The interleaving is forced deterministically with the acquired/held gate the package's other
    // concurrency suites use (async-settle, reversal, incident-dedup): the holder pauses AFTER
    // `settleSale` has inserted its tenders and its `sale_settlements` row but BEFORE its
    // transaction commits, so its UNIQUE key is held-but-invisible. Left ungated, the loser could
    // instead insert its tenders after the winner had already committed, and the WT002
    // post-settlement trigger — not `isUniqueViolation` — would fire, surfacing a raw error rather
    // than `sale.already_settled`. The gate keeps the loser on the intended UNIQUE-violation path.
    const seed = await seedTenant(postgres.admin);
    const saleId = await seedSale(postgres.admin, seed, { total: "65.00" });
    const input: SettleSaleInput = {
      tenantId: seed.tenantId,
      saleId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    };

    // Distinct connections, so the two callers land on two backend processes (`connect()`'s own
    // contract). Guarded closes even though these live in a `finally` inside the test, not an
    // afterAll — the convention CLAUDE.md §4 states and `guarded-teardowns.test.ts` backstops.
    let holder: Database | undefined;
    let waiter: Database | undefined;
    let release: () => void = () => {};
    let holderRun: Promise<void> | undefined;
    let waiterRun: Promise<unknown> | undefined;
    try {
      holder = await postgres.pg.connect();
      waiter = await postgres.pg.connect();

      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // Holder: settles fully (tenders + sale_settlements), signals it holds the uncommitted UNIQUE
      // key, and pauses before commit — keeping its transaction, and the key, open.
      holderRun = withTenant(holder, seed.tenantId, async (tx) => {
        await asAppUser(tx);
        await settleSale(tx, input);
        acquire();
        await held;
      });
      await acquired; // do not start the waiter before the key is actually held

      // Waiter: the real path, unmodified. Its pre-check passes (the holder's row is uncommitted and
      // invisible), it inserts its own tenders (WT002 sees no committed settlement), then BLOCKS on
      // the sale_settlements UNIQUE key.
      let waiterDone = false;
      waiterRun = settle(waiter, seed.tenantId, input)
        .then(() => undefined)
        .catch((error: unknown) => error)
        .finally(() => {
          waiterDone = true;
        });

      const resolvedEarly = await Promise.race([
        waiterRun.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 300)),
      ]);
      expect(resolvedEarly).toBe(false); // genuinely blocked on the holder's uncommitted key
      expect(waiterDone).toBe(false);

      release(); // holder commits → the waiter's INSERT collides → 23505 → sale.already_settled
      await holderRun;
      const loser = await waiterRun;

      expect(loser).toBeInstanceOf(AppError);
      expect((loser as AppError).code).toBe("sale.already_settled");
      expect((loser as AppError).params).toMatchObject({ saleId });

      // Exactly one settlement, and exactly the winner's single tender — the loser's tender rolled
      // back with its whole transaction.
      const settled = await postgres.admin
        .select()
        .from(saleSettlements)
        .where(eq(saleSettlements.saleId, saleId));
      expect(settled).toHaveLength(1);
      const tenderRows = await postgres.admin
        .select()
        .from(tenders)
        .where(eq(tenders.saleId, saleId));
      expect(tenderRows).toHaveLength(1);
    } finally {
      release();
      if (holderRun !== undefined) await holderRun.catch(() => {});
      if (waiterRun !== undefined) await waiterRun.catch(() => {});
      if (holder !== undefined) await holder.close();
      if (waiter !== undefined) await waiter.close();
    }
  });
});

describe("settleSale — error propagation", () => {
  it("rethrows a non-unique error from the settlement insert, untranslated", async () => {
    // The settlement insert's OTHER failure path. `settleSale` catches the `sale_settlements` UNIQUE
    // violation and maps it to `sale.already_settled`; ANY other database failure (a future
    // constraint, a transport error) must reach the caller as-is rather than be mislabelled as
    // already-settled. Mirrors record-void.test.ts's identical "propagates a database error that is
    // not a unique violation" stub for recordVoid's analogous catch/rethrow. A hand-built
    // Transaction stub, not the real PGlite/PG one: there is no second schema-level constraint on
    // `sale_settlements` to provoke a genuinely different SQLSTATE, so this drives settleSale's own
    // catch/rethrow branch directly. A tenderless (€0) settlement so the ONLY insert reached is the
    // `sale_settlements` one that rejects — no tender insert runs before it.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          // 1: the sale row; 2: sale_voids (none); 3: existing settlement (none).
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: "0.00" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        tenantId: brandTenantId("00000000-0000-4000-8000-000000000000"),
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [],
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(pgErrorCode(error)).toBe("53100");
  });

  it("translates the tenders post-settlement guard (WT002) to sale.already_settled", async () => {
    // The OTHER concurrent-loser interleaving, driven directly. The real-PG race above forces the
    // loser onto the `sale_settlements` UNIQUE; here the winner has already COMMITTED, so the
    // loser's tender INSERT trips the `tenders_reject_post_settlement` trigger (SQLSTATE WT002)
    // instead. That trigger fires iff a settlement row already exists for the sale, so WT002 on the
    // tender insert always means "already settled" and must surface as `sale.already_settled` — the
    // same code the UNIQUE path maps to — rather than a raw driver error a retry/idempotency caller
    // would not recognise. A hand-built Transaction stub (like the rethrow test above): the
    // deterministic post-commit interleaving is awkward to force on a live DB, and this drives
    // settleSale's own tenders-insert catch/translate branch directly. Tenders are PRESENT (unlike
    // the €0 rethrow test) so the tenders INSERT — the one WT002 fires on — is actually reached.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          // 1: the sale row (total 65.00); 2: sale_voids (none); 3: existing settlement (none).
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: "65.00" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () =>
          Promise.reject(
            Object.assign(new Error("tender for sale rejected: the sale is already settled"), {
              code: "WT002",
            }),
          ),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        tenantId: brandTenantId("00000000-0000-4000-8000-000000000000"),
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("sale.already_settled");
    expect((error as AppError).params).toMatchObject({
      saleId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("rethrows a non-WT002 error from the tenders insert, untranslated", async () => {
    // The tenders insert's OTHER failure path, mirroring the settlement-insert rethrow above. Only
    // the post-settlement guard's WT002 means "already settled"; ANY other failure on the tenders
    // insert (a transport error, a future constraint) must reach the caller as-is rather than be
    // mislabelled `sale.already_settled`. This also exercises `isPostSettlementViolation` walking a
    // non-matching error's cause chain to the end and returning false. Tenders are present so the
    // tenders INSERT is the one reached; a WT002-free `.code` so the predicate declines it.
    let selects = 0;
    const fakeTx = {
      select: () => ({
        from: () => ({
          where: () => {
            selects += 1;
            return selects === 1
              ? Promise.resolve([{ tillId: "t", total: "65.00" }])
              : Promise.resolve([]);
          },
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })),
      }),
    } as unknown as Transaction;

    const error = await captureError(() =>
      settleSale(fakeTx, {
        tenantId: brandTenantId("00000000-0000-4000-8000-000000000000"),
        saleId: brandSaleId("11111111-1111-4111-8111-111111111111"),
        tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(pgErrorCode(error)).toBe("53100");
  });
});

// Local helper: insert a rectificativa (negative or positive total) that corrects `originalId`.
async function seedCorrective(
  db: Database,
  seed: { tenantId: TenantId; tillId: TillId; nodeId: NodeId; seriesId: SeriesId },
  originalId: SaleId,
  overrides: { total: string; invoiceNumber: number },
): Promise<void> {
  await db.insert(sales).values({
    tenantId: seed.tenantId,
    tillId: seed.tillId,
    nodeId: seed.nodeId,
    seriesId: seed.seriesId,
    invoiceNumber: overrides.invoiceNumber,
    issuedAt: new Date("2026-08-01T11:30:00Z").toISOString(),
    issuedOffsetMinutes: 0,
    total: overrides.total, // negative allowed because correctsSaleId is set (sales_total_ck)
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
    correctsSaleId: originalId,
  });
}

// Insert tenders then a settlement row directly, as the app role — bypassing settleSale so the
// coverage TRIGGER is what is under test. Tenders first: tenders_reject_post_settlement (WT002)
// rejects a tender once a settlement row exists.
async function settleDirect(
  db: Database,
  tenantId: TenantId,
  saleId: SaleId,
  amount: string,
): Promise<void> {
  await withTenant(db, tenantId, async (tx) => {
    await asAppUser(tx);
    await tx.insert(tenders).values({
      tenantId,
      saleId,
      method: "cash",
      amount,
      tipAmount: "0.00",
      settledAt: SETTLED_AT.toISOString(),
    });
    await tx
      .insert(saleSettlements)
      .values({ tenantId, saleId, settledAt: SETTLED_AT.toISOString() });
  });
}

describe("coverage trigger nets corrections", () => {
  it("accepts the net: 65 covers a 70 sale corrected by -5", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await settleDirect(postgres.admin, seed.tenantId, originalId, "65.00");

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("rejects the pre-correction total: 70 against a 70 sale corrected by -5 (net 65)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    const error = await captureError(() =>
      settleDirect(postgres.admin, seed.tenantId, originalId, "70.00"),
    );
    expect(error).toBeDefined();

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });

  it("negative control: an uncorrected sale still needs its exact total (65 rejected on a 70 sale)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });

    const error = await captureError(() =>
      settleDirect(postgres.admin, seed.tenantId, originalId, "65.00"),
    );
    expect(error).toBeDefined();

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(0);
  });
});

describe("settleSale nets corrections into the due", () => {
  it("settles a corrected sale at the net (70 corrected by -5, pay 65)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId: originalId,
      tenders: [{ method: "cash", amount: "65.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });

  it("shortfall's due is the net: paying the pre-correction 70 on a -5-corrected sale is rejected", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "-5.00", invoiceNumber: 2 });

    await expect(
      settle(postgres.admin, seed.tenantId, {
        tenantId: seed.tenantId,
        saleId: originalId,
        tenders: [{ method: "cash", amount: "70.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
      }),
    ).rejects.toMatchObject({
      code: "sale.tender_shortfall",
      params: { saleId: originalId, due: "65.00", charged: "70.00" },
    });
  });

  it("nets a correcting-up corrective (70 corrected by +5, pay 75)", async () => {
    const seed = await seedTenant(postgres.admin);
    const originalId = await seedSale(postgres.admin, seed, { total: "70.00", invoiceNumber: 1 });
    await seedCorrective(postgres.admin, seed, originalId, { total: "5.00", invoiceNumber: 2 });

    await settle(postgres.admin, seed.tenantId, {
      tenantId: seed.tenantId,
      saleId: originalId,
      tenders: [{ method: "cash", amount: "75.00", tipAmount: "0.00", settledAt: SETTLED_AT }],
    });

    const settled = await postgres.admin
      .select()
      .from(saleSettlements)
      .where(eq(saleSettlements.saleId, originalId));
    expect(settled).toHaveLength(1);
  });
});
