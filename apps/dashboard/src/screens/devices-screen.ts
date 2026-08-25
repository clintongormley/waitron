import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { selectStyles } from "../select-styles.js";
import type { DashboardApi, DeviceRow, Station } from "../api/client.js";

/**
 * The management dashboard's DEVICES screen (device-identity-1 §5b): manages the venue's always-on
 * enrolled devices — today the KDS station displays. It does three things, modelled on the kitchen /
 * service-status config screens (their inline list + "new" form idiom, `@waitron/ui` primitives, `--wt-*`
 * tokens):
 *
 *  - LISTS the enrolled devices (`api.listDevices()`), one `wt-card` row each: the label, the bound
 *    station's display NAME (resolved from `api.listStations()` — the list carries only a `stationId`),
 *    the status (active / revoked) and the last-seen time. Newest-enrolled first is the server's order,
 *    rendered as-is. A null `stationId` (a future non-station kind) and a station no longer in the active
 *    list (retired) both show a neutral placeholder; a never-authenticated device shows a "Never"
 *    last-seen.
 *  - GENERATES a pairing code: pick a station + type a label → `api.createDeviceCode({ kind: "kds_station",
 *    stationId, label })`. The returned code is shown ONCE in a prominent, copyable panel and lives ONLY
 *    in component state — it is NOT re-fetchable (like a passkey challenge handle), so dismissing the panel
 *    is final. Generating reloads the device list.
 *  - REVOKES a device (`api.revokeDevice(id)`) behind a TWO-STEP confirm (the purchase-list idiom): the
 *    first click on a row's Revoke ARMS it (label → confirm prompt), a second click confirms — a revoke
 *    stops a working kitchen screen, so an accidental single click must not fire it. Only ACTIVE devices
 *    show the control; an already-revoked one does not.
 *
 * Gating is server-side (`device.manage`, admin + manager): the shell hides this nav from a `staff`
 * session and every route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is
 * fully `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. The raw code stays in state; `codeMessage`
 * maps it to localised copy at the render edge, so the banner shows a sentence and never the raw wire code
 * (`station.not_found`, `device.not_found`).
 */
@customElement("dashboard-devices-screen")
export class DevicesScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .panel-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: center;
        flex-wrap: wrap;
      }
      .details {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
        margin-right: auto;
      }
      .label {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .meta {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .new {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        margin-top: var(--wt-space-6);
        flex-wrap: wrap;
      }
      .field {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .code-panel {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        align-items: flex-start;
        margin-top: var(--wt-space-4);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .code-hint {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .code-value {
        font-family: var(--wt-font-family-mono, monospace);
        font-size: var(--wt-font-size-lg);
        letter-spacing: 0.15em;
        color: var(--wt-color-text);
      }
      .code-actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .copied {
        color: var(--wt-color-text-muted);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The enrolled devices, loaded on connect and re-synced after every mutation (server order kept).
  @state() private devices: DeviceRow[] = [];
  // The venue's ACTIVE kitchen stations — both the generate-code picker's options and the source that
  // resolves a device row's stationId to a display name.
  @state() private stations: Station[] = [];
  // The generate-code form's fields: the picked station (seeded to the first on load) and the label.
  @state() private selectedStation = "";
  @state() private label = "";
  // The one-time pairing code, held ONLY here — never re-fetchable. null when no code is being shown.
  @state() private generatedCode: string | null = null;
  // Whether the shown code has just been copied (a transient confirmation next to the Copy button).
  @state() private copied = false;
  // The id of the device whose Revoke control is ARMED (awaiting a confirming second click), or null.
  // Single-valued, so arming one row disarms any other by construction.
  @state() private armedRevokeId: string | null = null;
  @state() private errorKey: string | null = null;

  // A handle to the native station <select>, reconciled to `selectedStation` in `updated()` — a native
  // select's `.value` bound in the template commits before its <option> children exist, so a non-first
  // selection would fall back to the first (the login screen documents the same picker bug).
  #stationSelect = createRef<HTMLSelectElement>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Reconcile the native station <select>'s live value to `selectedStation` after every render, once its
   * <option> children are in the DOM (mirrors login-screen). The select is rendered unconditionally, so
   * the ref is always populated. Setting `.value` imperatively does not trigger a reactive update. */
  override updated(): void {
    this.#stationSelect.value!.value = this.selectedStation;
  }

  /** (Re)load the devices + stations. Called on connect and after every mutation. A rejection anywhere
   * becomes the `errorKey` banner rather than an unhandled rejection. Disarms any armed revoke (the armed
   * row may no longer exist) and seeds the station picker to the first station when it is still unset (so
   * an operator's own pick survives a reload). */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.armedRevokeId = null;
    try {
      const [devices, stations] = await Promise.all([
        this.api.listDevices(),
        this.api.listStations(),
      ]);
      this.devices = devices;
      this.stations = stations;
      if (stations[0] !== undefined && this.selectedStation === "") {
        this.selectedStation = stations[0].id;
      }
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload the DEVICES only (not the stations) after a mutation. `#generate` and `#revoke` change the
   * device set but never the station set, so re-fetching `listStations` — which the initial {@link #load}
   * does — would be pure waste; this fetches `listDevices` alone. It throws on failure like `listDevices`
   * itself: both callers already run it inside their own `try/catch` that maps the rejection to the
   * `errorKey` banner via `codeOf` (the error-envelope pattern), so there is no separate handling here.
   * Disarms any armed revoke (mirroring {@link #load}): the armed row may no longer exist after the
   * mutation, and a `#generate` while a revoke is armed on another row must not leave it armed — a no-op
   * for the `#revoke` path, which {@link #onRevoke} already cleared before calling. */
  async #reloadDevices(): Promise<void> {
    this.armedRevokeId = null;
    this.devices = await this.api.listDevices();
  }

  /** Capture the picked station. A native `<select>` `change` is `composed: false`, so `stopPropagation`
   * here is defensive consistency with the composed `wt-change` handler below, not a boundary guard. */
  #onStationChange(event: Event): void {
    event.stopPropagation();
    this.selectedStation = (event.target as HTMLSelectElement).value;
  }

  /** The label field's composed `wt-change`. `stopPropagation` keeps it inside this screen's shadow. */
  #onLabelChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.label = event.detail.value;
  }

  /** Mint a pairing code for the picked station + label, then show it ONCE and reload the list. A blank
   * label or an unpicked station (no stations configured) is a no-op — the same blank-name guard the
   * kitchen screen's create uses. On success the code goes into state (never re-fetched) and the label
   * resets; on rejection the `errorKey` banner shows and the form is left intact for a retry. */
  async #generate(): Promise<void> {
    this.errorKey = null;
    const label = this.label.trim();
    if (label === "" || this.selectedStation === "") return;
    try {
      const { code } = await this.api.createDeviceCode({
        kind: "kds_station",
        stationId: this.selectedStation,
        label,
      });
      this.generatedCode = code;
      this.copied = false;
      this.label = "";
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Copy the shown code to the clipboard, confirming with a transient "Copied" status. Never throws: if
   * the clipboard is unavailable or denied the code stays on screen to copy by hand (the catch arm). */
  async #copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      this.copied = true;
    } catch {
      this.copied = false;
    }
  }

  /** Dismiss the shown-once code — it lived only in state, so this is final (it cannot be re-fetched). */
  #dismissCode(): void {
    this.generatedCode = null;
    this.copied = false;
  }

  /** The two-step revoke: the first click ARMS `id`, a second click on the armed row confirms and revokes.
   * Arming another row disarms the first (single-valued state). A revoke stops a working device, so the
   * confirm gate is deliberate. */
  #onRevoke(id: string): void {
    if (this.armedRevokeId === id) {
      this.armedRevokeId = null;
      void this.#revoke(id);
      return;
    }
    this.armedRevokeId = id;
  }

  /** Revoke the device `id` holds, then reload the device list (the station set is unchanged). A
   * rejection becomes the `errorKey` banner. `#onRevoke` already cleared the armed state before calling
   * this, so the devices-only reload needs no disarm. */
  async #revoke(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.revokeDevice(id);
      await this.#reloadDevices();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Resolve a device's `stationId` to the loaded station's display name; a null id (a future non-station
   * kind) or a station no longer in the active list (retired) both fall back to the neutral placeholder. */
  #stationName(stationId: string | null): string {
    if (stationId === null) return t("devices.no_station");
    return this.stations.find((s) => s.id === stationId)?.name ?? t("devices.no_station");
  }

  /** Format a device's last-seen ISO timestamp to the minute (UTC — no per-venue timezone yet, matching
   * date-utils' UTC slicing); a null last-seen (never authenticated) shows the "Never" placeholder. */
  #lastSeen(iso: string | null): string {
    if (iso === null) return t("devices.last_seen_never");
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }

  #renderDevice(device: DeviceRow): TemplateResult {
    const armed = this.armedRevokeId === device.id;
    return html`<li data-test="device-row-${device.id}">
      <wt-card>
        <div class="row">
          <div class="details">
            <span class="label" data-test="device-label-${device.id}">${device.label}</span>
            <span class="meta">
              <span data-test="device-station-${device.id}"
                >${this.#stationName(device.stationId)}</span
              >
              <span data-test="device-status-${device.id}"
                >${device.active ? t("devices.status_active") : t("devices.status_revoked")}</span
              >
              <span data-test="device-last-seen-${device.id}"
                >${this.#lastSeen(device.lastSeenAt)}</span
              >
            </span>
          </div>
          ${
            device.active
              ? html`<wt-button
                  variant="danger"
                  size="sm"
                  data-test="revoke-${device.id}"
                  data-armed=${armed ? "true" : nothing}
                  aria-label=${`${armed ? t("devices.revoke_confirm") : t("devices.revoke")} ${device.label}`}
                  @click=${() => this.#onRevoke(device.id)}
                  >${armed ? t("devices.revoke_confirm") : t("devices.revoke")}</wt-button
                >`
              : nothing
          }
        </div>
      </wt-card>
    </li>`;
  }

  #renderCodePanel(code: string): TemplateResult {
    return html`<section
      class="code-panel"
      data-test="code-panel"
      aria-label=${t("devices.code_title")}
    >
      <h2 class="panel-title">${t("devices.code_title")}</h2>
      <p class="code-hint">${t("devices.code_hint")}</p>
      <code class="code-value" data-test="code-value">${code}</code>
      <div class="code-actions">
        <wt-button
          variant="secondary"
          data-test="copy-code"
          @click=${() => void this.#copyCode(code)}
          >${t("devices.copy")}</wt-button
        >
        <wt-button variant="ghost" data-test="dismiss-code" @click=${() => this.#dismissCode()}
          >${t("devices.done")}</wt-button
        >
        ${
          this.copied
            ? html`<span class="copied" role="status" data-test="copied"
                >${t("devices.copied")}</span
              >`
            : nothing
        }
      </div>
    </section>`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("devices.title")}</h1>
      <section data-test="devices-panel">
        ${
          this.devices.length === 0
            ? html`<p class="empty" data-test="no-devices">${t("devices.no_devices")}</p>`
            : html`<ol>
                ${this.devices.map((device) => this.#renderDevice(device))}
              </ol>`
        }
      </section>

      <section>
        <h2 class="panel-title">${t("devices.generate_title")}</h2>
        <div class="new">
          <label class="field"
            >${t("devices.station")}
            <select
              ${ref(this.#stationSelect)}
              data-test="station-select"
              @change=${(e: Event) => this.#onStationChange(e)}
            >
              ${this.stations.map((s) => html`<option value=${s.id}>${s.name}</option>`)}
            </select>
          </label>
          <wt-input
            label=${t("devices.label")}
            data-test="code-label"
            .value=${this.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onLabelChange(e)}
          ></wt-input>
          <wt-button variant="primary" data-test="generate" @click=${() => void this.#generate()}
            >${t("devices.generate")}</wt-button
          >
        </div>
        ${this.generatedCode !== null ? this.#renderCodePanel(this.generatedCode) : nothing}
      </section>

      ${
        this.errorKey
          ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-devices-screen": DevicesScreen;
  }
}
