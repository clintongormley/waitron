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
import { resolveContentText, type ContentLanguages } from "@waitron/shared";
import { resolveMenuText } from "@waitron/catalogue/src/customer-menu-presentation.js";
import {
  FOLLOWING_FOLDER,
  folderOverridesFrom,
  folderPresentation,
} from "@waitron/catalogue/src/include-folder-presentation.js";
import type {
  IncludeFolder,
  IncludeFolderInput,
  IncludeFolderOverrides,
  Presentation,
} from "@waitron/catalogue/src/section-types.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "./image-upload.js";
import { sameValue } from "./product-editor-model.js";
import { colorField, colorFieldStyles } from "./color-field.js";
import { optionalTextFields } from "./form-fields.js";
import type { ImageUploader } from "./image-upload.js";
import { t } from "../i18n/t.js";

/** How one include shows the menu it includes: as a folder, with the names, colour and photo it
 * fixes, or with the included menu's sections directly in its place. */
@customElement("dashboard-include-folder-form")
export class IncludeFolderForm extends LitElement {
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
      .hint {
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
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
        color: var(--wt-color-danger);
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
  @property({ attribute: false }) api?: ImageUploader;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  /** The included menu's staff name. */
  @property() menuName = "";
  /** The included menu's own customer-facing presentation. */
  @property({ attribute: false }) own: Presentation = { names: {}, image: null, color: null };
  @property({ attribute: false }) value: IncludeFolder | null = null;
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @property({ attribute: false }) draftParent?: object;
  @state() private showAsFolder = true;
  @state() private names: Record<string, string> = {};
  @state() private image: string | null = null;
  @state() private color: string | null = null;
  /** Refusal keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  @state() private pickerOpen = false;
  #scope?: DraftScope<IncludeFolderInput>;
  /** Survives disconnect, so an edit kept across a put-back still compares against it. */
  #baseline?: IncludeFolderInput;
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

  /** The included menu's presentation and the stored folder as the dialog opened on them: what
   * follows the menu and what is fixed is decided against these, not a later refresh. */
  #loaded: { own: Presentation; stored: IncludeFolder } = {
    own: { names: {}, image: null, color: null },
    stored: FOLLOWING_FOLDER,
  };

  #show(showAsFolder: boolean, overrides: IncludeFolderOverrides): void {
    const shown = folderPresentation(this.#loaded.own, { showAsFolder: true, overrides });
    this.showAsFolder = showAsFolder;
    this.names = { ...shown.names };
    for (const locale of this.languages.languages) this.names[locale] ??= "";
    this.image = shown.image;
    this.color = shown.color;
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("open") && this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#baseline = undefined;
      this.#loaded = structuredClone({ own: this.own, stored: this.value ?? FOLLOWING_FOLDER });
      this.#show(this.#loaded.stored.showAsFolder, this.#loaded.stored.overrides);
      this.dismissed = new Set();
    }
    if (changes.has("fieldErrors")) this.dismissed = new Set();
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (!this.#scope && this.isConnected) {
      this.#baseline ??= structuredClone(this.#submissionValue());
      const { coordinator, scope } = draftScopeFor<IncludeFolderInput>(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.#submissionValue(),
        snapshot: (value) => structuredClone(value),
        equal: sameValue,
        // A submission with the switch off carries no overrides; the stored ones fill the hidden
        // fields, so switching back on shows them.
        restore: (value) =>
          this.#show(value.showAsFolder, value.overrides ?? this.#loaded.stored.overrides),
      });
      this.#leave = coordinator;
      this.#scope = scope;
      scope.commit(this.#baseline);
    }
  }
  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("fieldErrors") && this.#fieldKeys(this.fieldErrors).length > 0)
      void focusFirstInvalid(this.shadowRoot!);
  }
  #dismiss(...keys: string[]): void {
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  /** The keys of `errors` that a field this form shows displays. */
  #fieldKeys(errors: Record<string, string>): string[] {
    const shown = new Set(
      this.showAsFolder
        ? [
            "color",
            "image",
            "names",
            ...this.languages.languages.map((locale) => `names-${locale}`),
          ]
        : [],
    );
    return Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && shown.has(key))
      .map(([key]) => key);
  }
  #errors(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.fieldErrors).filter(([key]) => !this.dismissed.has(key)),
    );
  }
  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: IncludeFolderInput | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy || this.pickerOpen) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.#dismiss(...Object.keys(this.fieldErrors));
    this.#emit(event, "wt-submit", this.#submissionValue());
  }
  /** Each name field's hint: what a customer reading that language sees while the field is blank,
   * worked out from the names this form would save. Names the save would refuse are never shown, so
   * they hint nothing. */
  #placeholderFor(): (locale: string) => string {
    const { names } = folderPresentation(this.#loaded.own, {
      showAsFolder: true,
      overrides: this.#overrides(),
    });
    const { defaultLanguage } = this.languages;
    if (
      Object.keys(names).length > 0 &&
      !resolveContentText(names, defaultLanguage, defaultLanguage)
    )
      return () => "";
    return (locale) =>
      resolveMenuText(names, this.menuName, { kind: "customer", language: locale }, this.languages)
        .text;
  }
  #overrides(): IncludeFolderOverrides {
    return folderOverridesFrom(
      this.#loaded.own,
      { names: this.names, image: this.image, color: this.color },
      this.languages.languages,
      this.#loaded.stored.overrides,
    );
  }
  #submissionValue(): IncludeFolderInput {
    if (!this.showAsFolder) return { showAsFolder: false };
    return { showAsFolder: true, overrides: this.#overrides() };
  }
  commitSaved(submitted: IncludeFolderInput): void {
    this.#baseline = structuredClone(submitted);
    this.#scope?.commit(submitted);
  }
  closeSaved(submitted: IncludeFolderInput): void {
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
  #folderFields(errors: Record<string, string>) {
    const context = {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key: string) => errors[key] ?? "",
    };
    return html`<fieldset class="names">
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
          this.#placeholderFor(),
        )}
        <span class="field-error">${errors.names ?? nothing}</span>
      </fieldset>
      ${colorField({
        color: this.color,
        busy: this.busy,
        error: errors.color ?? "",
        name: "include-color",
        errorId: "include-color-error",
        change: (color) => {
          this.color = color;
          this.#scope?.changed();
          this.#dismiss("color");
        },
      })}
      <dashboard-image-upload
        name="include-image"
        .draftParent=${this}
        aria-describedby="include-image-error"
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
      <span class="field-error" id="include-image-error">${errors.image ?? nothing}</span>`;
  }
  override render() {
    const errors = this.#errors();
    const fieldKeys = new Set(this.#fieldKeys(errors));
    const formMessages = Object.entries(errors)
      .filter(([key, message]) => Boolean(message) && !fieldKeys.has(key))
      .map(([, message]) => message);
    const bottom = [...formMessages, ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : [])].join(
      " ",
    );
    const hint = t("menus.include_direct_hint");
    const action = saveActionState(this.#scope);
    return html`<wt-modal
      size="standard"
      .open=${this.open}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      heading=${t("menus.include_edit_heading").replace("{name}", this.menuName)}
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
        <div>
          <wt-switch
            name="show-as-folder"
            label=${t("menus.include_show_as_folder")}
            description=${hint}
            .checked=${this.showAsFolder}
            .disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              this.showAsFolder = event.detail.checked;
              this.#scope?.changed();
            }}
          ></wt-switch>
          <p class="hint" aria-hidden="true">${hint}</p>
        </div>
        ${this.showAsFolder ? this.#folderFields(errors) : nothing}
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
          .disabled=${action.unchanged || this.busy || this.pickerOpen}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-include-folder-form": IncludeFolderForm;
  }
}
