import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import {
  baseStyles,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
} from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { t } from "../i18n/t.js";

export interface TodaySeatsDetail {
  seats: number;
}

const SEATS_MAX = 999;

function seatsFrom(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seats = Number(trimmed);
  return seats >= 1 && seats <= SEATS_MAX ? seats : null;
}

@customElement("till-today-seats-dialog")
export class TillTodaySeatsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property() heading = "";
  @property({ attribute: false }) seats: number | null = null;
  @property() action: "join" | "save" = "save";

  @state() private value = "";
  @state() private attempted = false;
  @state() private active = true;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  #baseline?: string;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(): void {
    if (!this.isConnected || !this.active || this.#scope) return;
    if (this.#baseline === undefined) {
      this.#baseline = this.seats !== null && this.seats > 0 ? String(this.seats) : "";
      this.value = this.#baseline;
    }
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => {
        const [x, y] = [seatsFrom(a), seatsFrom(b)];
        return x !== null && y !== null ? x === y : a.trim() === b.trim();
      },
      restore: (value) => (this.value = value),
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
    this.renderRoot.querySelector<HTMLElement>("wt-number-stepper")!.focus();
  }

  #actionState() {
    return saveActionState(this.#scope);
  }

  #invalid(): boolean {
    return this.attempted && seatsFrom(this.value) === null;
  }

  #onInput(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.value = event.detail.value;
    this.#scope?.changed();
  }

  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    if (this.#actionState().unchanged) return;
    this.attempted = true;
    const seats = seatsFrom(this.value);
    if (seats === null) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#baseline = this.value;
    this.#scope?.commit(this.value);
    this.dispatchEvent(
      new CustomEvent<TodaySeatsDetail>("today-seats-confirm", {
        detail: { seats },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("today-seats-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const invalid = this.#invalid();
    const actionState = this.#actionState();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${this.heading}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-number-stepper
          name="seats"
          required
          .min=${1}
          .max=${SEATS_MAX}
          .label=${t("floor.seats_label")}
          .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", label)}
          .increaseLabel=${(label: string) => t("action.increase").replace("{label}", label)}
          .value=${live(this.value)}
          .error=${invalid ? t("floor.seats_invalid") : ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onInput(event)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-seats-action]"),
            )}
        ></wt-number-stepper>
        <wt-form-actions .error=${invalid ? t("form.fix_fields") : ""}>
          <wt-button
            slot="cancel"
            data-seats-cancel
            variant="secondary"
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-seats-action
            variant=${actionState.variant}
            ?disabled=${actionState.unchanged || invalid}
            @click=${() => void this.#confirm()}
          >
            ${t(this.action === "join" ? "floor.seats_join" : "floor.seats_save")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-today-seats-dialog": TillTodaySeatsDialog;
  }
}
