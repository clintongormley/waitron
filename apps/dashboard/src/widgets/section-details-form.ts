import { LocaleChangeController } from "../state/locale-controller.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import { sameValue } from "./product-editor-model.js";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./image-upload.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { textField, optionalTextFields } from "./form-fields.js";
import type { ImageUploader } from "./image-upload.js";
import type { SectionDetails, SectionInput } from "../api/client.js";
import { fieldOf } from "./section-writes.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
@customElement("dashboard-section-details-form")
export class SectionDetailsForm extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    colorFieldStyles,
    css`
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .field-error {
        color: var(--wt-color-danger);
      }
      .names {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .field-error {
        margin: var(--wt-space-3) 0 0;
        text-align: start;
      }
      legend {
        margin-bottom: var(--wt-space-2);
        padding: 0;
      }
      .group-label {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }
    `,
  ];
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: SectionDetails | null = null;
  @property({ attribute: false }) draftParent?: object;
  @property() heading = "";
  @property() nameLabel = "";
  @property() nameRequired = "";
  @property({ attribute: false }) api?: ImageUploader;
  @property({ attribute: false }) refusal: unknown = null;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private names: Record<string, string> = {};
  @state() private internalName = "";
  @state() private image: string | null = null;
  @state() private color: string | null = null;
  @state() private attempted = false;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  @state() private pickerOpen = false;
  #scope?: DraftScope<SectionInput>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    !this.pickerOpen &&
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
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as SectionDetails | null | undefined)?.id)
    ) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.names = { ...this.value?.names };
      this.internalName = this.value?.internalName ?? "";
      for (const locale of this.languages.languages) this.names[locale] ??= "";
      this.image = this.value?.image ?? null;
      this.color = this.value?.color ?? null;
      this.attempted = false;
      this.dismissed = new Set();
    }
    if (changes.has("fieldErrors") || changes.has("refusal")) this.dismissed = new Set();
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (!this.#scope && this.isConnected) {
      const { coordinator, scope } = draftScopeFor<SectionInput>(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.#submissionValue(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        restore: (value) => {
          this.internalName = value.internalName;
          this.names = { ...value.names };
          this.image = value.image ?? null;
          this.color = value.color ?? null;
        },
      });
      this.#leave = coordinator;
      this.#scope = scope;
    }
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("fieldErrors") && this.#fieldKeys(this.fieldErrors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }
  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }
  #validate(): Record<string, string> {
    return this.internalName.trim()
      ? {}
      : { internalName: this.nameRequired || t("sections.internal_name_required") };
  }

  /** The keys of `errors` that a field this form shows displays. */
  #fieldKeys(errors: Record<string, string>): string[] {
    const shown = new Set([
      "internalName",
      "color",
      "image",
      ...this.languages.languages.map((locale) => `names-${locale}`),
    ]);
    return Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && shown.has(key))
      .map(([key]) => key);
  }
  #errors(): Record<string, string> {
    const refused = Object.fromEntries(
      Object.entries({
        ...this.fieldErrors,
        ...(this.refusal ? { [fieldOf(this.refusal)]: codeMessage(codeOf(this.refusal)) } : {}),
      }).filter(([key]) => !this.dismissed.has(key)),
    );
    return { ...refused, ...(this.attempted ? this.#validate() : {}) };
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: SectionInput | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.pickerOpen) return;
    this.attempted = true;
    this.#dismiss(
      ...Object.keys(this.fieldErrors),
      ...(this.refusal ? [fieldOf(this.refusal)] : []),
    );
    if (Object.keys(this.#validate()).length > 0) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    this.#emit(event, "wt-submit", this.#submissionValue());
  }
  #submissionValue(): SectionInput {
    return {
      internalName: this.internalName.trim(),
      names: Object.fromEntries(
        Object.entries(this.names)
          .map(([language, text]) => [language, text.trim()])
          .filter(([, text]) => text),
      ),
      image: this.image,
      color: this.color,
    };
  }
  commitSaved(submitted: SectionInput): void {
    this.#scope?.commit(submitted);
  }
  closeSaved(submitted: SectionInput): void {
    this.commitSaved(submitted);
    this.open = false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }
  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.pickerOpen || !this.open) return;
    if (this.#leave) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.#emit(event, "wt-cancel", {});
  }
  override render() {
    const errors = this.#errors();
    const context = {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key: string) => errors[key] ?? "",
    };
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    const action = saveActionState(this.#scope);
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      heading=${this.heading}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        if (!this.busy && !this.pickerOpen && this.open) this.#emit(event, "wt-cancel", {});
        else event.stopPropagation();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        ${textField(
          context,
          "internalName",
          this.nameLabel || t("sections.internal_name"),
          this.internalName,
          (value) => {
            this.internalName = value;
            this.#scope?.changed();
            this.#dismiss("internalName");
          },
          true,
          t("sections.internal_name_help"),
        )}
        <fieldset class="names">
          <legend class="group-label" data-test="customer-names-heading">
            ${t("sections.customer_names")}
          </legend>
          ${optionalTextFields(
            context,
            "names",
            t("sections.customer_name"),
            this.names,
            (names) => {
              const changed = Object.keys(names).filter(
                (language) => names[language] !== this.names[language],
              );
              this.names = names;
              this.#scope?.changed();
              this.#dismiss("names", ...changed.map((language) => `names-${language}`));
            },
            this.internalName,
            this.languages.defaultLanguage,
          )}
          <span class="field-error">${errors.names ?? nothing}</span>
        </fieldset>
        ${colorField({
          color: this.color,
          busy: this.busy,
          error: errors.color ?? "",
          name: "section-color",
          errorId: "section-color-error",
          change: (color) => {
            this.color = color;
            this.#scope?.changed();
            this.#dismiss("color");
          },
        })}
        <dashboard-image-upload
          .draftParent=${this}
          aria-describedby="section-image-error"
          .api=${this.api}
          .invalid=${Boolean(errors.image)}
          .image=${this.image}
          @image-picker-state=${(event: CustomEvent<{ open: boolean }>) => {
            event.stopPropagation();
            this.pickerOpen = event.detail.open;
          }}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            this.image = event.detail.image;
            this.#scope?.changed();
            this.#dismiss("image");
          }}
        ></dashboard-image-upload>
        <span class="field-error" id="section-image-error">${errors.image ?? nothing}</span>
      </div>
      <p class="field-error" role="alert" data-test="form-error">
        ${this.open ? bottom || nothing : nothing}
      </p>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${this.#cancel}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${action.variant}
          .disabled=${action.unchanged || this.busy || this.pickerOpen || invalid}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-section-details-form": SectionDetailsForm;
  }
}
