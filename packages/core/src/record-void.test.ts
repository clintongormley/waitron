import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import type { NodeId, SaleId, SeriesId, TillId } from "@waitron/shared";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import {
  CORE_MIGRATIONS,
  captureError,
  constraintTarget,
  isUniqueViolation,
  incidents,
  invoiceSeries,
  driverErrorCode,
  saleVoids,
  sales,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { IDENTITY_MIGRATIONS, hashPin, loginWithPin, persons } from "@waitron/identity";
import type { AuthzInput } from "@waitron/identity";
import { recordSale } from "./record-sale.js";
import type { RecordSaleInput } from "./record-sale.js";
import { recordVoid } from "./record-void.js";
import { seedTenant } from "../test/fixtures.js";

let tillId: TillId;
let nodeId: NodeId;
let seriesId: SeriesId;
// `managerId` holds `sale.void` on its own role, so `managerSessionId` authorizes every green-path
// void; `staffId` holds nothing, and `supervisorId` is the second person whose PIN unlocks an
// override.
let managerId: string;
let supervisorId: string;
let managerSessionId: string;
let staffSessionId: string;

const suite = useVenueDb({
  // `recordVoid` calls `authorize`, which reads identity's tables.
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
  setup: (db) => FakeFiscalBackend.install(db),
  timeoutMs: 60_000,
});

beforeEach(async () => {
  ({ tillId, nodeId, seriesId } = await seedTenant(suite.db));
  managerId = await seedPerson("manager");
  supervisorId = await seedPerson("supervisor");
  const staffId = await seedPerson("staff");
  managerSessionId = await openSession(managerId);
  staffSessionId = await openSession(staffId);
});

/** A person of `role` whose PIN is "1234". The role keeps the display names distinct. */
async function seedPerson(role: "staff" | "supervisor" | "manager" | "admin"): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: `P ${role}`, pinHash: hashPin("1234"), role })
    .returning({ id: persons.id });
  return row!.id;
}

/** Opens a shift session for `personId` at this tenant's till and returns its id. */
async function openSession(personId: string): Promise<string> {
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { tillId, personId, pin: "1234" }),
  );
  return session.id;
}

const BASE = new Date("2026-03-01T13:05:00+01:00");

/** A `TrustedClock` from `now()` alone; `recordSale` calls nothing else on it. */
function fixedClock(now: TrustedClock["now"]): TrustedClock {
  return {
    now,
    anchor: () => {
      throw new Error("fixedClock: anchor() is not used by recordSale/recordVoid");
    },
    currentAnchor: () => null,
  };
}

const steadyClock: TrustedClock = fixedClock(() => ({
  instant: BASE,
  offsetMinutes: 60,
  confident: true,
  confidence: "anchored",
  anchorAgeSeconds: 0,
}));

function saleInput(overrides: Partial<RecordSaleInput> = {}): RecordSaleInput {
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

/**
 * Registers the node with the backend, then sells, in one transaction: the fake refuses
 * `recordSale` for a node it has not registered.
 */
async function sell(backend: FiscalBackend, overrides: Partial<RecordSaleInput> = {}) {
  return withTransaction(suite.db, async (tx) => {
    await backend.registerNode(tx, nodeId);
    return recordSale(tx, backend, saleInput(overrides));
  });
}

async function voidSale(
  backend: FiscalBackend,
  saleId: SaleId,
  reason = "Wrong table",
  authz: AuthzInput = { sessionId: managerSessionId },
) {
  return withTransaction(suite.db, async (tx) => {
    return recordVoid(tx, backend, saleId, reason, authz);
  });
}

/** Counts every row in `table`; the suite helper empties the tables between tests. */
async function countRows(table: string): Promise<number> {
  const result = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from ${sql.raw(table)}`,
  );
  return result.rows[0]!.n;
}

/**
 * A `FiscalBackend` delegating to `fake` except where `overrides` supplies a method. Each method
 * is bound by hand: they live on the prototype, where object spread cannot see them.
 */
function wrapBackend(fake: FakeFiscalBackend, overrides: Partial<FiscalBackend>): FiscalBackend {
  return {
    id: fake.id,
    registerNode: (tx, node) => fake.registerNode(tx, node),
    recordSale: (tx, sale) => fake.recordSale(tx, sale),
    filedReceiptFor: (tx, saleId) => fake.filedReceiptFor(tx, saleId),
    recordVoid: (tx, id, reason) => fake.recordVoid(tx, id, reason),
    recordCorrection: (tx, sale, correction) => fake.recordCorrection(tx, sale, correction),
    recordSubstitution: (tx, sale, substitution) => fake.recordSubstitution(tx, sale, substitution),
    checkIntegrity: (tx, node) => fake.checkIntegrity(tx, node),
    pendingCount: (node) => fake.pendingCount(node),
    ...overrides,
  };
}

describe("recordVoid — nothing is ever edited", () => {
  it("leaves the original sale row byte for byte unchanged", async () => {
    // The full row, not named columns: a named-column assertion cannot notice an implementation
    // that quietly changed fiscal_state.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const [before] = await suite.db.select().from(sales).where(eq(sales.id, saleId));

    await voidSale(backend, saleId);

    const [after] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(after).toEqual(before);
  });

  it("appends a sale_voids row carrying the reason verbatim", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId, "Customer returned the order");

    const [row] = await suite.db.select().from(saleVoids).where(eq(saleVoids.saleId, saleId));
    expect(row?.reason).toBe("Customer returned the order");
    // This void ran under the manager session, so the manager is the recorded authorizer.
    expect(row?.voidedBy).toBe(managerId);
  });

  it("asks the module for a new record rather than for an edit", async () => {
    // The fake's ledger, in order: the sale, then the void, never an edit of the first entry.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(records[1]?.saleId).toBe(saleId);
  });
});

describe("recordVoid — numbering", () => {
  it("allocates no invoice number", async () => {
    // The annulment carries the annulled invoice's identity, so there is no number to allocate.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    const [before] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));

    await voidSale(backend, saleId);

    const [after] = await suite.db
      .select({ n: invoiceSeries.nextNumber })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.id, seriesId));
    expect(after?.n).toBe(before?.n);
  });

  it("permanently burns the annulled invoice number", async () => {
    // Annulling does not free a number: resending a record under it still returns AEAT error 3000,
    // because a record's identity is `IDEmisorFactura` + `NumSerieFactura` +
    // `FechaExpedicionFactura`. Enforced locally rather than discovered as a rejected record.
    //
    // Not `.rejects.toMatchObject({ code })`: `node:sqlite` puts `"ERR_SQLITE_ERROR"` on `code`
    // for every failure alike; `isUniqueViolation` reads the numeric `errcode`, and
    // `constraintTarget` names which key refused.
    const backend = new FakeFiscalBackend(suite.db);
    const first = await sell(backend);
    await voidSale(backend, first.saleId);

    const second = await sell(backend);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, second.saleId));
    expect(row?.invoiceNumber).toBe(2);

    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) => {
        await tx.insert(sales).values({
          tillId,
          nodeId,
          seriesId,
          invoiceNumber: 1,
          issuedAt: BASE.toISOString(),
          issuedOffsetMinutes: 60,
          // A money column holds whole cents: 100 is 1.00.
          total: 100,
          // Required by the column; supplied so the only thing wrong with this row is its number.
          vatBreakdown: [],
          locale: "es-ES",
          invoiceLocales: ["es-ES"],
          fiscalBackend: "fake",
          fiscalState: "recorded",
        });
      }),
    );
    // WHICH key, not only a class that means "something unique".
    expect(isUniqueViolation(error)).toBe(true);
    expect(constraintTarget(error)).toEqual({
      table: "sales",
      columns: ["series_id", "invoice_number"],
    });
  });
});

describe("recordVoid — guards", () => {
  it("refuses to void a sale that does not exist", async () => {
    // An operational failure, not a fiscal one: there is nothing here to void.
    await expect(
      voidSale(new FakeFiscalBackend(suite.db), "00000000-0000-4000-8000-000000000000" as SaleId),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });

  it("refuses to void the same sale twice", async () => {
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toMatchObject({
      code: "sale.already_voided",
    });
  });

  it("chains nothing on a rejected second void", async () => {
    // The unique violation must fire before the module records an annulment: the fake's ledger
    // must hold one sale and one void, not two voids.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    await voidSale(backend, saleId);
    await expect(voidSale(backend, saleId)).rejects.toBeInstanceOf(AppError);

    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
    expect(await countRows("sale_voids")).toBe(1);
  });
});

describe("recordVoid — authorization", () => {
  it("records the authorizing supervisor when a staff session voids under an override", async () => {
    // The staff operator holds nothing; the supervisor's PIN authorizes, so `voided_by` names the
    // supervisor, the person who took responsibility.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);

    await voidSale(backend, saleId, "Wrong table", {
      sessionId: staffSessionId,
      override: { personId: supervisorId, pin: "1234" },
    });

    const [row] = await suite.db.select().from(saleVoids).where(eq(saleVoids.saleId, saleId));
    expect(row?.voidedBy).toBe(supervisorId);
  });

  it("refuses a staff session with no override and appends no sale_voids row", async () => {
    // A staff member cannot void alone, and a refused void leaves no `sale_voids` row behind.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);

    await expect(
      voidSale(backend, saleId, "Wrong table", { sessionId: staffSessionId }),
    ).rejects.toMatchObject({ code: "authorization.not_permitted" });

    expect(await countRows("sale_voids")).toBe(0);
  });

  it("returns sale.not_found before the gate — a missing sale never leaks an authz error", async () => {
    await expect(
      voidSale(
        new FakeFiscalBackend(suite.db),
        "00000000-0000-4000-8000-000000000000" as SaleId,
        "Wrong table",
        { sessionId: staffSessionId },
      ),
    ).rejects.toMatchObject({ code: "sale.not_found" });
  });
});

describe("recordVoid — error propagation", () => {
  it("propagates a database error that is not a unique violation, untranslated", async () => {
    // Any other insert failure must reach the caller as it arrived, not as `sale.already_voided`.
    // A stub drives `recordVoid`'s catch directly. Its `select` also has to satisfy `authorize`,
    // which runs between the sale lookup and the insert: the sale lookup is `.from().where()` and
    // authorize's is `.from().innerJoin().where()`, so `from()` exposes both.
    const row = [{ tillId, nodeId, personId: "operator", role: "manager" }];
    const fakeTx = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(row),
          innerJoin: () => ({ where: () => Promise.resolve(row) }),
        }),
      }),
      insert: () => ({
        values: () => Promise.reject(Object.assign(new Error("disk full"), { code: "53100" })),
      }),
    } as unknown as Transaction;

    const backend: FiscalBackend = {
      id: "fake",
      registerNode: () => {
        throw new Error("not used by this test");
      },
      recordSale: () => {
        throw new Error("not used by this test");
      },
      filedReceiptFor: () => {
        throw new Error("not used by this test");
      },
      recordVoid: () => {
        throw new Error("recordVoid must not be reached: the insert above always rejects first");
      },
      recordCorrection: () => {
        throw new Error("not used by this test");
      },
      recordSubstitution: () => {
        throw new Error("not used by this test");
      },
      checkIntegrity: async () => ({ ok: true, checked: 0, issues: [] }),
      // Part of the interface's signature; unused here.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      pendingCount: (_node) => {
        throw new Error("not used by this test");
      },
    };

    const error = await captureError(() =>
      recordVoid(fakeTx, backend, "00000000-0000-4000-8000-000000000000" as SaleId, "reason", {
        sessionId: "operator-session",
      }),
    );
    expect(error).not.toBeInstanceOf(AppError);
    expect(driverErrorCode(error)).toBe("53100");
  });
});

describe("recordVoid — atomicity", () => {
  it("rolls back the sale_voids projection when the fiscal step fails", async () => {
    // `sale_voids` is appended before `backend.recordVoid`, in one transaction: a fiscal failure
    // must roll the projection back, or a void row is left with no annulment behind it.
    const fake = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(fake);
    const exploding = wrapBackend(fake, {
      recordVoid: () => {
        throw new Error("simulated fiscal backend outage");
      },
    });

    await expect(voidSale(exploding, saleId)).rejects.toThrow("simulated fiscal backend outage");

    expect(await countRows("sale_voids")).toBe(0);
    // No annulment either: the fake's own ledger must still show only the sale record, never a void.
    const records = await fake.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale"]);
  });
});

describe("recordVoid — no fiscal condition blocks a void", () => {
  it("completes the void when chain verification fails", async () => {
    // An annulment is a fiscal record like any other, so «NUNCA debe interrumpirse» applies:
    // blocking a void on a chain error would stop staff correcting the very sale concerned.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    backend.breakIntegrity(nodeId, { code: "chain.verification_failed", params: { sequence: 1 } });

    await voidSale(backend, saleId);

    expect(await countRows("sale_voids")).toBe(1);
    const records = await backend.recordsFor(nodeId);
    expect(records.map((r) => r.kind)).toEqual(["sale", "void"]);
  });

  it("records an incident against the voided sale when chain verification fails", async () => {
    // The test above checks only that the void completed; this one checks the incident.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);
    backend.breakIntegrity(nodeId, { code: "predecessor-hash-mismatch", params: { sequence: 1 } });

    await voidSale(backend, saleId);

    const rows = await suite.db.select().from(incidents).where(eq(incidents.tillId, tillId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("chain.verification_failed");
    expect(rows[0]?.severity).toBe("error");
    // The voided sale's id: an incident on the wrong sale sends staff after the wrong receipt.
    expect(rows[0]?.saleId).toBe(saleId);
  });

  it("records nothing when the void's own chain verification passes", async () => {
    // Without this, an implementation that always records an incident passes the test above.
    const backend = new FakeFiscalBackend(suite.db);
    const { saleId } = await sell(backend);

    await voidSale(backend, saleId);

    expect(await countRows("incidents")).toBe(0);
  });

  it("verifies the chain before asking the backend to record the void", async () => {
    const observed: string[] = [];
    const fake = new FakeFiscalBackend(suite.db);
    const backend = wrapBackend(fake, {
      async checkIntegrity(tx, node) {
        observed.push("checkIntegrity");
        return fake.checkIntegrity(tx, node);
      },
      async recordVoid(tx, id, reason) {
        observed.push("recordVoid");
        return fake.recordVoid(tx, id, reason);
      },
    });
    const { saleId } = await sell(backend);
    observed.length = 0;

    await voidSale(backend, saleId);

    expect(observed).toEqual(["checkIntegrity", "recordVoid"]);
  });
});
