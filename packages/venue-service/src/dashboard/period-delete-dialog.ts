import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import type { PeriodRoutingUse } from "../menu-timetable-types.js";
import type { PeriodDeleteImpact } from "./opening-hours-client.js";
import type { Refusal } from "./refusal.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";
import { clockChangeConflictText } from "./clock-change-conflict.js";

const cellLabel = (use: PeriodRoutingUse) =>
  format("opening.routing_use", {
    row:
      use.rowLabel ?? t(use.rowKind === "all" ? "routing.all_categories" : "routing.no_category"),
    zone: use.zoneName ?? t("routing.every_zone"),
  });
const offersReplacement = (impact: PeriodDeleteImpact) =>
  impact.replacements.length > 0 &&
  (impact.seasons + impact.specialDays > 0 || impact.keptOpenToday);

@customElement("period-delete-dialog")
export class PeriodDeleteDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .body {
        display: grid;
        gap: var(--wt-space-3);
        padding-block: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
      .hint {
        color: var(--wt-color-text-muted);
      }
      .status {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0;
        padding-block: var(--wt-space-3);
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) period?: { id: string; name: string };
  /** Undefined while it loads. Going undefined keeps the Replace-with choice. */
  @property({ attribute: false }) impact?: PeriodDeleteImpact;
  @property() readError = "";
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal?: Refusal;
  @state() private replacement = "";
  private periodId?: string;

  protected override willUpdate(changed: PropertyValues<this>) {
    if (this.period?.id !== this.periodId) {
      this.periodId = this.period?.id;
      this.replacement = "";
    }
    if (
      changed.has("impact") &&
      this.impact &&
      this.replacement !== "" &&
      (!offersReplacement(this.impact) ||
        !this.impact.replacements.some((entry) => entry.id === this.replacement))
    )
      this.replacement = "";
  }
  private emit(name: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private get replacementName(): string {
    return this.impact?.replacements.find((entry) => entry.id === this.replacement)?.name ?? "";
  }
  private offsetSentence(periodId: unknown): string {
    const name = this.impact?.replacements.find((entry) => entry.id === periodId)?.name;
    return name
      ? format("menu.offset_timetable_named", { period: name })
      : t("menu.offset_timetable");
  }
  /** The refusal worded for under Replace with, or "" when it names no field here. */
  private fieldError(): string {
    const refusal = this.refusal;
    if (refusal?.params?.field !== "replacementPeriodId") return "";
    if (refusal.code === "menu_period.invalid") return t("period.replace_invalid");
    if (refusal.code === "menu_timetable.invalid" && refusal.params.reason === "end_offset")
      return this.offsetSentence(refusal.params.periodId);
    return "";
  }
  private bottomError(): string {
    const refusal = this.refusal;
    if (!refusal || (this.readError && !this.impact)) return this.readError;
    if (this.fieldError()) return t("prep.fix_fields");
    const params = refusal.params ?? {};
    switch (refusal.code) {
      case "hours.clock_changed":
        return t("period.delete_clock_changed");
      case "hours.clock_change_conflict":
        return clockChangeConflictText(refusal)!;
      case "menu_period.not_found":
        return t("menu.period_gone");
      case "department.not_found":
        return t("menu.department_gone");
      case "menu_timetable.invalid":
        if (params.reason === "end_offset") return this.offsetSentence(params.periodId);
    }
    return t("menu.save_error");
  }
  private lines(impact: PeriodDeleteImpact) {
    const painted = impact.seasons + impact.specialDays > 0;
    const uses = impact.routingUses;
    const replacement = this.replacementName;
    const lines = [
      impact.seasons > 0
        ? format(impact.seasons === 1 ? "period.delete_seasons_one" : "period.delete_seasons", {
            count: String(impact.seasons),
          })
        : "",
      impact.specialDays > 0
        ? format(
            impact.specialDays === 1
              ? "period.delete_special_days_one"
              : "period.delete_special_days",
            { count: String(impact.specialDays) },
          )
        : "",
      uses.length > 0
        ? format(uses.length === 1 ? "period.delete_cells_one" : "period.delete_cells", {
            count: String(uses.length),
            cells: uses.map(cellLabel).join(", "),
          })
        : "",
      painted
        ? replacement
          ? format("period.delete_takes", { replacement })
          : t("period.delete_closes")
        : "",
      uses.length > 0 ? t("period.delete_routing") : "",
      impact.keptOpenToday
        ? replacement
          ? format("period.delete_kept_moves", { replacement })
          : t("period.delete_kept_ends")
        : "",
    ].filter(Boolean);
    return lines.length ? lines : [t("period.delete_nothing")];
  }
  private picker(impact: PeriodDeleteImpact) {
    if (!offersReplacement(impact)) return nothing;
    return html`<p class="hint">${t("period.delete_keep_hint")}</p>
      <wt-combobox
        name="replacementPeriodId"
        show-empty-option
        search="never"
        label=${t("period.replace_with")}
        .value=${this.replacement}
        .options=${[
          { value: "", label: t("period.replace_none") },
          ...impact.replacements.map((entry) => ({ value: entry.id, label: entry.name })),
        ]}
        .error=${this.fieldError()}
        ?disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (this.busy) return;
          if (this.fieldError()) this.refusal = undefined;
          this.replacement = event.detail.value;
        }}
      ></wt-combobox>`;
  }
  override render(): unknown {
    if (!this.open || !this.period) return nothing;
    const period = this.period;
    const impact = this.impact;
    return html`<wt-modal
      open
      size="compact"
      heading=${format("opening.delete_confirm", { name: period.name })}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.busy) return;
        this.open = false;
        this.emit("period-delete-close");
      }}
    >
      ${
        impact
          ? html`<div class="body" data-test="body">
              ${this.lines(impact).map((line) => html`<p>${line}</p>`)}${this.picker(impact)}
            </div>`
          : this.readError
            ? nothing
            : html`<p class="status" role="status">
                <wt-spinner size="sm" decorative></wt-spinner>${t("period.delete_loading")}
              </p>`
      }
      <wt-form-actions slot="footer" .error=${this.bottomError()}>
        <wt-button
          slot="cancel"
          data-test="cancel-delete"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (!this.busy) void this.shadowRoot!.querySelector("wt-modal")?.requestClose("cancel");
          }}
          >${t("prep.cancel")}</wt-button
        >
        ${
          this.readError
            ? html`<wt-button
                slot="secondary"
                data-test="retry-delete"
                variant="secondary"
                @click=${() => this.emit("period-delete-retry")}
                >${t("period.delete_retry")}</wt-button
              >`
            : nothing
        }
        <wt-button
          data-test="confirm-delete"
          variant=${impact ? "danger" : "secondary"}
          ?disabled=${!impact || this.busy}
          ?loading=${this.busy}
          @click=${() => {
            if (!impact || this.busy) return;
            this.emit("period-delete-confirm", {
              periodId: period.id,
              replacementPeriodId: this.replacement === "" ? null : this.replacement,
            });
          }}
          >${format("period.delete_named", { name: period.name })}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "period-delete-dialog": PeriodDeleteDialog;
  }
}
