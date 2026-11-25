import { css, html } from "lit";
import type { ProductItemsRoutingPreview, RoutingMove } from "../routing-types.js";
import type { RouteTarget } from "../routing.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export const routingPreviewStyles = css`
  .routing-preview-table {
    overflow: auto;
    max-width: 100%;
  }
  .routing-preview-table table {
    width: 100%;
    border-collapse: collapse;
  }
  .routing-preview-table th,
  .routing-preview-table td {
    text-align: start;
    vertical-align: top;
    padding: var(--wt-space-2);
    border-bottom: 1px solid var(--wt-color-border);
  }
`;

export function previewPeriodNames(
  periods: ProductItemsRoutingPreview["periods"],
  ids: readonly string[],
): string {
  const selected = new Set(ids);
  const during = periods.filter((period) => selected.has(period.id));
  const names = during.map((period) => period.name);
  return during
    .map((period) =>
      names.indexOf(period.name) === names.lastIndexOf(period.name)
        ? period.name
        : format("routing.period_in_department", {
            period: period.name,
            department: period.departmentName,
          }),
    )
    .join(", ");
}

export function previewFrom(
  move: RoutingMove,
  targetName: (target: RouteTarget) => string,
): string {
  return move.from ? targetName(move.from) : t("prep.no_station");
}
export function previewTo(move: RoutingMove, targetName: (target: RouteTarget) => string): string {
  return move.to
    ? targetName(move.to)
    : t(move.toNoReplacement ? "prep.no_replacement" : "prep.no_station");
}
function moveName(move: RoutingMove, periods: ProductItemsRoutingPreview["periods"]): string {
  const name = move.dish
    ? format("prep.preview_extra", { extra: move.productName, dish: move.dish.productName })
    : move.variantOf
      ? format("prep.preview_variant", {
          product: move.variantOf.productName,
          variant: move.productName,
        })
      : move.productName;
  return move.periodIds === null || move.periodIds === undefined
    ? name
    : format("prep.preview_during", {
        move: name,
        periods: previewPeriodNames(periods, move.periodIds),
      });
}

export function routingPreviewTable(preview: ProductItemsRoutingPreview) {
  if (preview.moves.length === 0) return html`<p>${t("prep.preview_none")}</p>`;
  const targetName = (target: RouteTarget) =>
    target.kind === "no_preparation"
      ? t("prep.no_preparation")
      : (preview.stations.find(({ id }) => id === target.stationId)?.name ?? target.stationId);
  return html`<div
    class="routing-preview-table"
    data-test="routing-preview-table"
    tabindex="0"
    role="region"
    aria-label=${t("prep.preview_title")}
  >
    <table>
      <thead>
        <tr>
          <th scope="col">${t("prep.preview_product")}</th>
          <th scope="col">${t("prep.service_zone")}</th>
          <th scope="col">${t("prep.preview_from")}</th>
          <th scope="col">${t("prep.preview_to")}</th>
        </tr>
      </thead>
      <tbody>
        ${[...preview.moves]
          .sort((a, b) =>
            (a.variantOf?.productName ?? a.productName).localeCompare(
              b.variantOf?.productName ?? b.productName,
            ),
          )
          .map(
            (move) =>
              html`<tr>
                <td>${moveName(move, preview.periods)}</td>
                <td>${move.zoneName ?? t("routing.every_zone")}</td>
                <td>${previewFrom(move, targetName)}</td>
                <td>${previewTo(move, targetName)}</td>
              </tr>`,
          )}
      </tbody>
    </table>
  </div>`;
}
