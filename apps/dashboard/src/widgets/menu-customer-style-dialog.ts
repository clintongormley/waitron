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
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import { contrastRatio } from "@waitron/ui-core/theme";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import type { MenuApi } from "../api/menu-api.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { colourValueField, colourValueStyles } from "./color-field.js";
import { fixLineStyles } from "./fix-line-styles.js";
import type { CustomerStyleChange } from "./menu-online-save.js";
import "./menu-online-preview.js";

const defaultChoice = "venue-default";
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
      .colour-value > wt-input {
        flex-grow: 1;
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
        .preview {
          --menu-preview-computer-width: 0;
        }
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
    "getCustomerPreview" | "getCustomerStyles"
  >;
  @property({ attribute: false }) menuId = "";
  @property({ attribute: false }) styleId: string | null = null;
  @property({ attribute: false }) disabled = false;
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: false }) photos: CustomerMenuPhotoSize = "large";
  @property({ attribute: false }) previewHref = "";
  @property({ attribute: false }) openPreview?: (event: MouseEvent) => void;

  @query("wt-modal") private modal!: HTMLElementTagNameMap["wt-modal"];
  @state() private styles?: CustomerMenuStyle[] | null;
  @state() private choice: string | null = null;
  @state() private copyName: string | null = null;
  @state() private open = false;
  @state() private draft: Draft = {};
  @state() private busy = false;
  @state() private refusal?: unknown;
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<{ appearance: Draft; name: string }>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.#snapshot(),
      snapshot: (draft) => draft,
      equal: (a, b) =>
        a.name === b.name &&
        colors.every((key) => a.appearance[key] === b.appearance[key]) &&
        fonts.every((key) => (a.appearance[key] ?? "system") === (b.appearance[key] ?? "system")),
      restore: ({ appearance, name }) => {
        this.draft = appearance;
        if (this.copyName !== null) this.copyName = name;
      },
    }).scope;
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    super.disconnectedCallback();
  }

  #styleFor(id: string | null): CustomerMenuStyle | undefined {
    return this.styles?.find((style) => (id === null ? style.isDefault : style.id === id));
  }

  get #selected(): CustomerMenuStyle | undefined {
    return this.#styleFor(this.choice);
  }

  #snapshot() {
    return { appearance: this.draft, name: this.copyName ?? "" };
  }

  #reset(choice: string | null): void {
    this.choice = choice;
    this.draft = this.#selected?.appearance ?? {};
    this.copyName = null;
    this.refusal = undefined;
    this.#feedback.reset();
    this.#scope?.commit(this.#snapshot());
  }

  async #load(): Promise<void> {
    this.styles = undefined;
    try {
      const styles = await this.readApi.getCustomerStyles(this.menuId);
      if (!this.isConnected) return;
      this.styles = styles;
      if (this.open) this.#reset(this.styleId);
    } catch {
      if (this.isConnected) this.styles = null;
    }
  }

  async #choose(value: string): Promise<void> {
    const choice = value === defaultChoice ? null : value;
    if (this.busy || this.choice === choice) return;
    const proceed = () => this.#reset(choice);
    const leave = leaveCoordinatorFor(this);
    if (leave) await leave.request({ scopes: [this], reason: "navigation", proceed });
    else proceed();
    this.requestUpdate();
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

  async #checkColours(): Promise<boolean> {
    this.#feedback.press(...colors, "_form");
    if (!colors.some((key) => this.#invalid(key))) return true;
    await this.#feedback.focus(this.renderRoot);
    return false;
  }

  #use(): void {
    const style = this.#selected;
    if (!style || this.busy || this.choice === this.styleId) return;
    this.#finish({ action: "pick", styleId: this.choice, style });
  }

  async #startCopy(): Promise<void> {
    if (this.busy || !(await this.#checkColours())) return;
    this.refusal = undefined;
    this.copyName = "";
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('[name="name"]')?.focus();
  }

  async #save(): Promise<void> {
    const style = this.#selected;
    if (this.busy || !style) return;
    const name = this.copyName?.trim();
    if (name === undefined) {
      if (saveActionState(this.#scope).unchanged || !(await this.#checkColours())) return;
    } else if (!name) return;
    this.busy = true;
    this.refusal = undefined;
    let saved: CustomerMenuStyle;
    try {
      saved = await this.api.saveCustomerStyle(this.menuId, style.id, this.draft, name);
    } catch (error) {
      if (this.isConnected) {
        this.refusal = error;
        this.#feedback.newRefusal();
        if (fieldOf(error) === "name") await this.#feedback.focus(this.renderRoot);
      }
      return;
    } finally {
      this.busy = false;
    }
    if (!this.isConnected) return;
    const styles = this.styles ?? [];
    this.styles =
      name === undefined
        ? styles.map((row) => (row.id === saved.id ? saved : row))
        : [...styles, saved];
    this.#finish({
      action: name === undefined ? "edit" : "copy",
      styleId: name === undefined ? this.choice : saved.id,
      style: saved,
    });
  }

  #finish(change: CustomerStyleChange): void {
    this.#scope?.commit(this.#snapshot());
    this.dispatchEvent(
      new CustomEvent("customer-style-change", {
        detail: change,
        bubbles: true,
        composed: true,
      }),
    );
    this.modal.closeAfter("saved");
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
    const selected = this.#selected;
    if (!selected) {
      return this.styles !== undefined
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
    const affected = selected.affectedMenus.map(({ name }) => name);
    const names = new Intl.ListFormat(currentLocale(), { type: "conjunction" }).format(affected);
    return html`<div class="layout">
      <div class="fields">
        <div>
          <wt-combobox
            name="customer-menu-style"
            label=${t("customer_menu.style.open")}
            search="never"
            .value=${live(this.choice ?? defaultChoice)}
            .options=${[
              { value: defaultChoice, label: t("customer_menu.style.venue_default"), fixed: true },
              ...(this.styles ?? []).map((style) => ({ value: style.id, label: style.name })),
            ]}
            ?disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              void this.#choose(event.detail.value);
            }}
          ></wt-combobox>
          ${this.#swatches(tokens)}
          ${names ? html`<span class="style-label">${fill("customer_menu.style.affected", { menus: names })}</span>` : nothing}
        </div>
        <div class="fonts">${this.#font("headingFont")} ${this.#font("textFont")}</div>
        <p>${t("customer_menu.style.default_colour")}</p>
        ${this.#color("pageColor", page, errors.pageColor ?? "")}
        ${this.#color("textColor", text, errors.textColor ?? "", contrastRatio(text, page) < 4.5 ? t("customer_menu.style.text_contrast") : undefined)}
        ${this.#color("headingColor", heading, errors.headingColor ?? "", contrastRatio(heading, page) < 4.5 ? t("customer_menu.style.heading_contrast") : undefined)}
      </div>
      <dashboard-menu-online-preview
        class="preview"
        .api=${this.readApi}
        .menuId=${this.menuId}
        .defaultLanguage=${this.defaultLanguage}
        .photos=${this.photos}
        .previewHref=${this.previewHref}
        .openPreview=${this.openPreview}
        .draftAppearance=${prepared}
      ></dashboard-menu-online-preview>
    </div>`;
  }

  #swatches(tokens: Readonly<Record<string, string>>) {
    const swatches = [
      tokens["--wt-color-bg"],
      tokens["--wt-menu-heading-color"] ?? tokens["--wt-color-primary-text"],
      tokens["--wt-color-text"],
    ];
    return html`<span class="swatches" aria-hidden="true">
      ${swatches.map((color) => html`<span style=${`background-color: ${color}`}></span>`)}
    </span>`;
  }

  #card() {
    const style = this.#styleFor(this.styleId);
    const tokens =
      prepareMenuAppearance(WAITRON_DEFAULTS, style?.appearance)?.tokens ?? WAITRON_DEFAULTS.light;
    return html`<div class="style-card">
      <div>
        <span class="style-label">${t("customer_menu.style.open")}</span>
        ${
          style
            ? html`<div class="style-name">
                <strong>${style.name}</strong>${this.#swatches(tokens)}
              </div>`
            : nothing
        }
      </div>
      <wt-button
        variant="secondary"
        ?disabled=${this.disabled || this.styles === undefined}
        @click=${() => {
          this.#reset(this.styleId);
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
    const nameError =
      refusalField === "name" && this.#feedback.shows("name")
        ? codeMessage(codeOf(this.refusal))
        : "";
    const formError =
      this.refusal && !colorRefusal && refusalField !== "name" && this.#feedback.shows("_form")
        ? codeMessage(codeOf(this.refusal))
        : undefined;
    const error = this.#feedback.message(
      { ...errors, name: nameError, _form: formError },
      new Set([...Object.keys(errors), ...(nameError ? ["name"] : [])]),
      t("form.fix_fields"),
    );
    const copying = this.copyName !== null;
    const use = !copying && action.unchanged && this.choice !== this.styleId;
    const invalid = this.#feedback.attempted && colors.some((key) => this.#invalid(key));
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
      ${
        copying
          ? html`<wt-input
              name="name"
              label=${t("customer_menu.style.name")}
              required
              .value=${this.copyName ?? ""}
              .error=${nameError}
              ?disabled=${this.busy}
              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                event.stopPropagation();
                this.copyName = event.detail.value;
                this.#feedback.dismiss("name", "_form");
                this.#scope?.changed();
              }}
            ></wt-input>`
          : this.#content(errors)
      }
      <wt-form-actions slot="footer" .error=${error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (!copying) void this.modal.requestClose("cancel");
            else {
              this.copyName = null;
              this.refusal = undefined;
              this.#feedback.reset();
              this.#scope?.changed();
            }
          }}
          >${t("action.cancel")}</wt-button
        >
        ${
          !copying
            ? html`<wt-button
                variant=${!action.unchanged && this.#selected?.affectedMenus.length ? "primary" : "secondary"}
                ?disabled=${!this.#selected || this.busy || invalid}
                @click=${() => void this.#startCopy()}
                >${t("customer_menu.style.new")}</wt-button
              >`
            : nothing
        }
        <wt-button
          data-save-style
          variant=${use || this.copyName?.trim() ? "primary" : action.variant}
          ?loading=${this.busy}
          ?disabled=${!this.#selected || this.busy || (copying ? !this.copyName?.trim() : !use && (action.unchanged || invalid))}
          @click=${() => (use ? this.#use() : void this.#save())}
          >${t(copying ? "customer_menu.style.create" : use ? "customer_menu.style.use" : "customer_menu.style.save")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}
