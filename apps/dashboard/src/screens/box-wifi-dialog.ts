import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
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
import { t } from "../i18n/t.js";
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
  @state() private busy = false;
  @state() private choice = "";
  @state() private password = "";
  @state() private attempted = false;
  @state() private refusal = "";
  @state() private bottom = "";
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  show(wired: boolean): void {
    if (this.opened) return;
    this.opened = true;
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
    this.attempted = false;
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
      if (generation === this.#generation) this.bottom = codeMessage(codeOf(error));
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
    this.attempted = true;
    this.refusal = "";
    this.bottom = "";
    if (this.password === "") {
      await this.updateComplete;
      this.#dialog()?.querySelector<WtInput>("wt-input")?.focus();
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
        this.refusal = codeMessage(codeOf(error));
        await this.updateComplete;
        this.#dialog()?.querySelector<WtInput>("wt-input")?.focus();
      } else this.bottom = wifiRequestError(error);
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  override render() {
    const fieldError =
      this.refusal ||
      (this.attempted && !this.password ? t("box_status.network.password_required") : "");
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
        this.opened
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
              ${!this.scanning && this.networks.length === 0 ? html`<p role="status">${t("box_status.network.empty")}</p>` : nothing}
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
          ?disabled=${disabled || !this.#selected() || (this.attempted && !this.password)}
          @click=${() => void this.#join()}
          >${t("box_status.network.join")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
export function wifiRequestError(error: unknown): string {
  const code = codeOf(error);
  return !code || code === "connection.failed" || code === "box_host.failed"
    ? t("box_status.network.unknown")
    : codeMessage(code);
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-box-wifi-dialog": BoxWifiDialog;
  }
}
