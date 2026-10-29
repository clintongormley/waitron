import { html, nothing } from "lit";
import type { TemplateResult } from "lit";
import type { QueueCrossRef } from "../api/client.js";
import { t } from "../i18n/t.js";
import { extraNutrition } from "./diet-badges.js";

/** An extra's count per dish as the kitchen reads it, " x2", or nothing for one. */
export function extraCount(extra: { perDish?: number }): string {
  return extra.perDish !== undefined && extra.perDish > 1 ? ` x${extra.perDish}` : "";
}

export function queueCrossRefs(
  item: { id: string; crossRefs?: QueueCrossRef[] },
  surface: "line" | "item",
): TemplateResult | typeof nothing {
  if (!item.crossRefs?.length) return nothing;
  return html`<span class=${`${surface}-crossrefs`}
    >${item.crossRefs.map((ref, i) => {
      const name = `${ref.name}${extraCount(ref)}`;
      const key =
        ref.kind === "with"
          ? "station.crossref_with"
          : ref.stationName === null
            ? "station.crossref_for_no_prep"
            : "station.crossref_for";
      const wording = t(key)
        .replace("{name}", name)
        .replace("{station}", ref.stationName ?? "");
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
