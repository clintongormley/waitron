import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
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
  @state() private attempted = false;

  #error(): string {
    return this.attempted && parseGuestCount(this.value) === undefined
      ? t("seat.guest_count_invalid")
      : "";
  }

  async #confirm(): Promise<void> {
    this.attempted = true;
    const parsed = parseGuestCount(this.value);
    if (parsed === undefined) {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
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
    const error = this.#error();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("seat.title").replace("{table}", () => this.tableLabel)}
      @wt-close=${() => this.#cancel()}
    >
      <div class="fields">
        <wt-input
          name="guestCount"
          autocomplete="off"
          .label=${t("seat.guest_count")}
          .hint=${t("seat.guest_count_hint")}
          .value=${this.value}
          .error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => (this.value = event.detail.value)}
          @keydown=${(event: KeyboardEvent) =>
            submitOnEnter(
              event,
              this.shadowRoot!.querySelector<HTMLElement>("[data-seat-confirm]"),
            )}
        ></wt-input>
        <wt-form-actions .error=${error === "" ? "" : t("form.fix_fields")}>
          <wt-button
            slot="cancel"
            data-seat-cancel
            variant="secondary"
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-seat-confirm
            variant="primary"
            ?disabled=${error !== ""}
            @click=${() => void this.#confirm()}
          >
            ${t("seat.confirm")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-seat-dialog": TillSeatDialog;
  }
}
