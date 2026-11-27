import { prepareMenuAppearance } from "@waitron/customer-menu/appearance";
import {
  isStoredColor,
  type CustomerMenuAppearance,
  type CustomerMenuPhotoSize,
  type CustomerMenuStyle,
} from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  leaveCoordinatorFor,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { contrastRatio } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MenuApi } from "../api/menu-api.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { colourValueField, colourValueStyles } from "./color-field.js";
import "./menu-online-preview.js";

const colors = ["pageColor", "textColor", "headingColor"] as const;
const fonts = ["headingFont", "textFont"] as const;
type Color = (typeof colors)[number];
type Font = (typeof fonts)[number];
type Draft = { -readonly [K in keyof CustomerMenuAppearance]: CustomerMenuAppearance[K] };

@customElement("dashboard-menu-customer-style-dialog")
export class MenuCustomerStyleDialog extends LitElement {
  static override styles = [
    baseStyles,
    colourValueStyles,
    css`
      .layout {
        display: grid;
        gap: var(--wt-space-4);
      }
      .fields {
        display: grid;
        align-content: start;
        gap: var(--wt-space-3);
      }
      .fields p,
      .fields ul {
        margin: 0;
      }
      .preview {
        min-inline-size: 0;
        container: online-editor / inline-size;
      }
      @media (min-width: 900px) {
        .layout {
          grid-template-columns: minmax(0, 1fr) minmax(0, 3fr);
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<MenuApi, "getCustomerStyle" | "saveCustomerStyle">;
  @property({ attribute: false }) previewApi!: Pick<MenuApi, "getCustomerPreview">;
  @property({ attribute: false }) menuId = "";
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: false }) photos: CustomerMenuPhotoSize = "large";
  @property({ attribute: false }) previewHref = "";
  @property({ attribute: false }) openPreview?: (event: MouseEvent) => void;

  @state() private storedStyle?: CustomerMenuStyle;
  @state() private draft: Draft = {};
  @state() private loadFailed = false;
  @state() private busy = false;
  @state() private refusal?: unknown;
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<Draft>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (draft) => draft,
      equal: (a, b) =>
        colors.every((key) => a[key] === b[key]) &&
        fonts.every((key) => (a[key] ?? "system") === (b[key] ?? "system")),
      restore: (draft) => (this.draft = draft),
    }).scope;
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }

  get #modal() {
    return this.renderRoot.querySelector("wt-modal")!;
  }

  async #load(): Promise<void> {
    this.loadFailed = false;
    try {
      const style = await this.api.getCustomerStyle(this.menuId);
      if (!this.isConnected) return;
      this.storedStyle = style;
      this.draft = style.appearance;
      this.#scope?.commit(this.draft);
    } catch {
      if (this.isConnected) this.loadFailed = true;
    }
  }

  #edit<K extends keyof Draft>(key: K, value: Draft[K]): void {
    if (this.busy) return;
    this.draft = { ...this.draft, [key]: value };
    this.#feedback.dismiss(key, "_form");
    this.#scope?.changed();
  }

  #invalid(key: Color): boolean {
    const value = this.draft[key];
    return value !== undefined && !isStoredColor(value);
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    const leave = leaveCoordinatorFor(this);
    return (
      !leave || (await leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };

  async #save(): Promise<void> {
    if (this.busy || !this.storedStyle || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press(...colors, "_form");
    if (colors.some((key) => this.#invalid(key))) {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    this.busy = true;
    this.refusal = undefined;
    const submitted = this.draft;
    try {
      await this.api.saveCustomerStyle(this.menuId, submitted);
    } catch (error) {
      if (this.isConnected) {
        this.refusal = error;
        this.#feedback.newRefusal();
      }
      return;
    } finally {
      this.busy = false;
    }
    if (!this.isConnected) return;
    this.#scope?.commit(submitted);
    this.dispatchEvent(new CustomEvent("customer-style-saved", { bubbles: true, composed: true }));
    this.#modal.closeAfter("saved");
  }

  #color(key: Color, color: string, error: string) {
    const label = t(`customer_menu.style.${key}`);
    return html`<div>
      <p>${label}</p>
      ${colourValueField({
        colour: color,
        code: this.draft[key] ?? "",
        name: key,
        pickerName: `${key}-picker`,
        label: `${label} · ${t("editor.color_custom")}`,
        codeLabel: label,
        error,
        busy: this.busy,
        pick: (value) => this.#edit(key, value),
        type: (text) => this.#edit(key, text.toLowerCase() || undefined),
      })}
    </div>`;
  }

  #font(key: Font) {
    return html`<wt-combobox
      name=${key}
      label=${t(`customer_menu.style.${key}`)}
      .value=${this.draft[key] ?? "system"}
      .options=${[
        { value: "system", label: t("appearance.typeface.system") },
        { value: "serif", label: t("appearance.typeface.serif") },
      ]}
      search="never"
      ?disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: Draft[Font] }>) => {
        event.stopPropagation();
        this.#edit(key, event.detail.value);
      }}
    ></wt-combobox>`;
  }

  #content(errors: Partial<Record<Color, string>>) {
    if (!this.storedStyle) {
      return this.loadFailed
        ? html`<p role="alert">${t("customer_menu.style.load_error")}</p>
            <wt-button variant="secondary" @click=${() => void this.#load()}
              >${t("menus.retry")}</wt-button
            >`
        : html`<p role="status">${t("menus.loading")}</p>`;
    }
    const valid = { ...this.draft };
    for (const key of colors) if (this.#invalid(key)) delete valid[key];
    const prepared = prepareMenuAppearance(WAITRON_DEFAULTS, valid)!;
    const tokens = prepared.tokens;
    const page = tokens["--wt-color-bg"]!;
    const text = tokens["--wt-color-text"]!;
    const heading = tokens["--wt-menu-heading-color"] ?? tokens["--wt-color-primary-text"]!;
    return html`<div class="layout">
      <div class="fields">
        <p><strong>${this.storedStyle.name}</strong></p>
        ${this.#font("headingFont")} ${this.#font("textFont")}
        <p>${t("customer_menu.style.default_colour")}</p>
        ${this.#color("pageColor", page, errors.pageColor ?? "")}
        ${this.#color("textColor", text, errors.textColor ?? "")}
        ${this.#color("headingColor", heading, errors.headingColor ?? "")}
        <div role="status">
          ${contrastRatio(text, page) < 4.5 ? html`<p>${t("customer_menu.style.text_contrast")}</p>` : nothing}
          ${contrastRatio(heading, page) < 4.5 ? html`<p>${t("customer_menu.style.heading_contrast")}</p>` : nothing}
        </div>
        ${
          this.storedStyle.affectedMenus.length
            ? html`<p>${t("customer_menu.style.affected")}</p>
                <ul>
                  ${this.storedStyle.affectedMenus.map(({ name }) => html`<li>${name}</li>`)}
                </ul>`
            : nothing
        }
      </div>
      <div class="preview">
        <dashboard-menu-online-preview
          .api=${this.previewApi}
          .menuId=${this.menuId}
          .defaultLanguage=${this.defaultLanguage}
          .photos=${this.photos}
          .previewHref=${this.previewHref}
          .openPreview=${this.openPreview}
          .draftAppearance=${prepared}
        ></dashboard-menu-online-preview>
      </div>
    </div>`;
  }

  override render() {
    const action = saveActionState(this.#scope);
    const refusalField = this.refusal ? fieldOf(this.refusal) : undefined;
    const colorRefusal = colors.find((key) => key === refusalField);
    const errors = Object.fromEntries(
      colors.flatMap((key) =>
        this.#feedback.attempted && this.#invalid(key)
          ? [[key, t("customer_menu.style.hex")]]
          : key === colorRefusal && this.#feedback.shows(key)
            ? [[key, codeMessage(codeOf(this.refusal))]]
            : [],
      ),
    );
    const formError =
      this.refusal && !colorRefusal && this.#feedback.shows("_form")
        ? codeMessage(codeOf(this.refusal))
        : undefined;
    const error = this.#feedback.message(
      { ...errors, _form: formError },
      new Set(Object.keys(errors)),
      t("form.fix_fields"),
    );
    return html`<wt-modal
      open
      heading=${t("customer_menu.style.heading")}
      .beforeClose=${this.#beforeClose}
      .dismissible=${!this.busy}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector("[data-save-style]"))}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("customer-style-close", { bubbles: true, composed: true }),
        );
      }}
    >
      ${this.#content(errors)}
      <wt-form-actions slot="footer" .error=${error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => void this.#modal.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-save-style
          variant=${action.variant}
          ?loading=${this.busy}
          ?disabled=${!this.storedStyle || action.unchanged || this.busy || (this.#feedback.attempted && colors.some((key) => this.#invalid(key)))}
          @click=${() => void this.#save()}
          >${t("customer_menu.style.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
