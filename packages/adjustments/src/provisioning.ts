import type { PersonRoleValue } from "@waitron/identity";
import type { ModuleProvisioning } from "@waitron/module";
import { createAdjustmentReason, listAdjustmentReasons } from "./operations.js";
import type { AdjustmentReasonInput } from "./operations.js";

const EVERY: PersonRoleValue[] = ["staff", "supervisor", "manager", "admin"];
const SUPERVISOR_UP: PersonRoleValue[] = ["supervisor", "manager", "admin"];
const MANAGER_UP: PersonRoleValue[] = ["manager", "admin"];

type Starter = Omit<AdjustmentReasonInput, "name" | "names"> & {
  names: { en: string };
};

function voidReason(en: string, noteRequired = false): Starter {
  return {
    names: { en },
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
    names: { en },
    kind: "comp",
    actions,
    maxPercentBp,
    maxAmount: null,
    applyRoles: [...applyRoles],
    approverRoles: [...approverRoles],
    noteRequired: false,
  };
}

/** Design §4. "Other" asks for a note: a venue always keeps a switched-on Void reason that does
 * (D27). */
const STARTERS: readonly Starter[] = [
  voidReason("Entry error"),
  voidReason("Item not available"),
  voidReason("Customer changed mind"),
  voidReason("Not served"),
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
    async run(tx) {
      if ((await listAdjustmentReasons(tx, { includeInactive: true })).length > 0) {
        return "reasons already present";
      }
      for (const starter of STARTERS) {
        await createAdjustmentReason(tx, {
          ...starter,
          name: starter.names.en,
          names: { ...starter.names },
        });
      }
      return "default cancel reason ready";
    },
  },
};
