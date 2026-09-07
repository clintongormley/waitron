import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles, type WtInput } from "@waitron/ui";
import { selectStyles } from "../select-styles.js";
import { t } from "../i18n/t.js";
import "../widgets/language-chooser.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { kindOfFormFactor } from "../layout.js";
import type { EnrolCatalogue, TillApi } from "../api/client.js";

/**
 * The device front door's ENROL screen (device-enrolment §3.3) — one screen, two steps, the twin the
 * boot decision renders for a FRESH (unenrolled) browser and the dev chooser embeds pre-advanced:
 *
 *  - **step 1 — the key.** A single field for the enrolment key → {@link TillApi.enrolVerify}, which
 *    validates the key WITHOUT consuming it and returns the {@link EnrolCatalogue} step 2 binds against.
 *  - **step 2 — describe this device.** Name + a profile picker, then a binding picker DRIVEN by the
 *    chosen profile's form factor: a STATION picker for a `kds` profile, a CASH-REGISTER picker for a
 *    phone/tablet handheld (defaulting to the sole register), or NEITHER for a counter `till` (whose
 *    register the server auto-creates). "Set up device" → {@link TillApi.enrol}.
 *
 * The dev "Set up a new device" path passes a preset {@link code} (`DEMO`): the screen auto-verifies it
 * on connect and jumps straight to step 2, so demo mode never types a key (§2.4). A refused key/enrol
 * shows the ONE generic `device.enrol_failed` banner — the operator's only recovery is a fresh key from
 * a manager either way, so distinguishing invalid from expired buys the device nothing.
 *
 * On a redeemed enrol the screen emits a composed, bubbling `enrolled` carrying `{ deviceId }`. It never
 * routes itself: the boot front door re-boots on that event (the httpOnly device cookie the enrol set is
 * the source of truth), and the dev chooser writes the id to this tab's `sessionStorage` — two different
 * parents, one event. The resolved token never rides the body; only the redemption's success matters here.
 *
 * Human labels throughout: the profile picker shows each profile's `name`, and the binding pickers their
 * option names — no `kds_station`/`till`/`phone-portrait` token is ever rendered (device-enrolment §3.3).
 */
@customElement("till-enrol-screen")
export class TillEnrolScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }

      /* A narrow reading column so the fields + button stack rather than span a device edge-to-edge. */
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

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      label {
        font-weight: var(--wt-font-weight-bold);
      }

      /* The enrol error banner — the danger-on-surface pairing the lock/station screens use (a11y-safe in
         both themes), never behind muted text. */
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

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  /** The HTTP face of the till. Threaded from the parent (boot front door or the dev chooser); the enrol
   * path is unauthenticated — no session yet. */
  @property({ attribute: false }) api!: TillApi;

  /** A PRESET enrolment key. Non-empty (the dev chooser passes `DEMO`) makes the screen auto-verify on
   * connect and skip straight to step 2. Empty (the production front door) starts on step 1. */
  @property() code = "";

  /** Which step is showing. `key` verifies the enrolment key; `describe` binds the device. */
  @state() private step: "key" | "describe" = "key";
  /** The catalogue a verified key returned (profiles + station/register option-sources). */
  @state() private catalogue?: EnrolCatalogue;
  /** The key that VERIFIED — sent back on the enrol POST (never re-read from the now-hidden field). */
  @state() private verifiedCode = "";
  /** The step-1 field's tracked value, purely to gate Continue; the submitted key is read live off the
   * field at click time (a paste/autofill that changed it after the last `wt-change` still submits). */
  @state() private enteredKey = "";
  /** Whether the last verify/enrol attempt was refused — drives the one generic `device.enrol_failed`. */
  @state() private failed = false;
  /** Reentry guard: one in-flight verify OR enrol at a time (a double-tap is a no-op). */
  @state() private busy = false;

  /** Step-2 fields. `profileId` drives which binding picker (station vs register vs neither) shows. */
  @state() private name = "";
  @state() private profileId = "";
  @state() private stationId = "";
  @state() private registerId = "";

  override connectedCallback(): void {
    super.connectedCallback();
    // The dev "Set up a new device" path pre-fills `DEMO`: verify it for the catalogue and jump to step 2
    // without ever showing the key field (device-enrolment §2.4).
    if (this.code !== "") void this.#verify(this.code);
  }

  /** Track the key field's value and clear a stale error as the operator retypes. */
  #onKey(event: Event): void {
    this.enteredKey = (event as CustomEvent<{ value: string }>).detail.value;
    this.failed = false;
  }

  /** Read the key LIVE off the field and verify it — the Continue handler. */
  #continue(): void {
    const key = this.shadowRoot!.querySelector<WtInput>("[data-key]")!.value;
    void this.#verify(key);
  }

  /**
   * Verify a key WITHOUT consuming it. On success stash the catalogue + the verified key, default a sole
   * register/station picker, and advance to step 2 (only if still connected — a torn-down view never
   * repaints). A refused/empty key shows the generic banner and stays on step 1.
   */
  async #verify(key: string): Promise<void> {
    if (key === "" || this.busy) return;
    this.busy = true;
    this.failed = false;
    try {
      const catalogue = await this.api.enrolVerify(key);
      if (!this.isConnected) return;
      this.catalogue = catalogue;
      this.verifiedCode = key;
      // Default a SOLE register/station so a single-location deli never touches the picker (§2.3).
      this.registerId = catalogue.registers.length === 1 ? catalogue.registers[0]!.id : "";
      this.stationId = catalogue.stations.length === 1 ? catalogue.stations[0]!.id : "";
      this.step = "describe";
    } catch {
      this.failed = true;
    } finally {
      this.busy = false;
    }
  }

  /** The chosen profile's derived device kind (`kds_station`/`handheld`/`till`), or `undefined` when no
   * profile is chosen or its form factor is unknown — which picker step 2 shows keys off this. */
  #chosenKind(): ReturnType<typeof kindOfFormFactor> {
    const profile = this.catalogue?.profiles.find((p) => p.id === this.profileId);
    return profile === undefined ? undefined : kindOfFormFactor(profile.formFactor);
  }

  /** Track a step-2 text field and clear a stale error. */
  #onName(event: Event): void {
    this.name = (event as CustomEvent<{ value: string }>).detail.value;
    this.failed = false;
  }

  /** Whether the describe form can submit — a name, a profile, and the binding the profile's kind needs. */
  #canSubmit(): boolean {
    if (this.name === "" || this.profileId === "" || this.busy) return false;
    const kind = this.#chosenKind();
    if (kind === "kds_station") return this.stationId !== "";
    if (kind === "handheld") return this.registerId !== "";
    return true; // a `till` (or an unknown kind) needs no binding
  }

  /**
   * Enrol the device with the verified key + the description. Builds the ONE binding the profile's kind
   * uses (station for kds, register for handheld, neither for till). On success — and only if still
   * connected — emits the composed `enrolled` carrying the new `deviceId`; a refusal shows the banner.
   */
  async #enrol(): Promise<void> {
    if (!this.#canSubmit()) return;
    const kind = this.#chosenKind();
    this.busy = true;
    this.failed = false;
    try {
      const res = await this.api.enrol({
        code: this.verifiedCode,
        name: this.name,
        profileId: this.profileId,
        ...(kind === "kds_station" ? { stationId: this.stationId } : {}),
        ...(kind === "handheld" ? { registerId: this.registerId } : {}),
      });
      if (!this.isConnected) return;
      this.dispatchEvent(
        new CustomEvent("enrolled", {
          detail: { deviceId: res.deviceId, name: res.name, formFactor: res.formFactor },
          bubbles: true,
          composed: true,
        }),
      );
    } catch {
      this.failed = true;
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <section class="screen">
        ${this.step === "key" ? this.#renderKeyStep() : this.#renderDescribeStep()}
      </section>
      <till-language-chooser
        .loadLocales=${() => this.api.getLocales().then((r) => r.locales)}
      ></till-language-chooser>
    `;
  }

  #renderError(): TemplateResult | typeof nothing {
    return this.failed
      ? html`<p class="error" role="alert">${t("device.enrol_failed")}</p>`
      : nothing;
  }

  #renderKeyStep(): TemplateResult {
    return html`
      <h1 class="title">${t("device.enrol_key_title")}</h1>
      <p class="hint">${t("device.enrol_key_hint")}</p>
      ${this.#renderError()}
      <wt-input
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-continue]"))}
        data-key
        .label=${t("device.enrol_key_label")}
        @wt-change=${(e: Event) => this.#onKey(e)}
      ></wt-input>
      <wt-button
        data-continue
        variant="primary"
        ?disabled=${this.enteredKey === "" || this.busy}
        @click=${() => this.#continue()}
      >
        ${t("device.enrol_continue")}
      </wt-button>
    `;
  }

  #renderDescribeStep(): TemplateResult {
    const catalogue = this.catalogue;
    if (catalogue === undefined) return html`<p class="hint">…</p>`;
    const kind = this.#chosenKind();
    return html`
      <h1 class="title">${t("device.describe_title")}</h1>
      ${this.#renderError()}
      <wt-input
        data-name
        .label=${t("device.describe_name")}
        .value=${this.name}
        @wt-change=${(e: Event) => {
          e.stopPropagation();
          this.#onName(e);
        }}
      ></wt-input>
      <div class="field">
        <label for="enrol-profile">${t("device.describe_profile")}</label>
        <select
          id="enrol-profile"
          data-profile
          .value=${this.profileId}
          @change=${(e: Event) => {
            this.profileId = (e.target as HTMLSelectElement).value;
            this.failed = false;
          }}
        >
          <option value="">—</option>
          ${catalogue.profiles.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
        </select>
      </div>
      ${
        kind === "kds_station"
          ? this.#renderStationField(catalogue)
          : kind === "handheld"
            ? this.#renderRegisterField(catalogue)
            : nothing
      }
      <wt-button
        data-submit
        variant="primary"
        ?disabled=${!this.#canSubmit()}
        @click=${() => void this.#enrol()}
      >
        ${t("device.describe_submit")}
      </wt-button>
    `;
  }

  #renderStationField(catalogue: EnrolCatalogue): TemplateResult {
    return html`<div class="field">
      <label for="enrol-station">${t("device.describe_station")}</label>
      <select
        id="enrol-station"
        data-station
        .value=${this.stationId}
        @change=${(e: Event) => (this.stationId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        ${catalogue.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
      </select>
    </div>`;
  }

  #renderRegisterField(catalogue: EnrolCatalogue): TemplateResult {
    return html`<div class="field">
      <label for="enrol-register">${t("device.describe_register")}</label>
      <select
        id="enrol-register"
        data-register
        .value=${this.registerId}
        @change=${(e: Event) => (this.registerId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        ${catalogue.registers.map((r) => html`<option value=${r.id}>${r.name}</option>`)}
      </select>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-enrol-screen": TillEnrolScreen;
  }
}
