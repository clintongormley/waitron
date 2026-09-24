import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import type { PersonRoleValue } from "@waitron/identity";
import { isAppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECEIPT } from "./defaults.js";
import { getReceipt, putReceipt } from "./receipt-store.js";
import type { ReceiptConfig } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** Through drizzle rather than raw SQL: `persons.id` and `created_at` take their value from the
 * table's `$defaultFn`, which is not a SQL DEFAULT, so a raw insert naming neither is refused
 * `NOT NULL constraint failed: persons.id`. */
async function seedSession(role: PersonRoleValue): Promise<string> {
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Operator", pinHash: "seed-pin-hash", role })
    .returning({ id: persons.id });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  return session.token;
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const error = await captureError(fn);
  return isAppError(error) ? error.code : `did not throw an AppError: ${String(error)}`;
}

async function rowCount(): Promise<number> {
  const rows = await suite.db.execute<{ n: number }>(
    sql`select count(*) as n from tenant_receipts`,
  );
  return rows.rows[0]!.n;
}

describe("tenant receipt store against a real migrated database", () => {
  it("returns DEFAULT_RECEIPT ({}) for a tenant that has never authored a receipt", async () => {
    await seedTenant(suite.db);
    expect(await inTx((tx) => getReceipt(tx))).toEqual(DEFAULT_RECEIPT);
  });

  it("round-trips a manager-authored receipt through put → get", async () => {
    await seedTenant(suite.db);
    const managerSession = await seedSession("manager");
    const receipt: ReceiptConfig = { headerSubtitle: "Hola" };
    await inTx((tx) => putReceipt(tx, { managementSessionId: managerSession, receipt }));
    expect(await inTx((tx) => getReceipt(tx))).toEqual(receipt);
  });

  it("upserts the single per-tenant row on a second put — no duplicate", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    await inTx((tx) =>
      putReceipt(tx, {
        managementSessionId: session,
        receipt: { headerSubtitle: "Calle Mayor 1" },
      }),
    );
    const next: ReceiptConfig = { footerMessage: "Gracias por su visita" };
    await inTx((tx) => putReceipt(tx, { managementSessionId: session, receipt: next }));
    expect(await rowCount()).toBe(1);
    expect(await inTx((tx) => getReceipt(tx))).toEqual(next);
  });

  it("refuses a put from a staff-role session — the authorizeManager gate (differential)", async () => {
    await seedTenant(suite.db);
    const staffSession = await seedSession("staff");
    const code = await codeOf(() =>
      inTx((tx) =>
        putReceipt(tx, {
          managementSessionId: staffSession,
          receipt: { footerMessage: "Gracias" },
        }),
      ),
    );
    expect(code).toBe("authorization.not_permitted");
    expect(await rowCount()).toBe(0); // the gate ran before the write
  });

  it("rejects an invalid receipt with receipt.invalid before any INSERT", async () => {
    await seedTenant(suite.db);
    const session = await seedSession("manager");
    // A manager passes the gate, so this refusal is validation's.
    const code = await codeOf(() =>
      inTx((tx) =>
        putReceipt(tx, {
          managementSessionId: session,
          receipt: { unknownField: "x" },
        }),
      ),
    );
    expect(code).toBe("receipt.invalid");
    expect(await rowCount()).toBe(0); // validate threw before the INSERT
  });
});
