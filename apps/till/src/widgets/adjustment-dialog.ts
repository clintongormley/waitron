import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { compareDecimal, decimal, formatMoney } from "@waitron/shared";
import { trackDialog } from "./track-dialog.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type {
  AdjustmentAction,
  AdjustmentPreview,
  AdjustmentReason,
  PersonRole,
} from "../api/client.js";

/** What the person set out to do; a discount is by a percentage or an amount, chosen in the form. */
export type AdjustKind = "cancel" | "comp" | "discount";

/** What an adjustment acts on, as the dialog names it before anything is done. */
export interface AdjustTarget {
  /** The dish; null for the whole bill. */
  lineId: string | null;
  name: string;
  /** The dish's quantity as shown; null for the bill. */
  quantity: string | null;
  /** What the action can take off: the dish with its extras, or the whole bill. */
  total: string;
  /** One unit's price when the dish is several whole units the action may take one of; null when
   * only the whole of it can be adjusted (a weighed dish, or one with extras). */
  unitTotal: string | null;
  /** The kitchen has started the dish. */
  started?: boolean;
}

/** The person's choices, which the app asks the server about and then applies. */
export interface AdjustmentChoice {
  action: AdjustmentAction;
  reasonId: string;
  note: string | null;
  quantity?: string;
  percentBp?: number;
  amount?: string;
}

type DiscountKind = "percent" | "amount";
type Field = "reason" | "note" | "value" | "quantity";

/** The field of the form a refusal is about, or null when it is about none the form shows. */
export function refusalField(code: string, kind: AdjustKind, partial: boolean): Field | null {
  switch (code) {
    case "adjustment.note_required":
      return "note";
    case "adjustment.exceeds_amount":
      return kind === "discount" ? "value" : null;
    case "adjustment.over_limit":
      return kind === "discount" ? "value" : "reason";
    case "adjustment.action_not_allowed":
    case "adjustment.reason_inactive":
    case "adjustment_reason.not_found":
      return "reason";
    case "adjustment.quantity_invalid":
    case "adjustment.partial_with_extras":
      return partial ? "quantity" : null;
    default:
      return null;
  }
}

const TITLES: Record<AdjustKind, StringKey> = {
  cancel: "adjust.cancel_title",
  comp: "adjust.comp_title",
  discount: "adjust.discount_title",
};

const APPROVAL: Record<PersonRole, StringKey> = {
  staff: "adjust.approval_staff",
  supervisor: "adjust.approval_supervisor",
  manager: "adjust.approval_manager",
  admin: "adjust.approval_admin",
};

const DO: Record<AdjustKind, StringKey> = {
  cancel: "adjust.do_cancel",
  comp: "adjust.do_comp",
  discount: "adjust.do_discount",
};

/** A typed amount: digits, then at most two decimals after a point or a comma. */
const TYPED_AMOUNT = /^\d{1,9}([.,]\d{1,2})?$/;

/**
 * Cancels, gives away or discounts one dish, or discounts the whole bill (service plan Task 11).
 * The form offers only the reasons that allow the action, then asks the app for a preview; the
 * confirm step shows what the bill actually loses, and who must approve, before anything is done.
 * It holds no request of its own: the app answers `adjust-preview` with {@link preview}, and a
 * refusal with {@link refusal}.
 */
@customElement("till-adjustment-dialog")
export class TillAdjustmentDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      .scope {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .lead,
      .detail {
        margin: 0;
      }

      .detail {
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
      }

      .choice {
        margin: 0;
        padding: 0;
        border: none;
        min-width: 0;
      }

      .choice legend {
        padding: 0;
        margin-bottom: var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .options {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1) var(--wt-space-4);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        cursor: pointer;
        overflow-wrap: anywhere;
      }

      .option input {
        flex: none;
        accent-color: var(--wt-color-primary);
      }

      .required,
      .field-error {
        color: var(--wt-color-danger);
      }

      .required {
        margin-inline-start: var(--wt-space-1);
      }

      .field-error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }

      .takes-off {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .approval {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property() kind: AdjustKind = "comp";
  @property({ attribute: false }) target: AdjustTarget | null = null;
  /** The venue's active reasons; the form offers those allowing the action. */
  @property({ attribute: false }) reasons: AdjustmentReason[] = [];
  /** The server's answer to the last `adjust-preview`; set, the dialog asks for confirmation. */
  @property({ attribute: false }) preview: AdjustmentPreview | null = null;
  /** The code of the last request's refusal. */
  @property() refusal: string | null = null;
  /** A request is out. */
  @property({ type: Boolean }) busy = false;

  @state() private quantity: "1" | "all" = "all";
  @state() private discountKind: DiscountKind = "percent";
  @state() private reasonId = "";
  @state() private note = "";
  @state() private value = "";
  @state() private attempted = false;
  /** The refusal still shown: it goes when the field it names changes, or at the next submission. */
  @state() private shownRefusal: string | null = null;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (changed.has("reasons") || changed.has("kind")) {
      const kinds = this.#discountKinds();
      if (!kinds.includes(this.discountKind) && kinds[0] !== undefined)
        this.discountKind = kinds[0];
    }
  }

  #action(): AdjustmentAction {
    if (this.kind !== "discount") return this.kind;
    return this.discountKind === "percent" ? "discount_percent" : "discount_amount";
  }

  #discountKinds(): DiscountKind[] {
    const allows = (action: AdjustmentAction) =>
      this.reasons.some((reason) => reason.actions.includes(action));
    return [
      ...(allows("discount_percent") ? (["percent"] as const) : []),
      ...(allows("discount_amount") ? (["amount"] as const) : []),
    ];
  }

  #offered(): AdjustmentReason[] {
    const action = this.#action();
    return this.reasons.filter((reason) => reason.actions.includes(action));
  }

  #reason(): AdjustmentReason | undefined {
    return this.#offered().find((reason) => reason.id === this.reasonId);
  }

  #partial(): boolean {
    return this.target?.unitTotal != null;
  }

  /** The most a discount can take: one unit, or all the action covers. */
  #covered(): string {
    const target = this.target!;
    return this.quantity === "1" && target.unitTotal !== null ? target.unitTotal : target.total;
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  /** The form's own checks, by field; an empty map when it can be sent. */
  #ownErrors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    const reason = this.#reason();
    if (reason === undefined) errors.set("reason", t("adjust.reason_required"));
    if (reason?.noteRequired === true && this.note.trim() === "")
      errors.set("note", t("adjust.note_required"));
    if (this.kind === "discount") {
      const typed = this.value.trim();
      if (this.discountKind === "percent") {
        const percent = Number(typed.replace(",", "."));
        if (!TYPED_AMOUNT.test(typed) || percent <= 0 || percent > 100)
          errors.set("value", t("adjust.percent_invalid"));
      } else if (!TYPED_AMOUNT.test(typed) || Number(typed.replace(",", ".")) <= 0) {
        errors.set("value", t("adjust.amount_invalid"));
      } else if (compareDecimal(decimal(typed.replace(",", ".")), decimal(this.#covered())) > 0) {
        errors.set(
          "value",
          t("adjust.amount_too_large").replace("{total}", () => this.#money(this.#covered())),
        );
      }
    }
    return errors;
  }

  #refusalField(): Field | null {
    return this.shownRefusal === null
      ? null
      : refusalField(this.shownRefusal, this.kind, this.#partial());
  }

  /** What each field shows under it: its own check once a submission was tried, else a refusal. */
  #fieldErrors(): Map<Field, string> {
    const errors = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const field = this.#refusalField();
    if (field !== null && !errors.has(field)) errors.set(field, codeMessage(this.shownRefusal!));
    return errors;
  }

  /** The one message beside the action: the generic one while a field is marked, and a refusal
   * that names no field in its own words. */
  #bottomMessage(fieldErrors: Map<Field, string>): string {
    const parts: string[] = [];
    if (fieldErrors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(codeMessage(this.shownRefusal));
    return parts.join(" ");
  }

  #changed(field: Field): void {
    if (this.#refusalField() === field) this.shownRefusal = null;
  }

  #choice(): AdjustmentChoice {
    const note = this.note.trim();
    const choice: AdjustmentChoice = {
      action: this.#action(),
      reasonId: this.reasonId,
      note: note === "" ? null : note,
    };
    if (this.#partial() && this.quantity === "1") choice.quantity = "1";
    const typed = this.value.trim().replace(",", ".");
    if (choice.action === "discount_percent") choice.percentBp = Math.round(Number(typed) * 100);
    if (choice.action === "discount_amount") choice.amount = typed;
    return choice;
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownErrors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("adjust-preview", this.#choice());
  }

  #confirm(): void {
    this.shownRefusal = null;
    this.#emit("adjust-confirm", this.#choice());
  }

  override render() {
    const target = this.target;
    if (target === null) return nothing;
    const title =
      this.kind === "discount" && target.lineId === null
        ? t("adjust.discount_bill_title")
        : t(TITLES[this.kind]);
    const noReasons =
      this.kind === "discount" ? this.#discountKinds().length === 0 : this.#offered().length === 0;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${title}
      @wt-close=${() => this.#emit("adjust-close")}
    >
      <div class="body">
        <p class="scope" data-adjust-scope>${this.#scope(target)}</p>
        ${
          noReasons
            ? this.#noReasons()
            : this.preview === null
              ? this.#form(target)
              : this.#confirmStep(this.preview)
        }
      </div>
    </wt-dialog>`;
  }

  #scope(target: AdjustTarget): string {
    const quantity = target.quantity === null ? "" : ` ×${target.quantity}`;
    return `${target.name}${quantity} · ${this.#money(target.total)}`;
  }

  #closeButton(slot: string): TemplateResult {
    return html`<wt-button
      slot=${slot}
      variant="secondary"
      data-adjust-close
      @click=${() => this.#emit("adjust-close")}
    >
      ${t("adjust.close")}
    </wt-button>`;
  }

  #noReasons(): TemplateResult {
    return html`<p class="lead" data-no-reasons>${t("adjust.no_reasons")}</p>
      <wt-form-actions>${this.#closeButton("cancel")}</wt-form-actions>`;
  }

  #radio(
    name: string,
    value: string,
    label: string,
    checked: boolean,
    pick: () => void,
    opts: { required?: boolean; errorId?: string } = {},
  ): TemplateResult {
    return html`<label class="option">
      <input
        type="radio"
        name=${name}
        .value=${value}
        .checked=${checked}
        ?required=${opts.required === true}
        aria-invalid=${opts.errorId === undefined ? nothing : "true"}
        aria-describedby=${opts.errorId ?? nothing}
        @change=${(event: Event) => {
          event.stopPropagation();
          pick();
        }}
      />
      <span>${label}</span>
    </label>`;
  }

  #form(target: AdjustTarget): TemplateResult {
    const errors = this.#fieldErrors();
    const bottom = this.#bottomMessage(errors);
    const reason = this.#reason();
    const cancelWording =
      this.kind === "cancel"
        ? html`<p class="lead">
            ${target.started === true ? t("table.cancel_started") : t("table.cancel_sent")}
          </p>`
        : nothing;
    return html`${cancelWording}
      ${this.#partial() ? this.#quantityChoice(target, errors.get("quantity")) : nothing}
      ${this.kind === "discount" ? this.#discountFields(errors.get("value")) : nothing}
      ${this.#reasonChoice(errors.get("reason"))}
      <wt-input
        name="note"
        autocomplete="off"
        .maxlength=${500}
        .label=${t("adjust.note")}
        .value=${this.note}
        .required=${reason?.noteRequired === true}
        .error=${errors.get("note") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          this.note = event.detail.value;
          this.#changed("note");
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>
      <wt-form-actions .error=${bottom}>
        ${this.#closeButton("cancel")}
        <wt-button
          variant="primary"
          data-adjust-continue
          .loading=${this.busy}
          .disabled=${this.busy || (this.attempted && this.#ownErrors().size > 0)}
          @click=${() => void this.#continue()}
        >
          ${t("adjust.continue")}
        </wt-button>
      </wt-form-actions>`;
  }

  #enter(event: KeyboardEvent): void {
    submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-adjust-continue]"));
  }

  #fieldsetError(which: Field, message: string | undefined): TemplateResult | typeof nothing {
    return message === undefined
      ? nothing
      : html`<p class="field-error" id=${`${which}-error`} data-error-for=${which}>${message}</p>`;
  }

  #quantityChoice(target: AdjustTarget, error: string | undefined): TemplateResult {
    const invalid = error === undefined ? {} : { errorId: "quantity-error" };
    return html`<fieldset class="choice" data-quantity>
      <legend>${t("adjust.quantity")}</legend>
      <div class="options">
        ${this.#radio(
          "quantity",
          "1",
          t("adjust.quantity_one"),
          this.quantity === "1",
          () => {
            this.quantity = "1";
            this.#changed("quantity");
          },
          invalid,
        )}
        ${this.#radio(
          "quantity",
          "all",
          t("adjust.quantity_all").replace("{n}", target.quantity ?? ""),
          this.quantity === "all",
          () => {
            this.quantity = "all";
            this.#changed("quantity");
          },
          invalid,
        )}
      </div>
      ${this.#fieldsetError("quantity", error)}
    </fieldset>`;
  }

  #discountFields(error: string | undefined): TemplateResult {
    const kinds = this.#discountKinds();
    const pickKind = (kind: DiscountKind) => {
      this.discountKind = kind;
      this.value = "";
      if (this.#reason() === undefined) this.reasonId = "";
      this.#changed("value");
    };
    const names: Record<DiscountKind, StringKey> = {
      percent: "adjust.kind_percent",
      amount: "adjust.kind_amount",
    };
    return html`${
        kinds.length > 1
          ? html`<fieldset class="choice" data-discount-kind>
              <legend>${t("adjust.kind")}</legend>
              <div class="options">
                ${kinds.map((kind) =>
                  this.#radio(
                    "discountKind",
                    kind,
                    t(names[kind]),
                    this.discountKind === kind,
                    () => pickKind(kind),
                  ),
                )}
              </div>
            </fieldset>`
          : nothing
      }
      <wt-input
        name=${this.discountKind}
        autocomplete="off"
        required
        .label=${t(this.discountKind === "percent" ? "adjust.percent" : "adjust.amount")}
        .value=${this.value}
        .error=${error ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          this.value = event.detail.value;
          this.#changed("value");
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>`;
  }

  #reasonChoice(error: string | undefined): TemplateResult {
    const invalid = { required: true, ...(error === undefined ? {} : { errorId: "reason-error" }) };
    return html`<fieldset class="choice" data-reasons>
      <legend>
        ${t("adjust.reason")}<span class="required" data-reason-required aria-hidden="true">*</span>
      </legend>
      <div class="options">
        ${this.#offered().map((reason) =>
          this.#radio(
            "reason",
            reason.id,
            reason.name,
            this.reasonId === reason.id,
            () => {
              this.reasonId = reason.id;
              this.#changed("reason");
            },
            invalid,
          ),
        )}
      </div>
      ${this.#fieldsetError("reason", error)}
    </fieldset>`;
  }

  #confirmStep(preview: AdjustmentPreview): TemplateResult {
    const choice = this.#choice();
    const reason = this.#reason();
    const bottom = this.#bottomMessage(new Map());
    const asked =
      choice.amount !== undefined &&
      compareDecimal(decimal(choice.amount), decimal(preview.reduction)) !== 0
        ? html`<p class="detail" data-nearest>
            ${t("adjust.nearest")
              .replace("{amount}", () => this.#money(preview.reduction))
              .replace("{asked}", () => this.#money(choice.amount!))}
          </p>`
        : nothing;
    return html`${
        reason === undefined
          ? nothing
          : html`<p class="detail">
              ${t("adjust.reason_shown").replace("{reason}", () => reason.name)}
            </p>`
      }
      ${
        choice.note === null
          ? nothing
          : html`<p class="detail">
              ${t("adjust.note_shown").replace("{note}", () => choice.note!)}
            </p>`
      }
      <p class="takes-off" data-takes-off>
        ${t("adjust.takes_off").replace("{amount}", () => this.#money(preview.reduction))}
      </p>
      ${asked}
      ${
        preview.needsApproval === null
          ? nothing
          : html`<p class="approval" data-needs-approval>${t(APPROVAL[preview.needsApproval])}</p>`
      }
      <wt-form-actions .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-adjust-back
          .disabled=${this.busy}
          @click=${() => this.#emit("adjust-edit")}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button
          variant=${this.kind === "discount" ? "primary" : "danger"}
          data-adjust-confirm
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${() => this.#confirm()}
        >
          ${preview.needsApproval === null ? t(DO[this.kind]) : t("adjust.ask_approval")}
        </wt-button>
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-adjustment-dialog": TillAdjustmentDialog;
  }
}
