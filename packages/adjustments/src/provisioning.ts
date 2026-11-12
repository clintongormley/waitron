import {
  resolveInstalledStarterLanguages,
  starterName,
  starterNames,
} from "@waitron/country-packs";
import { decimal } from "@waitron/shared";
import { readTenant, readVenue } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { createAdjustmentReason, listAdjustmentReasons } from "./operations.js";
import type { AdjustmentReasonInput } from "./operations.js";
import { STARTER_REASON_NAMES } from "./starter-content.js";

type Starter = Omit<AdjustmentReasonInput, "name" | "names"> & {
  english: string;
};

function voidReason(en: string, noteRequired = false): Starter {
  return {
    english: en,
    kind: "void",
    actions: ["cancel"],
    maxPercentBp: null,
    maxAmount: null,
    noteRequired,
  };
}

function compReason(
  en: string,
  { actions, maxPercentBp, maxAmount }: Pick<Starter, "actions" | "maxPercentBp" | "maxAmount"> = {
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
    maxAmount: decimal("0.00"),
  },
): Starter {
  return {
    english: en,
    kind: "comp",
    actions,
    maxPercentBp,
    maxAmount,
    noteRequired: false,
  };
}

/** The starter Void reason Finish table's reason starts on, matched by its English name. */
export const NOT_SERVED_REASON = "Not served";

/** Design §4. "Other" asks for a note: a venue always keeps a Void reason that does
 * (D27). */
const STARTERS: readonly Starter[] = [
  voidReason("Entry error"),
  voidReason("Item not available"),
  voidReason("Customer changed mind"),
  voidReason(NOT_SERVED_REASON),
  voidReason("Other", true),
  compReason("Complaint"),
  compReason("On the house"),
  compReason("Staff meal", {
    actions: ["discount_percent", "discount_amount"],
    maxPercentBp: 5000,
    maxAmount: null,
  }),
  compReason("Discount"),
];

export const ADJUSTMENTS_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the starter void and comp reasons",
    async run(tx, _node, _operation, options) {
      if ((await listAdjustmentReasons(tx)).length > 0) {
        return "reasons already present";
      }
      const tenant = await readTenant(tx);
      const venue = await readVenue(tx);
      const { languages, staffLanguage } = resolveInstalledStarterLanguages({
        country: tenant?.country,
        area: venue.province,
        receiptLocale: venue.invoiceLocales[0],
        staffLanguage: options?.staffLanguage,
      });
      for (const { english, ...starter } of STARTERS) {
        await createAdjustmentReason(tx, {
          ...starter,
          name: starterName(STARTER_REASON_NAMES, english, staffLanguage),
          names: starterNames(STARTER_REASON_NAMES, english, languages),
        });
      }
      return "default cancel reason ready";
    },
  },
};
