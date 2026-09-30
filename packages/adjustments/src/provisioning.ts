import { eq } from "drizzle-orm";
import { locations } from "@waitron/db";
import type { ModuleProvisioning } from "@waitron/module";
import { createAdjustmentReason, listAdjustmentReasons } from "./operations.js";

const NAMES = { en: "Entry error", es: "Error al marcar" } as const;

/** Since the till's Cancel asks for a reason, a venue with none could cancel nothing. */
export const ADJUSTMENTS_PROVISIONING: ModuleProvisioning = {
  seed: {
    summary: "Create a cancel reason staff can use without approval",
    async run(tx, node) {
      if ((await listAdjustmentReasons(tx, { includeInactive: true })).length > 0) {
        return "reasons already present";
      }
      const [location] = await tx
        .select({ invoiceLocales: locations.invoiceLocales })
        .from(locations)
        .where(eq(locations.id, node.locationId));
      const spanish = location?.invoiceLocales[0]?.toLowerCase().startsWith("es") === true;
      await createAdjustmentReason(tx, {
        name: spanish ? NAMES.es : NAMES.en,
        names: { ...NAMES },
        actions: ["cancel"],
        maxPercentBp: null,
        maxAmount: null,
        applyRole: "staff",
        approverRole: "supervisor",
        noteRequired: false,
      });
      return "default cancel reason ready";
    },
  },
};
