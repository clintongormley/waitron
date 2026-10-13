import { LitElement, css, html, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, draftScopeFor, saveActionState } from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import type { TableState } from "../api/client.js";
import type { ApartReason } from "../state/floor-today.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";

export interface JoinAgainDetail {
  seats: number;
}

interface Draft {
  seats: string;
}

const SEATS_MAX = 999;

const REASON_KEYS = {
  guests: "floor.apart_guests",
  food: "floor.apart_food",
} as const satisfies Record<ApartReason, string>;

function seatsFrom(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seats = Number(trimmed);
  return seats >= 1 && seats <= SEATS_MAX ? seats : null;
}

@customElement("till-join-again-dialog")
export class TillJoinAgainDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
      }
      wt-number-stepper {
        --wt-stepper-field-width: 100%;
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) joined!: TableState;
  @property({ attribute: false }) apart: { table: TableState; reason: ApartReason }[] = [];
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal: { code: string; field?: string } | null = null;

  @state() private seats = "";
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  @state() private active = true;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #baseline: Draft = { seats: "" };
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("refusal")) this.refusalDismissed = false;
    if (!this.isConnected || !this.active || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => ({ seats: this.seats }),
      snapshot: (value) => ({ seats: value.seats }),
      equal: (a, b) => {
        const [x, y] = [seatsFrom(a.seats), seatsFrom(b.seats)];
        return x !== null && y !== null ? x === y : a.seats.trim() === b.seats.trim();
      },
      restore: (value) => {
        this.seats = value.seats;
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

  /** Marks the seats saved, so the holder can close the window without the leave question. */
  commit(): void {
    if (!this.isConnected || !this.active) return;
    this.#baseline = { seats: this.seats };
    this.#scope?.commit(this.#baseline);
  }

  #seatsError(): string {
    return this.attempted && seatsFrom(this.seats) === null ? t("floor.seats_invalid") : "";
  }

  #shownRefusal(): { code: string; field?: string } | null {
    return this.refusal === null || this.refusalDismissed ? null : this.refusal;
  }

  #onSeats(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy) return;
    this.seats = event.detail.value;
    if (this.refusal?.field === "seats") this.refusalDismissed = true;
    this.#scope?.changed();
  }

  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusalDismissed = true;
    const seats = seatsFrom(this.seats);
    if (seats === null) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent<JoinAgainDetail>("join-again-confirm", {
        detail: { seats },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("join-again-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const seatsError = this.#seatsError();
    const refusal = this.#shownRefusal();
    const refusalText = refusal === null ? "" : codeMessage(refusal.code);
    const seatsMessage = seatsError || (refusal?.field === "seats" ? refusalText : "");
    const invalid = seatsError !== "";
    const footError = seatsMessage !== "" ? t("form.fix_fields") : refusalText;
    const actionState = saveActionState(this.#scope);
    const withTable = (key: "floor.join_again_title" | "floor.seats_title") =>
      t(key).replace("{table}", () => this.joined.label);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : () => Promise.resolve(!this.busy)}
      .heading=${withTable("floor.join_again_title")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-number-stepper
          name="seats"
          required
          .min=${1}
          .max=${SEATS_MAX}
          .label=${withTable("floor.seats_title")}
          .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", label)}
          .increaseLabel=${(label: string) => t("action.increase").replace("{label}", label)}
          .value=${live(this.seats)}
          .disabled=${this.busy}
          .error=${seatsMessage}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSeats(event)}
        ></wt-number-stepper>
        ${this.apart.map(
          ({ table, reason }) =>
            html`<p data-stays-apart>
              ${t("floor.stays_apart").replace(/\{(table|reason)\}/g, (_, key: string) =>
                key === "table" ? table.label : t(REASON_KEYS[reason]),
              )}
            </p>`,
        )}
        <wt-form-actions .error=${footError}>
          <wt-button
            slot="cancel"
            data-join-again-cancel
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-join-again-action
            variant=${actionState.variant}
            ?disabled=${this.busy || actionState.unchanged || invalid}
            @click=${() => void this.#confirm()}
          >
            ${t("floor.join_again")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-join-again-dialog": TillJoinAgainDialog;
  }
}
