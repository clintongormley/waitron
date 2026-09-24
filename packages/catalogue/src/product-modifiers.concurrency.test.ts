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
 * names: both transactions complete, neither is refused, and the dish is left carrying nothing.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/** The domain code a transaction was refused with, else its cause's code, else the error itself. */
function refusalCode(reason: unknown): unknown {
  const error = reason as { code?: unknown; cause?: { code?: unknown } };
  return error.code ?? error.cause?.code ?? reason;
}

/** The dish whose attachment list is saved, and the topping the lists offer. */
let dish = "";
let topping = "";

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
