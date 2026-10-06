import { LitElement, css, html } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, submitOnEnter, leaveCoordinatorFor } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
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
    if (!this.active || this.#scope) return;
    this.#baseline ??= this.value;
    this.#leave = leaveCoordinatorFor(this);
    this.#scope = this.#leave?.register<string>({
      id: this,
      current: () => this.value,
      snapshot: (value) => value,
      equal: (a, b) => {
        const canonical = (value: string) => {
          const parsed = parseGuestCount(value);
          return parsed === undefined ? `invalid:${value.trim()}` : String(parsed.guestCount);
        };
        return canonical(a) === canonical(b);
      },
      restore: (value) => (this.value = value),
    });
    this.#scope?.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #change(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active) return;
    this.value = event.detail.value;
    this.#scope?.changed();
  }

  #error(): string {
    return this.attempted && parseGuestCount(this.value) === undefined
      ? t("seat.guest_count_invalid")
      : "";
  }

  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active) return;
    this.attempted = true;
    const parsed = parseGuestCount(this.value);
    if (parsed === undefined) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.#baseline = this.value;
    this.#scope?.commit(this.value);
    this.dispatchEvent(
      new CustomEvent<SeatConfirmDetail>("seat-confirm", {
        detail: parsed,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active) return;
    if (this.#scope) {
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
    this.dispatchEvent(new CustomEvent("seat-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const error = this.#error();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      .heading=${t("seat.title").replace("{table}", () => this.tableLabel)}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-input
          name="guestCount"
          autocomplete="off"
          .label=${t("seat.guest_count")}
          .hint=${t("seat.guest_count_hint")}
          .value=${live(this.value)}
          .error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(event)}
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
