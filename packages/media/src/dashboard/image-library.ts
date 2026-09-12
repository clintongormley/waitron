import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  selectStyles,
  ContentLanguageController,
  currentContentLanguages,
  submitOnEnter,
} from "@waitron/ui";
import {
  QueryController,
  currentLocale,
  codeMessage,
  codeOf,
  subscribeLocale,
} from "@waitron/dashboard-kit";
import { resolveEnabledContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import type { ImageApi, ImageMetadata, ImageQuery, ImageUsage, LibraryImage } from "./client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { t } from "./strings.js";

@customElement("dashboard-image-library")
export class ImageLibrary extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      header,
      .filters,
      .actions,
      nav {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      header {
        justify-content: space-between;
      }
      .filters {
        margin-block: var(--wt-space-4);
        align-items: end;
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: var(--wt-space-4);
      }
      article {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
      }
      article img {
        width: 100%;
        aspect-ratio: 4/3;
        object-fit: contain;
        background: var(--wt-color-surface);
      }
      h2 {
        font-size: var(--wt-font-size-md);
      }
      .labels {
        color: var(--wt-color-text-muted);
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
      }
      fieldset {
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-3);
        display: grid;
        gap: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
      }
      nav {
        justify-content: end;
        margin-block: var(--wt-space-4);
      }
      input[type="file"] {
        font: inherit;
        max-width: 100%;
        min-height: var(--wt-tap-min);
      }
      a {
        color: var(--wt-color-primary);
      }
    `,
  ];
  @property({ attribute: false }) api!: ImageApi;
  @property({ type: Boolean }) picker = false;
  @state() private images: LibraryImage[] = [];
  @state() private labels: string[] = [];
  @state() private total = 0;
  @state() private search = "";
  @state() private label = "";
  @state() private sort: ImageQuery["sort"] = "relevance";
  @state() private direction: "asc" | "desc" = "desc";
  @state() private offset = 0;
  @state() private loadError = false;
  @state() private editor: {
    image: LibraryImage | null;
    names: Record<string, string>;
    altText: Record<string, string>;
    labels: string;
    file: File | null;
  } | null = null;
  @state() private invalid = false;
  @state() private saveError: string | null = null;
  @state() private deletion: { image: LibraryImage; uses: ImageUsage[] } | null = null;
  @state() private deleteError = false;
  @state() private busy = false;
  #deleteGeneration = 0;
  #unsubscribeLocale?: () => void;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = true;
    },
  );
  constructor() {
    super();
    new ContentLanguageController(this);
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#unsubscribeLocale = subscribeLocale(() => {
      this.requestUpdate();
      this.offset = 0;
      void this.#load(true);
    });
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#deleteGeneration++;
    this.#unsubscribeLocale?.();
    super.disconnectedCallback();
  }
  #text(value: Record<string, string>): string {
    return resolveEnabledContentText(value, currentLocale(), currentContentLanguages());
  }

  async #load(passive = false): Promise<void> {
    this.loadError = false;
    const query: ImageQuery = {
      search: this.search,
      label: this.label,
      language: currentLocale(),
      sort: this.sort,
      ...(this.sort === "relevance" ? {} : { direction: this.direction }),
      offset: this.offset,
      limit: 24,
    };
    let initial = !passive;
    try {
      await this.#queries.watch(
        "library",
        {
          key: `media:${JSON.stringify(query)}`,
          dependencies: [
            ...new Set([...QUERY_DEPENDENCIES.images, ...QUERY_DEPENDENCIES.labels]),
          ].map((type) => ({ type })),
          refreshMs: 60_000,
          read: async () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            const [result, labels] = await Promise.all([api.listImages(query), api.listLabels()]);
            return { ...result, ...labels };
          },
        },
        (value) => {
          this.images = value.images;
          this.total = value.total;
          this.labels = value.labels;
          if (this.label !== "" && !value.labels.includes(this.label)) {
            this.label = "";
            this.offset = 0;
            void this.#load(true);
          } else if (this.offset > 0 && this.offset >= value.total) {
            this.offset = Math.max(0, Math.ceil(value.total / 24) - 1) * 24;
            void this.#load(true);
          }
        },
      );
    } catch {
      this.loadError = true;
    }
  }
  #filter(): void {
    this.offset = 0;
    void this.#load();
  }
  #edit(image: LibraryImage | null): void {
    this.editor = {
      image,
      names: { ...image?.names },
      altText: { ...image?.altText },
      labels: image?.labels.join(", ") ?? "",
      file: null,
    };
    this.invalid = false;
    this.saveError = null;
  }
  #closeEditor(): void {
    if (!this.busy) this.editor = null;
  }
  #field(field: "names" | "altText", language: string, value: string): void {
    if (this.editor !== null)
      this.editor = { ...this.editor, [field]: { ...this.editor[field], [language]: value } };
  }
  async #save(): Promise<void> {
    const editor = this.editor;
    if (editor === null || this.busy) return;
    const language = currentContentLanguages().defaultLanguage;
    this.invalid = true;
    if (
      (editor.image === null && editor.file === null) ||
      !editor.names[language]?.trim() ||
      !editor.altText[language]?.trim()
    )
      return;
    this.busy = true;
    this.saveError = null;
    const metadata: ImageMetadata = {
      names: editor.names,
      altText: editor.altText,
      labels: [
        ...new Set(
          editor.labels
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        ),
      ],
    };
    try {
      if (editor.image === null) await this.api.uploadImage(editor.file!, metadata);
      else await this.api.updateImage(editor.image.id, metadata);
      this.editor = null;
    } catch (error) {
      this.saveError = codeOf(error);
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  async #inspectDeletion(image: LibraryImage): Promise<void> {
    if (this.busy) return;
    const generation = ++this.#deleteGeneration;
    this.deleteError = false;
    try {
      const result = await this.api.getImage(image.id);
      if (this.isConnected && generation === this.#deleteGeneration)
        this.deletion = { image: result.image, uses: result.uses };
    } catch {
      if (this.isConnected && generation === this.#deleteGeneration) this.deleteError = true;
    }
  }
  async #delete(): Promise<void> {
    const deletion = this.deletion;
    if (this.busy || deletion === null || deletion.uses.length > 0) return;
    this.busy = true;
    this.deleteError = false;
    try {
      const result = await this.api.deleteImage(deletion.image.id);
      if (!result.deleted) {
        this.deletion = { ...deletion, uses: result.uses };
        return;
      }
      this.deletion = null;
    } catch {
      this.deleteError = true;
      return;
    } finally {
      this.busy = false;
    }
    await this.#load();
  }
  #renderEditor() {
    const editor = this.editor;
    if (editor === null) return nothing;
    const config = currentContentLanguages();
    const languages = [
      config.defaultLanguage,
      ...config.languages.filter((code) => code !== config.defaultLanguage),
    ];
    const languageNames = new Intl.DisplayNames([currentLocale()], { type: "language" });
    const fileError =
      this.invalid && editor.image === null && editor.file === null ? t("image.file_required") : "";
    const nameError =
      this.invalid && !editor.names[config.defaultLanguage]?.trim() ? t("image.required") : "";
    const altError =
      this.invalid && !editor.altText[config.defaultLanguage]?.trim() ? t("image.required") : "";
    return html`<wt-modal
      open
      heading=${t(editor.image ? "image.edit" : "image.upload")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeEditor();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"));
      }}
    >
      <wt-form-error-summary
        heading=${t("image.problem")}
        .errors=${[fileError, nameError, altError].filter(Boolean)}
      ></wt-form-error-summary>
      ${this.saveError ? html`<p role="alert" class="error">${t("image.save_error")} ${codeMessage(this.saveError)}</p>` : nothing}
      <div class="fields">
        ${
          editor.image === null
            ? html`<label
                  >${t("image.file")} *<input
                    type="file"
                    name="image-file"
                    accept="image/jpeg,image/png,image/webp"
                    required
                    ?disabled=${this.busy}
                    aria-invalid=${Boolean(fileError)}
                    aria-describedby=${fileError ? "file-error" : nothing}
                    @change=${(event: Event) => {
                      this.editor = {
                        ...editor,
                        file: (event.target as HTMLInputElement).files?.[0] ?? null,
                      };
                    }} /></label
                >${fileError ? html`<p id="file-error" class="error">${fileError}</p>` : nothing}`
            : nothing
        }
        ${languages.map(
          (language) =>
            html`<fieldset>
              <legend>
                ${languageNames.of(language)}${language === config.defaultLanguage ? ` (${t("image.default")})` : ""}
              </legend>
              <wt-input
                name=${`name-${language}`}
                label=${t("image.name")}
                .value=${editor.names[language] ?? ""}
                ?required=${language === config.defaultLanguage}
                ?disabled=${this.busy}
                error=${language === config.defaultLanguage ? nameError : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#field("names", language, event.detail.value)}
              ></wt-input>
              <wt-input
                name=${`alt-${language}`}
                label=${t("image.alt")}
                .value=${editor.altText[language] ?? ""}
                ?required=${language === config.defaultLanguage}
                ?disabled=${this.busy}
                error=${language === config.defaultLanguage ? altError : ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#field("altText", language, event.detail.value)}
              ></wt-input>
            </fieldset>`,
        )}
        <wt-input
          name="image-labels"
          label=${t("image.labels")}
          .value=${editor.labels}
          ?disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.editor = { ...this.editor!, labels: event.detail.value };
          }}
        ></wt-input>
        <p>${t("image.labels_help")}</p>
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#closeEditor()}
          >${t("image.cancel")}</wt-button
        ><wt-button data-test="save" ?disabled=${this.busy} @click=${() => void this.#save()}
          >${t("image.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
  override render() {
    return html`<header>
        <h1>${t("nav.images")}</h1>
        <wt-button data-test="upload" @click=${() => this.#edit(null)}
          >${t("image.upload")}</wt-button
        >
      </header>
      <div class="filters">
        <wt-input
          name="image-search"
          label=${t("image.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            this.search = event.detail.value;
            this.#filter();
          }}
        ></wt-input>
        <label
          >${t("image.filter_label")}<select
            name="image-label"
            @change=${(event: Event) => {
              this.label = (event.target as HTMLSelectElement).value;
              this.#filter();
            }}
          >
            <option value="" ?selected=${this.label === ""}>${t("image.all_labels")}</option>
            ${this.labels.map((label) => html`<option value=${label} ?selected=${this.label === label}>${label}</option>`)}
          </select></label
        >
        <label
          >${t("image.sort")}<select
            name="image-sort"
            @change=${(event: Event) => {
              this.sort = (event.target as HTMLSelectElement).value as ImageQuery["sort"];
              this.direction = this.sort === "name" ? "asc" : "desc";
              this.#filter();
            }}
          >
            ${(["relevance", "date", "name"] as const).map((sort) => html`<option value=${sort} ?selected=${this.sort === sort}>${t(sort === "name" ? "image.name_sort" : `image.${sort}`)}</option>`)}
          </select></label
        >
        ${
          this.sort !== "relevance"
            ? html`<label
                >${t("image.direction")}<select
                  name="image-direction"
                  @change=${(event: Event) => {
                    this.direction = (event.target as HTMLSelectElement).value as "asc" | "desc";
                    this.#filter();
                  }}
                >
                  <option value="asc" ?selected=${this.direction === "asc"}>
                    ${t(this.sort === "date" ? "image.oldest_first" : "image.name_ascending")}
                  </option>
                  <option value="desc" ?selected=${this.direction === "desc"}>
                    ${t(this.sort === "date" ? "image.newest_first" : "image.name_descending")}
                  </option>
                </select></label
              >`
            : nothing
        }
      </div>
      ${this.loadError ? html`<p role="alert" class="error">${t("image.load_error")} <wt-button variant="secondary" @click=${() => void this.#load()}>${t("image.retry")}</wt-button></p>` : nothing}
      ${this.deleteError && this.deletion === null ? html`<p role="alert" class="error">${t("image.delete_error")}</p>` : nothing}
      <div class="grid">
        ${this.images.map(
          (image) =>
            html`<article data-image=${image.id}>
              <img
                src=${`/media/${encodeURIComponent(image.filename)}`}
                alt=${this.#text(image.altText)}
                loading="lazy"
              />
              <h2>${this.#text(image.names)}</h2>
              <p class="labels">${image.labels.join(" · ")}</p>
              <time datetime=${image.createdAt}
                >${new Date(image.createdAt).toLocaleDateString(currentLocale())}</time
              >
              <div class="actions">
                ${this.picker ? html`<wt-button data-test=${`select-${image.id}`} @click=${() => this.dispatchEvent(new CustomEvent("select-image", { detail: image, bubbles: true, composed: true }))}>${t("image.select")}</wt-button>` : nothing}
                <wt-button
                  data-test=${`edit-${image.id}`}
                  variant="secondary"
                  @click=${() => this.#edit(image)}
                  >${t("image.edit")}</wt-button
                ><wt-button
                  data-test=${`delete-${image.id}`}
                  variant="secondary"
                  @click=${() => void this.#inspectDeletion(image)}
                  >${t("image.delete")}</wt-button
                >
              </div>
            </article>`,
        )}
      </div>
      ${this.images.length === 0 && !this.loadError ? html`<p>${t("image.empty")}</p>` : nothing}
      <nav aria-label=${t("image.page")}>
        <wt-button
          variant="secondary"
          ?disabled=${this.offset === 0}
          @click=${() => {
            this.offset = Math.max(0, this.offset - 24);
            void this.#load();
          }}
          >${t("image.previous")}</wt-button
        ><span
          >${this.total ? this.offset + 1 : 0}–${Math.min(this.offset + 24, this.total)} /
          ${this.total}</span
        ><wt-button
          variant="secondary"
          ?disabled=${this.offset + 24 >= this.total}
          @click=${() => {
            this.offset += 24;
            void this.#load();
          }}
          >${t("image.next")}</wt-button
        >
      </nav>
      ${this.#renderEditor()}
      ${
        this.deletion
          ? html`<wt-modal
              open
              heading=${t("image.confirm")}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                if (!this.busy) this.deletion = null;
              }}
              @keydown=${(event: KeyboardEvent) => {
                if (this.busy && event.key === "Escape") event.preventDefault();
              }}
            >
              <p>${this.#text(this.deletion.image.names)}</p>
              ${this.deleteError ? html`<p role="alert" class="error">${t("image.delete_error")}</p>` : nothing}
              <p>${t(this.deletion.uses.length ? "image.in_use" : "image.confirm_help")}</p>
              <ul>
                ${this.deletion.uses.map((use) => html`<li><a href=${`/manage/catalogue/product/${encodeURIComponent(use.id)}`}>${this.#text(use.names)}${use.active ? "" : ` (${t("image.inactive")})`}</a></li>`)}
              </ul>
              <wt-form-actions slot="footer"
                ><wt-button
                  slot="cancel"
                  variant="secondary"
                  ?disabled=${this.busy}
                  @click=${() => {
                    this.deletion = null;
                  }}
                  >${t("image.close")}</wt-button
                >${this.deletion.uses.length ? nothing : html`<wt-button data-test="confirm-delete" ?disabled=${this.busy} @click=${() => void this.#delete()}>${t("image.delete")}</wt-button>`}</wt-form-actions
              >
            </wt-modal>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-image-library": ImageLibrary;
  }
}
