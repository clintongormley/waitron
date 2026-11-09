import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type {
  ModulePromotionEntry,
  SetupContribution,
} from "@waitron/module/src/setup-contract.js";
import { SETUP_MODULES } from "@waitron/dashboard-modules/setup";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { baseStyles, focusFirstInvalid } from "@waitron/ui";
import { SetupApi, type HandoverStatus, type HandoverSignIn } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

const activated = (status?: HandoverStatus) =>
  status?.role === "destination" &&
  ["activated", "return_pending", "return_complete", "return_abandoned"].includes(status.state);
const closed = (status?: HandoverStatus) =>
  status !== undefined && ["abandoned", "replaced"].includes(status.state);

@customElement("setup-handover-screen")
export class SetupHandoverScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        max-width: 70ch;
        padding: var(--wt-space-5);
        overflow-wrap: anywhere;
      }
      wt-input {
        display: block;
        margin-bottom: var(--wt-space-3);
      }
      h1 {
        font-size: var(--wt-font-size-xl);
        margin-top: 0;
      }
      a {
        color: var(--wt-color-primary-text);
      }
    `,
  ];
  @property({ attribute: false }) api = new SetupApi();
  @property() operationId = "";
  @state() private status?: HandoverStatus;
  @state() private readFailed = false;
  @property({ attribute: false }) contributions: readonly SetupContribution[] = SETUP_MODULES;
  @state() private email = "";
  @state() private password = "";
  @state() private code = "";
  @state() private attempted = false;
  @state() private actionError = "";
  @state() private busy = false;
  @state() private ready = false;
  @state() private entry?: ModulePromotionEntry;
  #controller?: AbortController;
  #timer?: ReturnType<typeof setTimeout>;
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#restartPolling();
  }
  #restartPolling(): void {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    const controller = new AbortController();
    this.#controller = controller;
    void this.#poll(controller);
  }
  override disconnectedCallback(): void {
    this.#controller?.abort();
    clearTimeout(this.#timer);
    this.#resetSelection();
    this.password = this.code = "";
    super.disconnectedCallback();
  }
  async #poll(controller: AbortController): Promise<void> {
    try {
      const status = await this.api.handoverStatus(this.operationId, controller.signal);
      if (controller.signal.aborted) return;
      this.status = status;
      if (activated(status) || closed(status)) {
        this.#resetSelection();
        this.password = this.code = "";
      }
      this.readFailed = false;
    } catch {
      if (controller.signal.aborted) return;
      this.readFailed = true;
    }
    if (!controller.signal.aborted && !activated(this.status) && !closed(this.status)) {
      this.#timer = setTimeout(() => void this.#poll(controller), 2000);
    }
  }
  #resetSelection(): void {
    this.entry?.clear();
    this.entry = undefined;
    this.ready = false;
  }
  #signIn(): HandoverSignIn {
    return {
      email: this.email.trim(),
      password: this.password,
      ...(this.code.trim() ? { totp: this.code.trim() } : {}),
    };
  }
  #valid(): boolean {
    return this.email.includes("@") && this.password !== "";
  }
  async #authenticate(): Promise<void> {
    this.attempted = true;
    if (this.busy) return;
    if (!this.#valid()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.actionError = "";
    this.#resetSelection();
    const contribution = this.contributions.filter((item) => item.createPromotion);
    const status = this.status;
    if (contribution.length !== 1 || !status?.copyPlaced) return;
    const binding = {
      module: contribution[0]!.module,
      action: "promote",
      eventId: status.operationId,
      sourceId: status.sourceNodeId,
      targetNodeId: status.destinationNodeId,
    };
    const signIn = this.#signIn();
    this.entry = contribution[0]!.createPromotion!({
      locale: currentLocale().startsWith("es") ? "es" : "en",
      binding,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      prepare: (proposal) => this.api.prepareHandover(this.operationId, signIn, binding, proposal),
    });
  }
  async #activate(): Promise<void> {
    const moduleOperation = this.entry?.readOperation();
    if (!moduleOperation || this.busy) return;
    const controller = this.#controller;
    this.busy = true;
    this.actionError = "";
    try {
      await this.api.activateHandover(this.operationId, this.#signIn(), moduleOperation);
      if (controller?.signal.aborted) return;
      this.#resetSelection();
      this.password = this.code = "";
      this.#restartPolling();
    } catch (cause) {
      if (controller?.signal.aborted) return;
      this.actionError = this.entry!.refusalMessage(cause);
      this.#resetSelection();
      this.#restartPolling();
    } finally {
      this.busy = false;
    }
  }
  #fields() {
    const field = (
      name: "email" | "password" | "code",
      key: "handover.email" | "handover.password" | "handover.code",
    ) =>
      html`<wt-input
        name=${`handover-${name}`}
        label=${t(key)}
        type=${name === "password" ? "password" : name === "email" ? "email" : "text"}
        autocomplete=${name === "code" ? "one-time-code" : name === "email" ? "username" : "current-password"}
        .value=${this[name]}
        ?required=${name !== "code"}
        ?disabled=${this.busy}
        .error=${this.attempted && name !== "code" && (name === "email" ? !this.email.includes("@") : !this.password) ? t("handover.required") : ""}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          this.#resetSelection();
          if (name === "email" && event.detail.value !== this.email) this.password = this.code = "";
          this[name] = event.detail.value;
          this.actionError = "";
        }}
      ></wt-input>`;
    return html`<p>${t("handover.sign_in")}</p>
      ${field("email", "handover.email")}${field("password", "handover.password")}${field("code", "handover.code")}
      ${
        this.entry
          ? html`<p>${t("handover.zone")}</p>
              ${this.entry}`
          : nothing
      }
      <wt-form-actions
        .error=${this.actionError ? this.actionError : this.attempted && !this.#valid() ? t("handover.fix") : ""}
      >
        ${
          this.entry
            ? html`<wt-button
                data-test="activate"
                .disabled=${!this.ready || this.busy}
                variant=${this.ready ? "primary" : "secondary"}
                @click=${() => void this.#activate()}
                >${t("handover.activate")}</wt-button
              >`
            : html`<wt-button
                data-test="authenticate"
                .disabled=${this.busy || (this.attempted && !this.#valid())}
                variant=${this.busy ? "secondary" : "primary"}
                @click=${() => void this.#authenticate()}
                >${t("handover.compare")}</wt-button
              >`
        }
      </wt-form-actions>`;
  }
  override render() {
    const status = this.status;
    return html`<main
      lang=${currentLocale()}
      @promotion-change=${() => {
        this.ready = this.entry?.readOperation() !== null && this.entry !== undefined;
      }}
    >
      <h1>${t("handover.heading")}</h1>
      ${
        activated(status)
          ? html`<p role="status">${t("handover.done")}</p>
              <a href="/">${t("handover.continue")}</a>`
          : closed(status)
            ? html`<p role="status">${t("handover.closed")}</p>`
            : status?.role === "destination" &&
                status.copyPlaced &&
                status.scenario === "controlled"
              ? this.#fields()
              : html`<p role="status">${t(status ? "handover.copy" : "handover.loading")}</p>`
      }
      ${status?.waitingReason ? html`<p role="status">${t(status.waitingReason === "storage.disk_full" || status.waitingReason === "handover.no_room_to_place" ? "handover.space" : status.waitingReason === "handover.source_unreachable" ? "handover.source" : "handover.wait")}</p>` : nothing}
      ${this.readFailed ? html`<p role="status">${t("handover.read_failed")}</p>` : nothing}
    </main>`;
  }
}
