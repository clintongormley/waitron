import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createOptionList, getOptionList, updateOptionList } from "./options.js";

// Two saves have to be in flight at once for this to mean anything, and PGlite serialises every
// query onto its single backend, so the same suite there is a false pass (CLAUDE.md §4).
const suite = useTemplateDb({ template: "core" });

function app<T>(db: Database, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** A promise plus the function that settles it — the two barriers below are built from these. */
function latch(): { waited: Promise<void>; open: () => void } {
  let open!: () => void;
  const waited = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { waited, open };
}

/**
 * The domain code a save was refused with — or, when the failure came from the database rather than
 * from the code, that failure's SQLSTATE. drizzle wraps a driver error in a `Failed query:` error
 * that carries no `code` of its own and keeps the original on `cause`, so reading `code` alone
 * reports `undefined` for exactly the failure this test exists to catch.
 */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The three names carry three DIFFERENT texts, so a read of the wrong column cannot pass. */
const cooked = {
  name: "Cooked",
  customerName: { en: "How would you like it cooked?" },
  kitchenName: "COOK",
  labels: [{ name: "Rare", customerName: { en: "Barely cooked" }, kitchenName: "RA" }],
};
const spice = {
  name: "Spice",
  customerName: { en: "How hot would you like it?" },
  kitchenName: "HEAT",
  labels: [{ name: "Mild", customerName: { en: "Gently spiced" }, kitchenName: "MI" }],
};

it("refuses both of two saves that each claim the other list's label, without deadlocking", async () => {
  const lists = await app(suite.admin, async (tx) => {
    // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
    const doneness = await createOptionList(tx, cooked, "en");
    const heat = await createOptionList(tx, spice, "en");
    return { doneness, heat };
  });

  const [left, right] = await Promise.all([suite.pg.connect(), suite.pg.connect()]);
  const arrived = [latch(), latch()];
  const go = latch();
  // A save that names a label of another list. No customer-facing name on the body, so
  // `validateNames` reads nothing and the race is over the label tables alone.
  const claim = (
    db: Database,
    mine: { id: string; name: string },
    theirLabelId: string,
    ready: () => void,
  ) =>
    app(db, async (tx) => {
      // Both transactions are open and both have taken a statement's round trip before either
      // starts saving. That is what makes the two saves overlap rather than run in sequence: the
      // delete-first version this guards against took its row locks inside `updateOptionList`, and
      // with the saves in sequence the second one never reaches an uncommitted delete to wait on.
      await tx.execute(sql`select 1`);
      ready();
      await go.waited;
      return updateOptionList(
        tx,
        mine.id,
        { name: mine.name, labels: [{ id: theirLabelId, name: "Stolen" }] },
        "en",
      );
    });

  let attempts: Promise<unknown>[] = [];
  try {
    attempts = [
      claim(left, lists.doneness, lists.heat.labels[0]!.id, arrived[0]!.open),
      claim(right, lists.heat, lists.doneness.labels[0]!.id, arrived[1]!.open),
    ];
    // Racing the attempts so a save that throws before reaching its barrier surfaces its own error
    // rather than hanging the test on a latch nothing will open.
    await Promise.race([Promise.all([arrived[0]!.waited, arrived[1]!.waited]), ...attempts]);
    go.open();
    const settled = await Promise.allSettled(attempts);

    // Both saves are refused, and neither caller gets a database failure instead. Run against a
    // copy of options.ts whose `writeLabels` deletes before it checks ownership, this line read
    // `40P01 deadlock detected` for one of the two saves in every one of five runs (which of the two
    // varied); against the code as it stands it passed five runs out of five.
    expect(
      settled.map((outcome) =>
        outcome.status === "rejected" ? refusalCode(outcome.reason) : "no refusal at all",
      ),
    ).toEqual(["options.invalid", "options.invalid"]);
    for (const outcome of settled)
      if (outcome.status === "rejected")
        expect(outcome.reason).toMatchObject({ params: { field: "labels.0.id" } });

    const after = await app(suite.admin, async (tx) => {
      const doneness = await getOptionList(tx, lists.doneness.id);
      const heat = await getOptionList(tx, lists.heat.id);
      return { doneness, heat };
    });
    expect(after).toEqual(lists);
  } finally {
    go.open();
    await Promise.allSettled(attempts);
    await Promise.all([left.close(), right.close()]);
  }
});
