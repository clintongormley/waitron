import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, type WtInput } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import type { TillApi } from "../api/client.js";

/**
 * The device kind this enrol view pairs a FRESH, cookieless browser as — the ONE seam that distinguishes
 * the three device kinds this single component serves (`till`/`handheld`/`kds`). It selects the
 * title/hint/submit copy ({@link ENROL_COPY}) and rides the emitted
 * {@link TillDeviceEnrolScreen} `enrolled` event's detail — the app re-boots on that event and picks the
 * shell from the redeemed device cookie, NOT from this kind, so the kind is copy + telemetry, never routing.
 */
export type DeviceEnrolKind = "till" | "handheld" | "kds";

/**
 * The per-kind title/hint/submit copy — the only thing that varies between the three device kinds. The
 * code-field label (`device.enrol_code`) and the refusal banner (`device.enrol_failed`) are SHARED across
 * every kind (a pairing code names no device type, and one generic failure message is all any kind
 * surfaces), so they are not in this table. A typed `Record` (not a `` `device.${kind}_enrol_title` ``
 * template) so the keys are checked against {@link StringKey} at compile time — a renamed or missing
 * string is a type error here, not a silent English fallback at runtime.
 */
const ENROL_COPY: Record<
  DeviceEnrolKind,
  { title: StringKey; hint: StringKey; submit: StringKey }
> = {
  till: {
    title: "device.till_enrol_title",
    hint: "device.till_enrol_hint",
    submit: "device.till_enrol_submit",
  },
  handheld: {
    title: "device.handheld_enrol_title",
    hint: "device.handheld_enrol_hint",
    submit: "device.handheld_enrol_submit",
  },
  kds: {
    title: "device.kds_enrol_title",
    hint: "device.kds_enrol_hint",
    submit: "device.kds_enrol_submit",
  },
};

/**
 * The enrol view a FRESH (unenrolled, cookieless) browser shows to become an enrolled device — the twin of
 * the lock screen's "set up …" affordances, and the ONE component behind all three device kinds (SP-A.2
 * device unification / handheld-tableside Task 8 / SP-B4 fresh-display enrol overlay). It unifies the two
 * standalone enrol screens (`till-enrol-screen`, `till-handheld-enrol-screen` — near-identical bar their
 * i18n keys and emitted event name) and newly routes the fresh-`kds` enrol through the same view (a fresh
 * KDS previously reached the station screen's own device-mode enrol sub-view, which this change orphans but
 * does not remove) — now the {@link kind} property and the single `enrolled` event across all three kinds. A labelled pairing-code field → "Set up"; on a redeemed code it emits a composed,
 * bubbling `enrolled` (carrying the {@link kind}) and the app re-boots. The device cookie `enrolDevice` set
 * reads back on the next probe (`till` → device-enrolled counter, `handheld` → phone shell,
 * `kds_station` → the kiosk shell), so the POST-ENROL ROUTING lives entirely in the app's `#boot` probe,
 * never here — this view only needs to know the redemption SUCCEEDED.
 *
 * Two deliberate differences from the station screen's device-mode enrol sub-view:
 *
 *  - it is a STANDALONE screen the app hosts on an `enrolling` state (not a sub-view of a dual-mode
 *    screen); and
 *  - a refused code shows ONE generic message (`device.enrol_failed`), not the per-code mapping the
 *    station screen surfaces — the operator's only recovery is a fresh code from the manager either way,
 *    so distinguishing "invalid" from "expired" buys the device nothing.
 *
 * The submit button enables once `this.code` becomes non-empty, which happens on `wt-change`, so a
 * `wt-change` (input, paste or autofill that fires one) is what unlocks it. At click time the handler
 * then reads the code LIVE off the field rather than from that tracked state, so it always submits the
 * exact current field contents even if the value changed after the last tracked `wt-change`.
 * `enrolDevice`'s resolved {@link DeviceEnrolment} is intentionally ignored: the trusted-device token
 * rides its Set-Cookie, never the body, and `#boot` re-reads the identity — this view only needs to
 * know the redemption SUCCEEDED, which is the resolve.
 */
@customElement("till-device-enrol-screen")
export class TillDeviceEnrolScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      /* A narrow reading column so the field + button stack rather than span a device edge-to-edge. */
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

  /** Which device kind this view pairs (see {@link DeviceEnrolKind}). Selects the title/hint/submit copy
   * and rides the emitted `enrolled` detail; the app sets it when it opens the overlay. Defaults to `till`
   * (the sale-capable counter) so a bare mount still renders valid copy. */
  @property() kind: DeviceEnrolKind = "till";

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
   * emits the composed `enrolled` (carrying {@link kind}) the app turns into a re-boot; on a rejected
   * `{ code }` it shows the generic `device.enrol_failed` banner (never the raw code).
   */
  async #enrol(): Promise<void> {
    const code = this.shadowRoot!.querySelector<WtInput>("[data-code]")!.value;
    if (code === "" || this.enrolling) return;
    this.enrolling = true;
    this.failed = false;
    try {
      await this.api.enrolDevice(code);
      if (!this.isConnected) return;
      this.dispatchEvent(
        new CustomEvent("enrolled", { detail: { kind: this.kind }, bubbles: true, composed: true }),
      );
    } catch {
      this.failed = true;
    } finally {
      this.enrolling = false;
    }
  }

  override render(): TemplateResult {
    const copy = ENROL_COPY[this.kind];
    return html`
      <section class="screen">
        <h1 class="title">${t(copy.title)}</h1>
        <p class="hint">${t(copy.hint)}</p>
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
          ${t(copy.submit)}
        </wt-button>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-device-enrol-screen": TillDeviceEnrolScreen;
  }
}
