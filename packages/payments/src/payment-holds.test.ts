import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  isRefusal,
  refusalOn,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentByRef, insertAttempting } from "./store.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const MANAGER = "22222222-2222-4222-8222-222222222222";
const NO_ROW = "99999999-9999-4999-8999-999999999999";
const FOUND_AT = "2026-10-19T09:00:00.000Z";
const RECORDED_AT = "2026-10-19T10:00:00.000Z";

let refCounter = 0;

async function aPayment(): Promise<string> {
  const { workingOrderId, deviceId } = await seedWorkingOrder(suite.db, freshNif());
  const paymentRef = `held-${++refCounter}`;
  return withTransaction(suite.db, async (tx) => {
    await insertAttempting(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId,
      provider: "stripe",
      paymentRef,
      amount: decimal("12.10"),
    });
    return (await getPaymentByRef(tx, { provider: "stripe", paymentRef }))!.id;
  });
}

let rowCounter = 0;
function rowId(): string {
  return `11111111-1111-4111-8111-${String(++rowCounter).padStart(12, "0")}`;
}

function insertHold(id: string, paymentId: string, providerAmount = 1210) {
  return withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into payment_holds (id, payment_id, provider_amount, found_at)
                   values (${id}, ${paymentId}, ${providerAmount}, ${FOUND_AT})`),
  );
}

function insertOutcome(
  id: string,
  holdId: string,
  over: { outcome?: string; note?: string | null } = {},
) {
  const outcome = over.outcome ?? "kept";
  const note = over.note === undefined ? "Guest paid twice; kept one" : over.note;
  return withTransaction(suite.db, (tx) =>
    tx.execute(sql`insert into payment_hold_outcomes (id, hold_id, outcome, note, person_id,
                                                      recorded_at)
                   values (${id}, ${holdId}, ${outcome}, ${note}, ${MANAGER}, ${RECORDED_AT})`),
  );
}

async function aHold(): Promise<string> {
  const id = rowId();
  await insertHold(id, await aPayment());
  return id;
}

describe("payment_holds and payment_hold_outcomes", () => {
  it("stores a hold and its outcome and reads them back", async () => {
    const paymentId = await aPayment();
    const hold = rowId();
    await insertHold(hold, paymentId, 2420);
    const outcome = rowId();
    await insertOutcome(outcome, hold, { outcome: "refunded_at_provider", note: null });
    const { rows } = await suite.db.execute(sql`
      select h.payment_id, h.provider_amount, h.found_at, o.hold_id, o.outcome, o.note,
             o.person_id, o.recorded_at
        from payment_holds h join payment_hold_outcomes o on o.hold_id = h.id
       where h.id = ${hold}`);
    expect(rows).toEqual([
      {
        payment_id: paymentId,
        provider_amount: 2420,
        found_at: FOUND_AT,
        hold_id: hold,
        outcome: "refunded_at_provider",
        note: null,
        person_id: MANAGER,
        recorded_at: RECORDED_AT,
      },
    ]);
  });

  it("keeps a note given with an outcome", async () => {
    const hold = await aHold();
    const outcome = rowId();
    await insertOutcome(outcome, hold, { outcome: "kept", note: "Guest paid twice; kept one" });
    const { rows } = await suite.db.execute(
      sql`select outcome, note from payment_hold_outcomes where id = ${outcome}`,
    );
    expect(rows).toEqual([{ outcome: "kept", note: "Guest paid twice; kept one" }]);
  });

  it("refuses a second hold for one payment", async () => {
    const paymentId = await aPayment();
    await insertHold(rowId(), paymentId);
    const error = await captureError(() => insertHold(rowId(), paymentId));
    // SQLite names the columns that collided, not the index.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "payment_holds", columns: ["payment_id"] }),
    ).toBe(true);
  });

  it("refuses a second outcome for one hold", async () => {
    const hold = await aHold();
    await insertOutcome(rowId(), hold);
    const error = await captureError(() => insertOutcome(rowId(), hold));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "payment_hold_outcomes", columns: ["hold_id"] }),
    ).toBe(true);
  });

  it("refuses a provider amount that is not above zero", async () => {
    const paymentId = await aPayment();
    const zero = await captureError(() => insertHold(rowId(), paymentId, 0));
    expect(checkFailed(zero, "payment_holds_provider_amount_ck")).toBe(true);
    const negative = await captureError(() => insertHold(rowId(), paymentId, -1));
    expect(checkFailed(negative, "payment_holds_provider_amount_ck")).toBe(true);
  });

  it("refuses an outcome it does not know", async () => {
    const hold = await aHold();
    const error = await captureError(() => insertOutcome(rowId(), hold, { outcome: "voided" }));
    expect(checkFailed(error, "payment_hold_outcomes_outcome_ck")).toBe(true);
  });

  it("refuses a blank note", async () => {
    const hold = await aHold();
    const empty = await captureError(() => insertOutcome(rowId(), hold, { note: "" }));
    expect(checkFailed(empty, "payment_hold_outcomes_note_ck")).toBe(true);
    const spaces = await captureError(() => insertOutcome(rowId(), hold, { note: "   " }));
    expect(checkFailed(spaces, "payment_hold_outcomes_note_ck")).toBe(true);
  });

  it("refuses a hold naming no payment and an outcome naming no hold", async () => {
    const hold = await captureError(() => insertHold(rowId(), NO_ROW));
    expect(isRefusal(hold, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(String((hold as Error).message)).toContain("FOREIGN KEY constraint failed");
    const outcome = await captureError(() => insertOutcome(rowId(), NO_ROW));
    expect(isRefusal(outcome, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(String((outcome as Error).message)).toContain("FOREIGN KEY constraint failed");
  });

  it("is append-only: updates and deletes of either table are refused", async () => {
    const hold = await aHold();
    const outcome = rowId();
    await insertOutcome(outcome, hold);
    const updateHold = await captureError(() =>
      suite.db.execute(sql`update payment_holds set provider_amount = 1 where id = ${hold}`),
    );
    expect(triggerRaised(updateHold, "payment_holds is append-only")).toBe(true);
    const deleteHold = await captureError(() =>
      suite.db.execute(sql`delete from payment_holds where id = ${hold}`),
    );
    expect(triggerRaised(deleteHold, "payment_holds is append-only")).toBe(true);
    const updateOutcome = await captureError(() =>
      suite.db.execute(sql`update payment_hold_outcomes set note = 'x' where id = ${outcome}`),
    );
    expect(triggerRaised(updateOutcome, "payment_hold_outcomes is append-only")).toBe(true);
    const deleteOutcome = await captureError(() =>
      suite.db.execute(sql`delete from payment_hold_outcomes where id = ${outcome}`),
    );
    expect(triggerRaised(deleteOutcome, "payment_hold_outcomes is append-only")).toBe(true);
  });
});
