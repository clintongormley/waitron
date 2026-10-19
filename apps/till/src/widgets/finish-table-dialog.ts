import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { addDecimal, compareDecimal, decimal, formatMoney } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { AdjustmentReason } from "../api/client.js";
import type { FinishCancellation, UnservedDish } from "../api/finish-table-types.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trimQuantity } from "./dish-format.js";
import { trackDialog } from "./track-dialog.js";

type Choice = { lineId: string; preparationStarted: boolean | null; refund: boolean };
type Draft = { choices: Choice[]; reasonId: string; note: string };
export interface FinishTableChoice {
  cancellations: FinishCancellation[];
}

@customElement("till-finish-table-dialog")
export class TillFinishTableDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body,
      .dish {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
      .dish {
        border-bottom: 1px solid var(--wt-color-border);
        padding-bottom: var(--wt-space-3);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .name,
      legend {
        font-weight: var(--wt-font-weight-bold);
      }
      fieldset {
        border: none;
        padding: 0;
        margin: 0;
        min-width: 0;
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      input {
        accent-color: var(--wt-color-primary);
        flex: none;
      }
      .required,
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property({ attribute: false }) dishes: UnservedDish[] = [];
  @property({ attribute: false }) refunds: Record<string, string> = {};
  @property({ type: Boolean }) refundAtTill = false;
  @property({ attribute: false }) reasons: AdjustmentReason[] | null = null;
  @property() defaultReasonId = "";
  @property({ type: Boolean }) reasonsLoading = false;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) confirmationLocked = false;
  @property() refusal = "";
  @property({ attribute: false }) refusalField: "reason" | "note" | null = null;
  @state() private refusalCleared = false;
  @state() private draft: Draft = { choices: [], reasonId: "", note: "" };
  @state() private attempted = false;
  @state() private active = true;
  @state() private sending = false;
  #key?: string;
  #baseline?: Draft;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason) =>
    !this.#busy() &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  #busy(): boolean {
    return this.busy || this.sending;
  }
  #currentKey(): string {
    return JSON.stringify([this.dishes, this.refunds]);
  }
  #asks(dish: UnservedDish): boolean {
    return (
      dish.context.stage === "not_started" &&
      dish.context.components.some((item) => item.firedAt !== null)
    );
  }
  #canRefund(dish: UnservedDish): boolean {
    return compareDecimal(decimal(this.refunds[dish.lineId] ?? "0"), decimal("0")) > 0;
  }
  #reasons(): AdjustmentReason[] {
    return (this.reasons ?? []).filter((reason) => reason.actions.includes("cancel"));
  }
  #reason(): AdjustmentReason | undefined {
    return this.#reasons().find((reason) => reason.id === this.draft.reasonId);
  }
  #noteInvalid(): boolean {
    return this.#reason()?.noteRequired === true && this.draft.note.trim() === "";
  }
  #valid(): boolean {
    return (
      this.dishes.length > 0 &&
      this.draft.choices.every((choice) => choice.preparationStarted !== null) &&
      this.#reason() !== undefined &&
      !this.#noteInvalid()
    );
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal") || changed.has("refusalField")) this.refusalCleared = false;
    if ((changed.has("busy") && !this.busy) || changed.has("refusal")) this.sending = false;
    const key = this.#currentKey();
    if (key !== this.#key) {
      this.#key = key;
      this.draft = {
        choices: this.dishes.map((dish) => {
          const started = this.#asks(dish) ? null : dish.context.stage === "started";
          return {
            lineId: dish.lineId,
            preparationStarted: started,
            refund: started === false && this.#canRefund(dish),
          };
        }),
        reasonId: this.#reasons().some((reason) => reason.id === this.defaultReasonId)
          ? this.defaultReasonId
          : "",
        note: "",
      };
      this.#baseline = structuredClone(this.draft);
      this.attempted = false;
      this.sending = false;
      this.#scope?.commit(this.#baseline);
    }
    if (changed.has("reasons") && this.draft.reasonId !== "" && this.#reason() === undefined) {
      this.draft = { ...this.draft, reasonId: "", note: "" };
      this.#scope?.changed();
    }
    if (this.isConnected && this.active && !this.#scope) {
      const { scope, coordinator } = draftScopeFor<Draft>(this, {
        id: this,
        current: () => this.draft,
        snapshot: (draft) => structuredClone(draft),
        equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
        restore: (draft) => {
          this.draft = structuredClone(draft);
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit(this.#baseline!);
    }
  }
  #set(change: Partial<Draft>): void {
    if (!this.isConnected || !this.active || this.#busy() || this.confirmationLocked) return;
    if (
      (this.refusalField === "reason" && change.reasonId !== undefined) ||
      (this.refusalField === "note" && (change.note !== undefined || change.reasonId !== undefined))
    )
      this.refusalCleared = true;
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
  }
  #preparation(dish: UnservedDish, started: boolean): void {
    this.#set({
      choices: this.draft.choices.map((choice) =>
        choice.lineId === dish.lineId
          ? { ...choice, preparationStarted: started, refund: !started && this.#canRefund(dish) }
          : choice,
      ),
    });
  }
  #refund(dish: UnservedDish, refund: boolean): void {
    if (!this.#canRefund(dish)) return;
    this.#set({
      choices: this.draft.choices.map((choice) =>
        choice.lineId === dish.lineId && choice.preparationStarted !== null
          ? { ...choice, refund }
          : choice,
      ),
    });
  }
  #refundTotal(): string {
    return this.draft.choices.reduce(
      (total, choice) =>
        choice.refund ? addDecimal(total, decimal(this.refunds[choice.lineId] ?? "0")) : total,
      decimal("0"),
    );
  }
  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active || this.#busy()) return;
    // A click may arrive after the observation changed and before Lit paints the new facts.
    if (this.#currentKey() !== this.#key) {
      this.requestUpdate();
      return;
    }
    this.attempted = true;
    if (this.reasonsLoading || !this.#valid()) {
      await this.updateComplete;
      if (this.isConnected && this.active) await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.sending = true;
    this.dispatchEvent(
      new CustomEvent<FinishTableChoice>("finish-table-choice", {
        detail: {
          cancellations: this.dishes.map((dish, index) => {
            const choice = this.draft.choices[index]!;
            return {
              lineId: dish.lineId,
              quantity: dish.quantity,
              expectedBillRevision: dish.billRevision,
              expectedContext: structuredClone(dish.context),
              ...(this.#asks(dish) ? { preparationStarted: choice.preparationStarted! } : {}),
              ...(choice.refund && this.#canRefund(dish) ? { refundHandoff: true } : {}),
              reasonId: this.draft.reasonId,
              ...(this.#reason()?.noteRequired ? { note: this.draft.note.trim() } : {}),
            };
          }),
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #close(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(
      new CustomEvent("finish-table-close", { detail: {}, bubbles: true, composed: true }),
    );
  }
  override render() {
    const count = this.dishes.reduce(
      (sum, dish) => addDecimal(sum, decimal(dish.quantity)),
      decimal("0"),
    );
    const total = this.#refundTotal();
    const serverField = this.refusalCleared ? null : this.refusalField;
    const invalidReason = this.attempted && this.#reason() === undefined;
    const invalidNote = this.attempted && this.#noteInvalid();
    const invalidPreparation =
      this.attempted && this.draft.choices.some((choice) => choice.preparationStarted === null);
    const disabled = this.#busy() || this.reasonsLoading || !this.#valid();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("finish_table.unserved").replace("{n}", () => trimQuantity(count))}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <div
        class="body"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector<HTMLElement>("[data-confirm]"))}
      >
        ${this.dishes.map((dish, index) => {
          const choice = this.draft.choices[index];
          return html`<section class="dish" data-dish=${dish.lineId} aria-label=${dish.name}>
            <p class="name">${trimQuantity(dish.quantity)} × ${dish.name}</p>
            ${
              this.#asks(dish)
                ? html`<fieldset>
                    <legend>
                      ${t("cancel_item.preparation")}
                      <span class="required" aria-hidden="true">*</span>
                    </legend>
                    ${[true, false].map(
                      (started) =>
                        html`<label
                          ><input
                            type="radio"
                            required
                            name=${`preparation-${dish.lineId}`}
                            value=${started ? "yes" : "no"}
                            .checked=${choice?.preparationStarted === started}
                            ?disabled=${this.#busy() || this.confirmationLocked}
                            @change=${() => this.#preparation(dish, started)}
                          />${t(started ? "cancel_item.yes" : "cancel_item.no")}</label
                        >`,
                    )}
                    ${this.attempted && choice?.preparationStarted === null ? html`<p class="error" role="alert">${t("cancel_item.preparation")}</p>` : nothing}
                  </fieldset>`
                : html`<p>
                    ${t("cancel_item.preparation")}:
                    ${t(dish.context.stage === "started" ? "cancel_item.yes" : "cancel_item.no")}
                  </p>`
            }
            ${
              this.#canRefund(dish) && choice?.preparationStarted !== null
                ? html`<label
                    ><input
                      type="checkbox"
                      name="refund"
                      .checked=${choice?.refund === true}
                      ?disabled=${this.#busy() || this.confirmationLocked}
                      @change=${(event: Event) => this.#refund(dish, (event.target as HTMLInputElement).checked)}
                    />${t("find_page.refund")}</label
                  >`
                : nothing
            }
          </section>`;
        })}
        ${this.refundAtTill ? html`<p data-refund-at-till>${t("cancel_item.refund_at_till")}</p>` : nothing}
        <wt-combobox
          name="reason"
          required
          .label=${t("adjust.reason")}
          .placeholder=${t("adjust.reason_required")}
          searchPlaceholder=${t("form.combobox_search")}
          noResultsLabel=${t("form.combobox_no_results")}
          .options=${this.#reasons().map((reason) => ({ value: reason.id, label: reason.name }))}
          .value=${this.draft.reasonId}
          .disabled=${this.#busy() || this.reasonsLoading || this.confirmationLocked}
          .error=${serverField === "reason" ? this.refusal : invalidReason ? t("adjust.reason_required") : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#set({ reasonId: event.detail.value, note: "" });
          }}
        ></wt-combobox>
        ${
          this.#reason()?.noteRequired
            ? html`<wt-input
                name="note"
                required
                autocomplete="off"
                .label=${t("adjust.note")}
                .placeholder=${codeMessage("working_order.reason_required")}
                .value=${live(this.draft.note)}
                .disabled=${this.#busy() || this.confirmationLocked}
                .error=${serverField === "note" ? this.refusal : invalidNote ? t("adjust.note_required") : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#set({ note: event.detail.value });
                }}
              ></wt-input>`
            : nothing
        }
        ${this.reasons !== null && this.#reasons().length === 0 ? html`<p>${t("adjust.no_reasons")}</p>` : nothing}
        ${
          this.reasons === null
            ? html`<wt-button
                variant="secondary"
                data-retry
                .disabled=${this.#busy() || this.reasonsLoading || this.confirmationLocked}
                .loading=${this.reasonsLoading}
                @click=${() => {
                  if (this.isConnected && this.active && !this.#busy() && !this.reasonsLoading)
                    this.dispatchEvent(
                      new CustomEvent("finish-table-reasons", {
                        detail: {},
                        bubbles: true,
                        composed: true,
                      }),
                    );
                }}
                >${t("find_page.retry")}</wt-button
              >`
            : nothing
        }
      </div>
      <wt-form-actions
        slot="footer"
        .error=${[invalidReason || invalidNote || invalidPreparation || serverField !== null ? t("form.fix_fields") : "", serverField === null && !this.refusalCleared ? this.refusal : ""].filter(Boolean).join(" ")}
      >
        <wt-button
          slot="cancel"
          data-close
          variant="secondary"
          .disabled=${this.#busy()}
          @click=${() => {
            if (this.isConnected && this.active && !this.#busy())
              void this.renderRoot.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
          }}
          >${t("action.back")}</wt-button
        >
        <wt-button
          data-confirm
          variant=${disabled && !this.#busy() ? "secondary" : "danger"}
          .disabled=${disabled}
          .loading=${this.#busy()}
          @click=${() => void this.#confirm()}
          >${
            compareDecimal(decimal(total), decimal("0")) > 0
              ? t("cancel_item.refund").replace("{amount}", () =>
                  formatMoney(decimal(total), currentLocale()),
                )
              : t("table.cancel_line")
          }</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-finish-table-dialog": TillFinishTableDialog;
  }
}
