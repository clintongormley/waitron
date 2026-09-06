import { CORE_MIGRATIONS, captureError, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { AppError } from "@waitron/shared";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { acceptSwap, decideSwap, listPendingSwaps, requestSwap } from "./shift-swaps.js";
import { IDENTITY_MIGRATIONS } from "@waitron/identity";
import { WORKFORCE_MIGRATIONS } from "./migrations.js";
import { insertDraftShift, insertShiftSwap, seedLocation, seedPerson } from "../test/fixtures.js";

// PGlite, not real Postgres: requestSwap / acceptSwap are LOGIC over mutable planning rows (ownership
// and existence checks, a status flip) — there is no privilege decision to prove here. The app role's
// grants on `shift_swaps` are `shift_swaps: "SIUD"` in the privilege matrix, `packages/fiscal-verifactu/src/privileges.expected.ts`.

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

  it("throws swap.not_permitted when a supplied to_shift is not owned by the to_person", async () => {
    // Fix B: a supplied return shift must belong to the person the swap is offered TO — you cannot put
    // up SOMEONE ELSE's shift as the return leg. Here the return shift belongs to a THIRD person, not
    // `toPerson`. Prove by deletion — drop the `toShiftOwner === toPersonId` check in requestSwap and
    // this offer inserts instead of throwing, reddening the assertion.
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const thirdPerson = await seedPerson(suite.db, tenantId, `third-${crypto.randomUUID()}`);
    const foreignReturnShift = await insertDraftShift(suite.db, {
      tenantId,
      personId: thirdPerson,
      locationId,
    });
    const code = await codeOfRejection(() =>
      run((tx) =>
        requestSwap(tx, {
          tenantId,
          requestedByPersonId: requester,
          fromShiftId: fromShift,
          toPersonId: toPerson,
          toShiftId: foreignReturnShift,
        }),
      ),
    );
    expect(code).toBe("swap.not_permitted");
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

  it.each(["accepted", "approved", "rejected"] as const)(
    "throws swap.not_acceptable when the to_person accepts a swap already in '%s' state",
    async (status) => {
      // Fix A, the requested-only guard: only a `requested` swap may be accepted. The
      // `and status = 'requested'` predicate on acceptSwap's conditional UPDATE IS that guard — drop
      // it and this already-decided swap is flipped back to `accepted` (the 0-row no-match path is
      // never taken, so nothing throws), reddening the assertion. Distinct from swap.not_found (the
      // swap EXISTS) and swap.not_permitted (the acceptor IS the to_person) — exists-but-wrong-state.
      const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
      const swapId = await insertShiftSwap(suite.db, {
        tenantId,
        requestedByPersonId: requester,
        fromShiftId: fromShift,
        toPersonId: toPerson,
        status,
      });
      const code = await codeOfRejection(() =>
        run((tx) => acceptSwap(tx, { tenantId, swapId, acceptingPersonId: toPerson })),
      );
      expect(code).toBe("swap.not_acceptable");
    },
  );

  it("checks IDENTITY before STATE — a non-recipient accepting an already-accepted swap gets swap.not_permitted", async () => {
    // Screen identity before state (mirroring the read order today): a stranger accepting a swap that
    // is BOTH not theirs AND no longer `requested` gets swap.not_permitted, never swap.not_acceptable —
    // the permission check runs before the state-guarded UPDATE, so the non-recipient never learns the
    // swap's state.
    const { requester, toPerson, fromShift } = await twoPeopleAndAShift();
    const stranger = await seedPerson(suite.db, tenantId, `str-${crypto.randomUUID()}`);
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
      status: "accepted",
    });
    const code = await codeOfRejection(() =>
      run((tx) => acceptSwap(tx, { tenantId, swapId, acceptingPersonId: stranger })),
    );
    expect(code).toBe("swap.not_permitted");
  });
});

describe("decideSwap", () => {
  async function acceptedSwap(): Promise<string> {
    const requester = await seedPerson(suite.db, tenantId, `req-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, tenantId, `to-${crypto.randomUUID()}`);
    const fromShift = await insertDraftShift(suite.db, {
      tenantId,
      personId: requester,
      locationId,
    });
    return insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
      status: "accepted",
    });
  }

  it("approves an accepted swap, stamping the decider and decided_at", async () => {
    const swapId = await acceptedSwap();
    const decider = await seedPerson(suite.db, tenantId, `mgr-${crypto.randomUUID()}`);
    await run((tx) =>
      decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: decider }),
    );
    const rows = await suite.db.execute<{
      status: string;
      decided_by_person_id: string | null;
      decided_at: string | null;
    }>(sql`select status, decided_by_person_id, decided_at from shift_swaps where id = ${swapId}`);
    expect(rows.rows[0]!.status).toBe("approved");
    expect(rows.rows[0]!.decided_by_person_id).toBe(decider);
    expect(rows.rows[0]!.decided_at).not.toBeNull();
  });

  it("rejects an accepted swap (decision 'rejected')", async () => {
    const swapId = await acceptedSwap();
    await run((tx) =>
      decideSwap(tx, { tenantId, swapId, decision: "rejected", decidedByPersonId: null }),
    );
    const rows = await suite.db.execute<{ status: string }>(
      sql`select status from shift_swaps where id = ${swapId}`,
    );
    expect(rows.rows[0]!.status).toBe("rejected");
  });

  it("throws swap.not_found for a swap that does not exist under the tenant", async () => {
    // Prove by deletion: the conditional UPDATE matches nothing, so the cold-path `SELECT` finds no
    // row → `swap.not_found`. Remove the `if (rows[0] === undefined) throw swap.not_found` branch and
    // this reddens (it falls through to swap.not_decidable instead).
    const code = await codeOfRejection(() =>
      run((tx) =>
        decideSwap(tx, {
          tenantId,
          swapId: crypto.randomUUID(),
          decision: "approved",
          decidedByPersonId: null,
        }),
      ),
    );
    expect(code).toBe("swap.not_found");
  });

  it("throws swap.not_decidable for a REQUESTED swap (not yet accepted)", async () => {
    // Prove by deletion: the `and status = 'accepted'` predicate on the UPDATE is the decidability
    // guard. Remove it and this REQUESTED swap is wrongly UPDATEd (0-row path never taken, no throw),
    // reddening this test.
    const requester = await seedPerson(suite.db, tenantId, `r-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, tenantId, `t-${crypto.randomUUID()}`);
    const fromShift = await insertDraftShift(suite.db, {
      tenantId,
      personId: requester,
      locationId,
    });
    const swapId = await insertShiftSwap(suite.db, {
      tenantId,
      requestedByPersonId: requester,
      fromShiftId: fromShift,
      toPersonId: toPerson,
      status: "requested",
    });
    const code = await codeOfRejection(() =>
      run((tx) =>
        decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: null }),
      ),
    );
    expect(code).toBe("swap.not_decidable");
  });

  it("throws swap.not_decidable for an already-approved swap (terminal state)", async () => {
    const swapId = await acceptedSwap();
    await run((tx) =>
      decideSwap(tx, { tenantId, swapId, decision: "approved", decidedByPersonId: null }),
    );
    const code = await codeOfRejection(() =>
      run((tx) =>
        decideSwap(tx, { tenantId, swapId, decision: "rejected", decidedByPersonId: null }),
      ),
    );
    expect(code).toBe("swap.not_decidable");
  });
});

describe("listPendingSwaps", () => {
  it("returns only accepted swaps for the tenant, ordered by created_at", async () => {
    // A FRESH tenant, isolated from the sibling suites above: the shared PGlite DB persists across
    // the file, and `acceptSwap`'s "moving the swap to accepted" test leaves an `accepted` swap on
    // the module-level `tenantId` — order-independent per CLAUDE.md §4, so this queries its own tenant.
    const listTenant = await seedTenant(suite.db);
    const listLocation = await seedLocation(suite.db, listTenant);
    const requester = await seedPerson(suite.db, listTenant, `lr-${crypto.randomUUID()}`);
    const toPerson = await seedPerson(suite.db, listTenant, `lt-${crypto.randomUUID()}`);
    const s1 = await insertDraftShift(suite.db, {
      tenantId: listTenant,
      personId: requester,
      locationId: listLocation,
    });
    const s2 = await insertDraftShift(suite.db, {
      tenantId: listTenant,
      personId: requester,
      locationId: listLocation,
    });
    const s3 = await insertDraftShift(suite.db, {
      tenantId: listTenant,
      personId: requester,
      locationId: listLocation,
    });
    // TWO accepted swaps seeded OUT OF created_at ORDER: the FIRST-inserted carries the LATER
    // timestamp, the SECOND-inserted the EARLIER one, so insertion order and created_at order
    // DISAGREE. `order by created_at` must return [early, late]; delete it and the query falls back to
    // physical/insert order [late, early] and the toEqual below reddens (CLAUDE.md §4 prove-by-deletion).
    const acceptedLate = await insertShiftSwap(suite.db, {
      tenantId: listTenant,
      requestedByPersonId: requester,
      fromShiftId: s1,
      toPersonId: toPerson,
      status: "accepted",
      createdAt: "2026-03-02T10:00:00Z",
    });
    const acceptedEarly = await insertShiftSwap(suite.db, {
      tenantId: listTenant,
      requestedByPersonId: requester,
      fromShiftId: s2,
      toPersonId: toPerson,
      status: "accepted",
      createdAt: "2026-03-01T10:00:00Z",
    });
    // A requested (not accepted) swap must NOT appear (the status filter).
    await insertShiftSwap(suite.db, {
      tenantId: listTenant,
      requestedByPersonId: requester,
      fromShiftId: s3,
      toPersonId: toPerson,
      status: "requested",
    });
    const rows = await withTenant(suite.db, listTenant, (tx) =>
      listPendingSwaps(tx, { tenantId: listTenant }),
    );
    // created_at ASC → [early, late], the REVERSE of insertion order; the requested swap is excluded.
    expect(rows.map((r) => r.id)).toEqual([acceptedEarly, acceptedLate]);
    expect(rows.map((r) => r.createdAt)).toEqual(["2026-03-01T10:00:00Z", "2026-03-02T10:00:00Z"]);
    expect(rows.map((r) => r.status)).toEqual(["accepted", "accepted"]);
    // Field mapping on the head row (the earlier-created accepted swap, from_shift s2).
    expect(rows[0]!.requestedByPersonId).toBe(requester);
    expect(rows[0]!.fromShiftId).toBe(s2);
  });
});
