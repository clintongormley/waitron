import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { acceptSwap, requestSwap } from "./shift-swaps.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { insertDraftShift, insertShiftSwap, seedLocation, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: requestSwap / acceptSwap are LOGIC over mutable planning rows (ownership
// and existence checks, a status flip) — there is no privilege set and no RLS decision to prove here.
// The app role's grants on `shift_swaps` are proven against real Postgres in
// scheduling-planning.rls.test.ts, not re-proven here.

let tenantId: string;
let locationId: string;

const suite = usePgliteDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, WORKFORCE_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
    locationId = await seedLocation(db, tenantId);
  },
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(suite.db, tenantId, fn);
}

async function codeOfRejection(fn: () => Promise<unknown>): Promise<string | undefined> {
  const error = await captureError(fn);
  return error instanceof AppError ? error.code : `not an AppError: ${String(error)}`;
}

/** A requester who owns one shift, and a second person offered the swap. */
async function twoPeopleAndAShift(): Promise<{
  requester: string;
  toPerson: string;
  fromShift: string;
}> {
  const requester = await seedPerson(suite.db, tenantId, `req-${crypto.randomUUID()}`);
  const toPerson = await seedPerson(suite.db, tenantId, `to-${crypto.randomUUID()}`);
  const fromShift = await insertDraftShift(suite.db, {
    tenantId,
    personId: requester,
    locationId,
  });
  return { requester, toPerson, fromShift };
}

describe("requestSwap", () => {
  it("creates a requested swap for a give-away (no return shift)", async () => {
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const swapId = await run((tx) =>
      requestSwap(tx, {
        tenantId,
        requestedByPersonId: requester,
        fromShiftId: fromShift,
        toPersonId: toPerson,
        toShiftId: null,
      }),
    );
    const rows = await suite.db.execute<{ status: string; to_shift_id: string | null }>(sql`
      select status, to_shift_id from shift_swaps where id = ${swapId}`);
    expect(rows.rows[0]).toEqual({ status: "requested", to_shift_id: null });
  });

  it("creates a swap that offers a return shift", async () => {
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const returnShift = await insertDraftShift(suite.db, {
      tenantId,
      personId: toPerson,
      locationId,
    });
    const swapId = await run((tx) =>
      requestSwap(tx, {
        tenantId,
        requestedByPersonId: requester,
        fromShiftId: fromShift,
        toPersonId: toPerson,
        toShiftId: returnShift,
      }),
    );
    const rows = await suite.db.execute<{ to_shift_id: string | null }>(
      sql`select to_shift_id from shift_swaps where id = ${swapId}`,
    );
    expect(rows.rows[0]!.to_shift_id).toBe(returnShift);
  });

  it("throws shift.not_found when the offered from_shift does not exist", async () => {
    const { requester, toPerson } = await twoPeopleAndAShift();
    const code = await codeOfRejection(() =>
      run((tx) =>
        requestSwap(tx, {
          tenantId,
          requestedByPersonId: requester,
          fromShiftId: crypto.randomUUID(),
          toPersonId: toPerson,
          toShiftId: null,
        }),
      ),
    );
    expect(code).toBe("shift.not_found");
  });

  it("throws swap.not_permitted when the requester does not own the from_shift", async () => {
    // The guard: you may only offer a shift that is YOURS. Here the shift belongs to `requester`, but
    // `intruder` tries to offer it. Prove by deletion — remove the ownership check and this stops
    // throwing (the intruder's swap inserts).
    const { toPerson, fromShift } = await twoPeopleAndAShift();
    const intruder = await seedPerson(suite.db, tenantId, `intr-${crypto.randomUUID()}`);
    const code = await codeOfRejection(() =>
      run((tx) =>
        requestSwap(tx, {
          tenantId,
          requestedByPersonId: intruder,
          fromShiftId: fromShift,
          toPersonId: toPerson,
          toShiftId: null,
        }),
      ),
    );
    expect(code).toBe("swap.not_permitted");
  });

  it("throws shift.not_found when a supplied to_shift does not exist", async () => {
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const code = await codeOfRejection(() =>
      run((tx) =>
        requestSwap(tx, {
          tenantId,
          requestedByPersonId: requester,
          fromShiftId: fromShift,
          toPersonId: toPerson,
          toShiftId: crypto.randomUUID(),
        }),
      ),
    );
    expect(code).toBe("shift.not_found");
  });
});

describe("acceptSwap", () => {
  it("lets the offered person accept, moving the swap to accepted", async () => {
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
    });
    await run((tx) => acceptSwap(tx, { tenantId, swapId, acceptingPersonId: toPerson }));
    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(rows.rows[0]!.status).toBe("accepted");
  });

  it("throws swap.not_found for a swap that does not exist under the tenant", async () => {
    const code = await codeOfRejection(() =>
      run((tx) =>
        acceptSwap(tx, {
          tenantId,
          swapId: crypto.randomUUID(),
          acceptingPersonId: crypto.randomUUID(),
        }),
      ),
    );
    expect(code).toBe("swap.not_found");
  });

  it("throws swap.not_permitted when someone other than the offered person accepts", async () => {
    // Only the swap's `to_person` may accept. Prove by deletion — remove the acceptor check and a
    // stranger's accept succeeds.
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const stranger = await seedPerson(suite.db, tenantId, `str-${crypto.randomUUID()}`);
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
    });
    const code = await codeOfRejection(() =>
      run((tx) => acceptSwap(tx, { tenantId, swapId, acceptingPersonId: stranger })),
    );
    expect(code).toBe("swap.not_permitted");
  });
});
