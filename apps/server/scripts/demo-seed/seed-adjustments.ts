// The owner's example reasons from the service design (§7). They are examples, not a required list,
// so they belong to the demo venue.

import type { Transaction } from "@waitron/db";
import {
  createAdjustmentReason,
  listAdjustmentReasons,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import { decimal } from "@waitron/shared";
import type { SeedLocale } from "./menu.js";
import type { DemoDataSet } from "./data-set.js";
import { inLanguages } from "./in-languages.js";

export type SeedReason = Omit<AdjustmentReasonInput, "name" | "names"> & {
  names: Record<SeedLocale, string>;
};

// Cancelling what was entered in error or is no longer wanted is routine, so staff do it alone;
// every reduction carries a per-bill euro cap.
export const DEMO_ADJUSTMENT_REASONS: readonly SeedReason[] = [
  {
    names: { en: "Entry error", es: "Error al marcar" },
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "supervisor",
    noteRequired: false,
  },
  {
    names: { en: "Changed mind", es: "Cambio de opinión" },
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "supervisor",
    noteRequired: false,
  },
  {
    names: { en: "Unavailable item", es: "Producto no disponible" },
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    applyRole: "staff",
    approverRole: "supervisor",
    noteRequired: false,
  },
  {
    names: { en: "Complaint", es: "Queja" },
    actions: ["comp", "discount_percent"],
    maxPercentBp: 5000,
    maxAmount: decimal("30.00"),
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: true,
  },
  {
    names: { en: "Friends and family", es: "Amigos y familia" },
    actions: ["discount_percent"],
    maxPercentBp: 2000,
    maxAmount: decimal("50.00"),
    applyRole: "manager",
    approverRole: "manager",
    noteRequired: true,
  },
  {
    names: { en: "Employee discount", es: "Descuento de empleado" },
    actions: ["discount_percent"],
    maxPercentBp: 3000,
    maxAmount: decimal("20.00"),
    applyRole: "supervisor",
    approverRole: "manager",
    noteRequired: false,
  },
  {
    names: { en: "Manager special", es: "Invitación del encargado" },
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: 10000,
    maxAmount: decimal("100.00"),
    applyRole: "manager",
    approverRole: "admin",
    noteRequired: true,
  },
];

export interface SeedAdjustmentReasonsInput {
  locale: SeedLocale;
  dataSet: DemoDataSet;
  /** The venue's content languages; each reason's names are cut to them. */
  languages: readonly string[];
}

/** Creates each example reason not already present under its name in the seed's language. */
export async function seedAdjustmentReasons(
  tx: Transaction,
  { locale, dataSet, languages }: SeedAdjustmentReasonsInput,
): Promise<void> {
  const present = new Set(
    (await listAdjustmentReasons(tx, { includeInactive: true })).map((reason) => reason.name),
  );
  for (const reason of dataSet.adjustmentReasons) {
    const name = reason.names[locale];
    if (present.has(name)) continue;
    await createAdjustmentReason(tx, {
      ...reason,
      names: inLanguages(reason.names, languages),
      name,
    });
  }
}
