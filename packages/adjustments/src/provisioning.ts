import { eq } from "drizzle-orm";
import {
  resolveInstalledStarterLanguages,
  starterName,
  starterNames,
} from "@waitron/country-packs";
import { locations, tenants } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";
import type { ModuleProvisioning } from "@waitron/module";
import { createAdjustmentReason, listAdjustmentReasons } from "./operations.js";
import type { AdjustmentReasonInput } from "./operations.js";
import { STARTER_REASON_NAMES } from "./starter-content.js";

const EVERY: PersonRoleValue[] = ["staff", "supervisor", "manager", "admin"];
const SUPERVISOR_UP: PersonRoleValue[] = ["supervisor", "manager", "admin"];
const MANAGER_UP: PersonRoleValue[] = ["manager", "admin"];

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
    applyRoles: [],
    approverRoles: [],
    noteRequired,
  };
}

function compReason(
  en: string,
  applyRoles: PersonRoleValue[],
  approverRoles: PersonRoleValue[],
  { actions, maxPercentBp }: Pick<Starter, "actions" | "maxPercentBp"> = {
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
  },
): Starter {
  return {
    english: en,
    kind: "comp",
    actions,
    maxPercentBp,
    maxAmount: null,
    applyRoles: [...applyRoles],
    approverRoles: [...approverRoles],
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
  compReason("Complaint", SUPERVISOR_UP, SUPERVISOR_UP),
  compReason("On the house", MANAGER_UP, MANAGER_UP),
  compReason("Staff meal", EVERY, MANAGER_UP, {
    actions: ["discount_percent", "discount_amount"],
    maxPercentBp: 5000,
  }),
  compReason("Discount", MANAGER_UP, MANAGER_UP),
];

export const ADJUSTMENTS_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the starter void and comp reasons",
    async run(tx, node) {
      if ((await listAdjustmentReasons(tx)).length > 0) {
        return "reasons already present";
      }
      const [venue] = await tx
        .select({
          country: tenants.country,
          area: locations.province,
          invoiceLocales: locations.invoiceLocales,
        })
        .from(locations)
        .innerJoin(tenants, eq(tenants.id, 1))
        .where(eq(locations.id, node.locationId));
      const { languages, staffLanguage } = resolveInstalledStarterLanguages({
        country: venue?.country,
        area: venue?.area,
        receiptLocale: venue?.invoiceLocales[0] ?? null,
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
