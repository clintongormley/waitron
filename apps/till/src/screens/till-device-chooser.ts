import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import { setDevDeviceId } from "../api/dev-device.js";
import { deviceKindLabel } from "../i18n/device-label.js";
import "./till-enrol-screen.js";
import type { DevDeviceList, TillApi } from "../api/client.js";

/**
 * The SP-C dev-only device front door (device-enrolment §3.2), rendered by the app's boot decision when
 * the host runs in dev mode AND this tab has not yet adopted a device. Two sections:
 *
 *  - **Select a device** — the venue's ACTIVE enrolled devices (`GET /api/dev/devices`, still dev-gated).
 *    "Use this device" writes the device id to THIS TAB's `sessionStorage` ({@link setDevDeviceId}) and
 *    navigates to `/`, so the tab boots as that device (the stored id rides every request as the
 *    `x-waitron-dev-device` header the server trusts in dev mode). That per-tab id is how one browser runs
 *    device X in one tab and device Y in another.
 *  - **Set up a new device** — opens a modal containing the {@link TillEnrolScreen}, which knocks
 *    at `POST /api/device/join` like any other fresh browser. Because the server runs in devMode here, that
 *    knock is AUTO-ACCEPTED on the spot with the venue's default `till` profile — no pairing window, no
 *    number to match. On approval the new device id is written to THIS tab's `sessionStorage` (not the
 *    browser cookie), so the fresh device stays this tab's identity.
 *
 *    A DELIBERATE regression of the old dev form: this affordance can only ever mint a `till` (auto-accept
 *    resolves the default profile, and a default profile is the one form factor it can produce), and a
 *    REPEATED name throws `device.register_name_taken` (409) because a till enrol auto-creates a register
 *    named after the device. Both are acceptable for a dev tool — the three demo devices `dev-setup` seeds
 *    cover the other form factors, and the real accept-with-profile flow is exercised by the dashboard.
 *
 * It is a DEVELOPER TOOL, never a shipped surface: reachable only when the server exposes the dev route
 * (devMode). Its own chrome is DELIBERATELY plain English literals, not `t()` catalogue keys — there is
 * nothing to localise for a tool no venue ever sees (`apps/*` is exempt from the english-only guard either
 * way). The embedded enrol screen, by contrast, IS a shipped surface and localises through `t()`. A rejected
 * `getDevDevices` — chiefly the 404 outside dev mode, but also a transient error — flips {@link loadFailed}
 * so the tool renders a load-failure hint instead of an empty, broken-looking list.
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

  /** The HTTP face of the till, threaded from the app's boot decision. */
  @property({ attribute: false }) api!: TillApi;

  /** How to boot into the chosen/enrolled device — the real `location.assign` by default, injectable so a
   * test can assert the navigation without navigating the runner (the `provisioning-screen.ts` pattern). */
  @property({ attribute: false }) navigate: (url: string) => void = (url) => location.assign(url);

  /** The enrolled devices. The app's boot passes the list it already fetched to detect dev mode, so the
   * common path never re-reads; left `undefined` (an isolated mount) the chooser fetches it on connect. */
  @property({ attribute: false }) list?: DevDeviceList;
  /** Set on ANY rejected `getDevDevices` (the 404 outside dev mode, chiefly) — renders the load-failure
   * hint. It only knows the list failed to load, not why, so the copy does not assert the cause. */
  @state() private loadFailed = false;
  /** Whether the "Set up a new device" modal is open. */
  @state() private settingUp = false;

  override connectedCallback(): void {
    super.connectedCallback();
    // The app hands a pre-fetched list (it read one to detect dev mode); only an isolated mount fetches.
    if (this.list === undefined) void this.#load();
  }

  /** Read the device list. Any rejection flips {@link loadFailed}. No `isConnected` guard is needed —
   * Lit never paints a detached element. */
  async #load(): Promise<void> {
    try {
      this.list = await this.api.getDevDevices();
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
    }
  }

  /** Adopt an existing device for this tab and boot into it. */
  #use(id: string): void {
    setDevDeviceId(id);
    this.navigate("/");
  }

  /** The embedded join screen was approved: adopt the fresh device for THIS tab (its id, not the browser
   * cookie) and boot into it. The `enrolled` event is handled here and NOT re-dispatched — a dev-tab join
   * is a chooser affordance, not the production front-door re-boot. */
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
