import { expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createOptionList, getOptionList, updateOptionList } from "./options.js";
import { racePair } from "../test/fixtures.js";

/**
 * Two saves of different options lists, each claiming a label of the other, started together. The
 * last assertion reads both lists back unchanged, which a `writeLabels` that deleted before checking
 * which list a label belongs to would fail.
 */
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });

/** The domain code a save was refused with — or, when the failure has none, the error itself. */
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

it("refuses both of two saves that each claim the other list's label", async () => {
  const lists = await withTransaction(suite.db, async (tx) => {
    // Awaited in turn, never Promise.all: they share one transaction (CLAUDE.md §3).
    const doneness = await createOptionList(tx, cooked, "en");
    const heat = await createOptionList(tx, spice, "en");
    return { doneness, heat };
  });

  const claim =
    (mine: { id: string; name: string }, theirLabelId: string) =>
    (tx: Parameters<typeof getOptionList>[0]) =>
      updateOptionList(
        tx,
        mine.id,
        { name: mine.name, labels: [{ id: theirLabelId, name: "Stolen" }] },
        "en",
      );

  const settled = await racePair(
    suite.db,
    claim(lists.doneness, lists.heat.labels[0]!.id),
    claim(lists.heat, lists.doneness.labels[0]!.id),
  );

  // Both saves are refused, and neither caller gets a database failure instead.
  expect(
    settled.map((outcome) =>
      outcome.status === "rejected" ? refusalCode(outcome.reason) : "no refusal at all",
    ),
  ).toEqual(["options.invalid", "options.invalid"]);
  for (const outcome of settled)
    if (outcome.status === "rejected")
      expect(outcome.reason).toMatchObject({ params: { field: "labels.0.id" } });

  const after = await withTransaction(suite.db, async (tx) => {
    const doneness = await getOptionList(tx, lists.doneness.id);
    const heat = await getOptionList(tx, lists.heat.id);
    return { doneness, heat };
  });
  expect(after).toEqual(lists);
});
