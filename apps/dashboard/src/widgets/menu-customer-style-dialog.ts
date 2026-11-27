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
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-modal.js";
import { cardFrameStyles } from "@waitron/ui-core/components/wt-card";
import { contrastRatio } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MenuApi } from "../api/menu-api.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { colourValueField, colourValueStyles } from "./color-field.js";
import { fixLineStyles } from "./fix-line-styles.js";
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
    fixLineStyles,
    css`
      .style-card {
        ${cardFrameStyles}
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .style-label {
        display: block;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .style-name,
      .swatches {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .swatches span {
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        border-radius: var(--wt-radius-full);
        border: 1px solid var(--wt-color-border);
      }
      .layout {
        display: grid;
        gap: var(--wt-space-4);
      }
      .fields {
        display: grid;
        align-content: start;
        gap: var(--wt-space-3);
      }
      .fields p:not(.warning) {
        margin: 0;
      }
      .fonts {
        display: grid;
        gap: var(--wt-space-3);
      }
      .preview {
        min-inline-size: 0;
        container: online-editor / inline-size;
        --menu-preview-space: 0;
      }
      @media (min-width: 900px) {
        .layout {
          grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
        }
        .fonts {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<MenuApi, "saveCustomerStyle">;
  @property({ attribute: false }) readApi!: Pick<
    MenuApi,
    "getCustomerPreview" | "getCustomerStyle"
  >;
  @property({ attribute: false }) menuId = "";
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: false }) photos: CustomerMenuPhotoSize = "large";
  @property({ attribute: false }) previewHref = "";
  @property({ attribute: false }) openPreview?: (event: MouseEvent) => void;

  @state() private storedStyle?: CustomerMenuStyle | null;
  @state() private open = false;
  @state() private draft: Draft = {};
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
    this.storedStyle = undefined;
    try {
      const style = await this.readApi.getCustomerStyle(this.menuId);
      if (!this.isConnected) return;
      this.storedStyle = style;
      this.draft = style.appearance;
      this.#scope?.commit(this.draft);
    } catch {
      if (this.isConnected) this.storedStyle = null;
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
    let saved: CustomerMenuStyle;
    try {
      saved = await this.api.saveCustomerStyle(this.menuId, submitted);
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
    this.storedStyle = saved;
    this.#scope?.commit(submitted);
    this.dispatchEvent(new CustomEvent("customer-style-saved", { bubbles: true, composed: true }));
    this.#modal.closeAfter("saved");
  }

  #color(key: Color, color: string, error: string, warning?: string) {
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
      <div role="status">
        ${warning ? html`<p class="warning"><wt-icon name="warning"></wt-icon><span>${warning}</span></p>` : nothing}
      </div>
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
      return this.storedStyle === null
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
    const affected = this.storedStyle.affectedMenus.map(({ name }) => name);
    const names = new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(affected);
    return html`<div class="layout">
      <div class="fields">
        <div>
          <span class="style-label">${t("customer_menu.style.open")}</span>${this.storedStyle.name}
          ${names ? html`<span class="style-label">${fill("customer_menu.style.affected", { menus: names })}</span>` : nothing}
        </div>
        <div class="fonts">${this.#font("headingFont")} ${this.#font("textFont")}</div>
        <p>${t("customer_menu.style.default_colour")}</p>
        ${this.#color("pageColor", page, errors.pageColor ?? "")}
        ${this.#color("textColor", text, errors.textColor ?? "", contrastRatio(text, page) < 4.5 ? t("customer_menu.style.text_contrast") : undefined)}
        ${this.#color("headingColor", heading, errors.headingColor ?? "", contrastRatio(heading, page) < 4.5 ? t("customer_menu.style.heading_contrast") : undefined)}
      </div>
      <div class="preview">
        <dashboard-menu-online-preview
          .api=${this.readApi}
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

  #card() {
    const style = this.storedStyle;
    const tokens =
      prepareMenuAppearance(WAITRON_DEFAULTS, style?.appearance)?.tokens ?? WAITRON_DEFAULTS.light;
    const swatches = [
      tokens["--wt-color-bg"],
      tokens["--wt-menu-heading-color"] ?? tokens["--wt-color-primary-text"],
      tokens["--wt-color-text"],
    ];
    return html`<div class="style-card">
      <div>
        <span class="style-label">${t("customer_menu.style.open")}</span>
        ${
          style
            ? html`<div class="style-name">
                <strong>${style.name}</strong
                ><span class="swatches" aria-hidden="true">
                  ${swatches.map((color) => html`<span style=${`background-color: ${color}`}></span>`)}
                </span>
              </div>`
            : nothing
        }
      </div>
      <wt-button
        variant="secondary"
        size="sm"
        ?disabled=${style === undefined}
        @click=${() => {
          this.draft = style?.appearance ?? {};
          this.#feedback.reset();
          this.refusal = undefined;
          this.open = true;
        }}
        >${t("customer_menu.style.change")}</wt-button
      >
    </div>`;
  }

  override render() {
    return html`${this.#card()}${this.open ? this.#editor() : nothing}`;
  }

  #editor() {
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
        this.open = false;
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
