import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
  type WtInput,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { BoxWifiNetwork, DashboardApi } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { passwordVisibility, t } from "../i18n/t.js";
import { ssidName } from "./box-status-rows.js";

type Draft = { choice: string; password: string };
@customElement("dashboard-box-wifi-dialog")
export class BoxWifiDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      p {
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ type: Boolean }) blocked = false;
  @state() private opened = false;
  @state() private wired = false;
  @state() private networks: BoxWifiNetwork[] = [];
  @state() private scanning = false;
  @state() private scanFailed = false;
  @state() private busy = false;
  @state() private choice = "";
  @state() private password = "";
  readonly #feedback = new FormFeedback(this);
  @state() private refusal = "";
  @state() private bottom = "";
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  show(wired: boolean): void {
    if (this.opened) return;
    this.opened = true;
    if (!this.#secure()) {
      this.bottom = codeMessage("box_network.join_connection_insecure");
      return;
    }
    this.wired = wired;
    this.networks = [];
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: {},
      current: () => ({ choice: this.choice, password: this.password }),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.choice === b.choice && a.password === b.password,
      restore: (value) => {
        this.choice = value.choice;
        this.password = value.password;
      },
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit({ choice: "", password: "" });
    void this.#scan();
  }
  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }
  // A route refusal cannot keep an HTTP request’s password off the wire.
  #secure(): boolean {
    return new URL(this.ownerDocument.URL).protocol === "https:";
  }
  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector("wt-dialog");
  }
  #close(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    const input = this.#dialog()?.querySelector<WtInput>("wt-input");
    if (input) input.value = "";
    this.password = "";
    this.choice = "";
    this.networks = [];
    this.opened = false;
    this.busy = false;
    this.scanning = false;
    this.scanFailed = false;
    this.#feedback.reset();
    this.refusal = "";
    this.bottom = "";
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#scope ||
    !this.#leave ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";
  async #scan(): Promise<void> {
    if (this.scanning || this.busy || this.blocked) return;
    const generation = this.#generation;
    this.scanning = true;
    this.scanFailed = false;
    this.bottom = "";
    try {
      const { networks } = await this.api.scanBoxNetwork();
      if (generation !== this.#generation) return;
      this.networks = networks;
      if (!this.#selected()) {
        this.choice = "";
        this.#scope?.changed();
      }
    } catch (error) {
      if (generation === this.#generation) {
        this.scanFailed = true;
        this.bottom = codeMessage(codeOf(error));
      }
    } finally {
      if (generation === this.#generation) this.scanning = false;
    }
  }
  #selected(): BoxWifiNetwork | undefined {
    return this.networks.find(
      (n) => `${n.ssidHex}:${n.security}` === this.choice && n.security !== "other",
    );
  }
  #edit(field: "choice" | "password", event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.busy) return;
    this[field] = event.detail.value;
    this.refusal = "";
    this.bottom = "";
    this.#scope?.changed();
  }
  async #join(): Promise<void> {
    const network = this.#selected();
    if (!network || network.security === "other" || this.busy || this.scanning || this.blocked)
      return;
    this.#feedback.press();
    this.refusal = "";
    this.bottom = "";
    if (this.password === "") {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    this.busy = true;
    const generation = this.#generation;
    try {
      await this.api.joinBoxNetwork({
        ssidHex: network.ssidHex,
        keyMgmt: network.security,
        psk: this.password,
        hidden: false,
      });
      if (generation !== this.#generation) return;
      this.#scope?.commit({ choice: "", password: "" });
      this.#dialog()?.closeAfter("saved");
      this.#close();
      this.dispatchEvent(
        new CustomEvent("wifi-accepted", { detail: {}, bubbles: true, composed: true }),
      );
    } catch (error) {
      if (generation !== this.#generation) return;
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: { field?: unknown } }).params
          : undefined;
      if (params?.field === "psk") {
        this.refusal =
          codeOf(error) === "box_network.password_invalid"
            ? t(
                network.security === "sae"
                  ? "box_status.network.password_sae"
                  : "box_status.network.password_wpa",
              )
            : codeMessage(codeOf(error));
        await this.#feedback.focus(this.renderRoot);
      } else {
        const code = codeOf(error);
        this.bottom = wifiRequestError(error);
        if (!WIFI_REFUSALS.has(code) || code === "box_network.busy" || code === "box_host.busy")
          this.api.liveData.refresh();
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  override render() {
    const fieldError =
      this.refusal ||
      (this.#feedback.attempted && !this.password ? t("box_status.network.password_required") : "");
    const disabled = this.busy || this.scanning || this.blocked;
    return html`<wt-dialog
      heading=${t("box_status.network.scan")}
      .open=${this.opened}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(e: Event) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) this.#close();
      }}
    >
      ${
        this.opened && this.#secure()
          ? html`<div class="fields">
              <p>
                ${t("box_status.network.warning")}
                ${!this.wired ? t("box_status.network.recovery") : nothing}
              </p>
              <wt-button
                data-test="wifi-scan-again"
                variant="secondary"
                ?disabled=${disabled}
                ?loading=${this.scanning}
                @click=${() => void this.#scan()}
                >${t("box_status.network.scan_again")}</wt-button
              >
              ${!this.scanning && !this.scanFailed && this.networks.length === 0 ? html`<p role="status">${t("box_status.network.empty")}</p>` : nothing}
              <wt-combobox
                name="network"
                required
                label=${t("box_status.network.title")}
                .value=${this.choice}
                .options=${this.networks.map((n) => ({ value: `${n.ssidHex}:${n.security}`, label: `${ssidName(n.ssidHex)} · ${n.signal}%${n.security === "other" ? ` · ${t("box_status.network.unsupported")}` : ""}`, disabled: n.security === "other" }))}
                ?disabled=${disabled}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit("choice", e)}
              ></wt-combobox>
              <wt-input
                name="psk"
                type="password"
                .passwordVisibility=${passwordVisibility()}
                required
                label=${t("box_status.network.password")}
                .value=${this.password}
                .error=${fieldError}
                ?disabled=${disabled}
                @wt-change=${(e: CustomEvent<{ value: string }>) => this.#edit("password", e)}
                @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.renderRoot.querySelector("[data-test=wifi-join]"))}
              ></wt-input>
            </div>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${fieldError ? t("form.fix_fields") : this.bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="wifi-join"
          variant=${disabled || !this.#selected() ? "secondary" : "primary"}
          ?loading=${this.busy}
          ?disabled=${disabled || !this.#selected() || (this.#feedback.attempted && !this.password)}
          @click=${() => void this.#join()}
          >${t("box_status.network.join")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
const WIFI_REFUSALS = new Set([
  "management_session.required",
  "management_session.expired",
  "person.suspended",
  "authorization.not_permitted",
  "management.request_invalid",
  "box_host.unavailable",
  "box_host.busy",
  "box_network.busy",
  "box_network.no_wifi",
  "box_network.not_saved",
  "box_network.password_invalid",
  "box_network.join_connection_insecure",
]);
export function wifiRequestError(error: unknown): string {
  const code = codeOf(error);
  return WIFI_REFUSALS.has(code) ? codeMessage(code) : t("box_status.network.unknown");
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-box-wifi-dialog": BoxWifiDialog;
  }
}
