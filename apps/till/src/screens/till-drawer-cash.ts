import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { formatMoney } from "@waitron/shared";
import {
  FormFeedback,
  baseStyles,
  draftScopeFor,
  formMessage,
  formMessageStyles,
  saveActionState,
  submitOnEnter,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-amount-block.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-choice-tile.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import type { TillApi } from "../api/client.js";
import type { DrawerEntryRequest } from "../api/drawer-api.js";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/numeric-pad.js";
import { trackDialog } from "../widgets/track-dialog.js";

type Direction = DrawerEntryRequest["kind"] | "";
type Field = "amount" | "reason";
type Change = CustomEvent<{ value: string }>;

@customElement("till-drawer-cash")
export class TillDrawerCash extends LitElement {
  static override styles = [
    baseStyles,
    formMessageStyles,
    css`
      form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-block-size: 100%;
        max-inline-size: var(--wt-till-chooser-dialog-width);
        margin-inline: auto;
        padding: var(--wt-space-4);
      }

      wt-full-screen-panel::part(body) {
        display: grid;
      }

      p {
        margin: 0;
      }

      .movement {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: var(--wt-space-2);
      }

      wt-choice-tile::part(label) {
        text-align: center;
      }

      wt-amount-block {
        padding-block-start: var(--wt-space-1);
        font-weight: var(--wt-font-weight-normal);
      }

      wt-amount-block::part(amount) {
        font-size: calc(2 * var(--wt-font-size-xl));
        font-weight: bolder;
      }

      .amount-error {
        color: var(--wt-color-danger);
      }

      till-numeric-pad {
        --wt-action-weight: var(--wt-font-weight-normal);
        --wt-till-keypad-row-height: calc(var(--wt-tap-min) + var(--wt-space-1) / 2);
        margin-block-start: auto;
      }

      till-numeric-pad::part(pad) {
        gap: calc(var(--wt-space-2) - var(--wt-space-1) / 2);
      }

      till-numeric-pad::part(key) {
        font-size: var(--wt-font-size-lg);
      }

      [data-cash-feedback] {
        max-inline-size: var(--wt-till-chooser-dialog-width);
        margin-inline: auto;
        padding-inline: var(--wt-space-4);
      }

      wt-foot-button-bar > wt-button {
        inline-size: 100%;
        max-inline-size: calc(var(--wt-till-chooser-dialog-width) - 2 * var(--wt-space-4));
        justify-self: center;
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<TillApi, "saveDrawerEntry">;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property() printerId = "";
  @property() printerName = "";
  @property({ type: Boolean }) opensDrawer = false;
  @state() private draft = { kind: "" as Direction, amount: "", reason: "" };
  @state() private busy = false;
  @state() private switchOperator = false;
  @state() private refusals: Partial<Record<Field | "request", string>> = {};
  readonly #feedback = new FormFeedback(this);
  #leave?: ReturnType<typeof draftScopeFor<typeof this.draft>>;
  #submission?: DrawerEntryRequest;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#leave = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (draft) => draft,
      equal: (a, b) => a.kind === b.kind && a.amount === b.amount && a.reason === b.reason,
      restore: (draft) => (this.draft = draft),
    });
  }

  override disconnectedCallback(): void {
    this.#leave?.scope.dispose();
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #change(field: Field | "kind", value: string): void {
    if (this.busy) return;
    if (field === "amount" && !/^\d{0,12}(?:\.\d{0,2})?$/.test(value)) return;
    this.draft = { ...this.draft, [field]: value };
    this.#leave?.scope.changed();
    this.#feedback.dismiss(field);
  }

  #fieldChanged(field: Field, event: Change): void {
    event.stopPropagation();
    this.#change(field, event.detail.value);
  }

  #showRefusal(error: unknown): void {
    const { code, params } = (error ?? {}) as { code?: string; params?: { field?: string } };
    if (
      code === "drawer.entry_invalid_field" &&
      (params?.field === "amount" || params?.field === "reason")
    ) {
      const { field } = params;
      this.refusals = {
        [field]: t(field === "amount" ? "drawer_entry.amount_error" : "drawer_entry.reason_error"),
      };
      void this.#feedback.focus(this.renderRoot);
    } else {
      this.switchOperator = code === "authorization.not_permitted";
      this.refusals = {
        request: t(
          this.switchOperator
            ? "drawer_entry.permission"
            : code === "drawer.assignment_changed" || code === "drawer.no_printer"
              ? "drawer_entry.reopen"
              : code === "submission.id_reused"
                ? "drawer_entry.reused"
                : "drawer_entry.failed",
        ),
      };
    }
    this.#feedback.newRefusal();
  }

  #checks() {
    const entered = this.draft.amount.replace(/\.$/, "");
    const amount = /[1-9]/.test(entered) ? entered : null;
    const reason = this.draft.reason.trim();
    const errors = {
      amount: amount === null ? t("drawer_entry.amount_error") : "",
      reason: !reason || reason.length > 500 ? t("drawer_entry.reason_error") : "",
    };
    return { amount, reason, errors };
  }

  async #save(): Promise<void> {
    const { kind } = this.draft;
    if (this.busy || !kind || saveActionState(this.#leave?.scope).unchanged) return;
    this.#feedback.press();
    this.refusals = {};
    this.switchOperator = false;
    const { amount, reason, errors } = this.#checks();
    if (amount === null || errors.reason) {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    const previous = this.#submission;
    const submission =
      previous?.kind === kind && previous.amount === amount && previous.reason === reason
        ? previous
        : { printerId: this.printerId, submissionId: crypto.randomUUID(), kind, amount, reason };
    this.#submission = submission;
    this.busy = true;
    try {
      await this.api.saveDrawerEntry(submission);
      this.#leave?.scope.commit(this.draft);
      this.renderRoot.querySelector<WtDialog>("wt-dialog")?.closeAfter("saved");
      this.dispatchEvent(new CustomEvent("drawer-cash-saved"));
    } catch (error) {
      this.#showRefusal(error);
    } finally {
      this.busy = false;
    }
  }

  #close(): void {
    void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("navigation");
  }

  readonly #beforeClose: NonNullable<WtDialog["beforeClose"]> = async (reason) =>
    !this.busy &&
    (this.#leave?.coordinator === undefined ||
      (await this.#leave.coordinator.request({ scopes: [this], reason, proceed() {} })) ===
        "proceeded");

  override render() {
    const checks = this.#checks().errors;
    const errors = { ...this.#feedback.remaining(this.refusals) };
    if (this.#feedback.attempted) {
      errors.amount ||= checks.amount;
      errors.reason ||= checks.reason;
    }
    const fields = new Set<Field>();
    if (errors.amount) fields.add("amount");
    if (errors.reason) fields.add("reason");
    const { unchanged } = saveActionState(this.#leave?.scope);
    const available =
      !unchanged &&
      !!this.draft.kind &&
      (!this.#feedback.attempted || (!checks.amount && !checks.reason));
    const locale = currentLocale();
    const amount = formatMoney(this.draft.amount || "0", locale);
    const action = !this.draft.kind
      ? t("drawer_entry.save")
      : t(
          this.draft.kind === "cash_in" ? "drawer_entry.add_amount" : "drawer_entry.take_amount",
        ).replace("{amount}", () => amount);
    const title = t("drawer_entry.title");
    return html`
      <wt-dialog
        ${trackDialog()}
        full-screen
        aria-label=${title}
        .open=${true}
        .opener=${this.opener}
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (event.target === event.currentTarget)
            this.dispatchEvent(new CustomEvent("drawer-cash-dismiss"));
        }}
      >
        <wt-full-screen-panel .bodyLabel=${title}>
          <wt-top-bar
            slot="header"
            .heading=${title}
            .subtitle=${this.printerName ? t("drawer_entry.printer").replace("{printer}", () => this.printerName) : ""}
            .backLabel=${t("tab.floor")}
            .backDisabled=${this.busy}
            @wt-back=${this.#close}
          ></wt-top-bar>
          <form
            @submit=${(event: Event) => {
              event.preventDefault();
              void this.#save();
            }}
          >
            <div class="movement" role="group" aria-label=${t("drawer_entry.direction")}>
              <wt-choice-tile
                .label=${t("drawer_entry.in")}
                .selected=${this.draft.kind === "cash_in"}
                .disabled=${this.busy}
                @click=${() => this.#change("kind", "cash_in")}
              ></wt-choice-tile>
              <wt-choice-tile
                .label=${t("drawer_entry.out")}
                .selected=${this.draft.kind === "cash_out"}
                .disabled=${this.busy}
                @click=${() => this.#change("kind", "cash_out")}
              ></wt-choice-tile>
            </div>
            ${this.opensDrawer ? nothing : html`<p>${t("drawer_close.use_key")}</p>`}
            <div
              class="amount"
              role="group"
              aria-labelledby="amount-label"
              aria-invalid=${errors.amount ? "true" : nothing}
              aria-describedby=${errors.amount ? "amount-error" : nothing}
              tabindex="-1"
            >
              <wt-amount-block>
                <span id="amount-label" slot="label">${t("drawer_entry.amount")}</span>
                ${amount}
                ${errors.amount ? html`<span id="amount-error" class="amount-error" slot="breakdown">${errors.amount}</span>` : nothing}
              </wt-amount-block>
            </div>
            <wt-input
              name="reason"
              required
              .label=${t("drawer_entry.reason")}
              .value=${this.draft.reason}
              .error=${errors.reason ?? ""}
              .disabled=${this.busy}
              @wt-change=${(event: Change) => this.#fieldChanged("reason", event)}
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(event, this.renderRoot.querySelector('[data-cash-action="save"]'))}
            ></wt-input>
            <till-numeric-pad
              ascending
              .value=${this.draft.amount}
              @wt-change=${(event: Change) => this.#fieldChanged("amount", event)}
              @pad-enter=${() => {
                if (available) void this.#save();
              }}
            ></till-numeric-pad>
          </form>
          <div slot="footer">
            <div data-cash-feedback>
              ${formMessage(this.#feedback.message(errors, fields, t("form.fix_fields")))}
            </div>
            <wt-foot-button-bar>
              ${
                this.switchOperator
                  ? html`<wt-button
                      variant="secondary"
                      @click=${() => this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }))}
                      >${t("action.logout")}</wt-button
                    >`
                  : nothing
              }
              <wt-button
                data-cash-action="save"
                variant=${available || this.busy ? "primary" : "secondary"}
                .disabled=${!available || this.busy}
                .loading=${this.busy}
                @click=${this.#save}
                >${action}${this.opensDrawer && this.draft.kind ? t("drawer_entry.opens_drawer") : ""}</wt-button
              >
            </wt-foot-button-bar>
          </div>
        </wt-full-screen-panel>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-drawer-cash": TillDrawerCash;
  }
}
