import { html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import type { AdjustmentReason } from "../api/client.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

export function voidReasons(reasons: AdjustmentReason[] | null): AdjustmentReason[] {
  return (reasons ?? []).filter((reason) => reason.actions.includes("cancel"));
}

export interface ReasonPicker {
  reasons: AdjustmentReason[] | null;
  reasonsLoading: boolean;
  reasonId: string;
  note: string;
  disabled: boolean;
  reasonError: string;
  noteError: string;
  onReason(reasonId: string): void;
  onNote(note: string): void;
  onRetry(): void;
  under?: unknown;
}

export function reasonPicker(picker: ReasonPicker) {
  const offered = voidReasons(picker.reasons);
  const chosen = offered.find((reason) => reason.id === picker.reasonId);
  return html`<wt-combobox
      name="reason"
      required
      .label=${t("adjust.reason")}
      .placeholder=${t("adjust.reason_required")}
      searchPlaceholder=${t("form.combobox_search")}
      noResultsLabel=${t("form.combobox_no_results")}
      .options=${offered.map((reason) => ({ value: reason.id, label: reason.name }))}
      .value=${picker.reasonId}
      .disabled=${picker.disabled || picker.reasonsLoading}
      .error=${picker.reasonError}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        picker.onReason(event.detail.value);
      }}
    ></wt-combobox>
    ${picker.under ?? nothing}
    ${
      chosen?.noteRequired
        ? html`<wt-input
            name="note"
            required
            autocomplete="off"
            .label=${t("adjust.note")}
            .placeholder=${codeMessage("working_order.reason_required")}
            .value=${live(picker.note)}
            .disabled=${picker.disabled}
            .error=${picker.noteError}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              picker.onNote(event.detail.value);
            }}
          ></wt-input>`
        : nothing
    }
    ${picker.reasons !== null && offered.length === 0 ? html`<p>${t("adjust.no_reasons")}</p>` : nothing}
    ${
      picker.reasons === null
        ? html`<wt-button
            variant="secondary"
            data-reasons-retry
            .disabled=${picker.disabled || picker.reasonsLoading}
            .loading=${picker.reasonsLoading}
            @click=${() => {
              if (!picker.disabled && !picker.reasonsLoading) picker.onRetry();
            }}
            >${t("find_page.retry")}</wt-button
          >`
        : nothing
    }`;
}
