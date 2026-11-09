import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { FreshSignIn, SignInWays } from "./fresh-sign-in.js";
import "./fresh-sign-in.js";

@customElement("dashboard-fresh-sign-in-dialog")
export class FreshSignInDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "getProfile" | "recoveryPackPasskeyOptions" | "confirmFreshSignIn"
  >;
  @state() private opened = false;
  @state() private busy = false;
  @state() private ways: SignInWays | null = null;
  @state() private refusal = "";
  #scope?: DraftScope<boolean>;
  #leave?: LeaveCoordinator;
  #finish?: (value: boolean) => void;
  #generation = 0;
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  show(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    this.#close(false);
    this.opened = true;
    this.ways = null;
    const { coordinator, scope } = draftScopeFor(this, {
      id: {},
      current: () => this.#signIn()?.typed ?? false,
      snapshot: (value: boolean) => value,
      equal: (a, b) => a === b,
      restore: () => this.#signIn()?.clear(),
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(false);
    return new Promise<boolean>((resolve) => {
      const abort = () => this.#close(false);
      signal.addEventListener("abort", abort, { once: true });
      this.#finish = (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      };
    });
  }
  #signIn(): FreshSignIn | null {
    return this.renderRoot.querySelector("dashboard-fresh-sign-in");
  }
  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector("wt-dialog");
  }
  #close(success: boolean): void {
    this.#generation++;
    this.#signIn()?.clear();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#dialog()?.closeAfter("security");
    this.opened = false;
    this.busy = false;
    this.refusal = "";
    const finish = this.#finish;
    this.#finish = undefined;
    finish?.(success);
  }
  override disconnectedCallback(): void {
    this.#close(false);
    super.disconnectedCallback();
  }
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  async #confirm(method?: "password" | "passkey"): Promise<void> {
    const signIn = this.#signIn();
    if (!this.opened || this.busy || signIn === null) return;
    const generation = this.#generation;
    this.busy = true;
    this.refusal = "";
    let invalid = false;
    try {
      const body = await signIn.signIn(method);
      if (generation !== this.#generation) return;
      if (body === null) {
        invalid = signIn.invalid;
        return;
      }
      await this.api.confirmFreshSignIn(body);
      if (generation === this.#generation) this.#close(true);
    } catch (error) {
      if (generation === this.#generation) this.refusal = signIn.refuse(error);
    } finally {
      if (generation === this.#generation) {
        this.busy = false;
        this.requestUpdate();
        if (invalid) {
          await this.updateComplete;
          if (generation === this.#generation) await focusFirstInvalid(signIn.shadowRoot!);
        }
      }
    }
  }
  override render() {
    const signIn = this.#signIn();
    const noWayIn = this.ways !== null && !this.ways.password && !this.ways.passkey;
    return html`<wt-dialog
      .open=${this.opened}
      heading=${t("fresh_sign_in.heading")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close(false);
      }}
    >
      ${
        this.opened
          ? html`<p>${t("fresh_sign_in.explanation")}</p>
              <dashboard-fresh-sign-in
                .api=${this.api}
                ?disabled=${this.busy}
                @sign-in-ways=${(event: CustomEvent<SignInWays>) => {
                  this.ways = event.detail;
                }}
                @sign-in-change=${() => {
                  this.#scope?.changed();
                  this.requestUpdate();
                }}
                @sign-in-passkey=${() => void this.#confirm("passkey")}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void this.#confirm();
                  }
                }}
              ></dashboard-fresh-sign-in>
              <wt-form-actions
                slot="footer"
                .error=${[this.refusal, signIn?.notice, signIn?.marked ? t("form.fix_fields") : ""].filter(Boolean).join(" ")}
              >
                <wt-button
                  slot="cancel"
                  variant="secondary"
                  @click=${() => void this.#dialog()?.requestClose("cancel")}
                  >${t("action.cancel")}</wt-button
                >
                ${noWayIn ? nothing : html`<wt-button data-test="confirm-proof" variant="primary" ?disabled=${this.busy || this.ways === null || (signIn?.invalid ?? false)} @click=${() => void this.#confirm()}>${t("fresh_sign_in.confirm")}</wt-button>`}
              </wt-form-actions>`
          : nothing
      }
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-fresh-sign-in-dialog": FreshSignInDialog;
  }
}
