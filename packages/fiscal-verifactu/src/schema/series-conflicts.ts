import { uniqueIndex } from "drizzle-orm/sqlite-core";
import { id, invoiceSeries, json, label, newId, table, ts } from "@waitron/db";
import type { LookupConflictEvidence } from "../conflict-types.js";
import { registroSif } from "./sif.js";

export const fiscalSeriesConflicts = table(
  "fiscal_series_conflicts",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    sifId: id("sif_id")
      .notNull()
      .references(() => registroSif.id),
    seriesId: id("series_id")
      .notNull()
      .references(() => invoiceSeries.id),
    invoiceIdentity: label("invoice_identity").notNull(),
    evidence: json<LookupConflictEvidence>("evidence").notNull(),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [uniqueIndex("fiscal_series_conflicts_invoice_uq").on(t.sifId, t.invoiceIdentity)],
);
