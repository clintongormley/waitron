import type { Transaction } from "@waitron/db";
import type { KitchenAllergyBlock, VenueServiceContribution } from "@waitron/module";
import type { recordKitchenNotices } from "../src/kitchen-notices.js";
import type { KitchenNoticeItem } from "../src/kitchen-notices.js";

declare const tx: Transaction;
declare const items: readonly KitchenNoticeItem[];
declare const record: typeof recordKitchenNotices;
declare const seat: VenueServiceContribution["recordKitchenNotices"];
declare const block: KitchenAllergyBlock;

export function refusesPositionalOptions(): void {
  void record(
    tx,
    "order",
    items,
    "changed",
    null,
    // @ts-expect-error The optional values are named, so a swapped pair cannot pass by position.
    null,
    "Queso",
  );
  void record(
    tx,
    "order",
    items,
    "rerouted",
    null,
    // @ts-expect-error The optional values are named, so a swapped pair cannot pass by position.
    null,
    null,
    "Grill",
  );
  void seat(
    tx,
    "order",
    items,
    "changed",
    null,
    // @ts-expect-error The optional values are named, so a swapped pair cannot pass by position.
    null,
    "Queso",
  );
  void seat(
    tx,
    "order",
    items,
    "rerouted",
    null,
    // @ts-expect-error The optional values are named, so a swapped pair cannot pass by position.
    null,
    null,
    "Grill",
  );
}

export function acceptsNamedOptions(): void {
  void record(tx, "order", items, "allergy_changed", { allergyBlock: block });
  void seat(tx, "order", items, "allergy_changed", { allergyBlock: block });
  void record(tx, "order", items, "allergy_removed", { allergyBlock: null });
  void seat(tx, "order", items, "allergy_removed", { allergyBlock: null });
  void record(tx, "order", items, "changed", {
    orderNoteChange: { before: null, after: "Together" },
  });
  void seat(tx, "order", items, "changed", {
    orderNoteChange: { before: "Together", after: null },
  });
  void record(tx, "order", items, "changed", { cancelledExtra: "Queso" });
  void seat(tx, "order", items, "rerouted", { reroutedTo: "Grill" });
}
