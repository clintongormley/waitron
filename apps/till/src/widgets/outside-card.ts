import { css, html, nothing } from "lit";
import type { OutsideCardDetails } from "../api/client.js";
import { t } from "../i18n/t.js";

export const outsideCardStyles = css`
  .outside-card {
    display: flex;
    flex-direction: column;
    gap: var(--wt-space-2);
  }
  .outside-card-options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--wt-space-3);
  }
`;

export function outsideCardValues(value: OutsideCardDetails): OutsideCardDetails {
  return {
    ...(value.externalProvider === undefined ? {} : { externalProvider: value.externalProvider }),
    ...(value.externalMachine?.trim() ? { externalMachine: value.externalMachine.trim() } : {}),
  };
}

export function outsideCardFields(
  value: OutsideCardDetails,
  change: (value: OutsideCardDetails) => void,
  disabled = false,
) {
  return html`<div class="outside-card">
    <div role="radiogroup" aria-label=${t("tender.outside_source")}>
      <p>${t("tender.outside_source")}</p>
      <div class="outside-card-options">
        ${(["", "sumup", "other"] as const).map(
          (source) =>
            html`<label>
              <input
                type="radio"
                name="external-provider"
                value=${source}
                .checked=${(value.externalProvider ?? "") === source}
                .disabled=${disabled}
                @change=${(event: Event) => {
                  event.stopPropagation();
                  change({ ...value, externalProvider: source || undefined });
                }}
              />
              ${t(source === "" ? "tender.outside_unspecified" : source === "sumup" ? "tender.outside_sumup" : "tender.outside_other")}
            </label>`,
        )}
      </div>
    </div>
    <wt-input
      name="externalMachine"
      .label=${t("tender.outside_machine")}
      .value=${value.externalMachine ?? ""}
      .disabled=${disabled}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        change({ ...value, externalMachine: event.detail.value });
      }}
    ></wt-input>
  </div>`;
}

export function outsideCardSummary(value: OutsideCardDetails) {
  const parts = [
    ...(value.externalProvider === undefined
      ? []
      : [t(value.externalProvider === "sumup" ? "tender.outside_sumup" : "tender.outside_other")]),
    ...(value.externalMachine ? [value.externalMachine] : []),
  ];
  return parts.length === 0 ? nothing : html`<p data-outside-card-details>${parts.join(" · ")}</p>`;
}
