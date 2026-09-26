import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-input.js";
import { isValidGuestCount } from "@waitron/shared";
import { t } from "../i18n/t.js";

export interface SeatConfirmDetail {
  guestCount: number | null;
}

/** A blank field records no count; anything else must be a whole number from 1. */
function parseGuestCount(value: string): { guestCount: number | null } | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return { guestCount: null };
  if (!/^[0-9]+$/.test(trimmed)) return undefined;
  const count = Number(trimmed);
  return isValidGuestCount(count) ? { guestCount: count } : undefined;
}

/**
 * Asks how many guests a party has before its table is seated. The count is optional. The dialog only
 * reports the choice: the floor decides what seating means.
 */
@customElement("till-seat-dialog")
export class TillSeatDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property() tableLabel = "";

  @state() private value = "";
  @state() private error = "";

  #confirm(): void {
    const parsed = parseGuestCount(this.value);
    if (parsed === undefined) {
      this.error = t("seat.guest_count_invalid");
      return;
    }
    this.error = "";
    this.dispatchEvent(
      new CustomEvent<SeatConfirmDetail>("seat-confirm", {
        detail: parsed,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    this.dispatchEvent(new CustomEvent("seat-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      .open=${true}
      .heading=${t("seat.title").replace("{table}", () => this.tableLabel)}
      @wt-close=${() => this.#cancel()}
    >
      <div class="fields">
        ${
          this.error === ""
            ? nothing
            : html`<wt-form-error-summary
                .heading=${t("form.error_heading")}
                .errors=${[this.error]}
              ></wt-form-error-summary>`
        }
        <wt-input
          name="guestCount"
          autocomplete="off"
          .label=${t("seat.guest_count")}
          .hint=${t("seat.guest_count_hint")}
          .value=${this.value}
          .error=${this.error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.value = event.detail.value)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]"),
            )}
        ></wt-input>
      </div>
      <wt-button slot="footer" data-seat-cancel variant="secondary" @click=${() => this.#cancel()}>
        ${t("action.cancel")}
      </wt-button>
      <wt-button slot="footer" data-seat-confirm variant="primary" @click=${() => this.#confirm()}>
        ${t("seat.confirm")}
      </wt-button>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-seat-dialog": TillSeatDialog;
  }
}
