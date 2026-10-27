// The owner's example reasons from the service design (§7). They are examples, not a required list,
// so they belong to the demo venue.

import type { Transaction } from "@waitron/db";
import {
  createAdjustmentReason,
  listAdjustmentReasons,
  updateAdjustmentReason,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import type { SeedLocale } from "./locale.js";
import type { DemoDataSet, DemoText } from "./data-set.js";
import { inLanguages } from "./in-languages.js";

export type SeedReason<L extends string = string> = Omit<
  AdjustmentReasonInput,
  "name" | "names"
> & {
  names: DemoText<L>;
};

export interface SeedAdjustmentReasonsInput {
  locale: SeedLocale;
  dataSet: DemoDataSet;
  /** The venue's content languages; each reason's names are cut to them. */
  languages: readonly string[];
}

/** Creates each example reason not already present. One that matches a reason already present by
 * English name, or by the name it would be stored under, renames that reason into the seed's
 * languages and keeps its rules, because a starter reason's rules win over the demo's. A seed whose
 * languages leave out English stores no English name, so a repeat run finds its own rows by name. */
export async function seedAdjustmentReasons(
  tx: Transaction,
  { locale, dataSet, languages }: SeedAdjustmentReasonsInput,
): Promise<void> {
  const existing = await listAdjustmentReasons(tx);
  const byEnglish = new Map(existing.map((reason) => [reason.names.en ?? reason.name, reason]));
  const byName = new Map(existing.map((reason) => [reason.name, reason]));
  for (const reason of dataSet.adjustmentReasons) {
    const names = inLanguages(reason.names, languages);
    const name = reason.names[locale];
    const present = byEnglish.get(reason.names.en) ?? byName.get(name);
    if (present === undefined) {
      await createAdjustmentReason(tx, { ...reason, names, name });
      continue;
    }
    await updateAdjustmentReason(tx, present.id, {
      name,
      names,
      kind: present.kind,
      actions: present.actions,
      maxPercentBp: present.maxPercentBp,
      maxAmount: present.maxAmount,
      applyRoles: present.applyRoles,
      approverRoles: present.approverRoles,
      noteRequired: present.noteRequired,
    });
  }
}
