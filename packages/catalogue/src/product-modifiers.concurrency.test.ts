import { beforeEach, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCatalogue, createProduct } from "./operations.js";
import { createExtraList, deleteExtraList } from "./extras.js";
import { createOptionList, deleteOptionList } from "./options.js";
import { readProductModifiers, writeProductModifiers } from "./product-modifiers.js";
import type { ProductModifierRef } from "./product-types.js";
import { racePair } from "../test/fixtures.js";

/**
 * A save of a product's attachment list, started together with a DELETE of one of the lists it
 * names.
 *
 * On PostgreSQL this needed THREE transactions — a blocker holding one attachment row `for update`
 * so the save parked at a chosen point, then the save, then the delete — and it existed because
 * the two could deadlock: before `assertRefsExist` took the referenced list rows' locks, both
 * kinds reported `40P01 deadlock detected` for one of the two transactions. The save held the
 * target's ATTACHMENT row and wanted the LIST row for its insert's foreign key, while the delete
 * held the LIST row and wanted that same attachment row for its cascade.
 *
 * One write transaction runs on the venue file at a time, so none of that choreography can be
 * staged and the deadlock is not a shape the engine can produce. What the two cases below still
 * assert is what they always asserted about the OUTCOME: both transactions complete, neither is
 * refused, and the dish is left carrying nothing. `racePair` (`test/fixtures.ts`) carries the
 * measurement that they do not interleave.
 *
 * ONE CASE WENT. "lets two products attach the same list at once, without either waiting for the
 * other" existed to prove `lockList`'s lock was SHARED (`for key share`, not `for update`), and
 * its negative control was changing that one word and watching the second save hang. There is no
 * lock, and two saves of any kind now DO wait for each other — so the property it asserted is
 * false here by design, not merely unmeasurable. Its outcome half, that two products can each
 * carry the same list, is `product-modifiers.test.ts`'s "lets two different products each carry
 * the same list".
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/**
 * The domain code a transaction was refused with — or, when the failure came from the database
 * rather than from the code, the error itself. Drizzle wraps a driver error in a `Failed query:`
 * error that carries no `code` of its own and keeps the original on `cause`.
 */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The dish whose attachment list is saved, and the topping the lists offer. */
let dish = "";
let topping = "";

// `useVenueDb` empties every data table after each test, so the products are re-made per test.
beforeEach(async () => {
  await withTransaction(suite.db, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: "Deli" });
    const make = async (name: string, unitPrice: string) =>
      (
        await createProduct(tx, {
          catalogueId: catalogue.id,
          categoryId: null,
          name,
          unitId: null,
          unitPrice,
          vatClass: "reduced",
        })
      ).id;
    dish = await make("sandwich", "7.00");
    topping = await make("sourdough", "2.50");
  });
});

/**
 * Two lists of one kind, and the delete that removes one of them. An ACTIVE extras list must offer
 * at least one product and an active options list at least one label (`parseExtraListInput`,
 * `parseOptionListInput`), so each list is created with one.
 */
async function makeLists(kind: ProductModifierRef["kind"]): Promise<{
  target: string;
  other: string;
  remove: (tx: Transaction, id: string) => Promise<void>;
}> {
  if (kind === "extras") {
    const lists = await withTransaction(suite.db, async (tx) => {
      // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
      const target = await createExtraList(
        tx,
        { name: "Bread", items: [{ productId: topping }] },
        "en",
      );
      const other = await createExtraList(
        tx,
        { name: "Sides", items: [{ productId: topping }] },
        "en",
      );
      return { target: target.id, other: other.id };
    });
    return { ...lists, remove: deleteExtraList };
  }
  const lists = await withTransaction(suite.db, async (tx) => {
    const target = await createOptionList(
      tx,
      { name: "Doneness", labels: [{ name: "rare" }] },
      "en",
    );
    const other = await createOptionList(tx, { name: "Dressing", labels: [{ name: "oil" }] }, "en");
    return { target: target.id, other: other.id };
  });
  return { ...lists, remove: deleteOptionList };
}

it.each(["extras", "options"] as const)(
  "saves a product's %s attachment list while one of its lists is being deleted",
  async (kind) => {
    const { target, other, remove } = await makeLists(kind);
    await withTransaction(suite.db, (tx) =>
      writeProductModifiers(tx, dish, [
        { kind, id: target },
        { kind, id: other },
      ]),
    );

    const settled = await racePair(
      suite.db,
      // Nothing else in this transaction: the save under test is the whole of it, exactly as a
      // route handler runs it.
      (tx) => writeProductModifiers(tx, dish, [{ kind, id: target }]),
      (tx) => remove(tx, target),
    );
    expect(
      settled.map((outcome) =>
        outcome.status === "rejected" ? refusalCode(outcome.reason) : "done",
      ),
    ).toEqual(["done", "done"]);

    // The save commits first, and the delete then takes the row the save just wrote with it,
    // through `product_modifiers`' cascade on the list key. The other list's attachment row is
    // gone because the save's body did not name it.
    const after = await withTransaction(suite.db, (tx) => readProductModifiers(tx, [dish]));
    expect(after).toEqual(new Map());
  },
);
