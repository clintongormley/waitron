import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, draftScopeFor } from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { parseGuestCount } from "./guest-count.js";
import { t } from "../i18n/t.js";

/** null records no count for that side. */
export interface SplitGuestsDetail {
  staying: number | null;
  leaving: number | null;
}

interface Draft {
  staying: string;
  leaving: string;
}

type Side = keyof Draft;

function canonical(value: string): string {
  const parsed = parseGuestCount(value);
  return parsed === undefined ? `invalid:${value.trim()}` : String(parsed.guestCount);
}

@customElement("till-split-guests-dialog")
export class TillSplitGuestsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
    `,
  ];

  @property() stayingLabel = "";
  @property() leavingLabel = "";
  @property() staying = "";
  @property() leaving = "";

  @state() private attempted = false;

  @state() private active = true;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #baseline?: Draft;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.isConnected || !this.active || this.#scope) return;
    this.#baseline ??= this.#draft();
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.#draft(),
      snapshot: (draft) => ({ ...draft }),
      equal: (a, b) =>
        canonical(a.staying) === canonical(b.staying) &&
        canonical(a.leaving) === canonical(b.leaving),
      restore: (draft) => {
        this.staying = draft.staying;
        this.leaving = draft.leaving;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  override async firstUpdated(): Promise<void> {
    await this.renderRoot.querySelector<WtDialog>("wt-dialog")!.updateComplete;
    this.renderRoot.querySelector<HTMLElement>("wt-input")!.focus();
  }

  #draft(): Draft {
    return { staying: this.staying, leaving: this.leaving };
  }

  #invalid(side: Side): boolean {
    return this.attempted && parseGuestCount(this[side]) === undefined;
  }

  #onInput(side: Side, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this[side] = event.detail.value;
    this.#scope?.changed();
  }

  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    this.attempted = true;
    const staying = parseGuestCount(this.staying);
    const leaving = parseGuestCount(this.leaving);
    if (staying === undefined || leaving === undefined) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#baseline = this.#draft();
    this.#scope?.commit(this.#baseline);
    this.dispatchEvent(
      new CustomEvent<SplitGuestsDetail>("split-guests-confirm", {
        detail: { staying: staying.guestCount, leaving: leaving.guestCount },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#leave) {
      void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
      return;
    }
    this.#reportClose();
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#reportClose();
  }

  #reportClose(): void {
    this.dispatchEvent(new CustomEvent("split-guests-cancel", { bubbles: true, composed: true }));
  }

  #field(side: Side, name: string, label: string) {
    return html`<wt-input
      name=${name}
      autocomplete="off"
      .label=${label}
      .value=${live(this[side])}
      .error=${this.#invalid(side) ? t("seat.guest_count_invalid") : ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(side, event)}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector<HTMLElement>("[data-split-guests-confirm]"),
        )}
    ></wt-input>`;
  }

  override render() {
    const invalid = this.#invalid("staying") || this.#invalid("leaving");
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${t("table.split_guests_title")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        ${this.#field("staying", "stayingGuests", this.stayingLabel)}
        ${this.#field("leaving", "leavingGuests", this.leavingLabel)}
        <wt-form-actions .error=${invalid ? t("form.fix_fields") : ""}>
          <wt-button
            slot="cancel"
            data-split-guests-cancel
            variant="secondary"
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-split-guests-confirm
            variant="primary"
            ?disabled=${invalid}
            @click=${() => void this.#confirm()}
          >
            ${t("table.split_guests_confirm")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-split-guests-dialog": TillSplitGuestsDialog;
  }
}
