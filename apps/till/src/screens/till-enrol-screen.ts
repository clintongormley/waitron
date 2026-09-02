import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type WtInput } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { TillApi } from "../api/client.js";

/**
 * The enrol view a FRESH counter shows to become a sale-capable TILL (SP-A.2 device unification) — the
 * twin of the lock screen's "set up this till" affordance, and the sibling of the handheld enrol screen
 * ({@link TillHandheldEnrolScreen}). A labelled pairing-code field → "Set up"; on a redeemed code it
 * emits a composed, bubbling `till-enrolled` and the app re-boots (the device cookie `enrolDevice` set
 * now reads back as `till`, so `#boot` stays on the lock screen but marks the till device-enrolled).
 * Mirrors the handheld enrol screen exactly, with the same two deliberate differences from the station
 * screen's device-mode enrol view:
 *
 *  - it is a STANDALONE screen the app hosts on a `tillEnrolling` state (not a sub-view of a dual-mode
 *    screen); and
 *  - a refused code shows ONE generic message (`device.enrol_failed`), not the per-code mapping the
 *    station screen surfaces — the operator's only recovery is a fresh code from the manager either way,
 *    so distinguishing "invalid" from "expired" buys the counter nothing.
 *
 * The submit button enables once `this.code` becomes non-empty, which happens on `wt-change`, so a
 * `wt-change` (input, paste or autofill that fires one) is what unlocks it. At click time the handler
 * then reads the code LIVE off the field rather than from that tracked state, so it always submits the
 * exact current field contents even if the value changed after the last tracked `wt-change`.
 * `enrolDevice`'s resolved {@link DeviceEnrolment} is intentionally ignored: the trusted-device token
 * rides its Set-Cookie, never the body, and `#boot` re-reads the identity — this view only needs to
 * know the redemption SUCCEEDED, which is the resolve.
 */
@customElement("till-enrol-screen")
export class TillEnrolScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* A narrow reading column so the field + button stack rather than span a counter edge-to-edge. */
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
   * Redeem the entered pairing code. Reads the code LIVE off the field at submit time so it always uses
   * the exact current field contents, covering a paste/autofill that changed the value after the last
   * tracked `wt-change`. Guarded so an empty code (or a double-tap past the disabled button) never
   * calls the API. On success — and only if still connected, so a torn-down view never announces — it
   * emits the composed `till-enrolled` the app turns into a re-boot; on a rejected `{ code }` it
   * shows the generic `device.enrol_failed` banner (never the raw code).
   */
  async #enrol(): Promise<void> {
    const code = this.shadowRoot!.querySelector<WtInput>("[data-code]")!.value;
    if (code === "" || this.enrolling) return;
    this.enrolling = true;
    this.failed = false;
    try {
      await this.api.enrolDevice(code);
      if (!this.isConnected) return;
      this.dispatchEvent(new CustomEvent("till-enrolled", { bubbles: true, composed: true }));
    } catch {
      this.failed = true;
    } finally {
      this.enrolling = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <section class="screen">
        <h1 class="title">${t("device.till_enrol_title")}</h1>
        <p class="hint">${t("device.till_enrol_hint")}</p>
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
          ${t("device.till_enrol_submit")}
        </wt-button>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-enrol-screen": TillEnrolScreen;
  }
}
