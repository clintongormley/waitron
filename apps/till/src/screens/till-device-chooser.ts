import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import { setDevDeviceId } from "../api/dev-device.js";
import { deviceKindLabel } from "../i18n/device-label.js";
import "./till-enrol-screen.js";
import type { DevDeviceList, TillApi } from "../api/client.js";

/**
 * The dev-only device front door, shown when the host runs in dev mode AND this tab has not yet adopted
 * a device. The adopted id lives in THIS TAB's `sessionStorage` ({@link setDevDeviceId}) and rides every
 * request as the `x-waitron-dev-device` header the server trusts in dev mode, so one browser can run a
 * different device in each tab.
 *
 * "Set up a new device" embeds the {@link TillEnrolScreen}; in devMode the server auto-accepts that knock
 * with the venue's default `till` profile, so it can only mint a `till`, and a REPEATED name is refused
 * with `device.register_name_taken` because a till enrol creates a register named after the device.
 * Both limits are acceptable for a dev tool, since the demo devices `dev-setup` seeds cover the other
 * form factors.
 *
 * Its own chrome is DELIBERATELY plain English literals, not `t()` keys: no venue ever sees this tool.
 */
@customElement("till-device-chooser")
export class TillDeviceChooser extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        max-width: 32rem;
        margin-inline: auto;
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

      .setup {
        display: flex;
        justify-content: flex-end;
      }

      wt-dialog {
        --wt-dialog-max-width: min(96vw, 40rem);
      }

      .dialog-enrol {
        width: 32rem;
        max-width: 100%;
        --till-enrol-max-width: 32rem;
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;

  /** Injectable so a test can assert the navigation without navigating the runner. */
  @property({ attribute: false }) navigate: (url: string) => void = (url) => location.assign(url);

  @property({ attribute: false }) list?: DevDeviceList;
  /** It only knows the list failed to load, not why, so the hint's copy does not assert the cause. */
  @state() private loadFailed = false;
  @state() private settingUp = false;

  override connectedCallback(): void {
    super.connectedCallback();
    // The app hands a pre-fetched list (it read one to detect dev mode); only an isolated mount fetches.
    if (this.list === undefined) void this.#load();
  }

  async #load(): Promise<void> {
    try {
      this.list = await this.api.getDevDevices();
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
    }
  }

  #use(id: string): void {
    setDevDeviceId(id);
    this.navigate("/");
  }

  /** Adopts the fresh device for THIS tab (its id, not the browser cookie). The `enrolled` event stops
   * here: a dev-tab join is not the production front-door re-boot. */
  #onEnrolled(event: Event): void {
    event.stopPropagation();
    const { deviceId } = (event as CustomEvent<{ deviceId: string }>).detail;
    setDevDeviceId(deviceId);
    this.navigate("/");
  }

  override render(): TemplateResult {
    return html`
      <div class="screen">
        <h1 class="title">Choose a device</h1>
        ${this.#body()}
      </div>
    `;
  }

  #body(): TemplateResult {
    if (this.loadFailed) {
      return html`<p class="hint" data-load-failed>
        Couldn't load devices. If this host isn't running in dev mode, start it with
        <code>WAITRON_ENV=dev</code> and reload.
      </p>`;
    }
    if (this.list === undefined) {
      return html`<p class="hint">Loading…</p>`;
    }
    return html`${this.#devicesSection(this.list)} ${this.#setupSection()}`;
  }

  #devicesSection(list: DevDeviceList): TemplateResult {
    return html`<section class="devices">
      <h2>Select a device</h2>
      ${
        list.devices.length === 0
          ? html`<p class="hint">No devices enrolled yet — set one up below.</p>`
          : html`<ul>
              ${list.devices.map(
                (device) =>
                  html`<li data-device=${device.id}>
                    <span>
                      <strong>${device.label}</strong>
                      <span class="meta"> · ${deviceKindLabel(device.kind)}</span>
                    </span>
                    <wt-button
                      data-use=${device.id}
                      variant="primary"
                      @click=${() => this.#use(device.id)}
                    >
                      Use this device
                    </wt-button>
                  </li>`,
              )}
            </ul>`
      }
    </section>`;
  }

  #setupSection(): TemplateResult {
    return html`
      <section class="setup">
        <wt-button data-setup-new variant="secondary" @click=${() => (this.settingUp = true)}>
          Set up a new device
        </wt-button>
      </section>
      ${
        this.settingUp
          ? html`<wt-dialog
              .open=${true}
              aria-label="Set up a new device"
              @wt-close=${() => (this.settingUp = false)}
            >
              <till-enrol-screen
                class="dialog-enrol"
                .api=${this.api}
                @enrolled=${(e: Event) => this.#onEnrolled(e)}
              >
                <wt-button
                  slot="actions-before"
                  data-setup-cancel
                  variant="secondary"
                  @click=${() => (this.settingUp = false)}
                >
                  Cancel
                </wt-button>
              </till-enrol-screen>
            </wt-dialog>`
          : html``
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-device-chooser": TillDeviceChooser;
  }
}
