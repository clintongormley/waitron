import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { compareDecimal, decimal, formatMoney, multiplyDecimal } from "@waitron/shared";
import { trackDialog } from "./track-dialog.js";
import { parseDecimalInput } from "@waitron/ui";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import type {
  AdjustmentAction,
  AdjustmentApproval,
  AdjustmentPreview,
  AdjustmentReason,
} from "../api/client.js";

export type AdjustKind = "cancel" | "comp" | "discount";

/** What an adjustment acts on, as the dialog names it before anything is done. */
export interface AdjustTarget {
  /** The dish or the extra; null for the whole bill. */
  lineId: string | null;
  name: string;
  /** Its quantity as shown; null for the bill. */
  quantity: string | null;
  /** What the action can take off: the dish with its extras, the extra, or the whole bill. */
  total: string;
  /** One unit's price, with its share of any extras, when the dish is several whole units the
   * action may take one of; null when only the whole of it can be adjusted (a weighed dish, or an
   * extra). */
  unitTotal: string | null;
  extras?: AdjustTarget[];
  started?: boolean;
  /** Sold by weight, which the server refuses to give away or discount in part. */
  weighed?: boolean;
  /** An extra of a dish, adjusted on its own. */
  extra?: boolean;
  /** An extra of a dish the kitchen has been sent, so cancelling it tells the kitchen. */
  kitchenTold?: boolean;
}

/** The person's choices, which the app asks the server about and then applies. */
export interface AdjustmentChoice {
  action: AdjustmentAction;
  lineId?: string;
  reasonId: string;
  note: string | null;
  quantity?: string;
  percentBp?: number;
  amount?: string;
}

type DiscountKind = "percent" | "amount";
type CompKind = "free" | DiscountKind;
interface AdjustmentDraft {
  compKind: CompKind;
  extraId: string | null;
  count: string | null;
  quantity: "1" | "all";
  discountKind: DiscountKind;
  reasonId: string;
  note: string;
  value: string;
}
type Field = "reason" | "note" | "value" | "quantity";

/** The field of the form a refusal is about, or null when it is about none the form shows. */
export function refusalField(code: string, kind: AdjustKind, partial: boolean): Field | null {
  switch (code) {
    case "adjustment.note_required":
      return "note";
    case "adjustment.exceeds_amount":
    case "adjustment.no_reduction":
      return kind === "discount" ? "value" : null;
    case "adjustment.action_not_allowed":
    case "adjustment.reason_inactive":
    case "adjustment_reason.not_found":
      return "reason";
    case "adjustment.quantity_invalid":
    case "adjustment.weighed_partial":
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

const EXTRA_TITLES: Record<AdjustKind, StringKey> = {
  cancel: "adjust.cancel_extra_title",
  comp: "adjust.comp_extra_title",
  discount: "adjust.discount_extra_title",
};

const DO: Record<AdjustKind, StringKey> = {
  cancel: "adjust.do_cancel",
  comp: "adjust.do_comp",
  discount: "adjust.do_discount",
};

const TYPED_AMOUNT = /^\d{1,9}(\.\d{1,2})?$/;

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
  @property({ type: Boolean }) combined = false;
  @property({ attribute: false }) target: AdjustTarget | null = null;
  /** The venue's active reasons; the form offers those allowing the action. */
  @property({ attribute: false }) reasons: AdjustmentReason[] = [];
  /** The server's answer to the last `adjust-preview`; set with {@link choice}, the dialog asks for
   * confirmation. */
  @property({ attribute: false }) preview: AdjustmentPreview | null = null;
  /** The choice the preview was asked for: what the confirm step shows and confirms. */
  @property({ attribute: false }) choice: AdjustmentChoice | null = null;
  /** The code of the last request's refusal. */
  @property() refusal: string | null = null;
  @property({ type: Boolean }) busy = false;

  @state() private compKind: CompKind = "free";
  @state() private extraId: string | null = null;
  @state() private count: string | null = null;
  @state() private quantity: "1" | "all" = "all";
  @state() private discountKind: DiscountKind = "percent";
  @state() private reasonId = "";
  @state() private note = "";
  @state() private value = "";
  @state() private attempted = false;
  /** The refusal still shown: it goes when the field it names changes, or at the next submission. */
  @state() private shownRefusal: string | null = null;

  @state() private active = true;
  #baseline?: AdjustmentDraft;
  #scope?: DraftScope<AdjustmentDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
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

  #draft(): AdjustmentDraft {
    return {
      compKind: this.compKind,
      extraId: this.extraId,
      count: this.count,
      quantity: this.quantity,
      discountKind: this.discountKind,
      reasonId: this.reasonId,
      note: this.note,
      value: this.value,
    };
  }

  #comparable(draft: AdjustmentDraft): string {
    const typed = draft.value.trim();
    const number = parseDecimalInput(typed) ?? typed;
    const percent = Number(number);
    const value = !(this.combined ? draft.compKind !== "free" : this.kind === "discount")
      ? null
      : (this.combined ? draft.compKind : draft.discountKind) === "percent" &&
          TYPED_AMOUNT.test(number) &&
          percent > 0 &&
          percent <= 100
        ? Math.round(percent * 100)
        : (this.combined ? draft.compKind : draft.discountKind) === "amount" &&
            /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(number)
          ? number.replace(/\.0+$|(?<=\.[0-9])0$/, "")
          : typed;
    return JSON.stringify({
      action: this.combined
        ? draft.compKind
        : this.kind === "discount"
          ? draft.discountKind
          : this.kind,
      extraId: this.combined ? draft.extraId : null,
      count: this.combined && this.#partial() ? (draft.count ?? this.target?.quantity) : null,
      quantity: this.#partial() ? draft.quantity : null,
      reasonId: draft.reasonId,
      note: draft.note.trim() || null,
      value,
    });
  }

  closeSaved(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.active = false;
    this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.closeAfter("saved");
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (this.#scope) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
    } else this.#emit("adjust-close");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#emit("adjust-close");
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("refusal")) this.shownRefusal = this.refusal;
    if (this.combined && changed.has("reasons")) this.#pickCompKind();
    if (!this.combined && (changed.has("reasons") || changed.has("kind"))) {
      const kinds = this.#discountKinds();
      if (!kinds.includes(this.discountKind) && kinds[0] !== undefined) {
        this.discountKind = kinds[0];
        this.#scope?.changed();
      }
    }
    if (!this.isConnected || !this.active || this.target === null || this.#scope) return;
    this.#baseline ??= this.#draft();
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<AdjustmentDraft>({
      id: this,
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => this.#comparable(a) === this.#comparable(b),
      restore: (value) => {
        this.compKind = value.compKind;
        this.extraId = value.extraId;
        this.count = value.count;
        this.quantity = value.quantity;
        this.discountKind = value.discountKind;
        this.reasonId = value.reasonId;
        this.note = value.note;
        this.value = value.value;
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  #action(): AdjustmentAction {
    if (this.combined)
      return this.compKind === "free"
        ? "comp"
        : this.compKind === "percent"
          ? "discount_percent"
          : "discount_amount";
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
    return this.reasons.filter((reason) =>
      this.combined
        ? reason.actions.some((action) => action !== "cancel")
        : reason.actions.includes(action),
    );
  }

  #reason(): AdjustmentReason | undefined {
    return this.#offered().find((reason) => reason.id === this.reasonId);
  }

  #partial(): boolean {
    return this.#target()?.unitTotal != null;
  }

  /** The most a discount can take: one unit, or all the action covers. */
  #covered(): string {
    const target = this.#target()!;
    if (this.combined && this.#partial())
      return compareDecimal(decimal(this.#count()), decimal(target.quantity!)) === 0
        ? target.total
        : multiplyDecimal(decimal(target.unitTotal!), decimal(this.#count()));
    return this.quantity === "1" && target.unitTotal !== null ? target.unitTotal : target.total;
  }

  #money(amount: string): string {
    return formatMoney(amount, currentLocale());
  }

  /** Whose PIN the adjustment needs; a reason no longer listed gets the general sentence. */
  #approvalText(approval: AdjustmentApproval, reason: AdjustmentReason | undefined): string {
    switch (approval.by) {
      case "reason":
        return reason === undefined
          ? t("adjust.approval_any")
          : t("adjust.approval_reason").replace("{reason}", () => reason.name);
      case "bill_limit":
        return t("adjust.approval_bill_limit").replace("{limit}", () =>
          this.#money(approval.limit),
        );
      case "refund":
        return t("adjust.approval_refund");
    }
  }

  #typedNumber(): string {
    const number = parseDecimalInput(this.value) ?? this.value.trim();
    return TYPED_AMOUNT.test(number) ? number.replace(/^0+(?=\d)/, "") : number;
  }

  /** The form's own checks, by field; an empty map when it can be sent. */
  #ownErrors(): Map<Field, string> {
    const errors = new Map<Field, string>();
    const reason = this.#reason();
    if (reason === undefined || (this.combined && !reason.actions.includes(this.#action())))
      errors.set("reason", t("adjust.reason_required"));
    if (reason?.noteRequired === true && this.note.trim() === "")
      errors.set("note", t("adjust.note_required"));
    if (
      this.combined &&
      this.#partial() &&
      (!/^[1-9]\d*$/.test(this.#count()) ||
        compareDecimal(decimal(this.#count()), decimal(this.target!.quantity!)) > 0)
    )
      errors.set("quantity", codeMessage("adjustment.quantity_invalid"));
    if (this.kind === "discount" || (this.combined && this.compKind !== "free")) {
      const number = this.#typedNumber();
      if ((this.combined ? this.compKind : this.discountKind) === "percent") {
        const percent = Number(number);
        if (!TYPED_AMOUNT.test(number) || percent <= 0 || percent > 100)
          errors.set("value", t("adjust.percent_invalid"));
      } else if (!TYPED_AMOUNT.test(number) || Number(number) <= 0) {
        errors.set("value", t("adjust.amount_invalid"));
      } else if (
        !errors.has("quantity") &&
        compareDecimal(decimal(number), decimal(this.#covered())) > 0
      ) {
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
      : refusalField(
          this.shownRefusal,
          this.combined && this.compKind !== "free" ? "discount" : this.kind,
          this.#partial(),
        );
  }

  /** What each field shows under it: the server's refusal of it, else its own check in `own`. */
  #fieldErrors(own: ReadonlyMap<Field, string>): Map<Field, string> {
    const errors = new Map(own);
    const field = this.#refusalField();
    if (field !== null) errors.set(field, codeMessage(this.shownRefusal!));
    return errors;
  }

  /** The one message above the action: the generic one while a field is marked, and a refusal
   * that names no field in its own words. */
  #bottomMessage(fieldErrors: Map<Field, string>): string {
    const parts: string[] = [];
    if (fieldErrors.size > 0) parts.push(t("form.fix_fields"));
    if (this.shownRefusal !== null && this.#refusalField() === null)
      parts.push(codeMessage(this.shownRefusal));
    return parts.join(" ");
  }

  #changed(field: Field): void {
    this.#scope?.changed();
    if (this.#refusalField() === field) this.shownRefusal = null;
  }

  #choice(): AdjustmentChoice {
    const note = this.note.trim();
    const choice: AdjustmentChoice = {
      action: this.#action(),
      reasonId: this.reasonId,
      note: note === "" ? null : note,
    };
    if (this.combined) {
      if (this.extraId !== null) choice.lineId = this.extraId;
      if (
        this.#partial() &&
        compareDecimal(decimal(this.#count()), decimal(this.target!.quantity!)) < 0
      )
        choice.quantity = this.#count();
    } else if (this.#partial() && this.quantity === "1") choice.quantity = "1";
    const typed = this.#typedNumber();
    if (choice.action === "discount_percent") choice.percentBp = Math.round(Number(typed) * 100);
    if (choice.action === "discount_amount") choice.amount = typed;
    return choice;
  }

  #emit(type: string, detail: unknown = {}): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  async #continue(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    this.attempted = true;
    this.shownRefusal = null;
    if (this.#ownErrors().size > 0) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#emit("adjust-preview", this.#choice());
  }

  #confirm(choice: AdjustmentChoice): void {
    if (!this.isConnected || !this.active || this.busy) return;
    if (
      this.combined &&
      (this.#ownErrors().size > 0 ||
        (["action", "lineId", "reasonId", "note", "quantity", "percentBp", "amount"] as const).some(
          (key) => this.#choice()[key] !== choice[key],
        ))
    ) {
      this.#emit("adjust-edit");
      return;
    }
    this.shownRefusal = null;
    this.#emit("adjust-confirm", choice);
  }

  override render() {
    const target = this.#target();
    if (target === null) return nothing;
    const title = this.combined
      ? t("comp.title")
      : this.kind === "discount" && target.lineId === null
        ? t("adjust.discount_bill_title")
        : t((target.extra === true ? EXTRA_TITLES : TITLES)[this.kind]);
    const noReasons =
      this.kind === "discount" ? this.#discountKinds().length === 0 : this.#offered().length === 0;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${title}
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="body">
        <p class="scope" data-adjust-scope>${this.#scopeTitle(target)}</p>
        ${
          noReasons
            ? this.#noReasons()
            : this.preview === null || this.choice === null
              ? this.combined
                ? this.#compForm(target)
                : this.#form(target)
              : this.#confirmStep(this.preview, this.choice)
        }
      </div>
    </wt-dialog>`;
  }

  #target(): AdjustTarget | null {
    return this.combined && this.extraId !== null
      ? (this.target?.extras?.find((extra) => extra.lineId === this.extraId) ?? null)
      : this.target;
  }

  #count(): string {
    return this.count ?? this.target?.quantity ?? "1";
  }

  #compKinds(): CompKind[] {
    const actions = this.#reason()?.actions ?? [];
    return [
      ...(actions.includes("comp") ? ["free" as const] : []),
      ...(actions.includes("discount_percent") ? ["percent" as const] : []),
      ...(actions.includes("discount_amount") ? ["amount" as const] : []),
    ];
  }

  #pickCompKind(): void {
    const kinds = this.#compKinds();
    if (!kinds.includes(this.compKind)) {
      this.compKind = kinds[0] ?? "free";
      this.value = "";
      this.#scope?.changed();
    }
  }

  #reasonLabel(reason: AdjustmentReason): string {
    const kinds = [
      ...(reason.actions.includes("comp") ? [t("comp.free")] : []),
      ...(reason.actions.includes("discount_percent")
        ? [
            reason.maxPercentBp === null
              ? "%"
              : t("comp.up_to").replace(
                  "{value}",
                  new Intl.NumberFormat(currentLocale()).format(reason.maxPercentBp / 100) + "%",
                ),
          ]
        : []),
      ...(reason.actions.includes("discount_amount") ? ["€"] : []),
    ];
    const cap =
      reason.maxAmount === null
        ? ""
        : " · " + t("comp.bill_cap").replace("{value}", this.#money(reason.maxAmount));
    return `${reason.name} · ${kinds.join(", ")}${cap} · ${t("comp.policy")
      .replace("{apply}", t(`comp.role_${reason.applyRole}`))
      .replace("{approve}", t(`comp.role_${reason.approverRole}`))}`;
  }

  #compLabel(choice?: AdjustmentChoice): string {
    const count =
      choice?.quantity ?? (this.#partial() ? this.#count() : this.#target()?.quantity) ?? "1";
    const action = choice?.action ?? this.#action();
    if (action === "comp") return t("comp.make_free").replace("{n}", count);
    const typed = this.#typedNumber();
    const value =
      action === "discount_percent"
        ? new Intl.NumberFormat(currentLocale()).format(
            choice?.percentBp === undefined ? Number(typed) || 0 : choice.percentBp / 100,
          ) + "%"
        : this.#money(choice?.amount ?? (TYPED_AMOUNT.test(typed) ? typed : "0"));
    return t("comp.take_off").replace("{value}", value).replace("{n}", count);
  }

  #compForm(target: AdjustTarget): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const kinds = this.#compKinds();
    const reason = this.#reason();
    const extras = this.target?.extras ?? [];
    return html` ${this.#reasonChoice(errors.get("reason"))}
      ${
        extras.length === 0
          ? nothing
          : html`<fieldset class="choice" data-adjust-target ?disabled=${this.busy}>
              <legend>${t("comp.what")}</legend>
              <div class="options">
                ${[this.target!, ...extras].map((option) =>
                  this.#radio(
                    "adjustTarget",
                    option.lineId!,
                    option === this.target ? t("comp.whole_dish") : option.name,
                    (this.extraId ?? this.target!.lineId) === option.lineId,
                    () => {
                      this.extraId = option === this.target ? null : option.lineId;
                      this.count = null;
                      this.value = "";
                      this.#changed("quantity");
                    },
                  ),
                )}
              </div>
            </fieldset>`
      }
      ${
        kinds.length < 2
          ? nothing
          : html`<fieldset class="choice" data-discount-kind ?disabled=${this.busy}>
              <legend>${t("comp.how_much")}</legend>
              <div class="options">
                ${kinds.map((kind) =>
                  this.#radio(
                    "discountKind",
                    kind,
                    kind === "free" ? t("comp.free") : kind === "percent" ? "%" : "€",
                    this.compKind === kind,
                    () => {
                      this.compKind = kind;
                      this.value = "";
                      this.#changed("value");
                    },
                  ),
                )}
              </div>
            </fieldset>`
      }
      ${this.compKind === "free" ? nothing : this.#discountFields(errors.get("value"))}
      ${
        !this.#partial()
          ? nothing
          : html`<wt-number-stepper
              name="adjustQuantity"
              .label=${t("adjust.quantity")}
              .value=${this.#count()}
              .min=${1}
              .max=${Number(target.quantity)}
              .disabled=${this.busy}
              .error=${errors.get("quantity") ?? ""}
              .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", label)}
              .increaseLabel=${(label: string) => t("action.increase").replace("{label}", label)}
              @keydown=${(event: KeyboardEvent) => this.#enter(event)}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                if (this.isConnected && this.active && !this.busy) {
                  this.count = event.detail.value;
                  this.#changed("quantity");
                }
              }}
            ></wt-number-stepper>`
      }
      <wt-input
        name="note"
        autocomplete="off"
        .disabled=${this.busy}
        .maxlength=${500}
        .label=${t("adjust.note")}
        .value=${live(this.note)}
        .required=${reason?.noteRequired === true}
        .error=${errors.get("note") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (this.isConnected && this.active && !this.busy) {
            this.note = event.detail.value;
            this.#changed("note");
          }
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>
      ${target.weighed === true ? html`<p class="detail" data-weighed-hint>${codeMessage("adjustment.weighed_partial")}</p>` : nothing}
      <wt-form-actions .error=${this.#bottomMessage(errors)}
        >${this.#closeButton("cancel")}<wt-button
          variant=${reason === undefined ? "secondary" : "primary"}
          data-adjust-continue
          .loading=${this.busy}
          .disabled=${this.busy || reason === undefined || own.size > 0}
          @click=${() => void this.#continue()}
          >${this.#compLabel()}</wt-button
        ></wt-form-actions
      >`;
  }

  #scopeTitle(target: AdjustTarget): string {
    const quantity = target.quantity === null ? "" : ` ×${target.quantity}`;
    return `${target.name}${quantity} · ${this.#money(target.total)}`;
  }

  #closeButton(slot: string): TemplateResult {
    return html`<wt-button
      slot=${slot}
      variant="secondary"
      data-adjust-close
      .disabled=${this.busy}
      @click=${() => this.#cancel()}
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
          if (!this.isConnected || !this.active || this.busy) return;
          pick();
        }}
      />
      <span>${label}</span>
    </label>`;
  }

  #form(target: AdjustTarget): TemplateResult {
    const own = this.attempted ? this.#ownErrors() : new Map<Field, string>();
    const errors = this.#fieldErrors(own);
    const bottom = this.#bottomMessage(errors);
    const reason = this.#reason();
    const cancelWording =
      this.kind === "cancel"
        ? html`<p class="lead">
            ${
              target.started === true
                ? t("table.cancel_started")
                : target.kitchenTold === true
                  ? t("table.cancel_extra_told")
                  : t("table.cancel_sent")
            }
          </p>`
        : nothing;
    return html`${cancelWording}
      ${this.#partial() ? this.#quantityChoice(target, errors.get("quantity")) : nothing}
      ${this.kind === "discount" ? this.#discountFields(errors.get("value")) : nothing}
      ${this.#reasonChoice(errors.get("reason"))}
      <wt-input
        name="note"
        autocomplete="off"
        .disabled=${this.busy}
        .maxlength=${500}
        .label=${t("adjust.note")}
        .value=${live(this.note)}
        .required=${reason?.noteRequired === true}
        .error=${errors.get("note") ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (!this.isConnected || !this.active || this.busy) return;
          this.note = event.detail.value;
          this.#changed("note");
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>
      ${
        target.weighed === true && this.kind !== "cancel"
          ? html`<p class="detail" data-weighed-hint>
              ${codeMessage("adjustment.weighed_partial")}
            </p>`
          : nothing
      }
      <wt-form-actions .error=${bottom}>
        ${this.#closeButton("cancel")}
        <wt-button
          variant="primary"
          data-adjust-continue
          .loading=${this.busy}
          .disabled=${this.busy || own.size > 0}
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
    return html`<fieldset class="choice" data-quantity ?disabled=${this.busy}>
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
    const kinds = this.combined ? [] : this.#discountKinds();
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
          ? html`<fieldset class="choice" data-discount-kind ?disabled=${this.busy}>
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
        name=${this.combined ? this.compKind : this.discountKind}
        decimal-locale=${currentLocale()}
        autocomplete="off"
        .disabled=${this.busy}
        required
        .label=${t((this.combined ? this.compKind : this.discountKind) === "percent" ? "adjust.percent" : "adjust.amount")}
        .value=${live(this.value)}
        .error=${error ?? ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (!this.isConnected || !this.active || this.busy) return;
          this.value = event.detail.value;
          this.#changed("value");
        }}
        @keydown=${(event: KeyboardEvent) => this.#enter(event)}
      ></wt-input>`;
  }

  #reasonChoice(error: string | undefined): TemplateResult {
    const invalid = { required: true, ...(error === undefined ? {} : { errorId: "reason-error" }) };
    return html`<fieldset class="choice" data-reasons ?disabled=${this.busy}>
      <legend>
        ${t("adjust.reason")}<span class="required" data-reason-required aria-hidden="true">*</span>
      </legend>
      <div class="options">
        ${this.#offered().map((reason) =>
          this.#radio(
            "reason",
            reason.id,
            this.combined ? this.#reasonLabel(reason) : reason.name,
            this.reasonId === reason.id,
            () => {
              this.reasonId = reason.id;
              if (this.combined) this.#pickCompKind();
              this.#changed("reason");
            },
            invalid,
          ),
        )}
      </div>
      ${this.#fieldsetError("reason", error)}
    </fieldset>`;
  }

  #confirmStep(preview: AdjustmentPreview, choice: AdjustmentChoice): TemplateResult {
    const reason = this.reasons.find((candidate) => candidate.id === choice.reasonId);
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
        choice.quantity === undefined
          ? nothing
          : html`<p class="detail" data-quantity-shown>
              ${
                this.combined
                  ? t("comp.quantity_shown")
                      .replace("{count}", () => choice.quantity!)
                      .replace("{n}", () => this.#target()!.quantity!)
                  : t("adjust.quantity_shown").replace("{n}", () => this.target!.quantity!)
              }
            </p>`
      }
      ${
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
          : html`<p class="approval" data-needs-approval>
              ${this.#approvalText(preview.needsApproval, reason)}
            </p>`
      }
      <wt-form-actions .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-adjust-back
          .disabled=${this.busy}
          @click=${() => {
            if (this.isConnected && this.active && !this.busy) this.#emit("adjust-edit");
          }}
        >
          ${t("action.back")}
        </wt-button>
        <wt-button
          variant=${this.kind === "cancel" ? "danger" : "primary"}
          data-adjust-confirm
          .loading=${this.busy}
          .disabled=${this.busy}
          @click=${() => this.#confirm(choice)}
        >
          ${preview.needsApproval === null ? (this.combined ? this.#compLabel(choice) : t(DO[this.kind])) : t("adjust.ask_approval")}
        </wt-button>
      </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-adjustment-dialog": TillAdjustmentDialog;
  }
}
