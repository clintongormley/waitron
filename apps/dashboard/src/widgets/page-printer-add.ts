import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { WtModal } from "@waitron/ui";
import type { DashboardApi, PagePrinterEntry } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import { bottomMessage, refusal } from "../i18n/form-message.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/**
 * Names an office printer found by discovery and adds it as an invoice printer. Open while `entry`
 * is set. Sends `page-printer-added` (`detail: { name }`) once the server has added it, and
 * `page-printer-add-closed` when the dialog has closed, either way.
 */
@customElement("dashboard-page-printer-add")
export class PagePrinterAdd extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) api?: Pick<DashboardApi, "registerPagePrinter">;
  @property({ attribute: false }) entry: PagePrinterEntry | null = null;
  /** What the dialog says it is adding: the device's name and address. */
  @property() description = "";
  @property({ attribute: false }) draftParent?: object;
  @state() private name = "";
  @state() private attempted = false;
  @state() private sending = false;
  @state() private refusedCode: string | null = null;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;
  /** The name the scope last committed; kept through a disconnect so a reattached dialog that was
   * edited still counts as changed. */
  #baseline = "";
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.sending &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("entry") && this.entry !== null) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#baseline = "";
      this.name = "";
      this.attempted = false;
      this.refusedCode = null;
    }
    if (this.entry === null) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (!this.#scope && this.isConnected) {
      const { coordinator, scope } = draftScopeFor<string>(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.name,
        snapshot: (value) => value,
        equal: (a, b) => a === b,
        restore: (value) => {
          this.name = value;
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
  }

  #nameError(): string {
    return this.attempted && this.name.trim() === "" ? t("form.name_required") : "";
  }

  async #add(): Promise<void> {
    const entry = this.entry;
    if (entry === null || this.sending || saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusedCode = null;
    const name = this.name.trim();
    if (name === "") {
      await this.updateComplete;
      void focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.sending = true;
    try {
      await this.api!.registerPagePrinter({ ...entry, name });
    } catch (error) {
      this.refusedCode = codeOf(error);
      return;
    } finally {
      this.sending = false;
    }
    this.#baseline = this.name;
    this.#scope?.commit(this.name);
    this.dispatchEvent(new CustomEvent("page-printer-added", { detail: { name } }));
    this.shadowRoot!.querySelector<WtModal>("wt-modal")!.closeAfter("saved");
  }

  override render() {
    const nameError = this.#nameError();
    const action = saveActionState(this.#scope);
    return html`<wt-modal
      size="compact"
      data-test="page-printer-add-modal"
      heading=${t("printers.page_printer_add")}
      .open=${this.entry !== null}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @keydown=${(event: KeyboardEvent) =>
        submitOnEnter(
          event,
          this.shadowRoot!.querySelector("[data-test=confirm-add-page-printer]"),
        )}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("page-printer-add-closed"));
      }}
    >
      <div class="fields">
        <p class="hint">${this.description}</p>
        <wt-input
          required
          name="name"
          autocomplete="off"
          label=${t("printers.name")}
          .value=${this.name}
          .invalid=${nameError !== ""}
          .error=${nameError}
          ?disabled=${this.sending}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.name = event.detail.value;
            this.#scope?.changed();
          }}
        ></wt-input>
      </div>
      <wt-form-actions
        slot="footer"
        .error=${bottomMessage(refusal(this.refusedCode), nameError === "" ? null : t("form.fix_fields"))}
      >
        <wt-button
          slot="cancel"
          data-test="cancel-add-page-printer"
          ?disabled=${this.sending}
          @click=${() =>
            void this.shadowRoot!.querySelector<WtModal>("wt-modal")!.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="confirm-add-page-printer"
          variant=${action.variant}
          ?loading=${this.sending}
          ?disabled=${action.unchanged || nameError !== ""}
          @click=${() => void this.#add()}
          >${t("action.add")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-page-printer-add": PagePrinterAdd;
  }
}
