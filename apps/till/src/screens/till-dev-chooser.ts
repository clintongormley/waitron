import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { selectStyles } from "../select-styles.js";
import { setDevDeviceId } from "../api/dev-device.js";
import type { DevDeviceList, TillApi } from "../api/client.js";

/**
 * The SP-C DEV per-tab device switcher, mounted by `main.ts` on the `?dev` query branch (never in the
 * normal boot path). It lets a developer running several device roles in one browser adopt an existing
 * device — or mint a fresh one — for THIS TAB, writing the chosen id to `sessionStorage` via
 * {@link setDevDeviceId} and reloading into `/` so the app boots as that device (the stored id then rides
 * every request as the `x-waitron-dev-device` header, which the server honours ONLY in devMode; see
 * `../api/dev-device.ts`).
 *
 * It is a DEVELOPER TOOL, not a shipped surface: reachable only when the server exposes the dev routes
 * (devMode) AND the operator adds `?dev`. So its copy is DELIBERATELY plain English literals, not `t()`
 * catalogue keys — there is nothing to localise for a tool no venue ever sees, and `apps/*` is exempt
 * from the english-only guard either way. The one dev route that is ABSENT outside devMode
 * (`GET /api/dev/devices` → 404) rejects `getDevDevices`, which flips {@link devOff} so the tool renders
 * a plain "dev mode is off" hint instead of an empty, broken-looking list.
 *
 * Modelled on `till-enrol-screen.ts` / `till-schedule-screen.ts`: `.api` threaded from the app, `wt-*`
 * primitives (`wt-card`/`wt-button`/`wt-input`) + token-styled native `<select>`s (there is no
 * `wt-select` primitive — the same fallback the schedule screen's pickers use), `baseStyles`.
 */
@customElement("till-dev-chooser")
export class TillDevChooser extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        max-width: 32rem;
        flex-direction: column;
        gap: var(--wt-space-4);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      /* Danger-on-surface banner — the a11y-safe pairing the enrol/schedule screens use. */
      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }

      ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      li {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .meta {
        color: var(--wt-color-text-muted);
      }

      .form {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      label {
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** The HTTP face of the till, threaded from the app (`main.ts`'s `?dev` branch). */
  @property({ attribute: false }) api!: TillApi;

  /** How to boot into the chosen device — the real `location.assign` by default, injectable so a test
   * can assert the navigation without navigating the runner (the `provisioning-screen.ts` pattern). */
  @property({ attribute: false }) navigate: (url: string) => void = (url) => location.assign(url);

  /** The enrolled devices + mint option-sources, or `undefined` while the first read is in flight. */
  @state() private list?: DevDeviceList;
  /** Set when the dev route is absent (rejected `getDevDevices`) — renders the "dev mode is off" hint. */
  @state() private devOff = false;
  /** The error CODE of a rejected mint, rendered inline (never a user-facing surface — see class note). */
  @state() private mintError?: string;
  /** Reentry guard: one mint at a time. */
  @state() private minting = false;

  /** The mint form's live fields. `kind` drives which binding picker (till vs station) is shown. */
  @state() private kind = "till";
  @state() private label = "";
  @state() private tillId = "";
  @state() private stationId = "";
  @state() private profileId = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Read the device list. Any rejection (the 404 when the dev route is absent, chiefly) flips
   * {@link devOff}; Lit never paints a detached element, so no `isConnected` guard is needed. */
  async #load(): Promise<void> {
    try {
      this.list = await this.api.getDevDevices();
      this.devOff = false;
    } catch {
      this.devOff = true;
    }
  }

  /** Adopt an existing device for this tab and boot into it. */
  #use(id: string): void {
    setDevDeviceId(id);
    this.navigate("/");
  }

  /** Mint a new device and adopt it. `tillId` rides only for a sale-capable kind (`till`/`handheld`),
   * `stationId` only for a `kds_station`; `layoutProfileId` rides whenever a profile is picked. An
   * empty selection omits its field (never sends `""`). A rejected `{ code }` shows inline. */
  async #mint(): Promise<void> {
    if (this.label === "" || this.minting) return;
    this.minting = true;
    this.mintError = undefined;
    const req: {
      kind: string;
      label: string;
      tillId?: string;
      stationId?: string;
      layoutProfileId?: string;
    } = { kind: this.kind, label: this.label };
    if (this.kind === "kds_station") {
      if (this.stationId !== "") req.stationId = this.stationId;
    } else if (this.tillId !== "") {
      req.tillId = this.tillId;
    }
    if (this.profileId !== "") req.layoutProfileId = this.profileId;
    try {
      const res = await this.api.mintDevDevice(req);
      setDevDeviceId(res.deviceId);
      this.navigate("/");
    } catch (error) {
      this.mintError = (error as { code?: string }).code ?? "server.internal";
    } finally {
      this.minting = false;
    }
  }

  /** Drop this browser's device cookie identity (a fresh, unenrolled tab). */
  #reset(): void {
    void this.api.resetDevice();
  }

  override render(): TemplateResult {
    return html`
      <wt-card class="screen">
        <h1 class="title">Dev device switcher</h1>
        ${this.#body()}
      </wt-card>
    `;
  }

  #body(): TemplateResult {
    if (this.devOff) {
      return html`<p class="hint" data-dev-off>
        Dev mode is off — set <code>WAITRON_ENV=dev</code> and restart the server to use the device
        switcher.
      </p>`;
    }
    if (this.list === undefined) {
      return html`<p class="hint">Loading…</p>`;
    }
    return html`${this.#devicesSection(this.list)} ${this.#mintSection(this.list)}
    ${this.#resetSection()}`;
  }

  #devicesSection(list: DevDeviceList): TemplateResult {
    return html`<section class="devices">
      <h2>Enrolled devices</h2>
      ${
        list.devices.length === 0
          ? html`<p class="hint">No devices enrolled yet — mint one below.</p>`
          : html`<ul>
              ${list.devices.map((device) => {
                const till = list.tills.find((candidate) => candidate.id === device.tillId);
                const profile = list.profiles.find(
                  (candidate) => candidate.id === device.layoutProfileId,
                );
                return html`<li data-device=${device.id}>
                  <span>
                    <strong>${device.label}</strong>
                    <span class="meta">
                      ·
                      ${device.kind}${till ? html` · ${till.name}` : nothing}${
                        profile ? html` · ${profile.name}` : nothing
                      }
                    </span>
                  </span>
                  <wt-button
                    data-use=${device.id}
                    variant="primary"
                    @click=${() => this.#use(device.id)}
                  >
                    Use this device
                  </wt-button>
                </li>`;
              })}
            </ul>`
      }
    </section>`;
  }

  #mintSection(list: DevDeviceList): TemplateResult {
    return html`<section class="mint">
      <h2>Mint a new device</h2>
      ${this.mintError ? html`<p class="error" role="alert">${this.mintError}</p>` : nothing}
      <div class="form">
        <div class="field">
          <label for="mint-kind">Kind</label>
          <select
            id="mint-kind"
            data-mint-kind
            .value=${this.kind}
            @change=${(e: Event) => (this.kind = (e.target as HTMLSelectElement).value)}
          >
            <option value="till">till</option>
            <option value="handheld">handheld</option>
            <option value="kds_station">kds_station</option>
          </select>
        </div>
        <wt-input
          data-mint-label
          .label=${"Label"}
          .value=${this.label}
          @wt-change=${(e: Event) => {
            e.stopPropagation();
            this.label = (e as CustomEvent<{ value: string }>).detail.value;
          }}
        ></wt-input>
        ${this.kind === "kds_station" ? this.#stationField(list) : this.#tillField(list)}
        ${this.#profileField(list)}
        <wt-button
          data-mint-submit
          variant="primary"
          ?disabled=${this.label === "" || this.minting}
          @click=${() => void this.#mint()}
        >
          Mint and use
        </wt-button>
      </div>
    </section>`;
  }

  #tillField(list: DevDeviceList): TemplateResult {
    return html`<div class="field">
      <label for="mint-till">Till</label>
      <select
        id="mint-till"
        data-mint-till
        .value=${this.tillId}
        @change=${(e: Event) => (this.tillId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        ${list.tills.map((till) => html`<option value=${till.id}>${till.name}</option>`)}
      </select>
    </div>`;
  }

  #stationField(list: DevDeviceList): TemplateResult {
    return html`<div class="field">
      <label for="mint-station">Station</label>
      <select
        id="mint-station"
        data-mint-station
        .value=${this.stationId}
        @change=${(e: Event) => (this.stationId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        ${list.stations.map(
          (station) => html`<option value=${station.id}>${station.name}</option>`,
        )}
      </select>
    </div>`;
  }

  #profileField(list: DevDeviceList): TemplateResult {
    return html`<div class="field">
      <label for="mint-profile">Layout profile (optional)</label>
      <select
        id="mint-profile"
        data-mint-profile
        .value=${this.profileId}
        @change=${(e: Event) => (this.profileId = (e.target as HTMLSelectElement).value)}
      >
        <option value="">—</option>
        ${list.profiles.map(
          (profile) => html`<option value=${profile.id}>${profile.name}</option>`,
        )}
      </select>
    </div>`;
  }

  #resetSection(): TemplateResult {
    return html`<section class="reset">
      <wt-button data-reset variant="secondary" @click=${() => this.#reset()}>
        Reset this browser's cookie identity
      </wt-button>
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-dev-chooser": TillDevChooser;
  }
}
