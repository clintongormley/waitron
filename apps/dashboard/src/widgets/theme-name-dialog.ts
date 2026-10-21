import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import { checkThemeName } from "@waitron/ui-core/theme";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { nameCheckText, nameRefusalText } from "./theme-names.js";

export type ThemeNameKind = "rename" | "copy" | "save-as-new" | "first-save";

export interface ThemeNameRequest {
  readonly kind: ThemeNameKind;
  readonly name: string;
  /** Ignored for "rename", which shows no switch. */
  readonly inUse: boolean;
  readonly warningLines: readonly string[];
  /** Throws the request's error. */
  readonly submit: (input: { name: string; inUse: boolean }) => Promise<void>;
}

interface Draft {
  readonly name: string;
  readonly inUse: boolean;
}

@customElement("dashboard-theme-name-dialog")
export class ThemeNameDialog extends LitElement {
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
      .warnings p {
        margin: 0 0 var(--wt-space-2);
      }
      .warnings ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
        display: grid;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The request the dialog opened with; null while it is shut. */
  @state() private request: ThemeNameRequest | null = null;
  @state() private name = "";
  @state() private inUse = false;
  @state() private busy = false;
  @state() private attempted = false;
  /** A refusal's sentence for the field, kept until the field changes or Save is pressed again. */
  @state() private refusal = "";
  @state() private bottom = "";

  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #opening = 0;

  show(request: ThemeNameRequest): void {
    if (this.request !== null) return;
    this.#opening += 1;
    const inUse = request.kind === "rename" ? false : request.inUse;
    this.request = request;
    this.name = request.name;
    this.inUse = inUse;
    this.busy = false;
    this.attempted = false;
    this.refusal = "";
    this.bottom = "";
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: {},
      current: () => ({ name: this.name.trim(), inUse: this.inUse }),
      snapshot: (draft) => ({ ...draft }),
      equal: (a, b) => a.name === b.name && a.inUse === b.inUse,
      restore: (draft) => {
        this.name = draft.name;
        this.inUse = draft.inUse;
        this.refusal = "";
        this.bottom = "";
        this.attempted = false;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit({ name: request.name.trim(), inUse });
  }

  /** Closes without asking and sends nothing. */
  dismiss(): void {
    if (this.request !== null) this.#close();
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  #close(): void {
    this.#opening += 1;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.request = null;
    this.busy = false;
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  #action(): { variant: "primary" | "secondary"; unchanged: boolean } {
    const kind = this.request?.kind;
    return saveActionState(this.#scope, {
      savableAtOpen: kind === "copy" || kind === "save-as-new",
    });
  }

  #ownError(): string {
    return this.attempted ? nameCheckText(checkThemeName(this.name)) : "";
  }

  #edited(): void {
    this.refusal = "";
    this.bottom = "";
    this.#scope?.changed();
  }

  #changeName(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (this.request === null || this.busy) return;
    this.name = event.detail.value;
    this.#edited();
  }

  #changeInUse(event: CustomEvent<{ checked: boolean }>): void {
    event.stopPropagation();
    if (this.request === null || this.busy) return;
    this.inUse = event.detail.checked;
    this.#edited();
  }

  async #save(): Promise<void> {
    const request = this.request;
    if (request === null || this.busy) return;
    if (this.#action().unchanged) return;
    this.attempted = true;
    this.refusal = "";
    this.bottom = "";
    if (this.#ownError()) {
      await this.#focusField();
      return;
    }
    const sent = { name: this.name.trim(), inUse: request.kind === "rename" ? false : this.inUse };
    const opening = this.#opening;
    this.busy = true;
    try {
      await request.submit(sent);
      if (opening !== this.#opening) return;
      this.#scope?.commit(sent);
      this.#dialog()?.closeAfter("saved");
      this.#close();
    } catch (error) {
      if (opening !== this.#opening) return;
      this.busy = false;
      const code = codeOf(error);
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: Record<string, unknown> }).params
          : undefined;
      const sentence =
        code === "theme.name_taken" || (code === "theme.invalid" && params?.field === "name")
          ? nameRefusalText(code, params?.reason)
          : "";
      if (sentence) {
        this.refusal = sentence;
        await this.#focusField();
      } else {
        this.bottom = codeMessage(code);
      }
    }
  }

  async #focusField(): Promise<void> {
    await this.updateComplete;
    this.#dialog()?.querySelector<HTMLElement>("wt-input[name=name]")?.focus();
  }

  #warnings(request: ThemeNameRequest): TemplateResult | typeof nothing {
    if (request.kind === "rename" || !this.inUse || request.warningLines.length === 0) {
      return nothing;
    }
    return html`<div class="warnings" data-test="name-warnings">
      <p>${t("appearance.switch_hard_to_read")}</p>
      <ul>
        ${request.warningLines.map((line) => html`<li>${line}</li>`)}
      </ul>
    </div>`;
  }

  #fields(request: ThemeNameRequest, fieldError: string): TemplateResult {
    return html`<div class="fields">
      <wt-input
        name="name"
        required
        label=${t("appearance.name_label")}
        .value=${this.name}
        .error=${fieldError}
        ?disabled=${this.busy}
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.renderRoot.querySelector<HTMLElement>("[data-test=name-save]"))}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeName(event)}
      ></wt-input>
      ${
        request.kind === "rename"
          ? nothing
          : html`<wt-switch
              name="inUse"
              label=${t("appearance.name_use_now")}
              .checked=${this.inUse}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#changeInUse(event)}
            ></wt-switch>`
      }
      ${this.#warnings(request)}
    </div>`;
  }

  override render(): TemplateResult {
    const request = this.request;
    const fieldError = this.refusal || this.#ownError();
    const bottom = [this.bottom, fieldError ? t("form.fix_fields") : ""].filter(Boolean).join(" ");
    const action = this.#action();
    return html`<wt-dialog
      data-test="name-dialog"
      heading=${t("appearance.name_heading")}
      .open=${request !== null}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${request ? this.#fields(request, fieldError) : nothing}
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="name-back"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.back")}</wt-button
        >
        <wt-button
          data-test="name-save"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.busy || this.#ownError() !== ""}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-name-dialog": ThemeNameDialog;
  }
}
