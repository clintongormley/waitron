import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import {
  addDecimal,
  compareDecimal,
  decimal,
  divideDecimal,
  formatMoney,
  multiplyDecimal,
  subtractDecimal,
} from "@waitron/shared";
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
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import type { AdjustmentReason } from "../api/client.js";
import type { CancellationRead } from "../api/line-cancel-types.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { trimQuantity } from "./dish-format.js";
import { trackDialog } from "./track-dialog.js";

type Outcome = "keep_charge" | "remove_charge" | "refund";
type Draft = {
  quantity: string;
  outcome: Outcome | null;
  preparationStarted: boolean | null;
  reasonId: string;
  note: string;
};
export interface CancelItemChoice {
  lineId: string;
  quantity: string;
  outcome: Outcome;
  consent: CancellationRead;
  preparationStarted?: boolean;
  reasonId?: string;
  note?: string;
}

function quantityValue(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;
}

function consentKey(read: CancellationRead | null): string {
  if (read === null) return "";
  return JSON.stringify([
    read.billId,
    read.saleId,
    read.refundValue,
    read.revision,
    read.billRevision,
    read.context.billStatus,
    read.context.stage,
    [...read.context.components]
      .sort((a, b) => a.lineId.localeCompare(b.lineId))
      .map((row) => [
        row.lineId,
        row.id,
        row.state,
        row.firedAt,
        row.quantity,
        row.kitchenQuantity,
        row.servedQuantity,
        row.cancelledQuantity,
      ]),
  ]);
}

@customElement("till-cancel-item-dialog")
export class TillCancelItemDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      fieldset {
        padding: 0;
        margin: 0;
        border: none;
        min-width: 0;
      }
      legend {
        font-weight: var(--wt-font-weight-bold);
        margin-bottom: var(--wt-space-2);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        overflow-wrap: anywhere;
      }
      .required {
        color: var(--wt-color-danger);
      }
      input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }
    `,
  ];
  @property() name = "";
  @property() lineId = "";
  @property({ type: Number }) unitPrecision: number | null = 0;
  @property({ attribute: false }) consent: CancellationRead | null = null;
  @property({ type: Boolean }) refundAvailable = false;
  @property({ type: Boolean }) refundAtTill = false;
  @property({ attribute: false }) reasons: AdjustmentReason[] | null = null;
  @property({ type: Boolean }) reasonsLoading = false;
  @property({ type: Boolean }) busy = false;
  @property() refusal = "";
  @property({ attribute: false }) refusalField: "reason" | "note" | null = null;
  @state() private draft: Draft = {
    quantity: "",
    outcome: null,
    preparationStarted: null,
    reasonId: "",
    note: "",
  };
  @state() private attempted = false;
  @state() private active = true;
  @state() private sending = false;
  @state() private shownRefusal = "";
  @state() private shownRefusalField: "reason" | "note" | null = null;
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
  #remaining(): string {
    const row = this.consent?.context.components.find(
      (component) => component.lineId === this.lineId,
    );
    return row
      ? subtractDecimal(decimal(row.quantity), decimal(row.cancelledQuantity))
      : decimal("0");
  }
  #options(): Outcome[] {
    const context = this.consent?.context;
    if (
      !context ||
      context.billStatus === "abandoned" ||
      (context.billStatus === "settled" &&
        context.components.some(
          (row) => compareDecimal(decimal(row.servedQuantity), decimal("0")) > 0,
        )) ||
      compareDecimal(decimal(this.#remaining()), decimal("0")) <= 0
    )
      return [];
    if (this.#asksPreparation() && this.draft.preparationStarted === null) return [];
    if (context.billStatus === "settled")
      return this.#canRefund() ? ["keep_charge", "refund"] : ["keep_charge"];
    return this.#started() ? ["keep_charge", "remove_charge"] : ["remove_charge"];
  }
  #canRefund(): boolean {
    const value = this.consent?.refundValue;
    return (
      this.refundAvailable &&
      value !== undefined &&
      compareDecimal(decimal(value.quantity), decimal("0")) > 0 &&
      compareDecimal(decimal(value.gross), decimal("0")) > 0
    );
  }
  #defaultOutcome(): Outcome | null {
    const options = this.#options();
    if (this.consent?.context.billStatus === "settled" && options.length > 0)
      return !this.#started() && options.includes("refund") ? "refund" : "keep_charge";
    return options.length === 1 && options[0] === "remove_charge" ? "remove_charge" : null;
  }
  #refundAmount(): string {
    const value = this.consent?.refundValue;
    if (value === undefined || !this.#quantityValid()) return "";
    const cancelled = decimal(
      this.consent!.context.components.find((row) => row.lineId === this.lineId)!.cancelledQuantity,
    );
    const share = (quantity: ReturnType<typeof decimal>) =>
      divideDecimal(multiplyDecimal(decimal(value.gross), quantity), decimal(value.quantity), 2);
    return formatMoney(
      subtractDecimal(
        share(addDecimal(cancelled, decimal(quantityValue(this.draft.quantity)))),
        share(cancelled),
      ),
      currentLocale(),
    );
  }
  #asksPreparation(): boolean {
    return (
      this.consent?.context.stage === "not_started" &&
      this.consent.context.components.some((component) => component.firedAt !== null)
    );
  }
  #started(): boolean {
    return this.consent?.context.stage === "started" || this.draft.preparationStarted === true;
  }
  #currentKey(): string {
    return JSON.stringify([this.lineId, this.unitPrecision, consentKey(this.consent)]);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal") || changed.has("refusalField")) {
      this.shownRefusal = this.refusal;
      this.shownRefusalField = this.refusalField;
      this.sending = false;
    }
    if (changed.has("busy") && !this.busy) this.sending = false;
    const key = this.#currentKey();
    if (key !== this.#key) {
      this.#key = key;
      this.draft = { ...this.draft, preparationStarted: null };
      this.draft = {
        preparationStarted: null,
        reasonId: "",
        note: "",
        quantity: this.unitPrecision === 0 ? trimQuantity(this.#remaining()) : this.#remaining(),
        outcome: this.#defaultOutcome(),
      };
      this.#baseline = { ...this.draft };
      this.attempted = false;
      this.sending = false;
      this.#scope?.commit(this.#baseline);
    }
    if (this.draft.outcome !== null && !this.#options().includes(this.draft.outcome)) {
      this.draft = {
        ...this.draft,
        outcome: this.consent?.context.billStatus === "settled" ? this.#defaultOutcome() : null,
      };
      this.#scope?.changed();
    }
    if (changed.has("reasons") && this.draft.reasonId !== "" && this.#reason() === undefined) {
      this.draft = { ...this.draft, reasonId: "", note: "" };
      this.#scope?.changed();
    }
    if (this.isConnected && this.active && !this.#scope) {
      const { coordinator, scope } = draftScopeFor<Draft>(this, {
        id: this,
        current: () => this.draft,
        snapshot: (value) => ({ ...value }),
        equal: (a, b) =>
          a.outcome === b.outcome &&
          a.preparationStarted === b.preparationStarted &&
          a.reasonId === b.reasonId &&
          a.note === b.note &&
          quantityValue(a.quantity) === quantityValue(b.quantity),
        restore: (value) => {
          this.draft = { ...value };
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
      scope.commit(this.#baseline!);
    }
  }
  override updated(changed: PropertyValues<this>): void {
    if (
      (changed.has("consent") || changed.has("refundAvailable")) &&
      this.#needsReason() &&
      this.reasons === null
    )
      this.#requestReasons();
  }
  #quantityValid(): boolean {
    const quantity = quantityValue(this.draft.quantity);
    if (this.unitPrecision !== 0) return compareDecimal(decimal(quantity || "0"), decimal("0")) > 0;
    return (
      /^\d+$/.test(quantity) &&
      compareDecimal(decimal(quantity), decimal("0")) > 0 &&
      compareDecimal(decimal(quantity), decimal(this.#remaining())) <= 0
    );
  }
  #set(change: Partial<Draft>): void {
    if (!this.isConnected || !this.active || this.#busy()) return;
    this.draft = { ...this.draft, ...change };
    if (
      (change.reasonId !== undefined && this.shownRefusalField === "reason") ||
      (change.note !== undefined && this.shownRefusalField === "note")
    ) {
      this.shownRefusal = "";
      this.shownRefusalField = null;
    }
    this.#scope?.changed();
    if (change.outcome !== undefined && this.#needsReason() && this.reasons === null)
      this.#requestReasons();
  }
  #needsReason(): boolean {
    return (
      this.draft.outcome === "keep_charge" ||
      this.draft.outcome === "refund" ||
      (this.draft.outcome === "remove_charge" && this.#started())
    );
  }
  #offeredReasons(): AdjustmentReason[] {
    return (this.reasons ?? []).filter((reason) => reason.actions.includes("cancel"));
  }
  #reason(): AdjustmentReason | undefined {
    return this.#offeredReasons().find((reason) => reason.id === this.draft.reasonId);
  }
  #noteInvalid(): boolean {
    return (
      this.#needsReason() && this.#reason()?.noteRequired === true && this.draft.note.trim() === ""
    );
  }
  #requestReasons(): void {
    if (!this.isConnected || !this.active || this.#busy() || this.reasonsLoading) return;
    this.dispatchEvent(
      new CustomEvent("cancel-item-reasons", {
        detail: {},
        bubbles: true,
        composed: true,
      }),
    );
  }
  #preparation(started: boolean): void {
    if (!this.isConnected || !this.active || this.#busy()) return;
    this.draft = { ...this.draft, preparationStarted: started, outcome: null };
    this.draft = { ...this.draft, outcome: this.#defaultOutcome() };
    this.#scope?.changed();
    if (this.#needsReason() && this.reasons === null) this.#requestReasons();
  }
  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active || this.#busy()) return;
    // Consent belongs to the facts whose choices have actually been drawn.
    if (this.#currentKey() !== this.#key) {
      this.requestUpdate();
      return;
    }
    this.attempted = true;
    this.shownRefusalField = null;
    this.shownRefusal = "";
    const outcome = this.draft.outcome;
    if (
      !this.#quantityValid() ||
      (this.#needsReason() && (this.#reason() === undefined || this.#noteInvalid()))
    ) {
      await this.updateComplete;
      if (this.isConnected && this.active) await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    if (outcome === null || !this.#options().includes(outcome)) return;
    this.sending = true;
    this.shownRefusal = "";
    this.dispatchEvent(
      new CustomEvent<CancelItemChoice>("cancel-item-choice", {
        detail: {
          lineId: this.lineId,
          quantity: quantityValue(this.draft.quantity),
          outcome,
          consent: structuredClone(this.consent!),
          ...(this.#asksPreparation()
            ? { preparationStarted: this.draft.preparationStarted! }
            : {}),
          ...(this.#needsReason()
            ? {
                reasonId: this.draft.reasonId,
                ...(this.#reason()?.noteRequired ? { note: this.draft.note.trim() } : {}),
              }
            : {}),
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
      new CustomEvent("cancel-item-close", { detail: {}, bubbles: true, composed: true }),
    );
  }
  #label(outcome: Outcome): string {
    if (outcome === "refund")
      return t("cancel_item.refund").replace("{amount}", () => this.#refundAmount());
    if (outcome === "keep_charge")
      return t(
        this.consent?.context.billStatus === "settled"
          ? "table.cancel_line"
          : "cancel_item.still_charge",
      );
    return t(this.#started() ? "cancel_item.dont_charge" : "action.remove");
  }
  override render() {
    const options = this.#options();
    const invalid = this.attempted && !this.#quantityValid();
    const reasonInvalid = this.attempted && this.#needsReason() && this.#reason() === undefined;
    const noteInvalid = this.attempted && this.#noteInvalid();
    const allowed = this.draft.outcome !== null && options.includes(this.draft.outcome);
    const unavailable = options.length === 0;
    const waitingForPreparation = this.#asksPreparation() && this.draft.preparationStarted === null;
    const disabled =
      this.#busy() ||
      this.reasonsLoading ||
      !allowed ||
      unavailable ||
      !this.#quantityValid() ||
      (this.#needsReason() && this.#reason() === undefined) ||
      this.#noteInvalid();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .heading=${t("cancel_item.title")}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => this.#close(event)}
    >
      <div
        class="body"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector<HTMLElement>("[data-confirm]"))}
      >
        <p class="name">${this.name}</p>
        ${
          this.#asksPreparation()
            ? html`<fieldset data-preparation>
                <legend>
                  ${t("cancel_item.preparation")} <span class="required" aria-hidden="true">*</span>
                </legend>
                ${[true, false].map(
                  (started) =>
                    html`<label
                      ><input
                        type="radio"
                        name="preparation"
                        required
                        value=${started ? "yes" : "no"}
                        .checked=${this.draft.preparationStarted === started}
                        ?disabled=${this.#busy()}
                        @change=${() => this.#preparation(started)}
                      />${t(started ? "cancel_item.yes" : "cancel_item.no")}</label
                    >`,
                )}
              </fieldset>`
            : nothing
        }
        ${
          this.consent?.context.billStatus === "settled" || this.#started()
            ? html`<p data-stage>
                ${t(this.consent?.context.billStatus === "settled" ? "cancel_item.paid" : "cancel_item.started")}
              </p>`
            : nothing
        }
        ${
          this.unitPrecision === 0 && (!unavailable || waitingForPreparation)
            ? html`<wt-number-stepper
                name="quantity"
                required
                .label=${t("adjust.quantity")}
                .min=${1}
                .max=${Number(this.#remaining())}
                .value=${live(this.draft.quantity)}
                .disabled=${this.#busy()}
                .error=${invalid ? t("table.split_quantity_whole_error") : ""}
                .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", () => label)}
                .increaseLabel=${(label: string) => t("action.increase").replace("{label}", () => label)}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#set({ quantity: event.detail.value });
                }}
              ></wt-number-stepper>`
            : unavailable && !waitingForPreparation
              ? nothing
              : html`<p data-whole-quantity>
                  ${t("adjust.quantity")}: ${trimQuantity(this.#remaining())}
                </p>`
        }
        ${
          waitingForPreparation
            ? nothing
            : unavailable
              ? html`<p>${t("cancel_item.unavailable")}</p>`
              : this.consent?.context.billStatus === "settled"
                ? this.#canRefund()
                  ? html`<label
                      ><input
                        type="checkbox"
                        name="refund"
                        .checked=${this.draft.outcome === "refund"}
                        ?disabled=${this.#busy()}
                        @change=${(event: Event) => this.#set({ outcome: (event.target as HTMLInputElement).checked ? "refund" : "keep_charge" })}
                      />${t("find_page.refund")}</label
                    >`
                  : nothing
                : html`<fieldset>
                    <legend>
                      ${t("cancel_item.choice")} <span class="required" aria-hidden="true">*</span>
                    </legend>
                    ${options.map(
                      (outcome) =>
                        html`<label>
                          <input
                            type="radio"
                            name="outcome"
                            required
                            .value=${outcome}
                            .checked=${this.draft.outcome === outcome}
                            ?disabled=${this.#busy()}
                            @change=${() => this.#set({ outcome })}
                          />${this.#label(outcome)}</label
                        >`,
                    )}
                  </fieldset>`
        }
        ${this.consent?.context.billStatus === "settled" && this.refundAtTill ? html`<p data-refund-at-till>${t("cancel_item.refund_at_till")}</p>` : nothing}
        ${
          this.#needsReason()
            ? html`
                <wt-combobox
                  name="reason"
                  required
                  searchPlaceholder=${t("form.combobox_search")}
                  noResultsLabel=${t("form.combobox_no_results")}
                  .label=${t("adjust.reason")}
                  .placeholder=${t("adjust.reason_required")}
                  .options=${this.#offeredReasons().map((reason) => ({ value: reason.id, label: reason.name }))}
                  .value=${this.draft.reasonId}
                  .disabled=${this.#busy() || this.reasonsLoading}
                  .error=${reasonInvalid ? t("adjust.reason_required") : this.shownRefusalField === "reason" ? this.shownRefusal : ""}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.#set({ reasonId: event.detail.value, note: "" });
                  }}
                ></wt-combobox>
                ${
                  this.reasons !== null && this.#offeredReasons().length === 0
                    ? html`<p>${t("adjust.no_reasons")}</p>`
                    : nothing
                }
                ${
                  this.#reason()?.noteRequired
                    ? html` <wt-input
                        name="note"
                        required
                        autocomplete="off"
                        .label=${t("adjust.note")}
                        .placeholder=${codeMessage("working_order.reason_required")}
                        .value=${live(this.draft.note)}
                        .disabled=${this.#busy()}
                        .error=${noteInvalid ? t("adjust.note_required") : this.shownRefusalField === "note" ? this.shownRefusal : ""}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          this.#set({ note: event.detail.value });
                        }}
                      ></wt-input>`
                    : nothing
                }
                ${
                  this.reasons === null
                    ? html` <wt-button
                        data-retry-reasons
                        variant="secondary"
                        .disabled=${this.#busy() || this.reasonsLoading}
                        .busy=${this.reasonsLoading}
                        @click=${() => this.#requestReasons()}
                        >${t("find_page.retry")}</wt-button
                      >`
                    : nothing
                }
              `
            : nothing
        }
        <wt-form-actions
          .error=${[invalid || reasonInvalid || noteInvalid || this.shownRefusalField !== null ? t("form.fix_fields") : "", this.shownRefusalField === null ? this.shownRefusal : ""].filter(Boolean).join(" ")}
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
            .busy=${this.#busy()}
            @click=${() => void this.#confirm()}
            >${this.draft.outcome !== null ? this.#label(this.draft.outcome) : this.consent?.context.billStatus === "settled" ? t("table.cancel_line") : t("adjust.continue")}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-cancel-item-dialog": TillCancelItemDialog;
  }
}
