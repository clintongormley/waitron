import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  ContentLanguageController,
  currentContentLanguages,
  focusFirstInvalid,
  submitOnEnter,
} from "@waitron/ui";
import {
  QueryController,
  currentLocale,
  codeMessage,
  codeOf,
  subscribeLocale,
} from "@waitron/dashboard-kit";
import { capitaliseFirst, resolveEnabledContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { ImageApi, ImageMetadata, ImageQuery, ImageUsage, LibraryImage } from "./client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { t } from "./strings.js";

/** Where a blocking use sends the operator: a variant opens its own product page. */
function usageHref(use: ImageUsage): string {
  if (use.kind === "section")
    return `/manage/menus/menu/${encodeURIComponent(use.ownerMenuId)}/view/structure`;
  if (use.kind === "menu_version") return `/manage/menus/menu/${encodeURIComponent(use.menuId)}`;
  return `/manage/catalogue/product/${encodeURIComponent(use.id)}`;
}

const PHOTO_REFUSALS = new Set([
  "image.too_large",
  "image.invalid_file",
  "image.too_many_pixels",
  "media.unsupported_type",
]);

/** The editor field a refused save names — `file` or `name-<language>` — or `_form` for none. */
function refusalField(error: unknown): string {
  const code = codeOf(error);
  if (PHOTO_REFUSALS.has(code)) return "file";
  const language = (error as { params?: { language?: unknown } }).params?.language;
  if (code === "image.translation_required" && typeof language === "string")
    return `name-${language}`;
  return "_form";
}

@customElement("dashboard-image-library")
export class ImageLibrary extends LitElement {
  static override styles = [
    baseStyles,
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
      .filters wt-input {
        flex: 1 1 calc(var(--wt-tap-min) * 8);
        min-width: 0;
      }
      .filters wt-combobox {
        min-width: calc(var(--wt-space-6) * 7);
      }
      label {
        display: grid;
        gap: var(--wt-space-2);
      }
      /* Wide enough for a card's Spanish Edit and Delete buttons to share a line;
         image-library.narrow.test.ts measures it. */
      .grid {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(min(100%, calc(var(--wt-tap-min) * 6)), 1fr)
        );
        gap: var(--wt-space-4);
      }
      article {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
      }
      .actions {
        justify-content: space-between;
      }
      .actions .use {
        flex-basis: 100%;
      }
      article img {
        width: 100%;
        aspect-ratio: 4/3;
        object-fit: contain;
        background: var(--wt-color-surface);
      }
      .thumb {
        position: relative;
        display: block;
        width: 100%;
        padding: 0;
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        background: none;
        color: inherit;
        font: inherit;
        cursor: zoom-in;
      }
      .thumb img {
        display: block;
        border-radius: var(--wt-radius-md);
      }
      .thumb:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .thumb:hover {
        border-color: var(--wt-color-primary);
      }
      .chip {
        position: absolute;
        inset-block-end: var(--wt-space-2);
        inset-inline-end: var(--wt-space-2);
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
      }
      .thumb:hover .chip,
      .thumb:focus-visible .chip {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      /* Side by side, the photo taking the larger share, wherever the dialog has room for both
         bases; one above the other where it has not. Driven by the dialog's width, not the
         viewport's. */
      .viewer {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: flex-start;
      }
      .viewer img {
        flex: 3 1 calc(var(--wt-tap-min) * 7);
        min-width: 0;
        height: auto;
        max-height: 60dvh;
        object-fit: contain;
        background: var(--wt-color-surface);
        border-radius: var(--wt-radius-md);
      }
      .uses {
        flex: 2 1 calc(var(--wt-tap-min) * 5);
        min-width: 0;
      }
      .uses h3 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-md);
      }
      .uses ul {
        margin: 0;
        padding-inline-start: var(--wt-space-5);
      }
      .uses a {
        display: inline-flex;
        align-items: center;
        min-height: var(--wt-tap-min);
      }
      .uses p {
        margin: 0;
      }
      h2 {
        font-size: var(--wt-font-size-md);
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
      .preview {
        justify-self: start;
        width: 100%;
        max-width: 320px;
        aspect-ratio: 4/3;
        object-fit: contain;
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      nav {
        justify-content: end;
        margin-block: var(--wt-space-4);
      }
      input[type="file"] {
        font: inherit;
        max-width: 100%;
        min-width: 0;
        min-height: var(--wt-tap-min);
      }
      a {
        color: var(--wt-color-primary);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: ImageApi;
  @property({ type: Boolean }) picker = false;
  @state() private images: LibraryImage[] = [];
  @state() private total = 0;
  @state() private search = "";
  @state() private sort: ImageQuery["sort"] = "relevance";
  @state() private direction: "asc" | "desc" = "desc";
  @state() private offset = 0;
  @state() private loadError = false;
  @state() private editor: {
    image: LibraryImage | null;
    names: Record<string, string>;
    file: File | null;
  } | null = null;
  @state() private attempted = false;
  @state() private previewUrl: string | null = null;
  /** The last save's refusal, until Save is pressed again or, for a field's, that field changes. */
  @state() private refusal: { field: string; code: string } | null = null;
  @state() private duplicateImage: LibraryImage | null = null;
  @state() private deletion: { image: LibraryImage; uses: ImageUsage[] } | null = null;
  @state() private deleteError = false;
  @state() private viewing: {
    image: LibraryImage;
    uses: ImageUsage[] | null;
    failed: boolean;
  } | null = null;
  @state() private busy = false;
  #deleteGeneration = 0;
  #viewGeneration = 0;
  #searchTimer?: ReturnType<typeof setTimeout>;
  #unsubscribeLocale?: () => void;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    () => {
      this.loadError = true;
    },
    () => {
      this.loadError = false;
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
    this.#viewGeneration++;
    this.viewing = null;
    clearTimeout(this.#searchTimer);
    this.#unsubscribeLocale?.();
    this.#setPreview(null);
    super.disconnectedCallback();
  }
  /** Holds the object URL for a newly chosen file, revoking the previous one so it cannot leak. */
  #setPreview(file: File | null): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = file ? URL.createObjectURL(file) : null;
  }
  #text(value: Record<string, string>): string {
    return resolveEnabledContentText(value, currentLocale(), currentContentLanguages());
  }
  #usage(use: ImageUsage) {
    const name =
      use.kind === "section"
        ? use.internalName
        : use.kind === "menu_version"
          ? `${use.menuName} (${t("image.published_menu")})`
          : use.name;
    const inactive = "active" in use && !use.active ? ` (${t("image.inactive")})` : "";
    return html`<a href=${usageHref(use)}>${name}${inactive}</a>`;
  }

  async #load(passive = false): Promise<void> {
    if (this.#searchTimer !== undefined) {
      clearTimeout(this.#searchTimer);
      this.#searchTimer = undefined;
      // This load sends the new search text, so it opens that search's first page.
      this.offset = 0;
    }
    this.loadError = false;
    const query: ImageQuery = {
      search: this.search,
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
          dependencies: QUERY_DEPENDENCIES.images.map((type) => ({ type })),
          refreshMs: 60_000,
          read: async () => {
            const api = initial ? this.api : (this.api.background ?? this.api);
            initial = false;
            return api.listImages(query);
          },
        },
        (value) => {
          this.images = value.images;
          this.total = value.total;
          if (this.offset > 0 && this.offset >= value.total) {
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
    this.#setPreview(null);
    this.editor = {
      image,
      names: { ...image?.names },
      file: null,
    };
    this.attempted = false;
    this.refusal = null;
    this.duplicateImage = null;
  }
  #closeEditor(): void {
    if (this.busy) return;
    this.#setPreview(null);
    this.editor = null;
  }
  #name(language: string, value: string): void {
    if (this.editor !== null)
      this.editor = { ...this.editor, names: { ...this.editor.names, [language]: value } };
    this.#dropRefusal(`name-${language}`);
  }
  #dropRefusal(field: string): void {
    if (this.refusal?.field === field) this.refusal = null;
  }
  /** The default content language first, then the other enabled ones. */
  #languages(): string[] {
    const config = currentContentLanguages();
    return [
      config.defaultLanguage,
      ...config.languages.filter((code) => code !== config.defaultLanguage),
    ];
  }
  /** The fields the editor shows, each with what the form's own check finds once Save was pressed. */
  #checked(): Map<string, string> {
    const editor = this.editor!;
    const config = currentContentLanguages();
    const errors = new Map<string, string>([
      ...(editor.image === null ? [["file", ""] as const] : []),
      ...this.#languages().map((language) => [`name-${language}`, ""] as const),
    ]);
    if (!this.attempted) return errors;
    if (editor.image === null && editor.file === null) errors.set("file", t("image.file_required"));
    if (!editor.names[config.defaultLanguage]?.trim())
      errors.set(`name-${config.defaultLanguage}`, t("image.required"));
    return errors;
  }
  async #focusFirstInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!.querySelector("wt-modal")!);
  }
  async #save(): Promise<void> {
    const editor = this.editor;
    if (editor === null || this.busy) return;
    this.attempted = true;
    this.refusal = null;
    if ([...this.#checked().values()].some(Boolean)) {
      void this.#focusFirstInvalid();
      return;
    }
    this.busy = true;
    const metadata: ImageMetadata = { names: editor.names };
    try {
      if (editor.image === null) {
        const result = await this.api.uploadImage(editor.file!, metadata);
        this.duplicateImage = result.created ? null : result.image;
      } else await this.api.updateImage(editor.image.id, metadata);
      this.#setPreview(null);
      this.editor = null;
    } catch (error) {
      this.refusal = { field: refusalField(error), code: codeOf(error) };
    } finally {
      this.busy = false;
    }
    if (this.refusal) void this.#focusFirstInvalid();
    else await this.#load();
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
  async #view(image: LibraryImage): Promise<void> {
    const generation = ++this.#viewGeneration;
    this.viewing = { image, uses: null, failed: false };
    try {
      const { uses } = await this.api.getImage(image.id);
      if (generation === this.#viewGeneration) this.viewing = { image, uses, failed: false };
    } catch {
      if (generation === this.#viewGeneration) this.viewing = { image, uses: null, failed: true };
    }
  }
  /** Closing by Close or a backdrop click leaves focus on the page body, so it is put back on the
   * thumbnail here. */
  async #closeViewer(id: string): Promise<void> {
    this.#viewGeneration++;
    this.viewing = null;
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>(`[data-test="preview-${CSS.escape(id)}"]`)?.focus();
  }
  /** `wt-dialog` has no close on a backdrop click (it sets `closedby` only to `closerequest` or
   * `none`), so it is caught here: such a click reaches the `<dialog>` itself, at a point outside
   * the dialog's box. */
  #closeOnBackdrop(event: MouseEvent, id: string): void {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLDialogElement)) return;
    const box = target.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      void this.#closeViewer(id);
  }
  #renderViewer() {
    const viewing = this.viewing;
    if (viewing === null) return nothing;
    const name = this.#text(viewing.image.names);
    return html`<wt-modal
      size="wide"
      open
      data-test="image-preview"
      heading=${name}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        void this.#closeViewer(viewing.image.id);
      }}
      @click=${(event: MouseEvent) => this.#closeOnBackdrop(event, viewing.image.id)}
    >
      <div class="viewer">
        <img src=${`/media/${encodeURIComponent(viewing.image.filename)}`} alt=${name} />
        <section class="uses">
          <h3 id="uses-heading">${t("image.uses")}</h3>
          ${
            viewing.failed
              ? html`<p role="alert" class="error">${t("image.uses_error")}</p>
                  <wt-button
                    data-test="retry-uses"
                    variant="secondary"
                    @click=${() => void this.#view(viewing.image)}
                    >${t("image.retry")}</wt-button
                  >`
              : viewing.uses === null
                ? html`<p role="status">${t("image.uses_loading")}</p>`
                : viewing.uses.length === 0
                  ? html`<p data-test="no-uses">${t("image.no_uses")}</p>`
                  : html`<ul aria-labelledby="uses-heading">
                      ${viewing.uses.map((use) => html`<li>${this.#usage(use)}</li>`)}
                    </ul>`
          }
        </section>
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="close-preview"
          variant="secondary"
          @click=${() => void this.#closeViewer(viewing.image.id)}
          >${t("image.close")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
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
    const languages = this.#languages();
    const languageNames = new Intl.DisplayNames([currentLocale()], { type: "language" });
    const checked = this.#checked();
    const invalid = [...checked.values()].some(Boolean);
    const refusal = this.refusal;
    const refusedField = refusal !== null && checked.has(refusal.field);
    const errors = new Map(checked);
    if (refusedField && !checked.get(refusal.field))
      errors.set(refusal.field, codeMessage(refusal.code));
    const fileError = errors.get("file") ?? "";
    const marked = [...errors.values()].some(Boolean);
    const bottom = [
      ...(refusal && !refusedField
        ? [`${t("image.save_error")} ${codeMessage(refusal.code)}`]
        : []),
      ...(marked ? [t("image.fix_fields")] : []),
    ].join(" ");
    const preview =
      editor.file !== null
        ? this.previewUrl
        : editor.image !== null
          ? `/media/${encodeURIComponent(editor.image.filename)}`
          : null;
    return html`<wt-modal
      size="standard"
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
                      const file = (event.target as HTMLInputElement).files?.[0] ?? null;
                      this.#setPreview(file);
                      this.editor = { ...editor, file };
                      this.#dropRefusal("file");
                    }} /></label
                >${fileError ? html`<p id="file-error" class="error">${fileError}</p>` : nothing}`
            : nothing
        }
        ${
          preview
            ? html`<img
                class="preview"
                data-test="preview"
                src=${preview}
                alt=${t("image.preview")}
              />`
            : nothing
        }
        ${languages.map(
          (language) =>
            html`<fieldset>
              <legend>
                ${capitaliseFirst(languageNames.of(language)!, currentLocale())}${language === config.defaultLanguage ? ` (${t("image.default")})` : ""}
              </legend>
              <wt-input
                name=${`name-${language}`}
                label=${t("image.name")}
                .value=${editor.names[language] ?? ""}
                ?required=${language === config.defaultLanguage}
                ?disabled=${this.busy}
                error=${errors.get(`name-${language}`)!}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#name(language, event.detail.value)}
              ></wt-input>
            </fieldset>`,
        )}
      </div>
      <wt-form-actions slot="footer" .error=${bottom}
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#closeEditor()}
          >${t("image.cancel")}</wt-button
        ><wt-button
          data-test="save"
          ?disabled=${this.busy || invalid}
          @click=${() => void this.#save()}
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
            clearTimeout(this.#searchTimer);
            this.#searchTimer = setTimeout(() => this.#filter(), 250);
          }}
        ></wt-input>
        <wt-combobox
          name="image-sort"
          label=${t("image.sort")}
          search="auto"
          .options=${(["relevance", "date", "name"] as const).map((sort) => ({
            value: sort,
            label: t(sort === "name" ? "image.name_sort" : `image.${sort}`),
          }))}
          .value=${this.sort}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            if (event.detail.value === this.sort) return;
            this.sort = event.detail.value as ImageQuery["sort"];
            this.direction = this.sort === "name" ? "asc" : "desc";
            this.#filter();
          }}
        ></wt-combobox>
        ${
          this.sort !== "relevance"
            ? html`<wt-combobox
                name="image-direction"
                label=${t("image.direction")}
                search="auto"
                .options=${[
                  {
                    value: "asc",
                    label: t(this.sort === "date" ? "image.oldest_first" : "image.name_ascending"),
                  },
                  {
                    value: "desc",
                    label: t(this.sort === "date" ? "image.newest_first" : "image.name_descending"),
                  },
                ]}
                .value=${this.direction}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (event.detail.value === this.direction) return;
                  this.direction = event.detail.value as "asc" | "desc";
                  this.#filter();
                }}
              ></wt-combobox>`
            : nothing
        }
      </div>
      ${
        this.duplicateImage
          ? html`<div role="status" data-test="duplicate-upload">
              <p>
                ${t("image.duplicate_reused")}
                <strong>${this.#text(this.duplicateImage.names)}</strong>.
                ${t("image.duplicate_metadata_kept")}
              </p>
              <wt-button
                data-test="edit-duplicate"
                variant="secondary"
                @click=${() => this.#edit(this.duplicateImage)}
                >${t("image.edit")}</wt-button
              >
            </div>`
          : nothing
      }
      ${this.loadError ? html`<p role="alert" class="error">${t("image.load_error")} <wt-button variant="secondary" @click=${() => void this.#load()}>${t("image.retry")}</wt-button></p>` : nothing}
      ${this.deleteError && this.deletion === null ? html`<p role="alert" class="error">${t("image.delete_error")}</p>` : nothing}
      <div class="grid">
        ${this.images.map((image) => {
          const name = this.#text(image.names);
          return html`<article data-image=${image.id}>
            <button
              type="button"
              class="thumb"
              data-test=${`preview-${image.id}`}
              aria-label=${`${t("image.preview_open")}: ${name}`}
              @click=${() => void this.#view(image)}
            >
              <img
                src=${`/media/${encodeURIComponent(image.filename)}`}
                alt=${name}
                loading="lazy"
              /><span class="chip">${t("image.preview_open")}</span>
            </button>
            <h2>${name}</h2>
            <time datetime=${image.createdAt}
              >${new Date(image.createdAt).toLocaleDateString(currentLocale())}</time
            >
            <div class="actions">
              ${this.picker ? html`<wt-button class="use" data-test=${`select-${image.id}`} aria-label=${`${t("image.select")}: ${name}`} @click=${() => this.dispatchEvent(new CustomEvent("select-image", { detail: image, bubbles: true, composed: true }))}>${t("image.select")}</wt-button>` : nothing}
              <wt-button
                data-test=${`delete-${image.id}`}
                variant="secondary"
                aria-label=${`${t("image.delete")}: ${name}`}
                @click=${() => void this.#inspectDeletion(image)}
                >${t("image.delete")}</wt-button
              ><wt-button
                data-test=${`edit-${image.id}`}
                variant="secondary"
                aria-label=${`${t("action.edit")}: ${name}`}
                @click=${() => this.#edit(image)}
                >${t("action.edit")}</wt-button
              >
            </div>
          </article>`;
        })}
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
      ${this.#renderEditor()} ${this.#renderViewer()}
      ${
        this.deletion
          ? html`<wt-modal
              size="compact"
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
              <p>${t(this.deletion.uses.length ? "image.in_use" : "image.confirm_help")}</p>
              <ul>
                ${this.deletion.uses.map((use) => html`<li>${this.#usage(use)}</li>`)}
              </ul>
              <wt-form-actions
                slot="footer"
                .error=${this.deleteError ? t("image.delete_error") : ""}
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
