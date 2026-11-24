import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope, type LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, SelfResetRefusal } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { fill, t } from "../i18n/t.js";

const REFUSAL: Record<SelfResetRefusal, StringKey> = {
  environment: "servers.self_reset_environment",
  local_address_required: "servers.self_reset_local",
  joined_another_box: "servers.self_reset_joined",
  remove_other_boxes: "servers.self_reset_other_boxes",
  reset_pending: "servers.self_reset_pending",
};

export function resetThisBoxRefusal(reason: unknown): string {
  return typeof reason === "string" && Object.hasOwn(REFUSAL, reason)
    ? t(REFUSAL[reason as SelfResetRefusal])
    : codeMessage("membership.self_reset_failed");
}

async function setupIsReady(signal: AbortSignal): Promise<boolean> {
  const response = await fetch("/setup-api/status", {
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
  });
  return response.ok && (await response.json())?.provisioned === false;
}

@customElement("dashboard-reset-this-box-dialog")
export class ResetThisBoxDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p:first-child {
        margin-top: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .note {
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<DashboardApi, "resetThisBox">;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property({ type: Boolean }) canExportConfiguration = false;
  @state() private word = "";
  @state() private busy = false;
  @state() private error = "";
  @state() private setupUrl = "";
  @state() private waiting = false;
  #lifetime = new AbortController();
  #draft?: DraftScope<string>;
  #canClose?: (reason: LeaveReason) => Promise<boolean>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#lifetime = new AbortController();
    const { scope, coordinator } = draftScopeFor(this, {
      id: this,
      current: () => this.word,
      snapshot: (word) => word,
      equal: (first, second) => first === second,
      restore: (word) => {
        this.word = word;
      },
    });
    this.#draft = scope;
    this.#canClose = async (reason) =>
      !coordinator ||
      (await coordinator.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  }

  override disconnectedCallback(): void {
    this.#lifetime.abort();
    this.#draft?.dispose();
    super.disconnectedCallback();
  }

  #close(): void {
    void this.renderRoot.querySelector("wt-dialog")?.requestClose("cancel");
  }

  async #reset(): Promise<void> {
    if (this.busy || this.setupUrl || this.word !== t("servers.self_reset_word")) return;
    const { signal } = this.#lifetime;
    this.busy = true;
    this.error = "";
    try {
      const { setupUrl } = await this.api.resetThisBox(signal);
      if (signal.aborted) return;
      this.#draft?.commit(this.word);
      this.setupUrl = setupUrl;
      this.waiting = true;
      const deadline = performance.now() + 60_000;
      while (!signal.aborted && performance.now() < deadline) {
        if (await setupIsReady(signal).catch(() => false)) {
          if (!signal.aborted) window.location.assign(setupUrl);
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      this.waiting = false;
    } catch (error) {
      if (signal.aborted) return;
      const code = codeOf(error);
      this.error =
        code === "membership.self_reset_unavailable"
          ? resetThisBoxRefusal((error as { params?: { reason?: unknown } }).params?.reason)
          : codeMessage(code);
    } finally {
      this.busy = false;
    }
  }

  override render() {
    const ready = this.word === t("servers.self_reset_word") && !this.busy;
    return html`<wt-dialog
      open
      heading=${t("servers.self_reset")}
      .opener=${this.opener}
      .dismissible=${!this.busy}
      .beforeClose=${this.#canClose}
    >
      ${
        this.setupUrl
          ? html`<p role="status">
                ${t(this.waiting ? "servers.self_reset_wait" : "servers.self_reset_timeout")}
              </p>
              ${this.waiting ? nothing : html`<a href=${this.setupUrl}>${t("servers.self_reset_open")}</a>`}`
          : html`<p>${t("servers.self_reset_loss")}</p>
              <p>${t("servers.self_reset_keeps")}</p>
              ${
                this.canExportConfiguration
                  ? html`<p>
                      ${t("servers.self_reset_export")}
                      <a href="/backup">${t("nav.backup")}</a>.
                    </p>`
                  : nothing
              }
              <wt-input
                name="confirmation"
                required
                autocomplete="off"
                label=${fill("servers.self_reset_confirm", { word: t("servers.self_reset_word") })}
                .value=${this.word}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  this.word = event.detail.value;
                  this.#draft?.changed();
                }}
              ></wt-input>
              <p class="note">${t("servers.self_reset_sign_in")}</p>
              <wt-form-actions slot="footer" .error=${this.error}>
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  autofocus
                  ?disabled=${this.busy}
                  @click=${this.#close}
                  >${t("servers.handover_stop")}</wt-button
                >
                <wt-button
                  variant=${ready || this.busy ? "danger" : "secondary"}
                  ?disabled=${!ready}
                  .loading=${this.busy}
                  @click=${() => void this.#reset()}
                  >${t("servers.self_reset")}</wt-button
                >
              </wt-form-actions>`
      }
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-reset-this-box-dialog": ResetThisBoxDialog;
  }
}
