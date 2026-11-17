import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import { setDevDeviceId } from "../api/dev-device.js";
import { t } from "../i18n/t.js";
import { deviceKindLabel } from "../i18n/device-label.js";
import "./till-enrol-screen.js";
import type { DevDeviceList, TillApi } from "../api/client.js";

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
        max-width: var(--wt-till-chooser-width);
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
        --wt-dialog-max-width: min(96vw, var(--wt-till-chooser-dialog-width));
      }

      .dialog-enrol {
        width: var(--wt-till-chooser-width);
        max-width: 100%;
        --till-enrol-max-width: var(--wt-till-chooser-width);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;

  /** Injectable so a test can assert the navigation without navigating the runner. */
  @property({ attribute: false }) navigate: (url: string) => void = (url) => location.assign(url);

  @property({ attribute: false }) list?: DevDeviceList;
  @state() private loadFailed = false;
  @state() private settingUp = false;

  override connectedCallback(): void {
    super.connectedCallback();
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
    try {
      setDevDeviceId(id);
      this.navigate("/till/");
    } catch {
      this.loadFailed = true;
    }
  }

  #onEnrolled(event: Event): void {
    event.stopPropagation();
    const { deviceId } = (event as CustomEvent<{ deviceId: string }>).detail;
    this.#use(deviceId);
  }

  override render(): TemplateResult {
    return html`
      <div class="screen">
        <h1 class="title">${t("device.chooser.title")}</h1>
        ${this.#body()}
      </div>
    `;
  }

  #body(): TemplateResult {
    if (this.loadFailed) {
      return html`<p class="hint" data-load-failed>${t("boot.error")}</p>`;
    }
    if (this.list === undefined) {
      return html`<p class="hint" role="status">${t("login.loading")}</p>`;
    }
    return html`${this.#devicesSection(this.list)} ${this.#setupSection()}`;
  }

  #devicesSection(list: DevDeviceList): TemplateResult {
    return html`<section class="devices">
      <h2>${t("device.chooser.select")}</h2>
      ${
        list.devices.length === 0
          ? html`<p class="hint">${t("device.chooser.empty")}</p>`
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
                      ${t("device.chooser.use")}
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
          ${t("device.chooser.pair")}
        </wt-button>
      </section>
      ${
        this.settingUp
          ? html`<wt-dialog
              ${trackDialog()}
              .open=${true}
              aria-label=${t("device.chooser.pair")}
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
                  ${t("action.cancel")}
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
