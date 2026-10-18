import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { currentLocale } from "@waitron/dashboard-kit";
import { conjunctionList } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import type { FloorPlanSetDeleteImpact } from "../floor-plan-set-types.js";
import type { Refusal } from "./refusal.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export type { FloorPlanSetDeleteImpact };
export type FloorPlanSetDeleteConfirm = { setId: string; replaceWith: string | null };
type NamedSet = { id: string; name: string };

const listOf = (items: { name: string }[]) =>
  conjunctionList(
    items.map(({ name }) => name),
    currentLocale().startsWith("es") ? "es-ES" : "en-GB",
  );

/** Asks before deleting a set that is not its department's default. The empty Replace with
 *  choice is the default, which sends `replaceWith: null`. */
@customElement("dashboard-floor-plan-set-delete-dialog")
export class FloorPlanSetDeleteDialog extends LitElement {
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
  @property({ attribute: false }) set?: NamedSet;
  @property({ attribute: false }) defaultSet?: NamedSet;
  /** The department's other sets, the default and this one left out. */
  @property({ attribute: false }) replacements: NamedSet[] = [];
  /** Undefined while it loads. */
  @property({ attribute: false }) impact?: FloorPlanSetDeleteImpact;
  @property() readError = "";
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal?: Refusal;
  @state() private replacement = "";

  protected override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("replacements") && !this.replacements.some((s) => s.id === this.replacement))
      this.replacement = "";
  }
  private emit(name: string, detail: unknown = {}) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  private fieldError(): string {
    const refusal = this.refusal;
    return refusal?.code === "floor_plan_set.invalid" && refusal.params?.field === "replaceWith"
      ? t("floor_plans.replace_invalid")
      : "";
  }
  private bottomError(): string {
    const refusal = this.refusal;
    if (!refusal) return this.readError;
    if (this.fieldError()) return t("prep.fix_fields");
    if (refusal.code === "floor_plan_set.not_found") return t("floor_plans.set_gone");
    if (refusal.code === "floor_plan_set.is_default") return t("floor_plans.is_default");
    return t("menu.save_error");
  }
  private lines(impact: FloorPlanSetDeleteImpact): string[] {
    return [
      impact.periods.length
        ? format("floor_plans.delete_used_by", {
            periods: listOf(impact.periods),
          })
        : t("floor_plans.delete_unused"),
      t("floor_plans.delete_tables_stay"),
      impact.zonesShowing.length
        ? format("floor_plans.delete_on_floor", {
            zones: listOf(impact.zonesShowing),
          })
        : "",
    ].filter(Boolean);
  }
  private picker(impact: FloorPlanSetDeleteImpact) {
    if (!impact.periods.length) return nothing;
    return html`<wt-combobox
      name="replaceWith"
      show-empty-option
      search="never"
      label=${t("period.replace_with")}
      .value=${this.replacement}
      .options=${[
        {
          value: "",
          label: format("floor_plans.replace_default", { set: this.defaultSet?.name ?? "" }),
          muted: true as const,
        },
        ...this.replacements.map((entry) => ({ value: entry.id, label: entry.name })),
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
    if (!this.open || !this.set) return nothing;
    const set = this.set;
    const impact = this.impact;
    return html`<wt-modal
      open
      size="compact"
      heading=${format("floor_plans.delete_heading", { set: set.name })}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (this.busy) return;
        this.open = false;
        this.emit("floor-plan-set-delete-close");
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
                @click=${() => this.emit("floor-plan-set-delete-retry")}
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
            this.emit("floor-plan-set-delete-confirm", {
              setId: set.id,
              replaceWith: this.replacement === "" ? null : this.replacement,
            } satisfies FloorPlanSetDeleteConfirm);
          }}
          >${format("floor_plans.delete_named", { set: set.name })}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-plan-set-delete-dialog": FloorPlanSetDeleteDialog;
  }
}
