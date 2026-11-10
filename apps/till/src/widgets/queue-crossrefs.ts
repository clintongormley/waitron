import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import { formatDecimalInput } from "@waitron/ui";
import type { QueueCrossRef } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { extraNutrition } from "./diet-badges.js";
import { snapshotDescriptionFor } from "./dish-format.js";

/** An extra's amount per dish with the kitchen ticket's digits in the screen's decimal mark:
 *  " 150 g", " 0.250 kg" (" 0,250 kg" in Spanish), " x2", or nothing for one. */
export function extraAmount(extra: {
  perDish?: number;
  amount?: string;
  unitName?: Record<string, string>;
}): string {
  if (extra.amount !== undefined && extra.unitName !== undefined)
    return ` ${formatDecimalInput(extra.amount.replace(/\.0+$/, ""), currentLocale())} ${snapshotDescriptionFor(extra.unitName, "")}`;
  return extra.perDish !== undefined && extra.perDish > 1 ? ` x${extra.perDish}` : "";
}

export function queueCrossRefs(
  item: { id: string; crossRefs?: QueueCrossRef[] },
  surface: "line" | "item",
): TemplateResult | typeof nothing {
  if (!item.crossRefs?.length) return nothing;
  return html`<span class=${`${surface}-crossrefs`}
    >${item.crossRefs.map((ref, i) => {
      const name = `${ref.name}${extraAmount(ref)}`;
      const key =
        ref.kind === "with"
          ? "station.crossref_with"
          : ref.stationName === null
            ? "station.crossref_for_no_prep"
            : "station.crossref_for";
      const wording = fill(t(key), { name, station: ref.stationName ?? "" });
      return html`<span class="crossref" data-crossref
        >${wording}${
          ref.kind === "with"
            ? extraNutrition(
                ref,
                `${surface}-crossref-allergens-${item.id}-${i}`,
                `${surface}-crossref-diet-${item.id}-${i}`,
              )
            : nothing
        }</span
      >`;
    })}</span
  >`;
}
