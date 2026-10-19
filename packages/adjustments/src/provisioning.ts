import { eq } from "drizzle-orm";
import { locations } from "@waitron/db";
import type { PersonRoleValue } from "@waitron/identity";
import type { ModuleProvisioning } from "@waitron/module";
import { createAdjustmentReason, listAdjustmentReasons } from "./operations.js";
import type { AdjustmentReasonInput } from "./operations.js";

const EVERY: PersonRoleValue[] = ["staff", "supervisor", "manager", "admin"];
const SUPERVISOR_UP: PersonRoleValue[] = ["supervisor", "manager", "admin"];
const MANAGER_UP: PersonRoleValue[] = ["manager", "admin"];

type Starter = Omit<AdjustmentReasonInput, "name" | "names"> & {
  names: { en: string; es: string };
};

function voidReason(en: string, es: string, noteRequired = false): Starter {
  return {
    names: { en, es },
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
  es: string,
  applyRoles: PersonRoleValue[],
  approverRoles: PersonRoleValue[],
  { actions, maxPercentBp }: Pick<Starter, "actions" | "maxPercentBp"> = {
    actions: ["comp", "discount_percent", "discount_amount"],
    maxPercentBp: null,
  },
): Starter {
  return {
    names: { en, es },
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
  voidReason("Entry error", "Error al marcar"),
  voidReason("Item not available", "Producto agotado"),
  voidReason("Customer changed mind", "Cambio del cliente"),
  voidReason("Not served", "No servido"),
  voidReason("Other", "Otro motivo", true),
  compReason("Complaint", "Queja del cliente", SUPERVISOR_UP, SUPERVISOR_UP),
  compReason("On the house", "Invitación", MANAGER_UP, MANAGER_UP),
  compReason("Staff meal", "Comida de personal", EVERY, MANAGER_UP, {
    actions: ["discount_percent", "discount_amount"],
    maxPercentBp: 5000,
  }),
  compReason("Discount", "Descuento", MANAGER_UP, MANAGER_UP),
];

export const ADJUSTMENTS_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create the starter void and comp reasons",
    async run(tx, node) {
      if ((await listAdjustmentReasons(tx, { includeInactive: true })).length > 0) {
        return "reasons already present";
      }
      const [location] = await tx
        .select({ invoiceLocales: locations.invoiceLocales })
        .from(locations)
        .where(eq(locations.id, node.locationId));
      const spanish = location?.invoiceLocales[0]?.toLowerCase().startsWith("es") === true;
      for (const starter of STARTERS) {
        await createAdjustmentReason(tx, {
          ...starter,
          name: spanish ? starter.names.es : starter.names.en,
          names: { ...starter.names },
        });
      }
      return "default cancel reason ready";
    },
  },
};
