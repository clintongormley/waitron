import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { selectStyles } from "../select-styles.js";
import { clearDevDeviceId, setDevDeviceId } from "../api/dev-device.js";
import type { DevDeviceList, DevMintRequest, TillApi } from "../api/client.js";

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
 * from the english-only guard either way. Any rejection of `getDevDevices` — chiefly the 404 when the
 * dev route is absent outside devMode, but also a transient/network/server error — flips {@link devOff}
 * so the tool renders a load-failure hint instead of an empty, broken-looking list. The hint does not
 * assert the cause: it only KNOWS the list failed to load, not why.
 *
 * Modelled on `till-device-enrol-screen.ts` / `till-schedule-screen.ts`: `.api` threaded from the app, `wt-*`
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
  /** Set on ANY rejected `getDevDevices` (404 when the dev route is absent, a transient/network/server
   * error, or a JSON-parse failure) — renders the load-failure hint. The flag name is a historical
   * shorthand; the rendered copy does not claim dev mode is definitely off, since a rejection can have
   * other causes. */
  @state() private devOff = false;
  /** The error CODE of a rejected mint, rendered inline (never a user-facing surface — see class note). */
  @state() private mintError?: string;
  /** The error CODE of a rejected cookie reset, rendered inline (same dev-only surface as {@link mintError}). */
  @state() private resetError?: string;
  /** Reentry guard: one mint at a time. */
  @state() private minting = false;

  /** The mint form's live fields. `kind` drives which binding picker (till vs station) is shown. */
  @state() private kind = "till";
  @state() private label = "";
  @state() private tillId = "";
  @state() private stationId = "";

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Read the device list. Any rejection (the 404 when the dev route is absent, chiefly) flips
   * {@link devOff}. No `isConnected` guard is needed: nothing user-visible happens on a late resolve —
   * a detached shadow root is never painted to screen, and the element is about to be GC'd. */
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
   * `stationId` only for a `kds_station`. An empty selection omits its field (never sends `""`). A
   * rejected `{ code }` shows inline. (Since the Task 10 cutover a device binds its canvas through a
   * device profile, assigned on the dashboard — the dev mint no longer picks a canvas.) */
  async #mint(): Promise<void> {
    if (this.label === "" || this.minting) return;
    this.minting = true;
    this.mintError = undefined;
    const req: DevMintRequest = { kind: this.kind, label: this.label };
    if (this.kind === "kds_station") {
      if (this.stationId !== "") req.stationId = this.stationId;
    } else if (this.tillId !== "") {
      req.tillId = this.tillId;
    }
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

  /** Drop this browser's device identity (a fresh, unenrolled tab): both the server cookie (via
   * `resetDevice`) AND this tab's sessionStorage override — clearing only the cookie would leave the
   * override in place, so the tab would keep adopting the same device on the next request. A rejected
   * reset shows its `{ code }` inline (never an unhandled promise rejection) — the same dev-only surface
   * as a mint. */
  #reset(): void {
    this.resetError = undefined;
    clearDevDeviceId();
    void this.api.resetDevice().catch((error) => {
      this.resetError = (error as { code?: string }).code ?? "server.internal";
    });
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
        Couldn't load devices. If this host isn't running in dev mode, start it with
        <code>WAITRON_ENV=dev</code> and reload.
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
                return html`<li data-device=${device.id}>
                  <span>
                    <strong>${device.label}</strong>
                    <span class="meta">
                      · ${device.kind}${till ? html` · ${till.name}` : nothing}
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

  #resetSection(): TemplateResult {
    return html`<section class="reset">
      ${this.resetError ? html`<p class="error" role="alert">${this.resetError}</p>` : nothing}
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
