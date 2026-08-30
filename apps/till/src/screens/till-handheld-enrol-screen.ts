import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { TillApi } from "../api/client.js";

/**
 * The enrol view a FRESH phone shows to become a waiter HANDHELD (handheld-tableside Task 8) — the
 * twin of the lock screen's "set up as waiter handheld" affordance. A labelled pairing-code field →
 * "Set up"; on a redeemed code it emits a composed, bubbling `handheld-enrolled` and the app re-boots
 * (the device cookie `enrolDevice` set now reads back as `handheld`, so `#boot` enters the phone
 * shell). Mirrors the station screen's device-mode enrol view, with two deliberate differences:
 *
 *  - it is a STANDALONE screen the app hosts on a `handheldEnrolling` state (not a sub-view of a
 *    dual-mode screen), because a handheld's shell has no station queue to fall back to; and
 *  - a refused code shows ONE generic message (`device.enrol_failed`), not the per-code mapping the
 *    station screen surfaces — the waiter's only recovery is a fresh code from the manager either way,
 *    so distinguishing "invalid" from "expired" buys the phone nothing.
 *
 * The submitted code is read LIVE off the field at click time (not from tracked state), so the browser
 * autofill / paste path a waiter uses reaches `enrolDevice` even without an intervening input event.
 * `enrolDevice`'s resolved {@link DeviceEnrolment} is intentionally ignored: the trusted-device token
 * rides its Set-Cookie, never the body, and `#boot` re-reads the identity — this view only needs to
 * know the redemption SUCCEEDED, which is the resolve.
 */
@customElement("till-handheld-enrol-screen")
export class TillHandheldEnrolScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* A narrow reading column so the field + button stack rather than span a phone edge-to-edge. */
      .screen {
        display: flex;
        max-width: 24rem;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      /* The enrol error banner — the same danger-on-surface pairing the lock + station screens use
         (a11y-safe in both themes), never behind muted text. */
      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** The HTTP face of the till. Threaded from the app (the enrol path is unauthenticated — no session
   * yet — but `enrolDevice` rides the same `#request`; see `client.ts`). */
  @property({ attribute: false }) api!: TillApi;

  /** The typed code, tracked from `wt-change` purely to gate the submit button and clear a stale error
   * as the operator retypes; the SUBMITTED value is read live off the field (see class note). */
  @state() private code = "";
  /** Whether the last enrol attempt was refused — drives the one generic `device.enrol_failed` banner. */
  @state() private failed = false;
  /** Reentry guard: one in-flight `enrolDevice` at a time (a double-tap is a no-op). */
  @state() private enrolling = false;

  /** Capture the field's new value and clear any stale error as the operator retypes. */
  #onCode(event: Event): void {
    this.code = (event as CustomEvent<{ value: string }>).detail.value;
    this.failed = false;
  }

  /**
   * Redeem the entered pairing code. Reads the code LIVE off the field so an autofill/paste with no
   * input event still enrols. Guarded so an empty code (or a double-tap past the disabled button) never
   * calls the API. On success — and only if still connected, so a torn-down view never announces — it
   * emits the composed `handheld-enrolled` the app turns into a re-boot; on a rejected `{ code }` it
   * shows the generic `device.enrol_failed` banner (never the raw code).
   */
  async #enrol(): Promise<void> {
    const code = this.shadowRoot!.querySelector<HTMLInputElement>("[data-code]")!.value;
    if (code === "" || this.enrolling) return;
    this.enrolling = true;
    this.failed = false;
    try {
      await this.api.enrolDevice(code);
      if (!this.isConnected) return;
      this.dispatchEvent(new CustomEvent("handheld-enrolled", { bubbles: true, composed: true }));
    } catch {
      this.failed = true;
    } finally {
      this.enrolling = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <section class="screen" aria-label=${t("device.handheld_enrol_title")}>
        <h1 class="title">${t("device.handheld_enrol_title")}</h1>
        <p class="hint">${t("device.handheld_enrol_hint")}</p>
        ${
          this.failed
            ? html`<p class="error" role="alert">${t("device.enrol_failed")}</p>`
            : nothing
        }
        <wt-input
          class="code"
          data-code
          .label=${t("device.enrol_code")}
          @wt-change=${(event: Event) => this.#onCode(event)}
        ></wt-input>
        <wt-button
          class="submit"
          data-enrol
          variant="primary"
          ?disabled=${this.code === "" || this.enrolling}
          @click=${() => void this.#enrol()}
        >
          ${t("device.handheld_enrol_submit")}
        </wt-button>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-handheld-enrol-screen": TillHandheldEnrolScreen;
  }
}
