import { liveMediaImage } from "@waitron/ui/src/live-media-image.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  ContentLanguageController,
  currentContentLanguages,
  focusFirstInvalid,
  submitOnEnter,
  draftScopeFor,
  saveActionState,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import {
  QueryController,
  currentLocale,
  codeMessage,
  codeOf,
  subscribeLocale,
} from "@waitron/dashboard-kit";
import { capitaliseFirst, resolveEnabledContentText } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-file-input.js";
import { imageNameFromFilename } from "./image-filename-name.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { ImageApi, ImageMetadata, ImageQuery, ImageUsage, LibraryImage } from "./client.js";
import { QUERY_DEPENDENCIES } from "./live-queries.js";
import { t } from "./strings.js";
import { sameFraming } from "./photo-framing-dialog.js";
import { DEFAULT_FRAMING, type ImageFraming } from "../framing.js";

/** Where a blocking use sends the operator: a variant opens its own product page. */
function usageHref(use: ImageUsage): string {
  if (use.kind === "department_receipt")
    return `/manage/venue-operations/department/${encodeURIComponent(use.id)}/view/receipt`;
  if (use.kind === "section")
    return `/manage/menus/menu/${encodeURIComponent(use.ownerMenuId)}/view/structure`;
  if (use.kind === "menu_include")
    return `/manage/menus/menu/${encodeURIComponent(use.menuId)}/view/structure`;
  if (use.kind === "menu_version" || use.kind === "scheduled_menu_version")
    return `/manage/menus/menu/${encodeURIComponent(use.menuId)}`;
  return `/manage/catalogue/product/${encodeURIComponent(use.id)}`;
}

function usageName(use: ImageUsage): string {
  switch (use.kind) {
    case "department_receipt":
      return t("image.department_receipt_logo").replace("{department}", () => use.name);
    case "section":
      return use.internalName;
    case "menu_include":
      return t("image.included_menu_folder")
        .replace("{included}", () => use.includedMenuName)
        .replace("{menu}", () => use.menuName);
    case "menu_version":
      return `${use.menuName} (${t("image.published_menu")})`;
    case "scheduled_menu_version":
      return `${use.menuName} (${t("image.scheduled_menu")})`;
    default:
      return use.name;
  }
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

interface ImageDraft {
  names: Record<string, string>;
  file: File | null;
  framing: ImageFraming;
}

interface BatchPhoto {
  file: File;
  status: "queued" | "uploading" | "uploaded" | "reused" | "failed";
  image?: LibraryImage;
  error?: string;
}

@customElement("dashboard-image-library")
export class ImageLibrary extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        position: relative;
        min-height: 100%;
      }
      .batch-chooser {
        max-width: none;
        margin-block: var(--wt-space-4);
      }
      .batch-progress {
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .batch-list {
        padding-inline-start: var(--wt-space-5);
        overflow-wrap: anywhere;
      }
      .drop-overlay {
        position: absolute;
        inset: 0;
        z-index: 1;
        border: 1px dashed var(--wt-color-primary);
        border-radius: var(--wt-radius-md);
        display: grid;
        place-items: center;
        padding: var(--wt-space-4);
        pointer-events: none;
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .drop-overlay::before {
        content: "";
        position: absolute;
        inset: 0;
        background: var(--wt-color-surface-lifted);
        opacity: 0.85;
      }
      .drop-overlay span {
        position: relative;
        background: var(--wt-color-surface);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-5);
      }
      [data-new] {
        position: absolute;
        inset-block-start: var(--wt-space-2);
        inset-inline-start: var(--wt-space-2);
        padding: var(--wt-space-1) var(--wt-space-2);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        border-radius: var(--wt-radius-sm);
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
      .picker-header {
        justify-content: end;
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
        aspect-ratio: 1;
        object-fit: cover;
        background: var(--wt-color-surface);
      }
      .thumbnail {
        position: relative;
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
      .tile-title {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-2);
      }
      .tile-title h2 {
        min-width: 0;
        margin: 0;
        overflow-wrap: anywhere;
      }
      .tile-title wt-row-actions {
        flex: none;
      }
      .tile-title wt-row-actions::part(trigger) {
        border: 1px solid var(--wt-color-border);
      }
      .use {
        width: 100%;
        margin-block-start: var(--wt-space-3);
      }
      /* Side by side wherever the dialog has room for 12 × --wt-tap-min plus the gap; one above
         the other where it has not. Driven by the dialog's width, not the viewport's. */
      .viewer {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
        align-items: flex-start;
        /* The photo's width at the height cap. Invalid while --photo-ratio is absent (before the
           photo loads, after it fails), so each reader below takes its fallback. */
        --photo-cap: calc(60dvh * var(--photo-ratio));
        container-type: inline-size;
      }
      .viewer img {
        flex: 3 1 calc(var(--wt-tap-min) * 7);
        min-width: 0;
        margin-inline: auto;
        height: auto;
        max-height: 60dvh;
        max-width: var(--photo-cap, none);
        object-fit: contain;
        background: var(--wt-color-surface);
        border-radius: var(--wt-radius-md);
      }
      /* Flex wraps on each item's basis clamped by its max-width (pinned by the wrap-point tests in
         image-library.narrow.test.ts), so the list's basis takes on what the photo's cap takes off
         its own, keeping the wrap point where the photo's and the list's original bases
         (12 × --wt-tap-min) put it. */
      .uses {
        flex: 2 1
          calc(
            var(--wt-tap-min) * 5 +
              max(0px, var(--wt-tap-min) * 7 - var(--photo-cap, var(--wt-tap-min) * 7))
          );
        min-width: 0;
      }
      /* 12 × --wt-tap-min + --wt-space-4, where the photo stops sitting beside the list; a container
         query cannot read a custom property. The wrap-point tests pin the two together. */
      @container (width < 544px) {
        .viewer > * {
          --photo-cap: calc(40dvh * var(--photo-ratio));
        }
        .viewer img {
          max-height: 40dvh;
        }
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
      .photo-summary {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .photo-summary > img,
      .photo-summary > media-photo-preview {
        width: calc(var(--wt-tap-min) * 3);
        aspect-ratio: 1;
        object-fit: cover;
        border-radius: var(--wt-radius-md);
      }
      .photo-details {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .photo-links {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        flex-wrap: wrap;
      }
      .photo-links wt-file-input {
        width: fit-content;
      }
      .photo-links wt-file-input::part(field) {
        border: 0;
        background: transparent;
      }
      .photo-links wt-button::part(button) {
        color: var(--wt-color-primary-text);
        padding-inline: 0;
      }
      nav {
        justify-content: end;
        margin-block: var(--wt-space-4);
      }
      a {
        color: var(--wt-color-primary-text);
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: ImageApi;
  @property({ type: Boolean }) picker = false;
  @property({ attribute: false }) draftParent?: object;
  @state() private batch: BatchPhoto[] = [];
  @state() private batchRunning = false;
  @state() private dragCount: number | null = null;
  #dragDepth = 0;
  #batchGeneration = 0;
  #createdIds = new Set<string>();
  #canBatch(): boolean {
    return (
      this.isConnected &&
      !this.picker &&
      !this.batchRunning &&
      !this.busy &&
      !this.editor &&
      !this.viewing &&
      !this.deletion
    );
  }
  #isFileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }
  readonly #pageEnter = (event: DragEvent): void => {
    if (!this.#isFileDrag(event)) return;
    event.preventDefault();
    if (!this.#canBatch()) return;
    this.#dragDepth++;
    this.dragCount = [...(event.dataTransfer?.items ?? [])].filter(
      (item) => item.kind === "file",
    ).length;
  };
  readonly #pageLeave = (): void => {
    this.#dragDepth = Math.max(0, this.#dragDepth - 1);
    if (this.#dragDepth === 0) this.dragCount = null;
  };
  readonly #pageOver = (event: DragEvent): void => {
    if (!this.#isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.#canBatch() ? "copy" : "none";
  };
  readonly #pageDrop = (event: DragEvent): void => {
    this.#dragDepth = 0;
    this.dragCount = null;
    if (!this.#isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    void this.#uploadBatch([...(event.dataTransfer?.files ?? [])]);
  };
  async #uploadBatch(files: File[]): Promise<void> {
    if (!files.length || !this.#canBatch()) return;
    this.#dragDepth = 0;
    this.dragCount = null;
    const generation = ++this.#batchGeneration;
    const language = currentContentLanguages().defaultLanguage;
    const pending = files.map((file) => ({ file, status: "queued" as const }));
    this.batch = pending;
    this.batchRunning = true;
    try {
      for (let index = 0; index < pending.length; index++) {
        if (!this.isConnected || generation !== this.#batchGeneration) return;
        const file = pending[index]!.file;
        this.batch = this.batch.map((item, at) =>
          at === index ? { ...item, status: "uploading" } : item,
        );
        try {
          const result = await this.api.uploadImage(file, {
            names: { [language]: imageNameFromFilename(file.name, language, t("image.file")) },
          });
          if (!this.isConnected || generation !== this.#batchGeneration) return;
          if (result.created) this.#createdIds.add(result.image.id);
          this.batch = this.batch.map((item, at) =>
            at === index
              ? { ...item, image: result.image, status: result.created ? "uploaded" : "reused" }
              : item,
          );
          await this.#load(true);
        } catch (error) {
          if (!this.isConnected || generation !== this.#batchGeneration) return;
          this.batch = this.batch.map((item, at) =>
            at === index ? { ...item, status: "failed", error: codeOf(error) } : item,
          );
        }
      }
    } finally {
      if (generation === this.#batchGeneration) this.batchRunning = false;
    }
  }
  #batchImages(): LibraryImage[] {
    const images = new Map(this.images.map((image) => [image.id, image]));
    const extra = new Map<string, LibraryImage>();
    for (const item of this.batch)
      if (item.image && !images.has(item.image.id)) extra.set(item.image.id, item.image);
    return [...extra.values(), ...images.values()];
  }
  #rememberImage(image: LibraryImage): void {
    this.batch = this.batch.map((item) =>
      item.image?.id === image.id ? { ...item, image } : item,
    );
  }
  #forgetImage(id: string): void {
    this.#createdIds.delete(id);
    this.batch = this.batch.map((item) => {
      if (item.image?.id !== id) return item;
      const next = { ...item };
      delete next.image;
      return next;
    });
  }
  #renderBatch() {
    const uploaded = this.batch.filter(
      (item) => item.status === "uploaded" || item.status === "reused",
    ).length;
    return html`${
      !this.picker
        ? html`<wt-file-input
            class="batch-chooser"
            name="image-files"
            compact
            multiple
            accept="image/jpeg,image/png,image/webp"
            .locale=${currentLocale()}
            .files=${[]}
            .copy=${{ drop: t("image.drop_page"), choose: t("image.choose_files"), replace: t("image.choose_another"), previewAlt: t("image.preview") }}
            ?disabled=${!this.#canBatch()}
            @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
              event.stopPropagation();
              void this.#uploadBatch(event.detail.files);
            }}
          ></wt-file-input>`
        : nothing
    }
    ${
      this.batch.length
        ? html`<div class="batch-progress" role="status">
              ${t(this.batch.length === 1 ? "image.batch_progress_one" : "image.batch_progress")
                .replace("{done}", String(uploaded))
                .replace("{total}", String(this.batch.length))}
            </div>
            <ul class="batch-list">
              ${this.batch.map(
                (item) =>
                  html`<li>
                    <strong>${item.file.name}</strong>
                    ${item.status === "failed" ? html`<span class="error" data-upload-error role="alert">${codeMessage(item.error!)}</span>` : item.status === "reused" ? html`<span>${t("image.duplicate_reused")} ${this.#text(item.image!.names)}. ${t("image.duplicate_metadata_kept")}</span>` : item.status === "queued" || item.status === "uploading" ? html`<span>${t(item.status === "queued" ? "image.queued" : "image.uploading")}</span>` : nothing}
                  </li>`,
              )}
            </ul>`
        : nothing
    }
    ${this.dragCount !== null ? html`<div class="drop-overlay" data-test="drop-overlay" role="status"><span>${this.dragCount ? t(this.dragCount === 1 ? "image.drop_count_one" : "image.drop_count").replace("{count}", String(this.dragCount)) : t("image.drop_unknown")}</span></div>` : nothing}`;
  }
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
    framing: ImageFraming;
  } | null = null;
  @state() private framingOpen = false;
  @state() private reloading = false;
  #replacementUrl?: string;
  #baseline?: ImageDraft;
  @state() private attempted = false;
  #suggestion: { language: string; name: string } | null = null;
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
  #editorGeneration = 0;
  #scope?: DraftScope<ImageDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    !this.framingOpen &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
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
    if (this.editor) {
      this.#syncReplacement();
      this.#registerScope();
    }
    window.addEventListener("dragenter", this.#pageEnter);
    window.addEventListener("dragleave", this.#pageLeave);
    window.addEventListener("dragover", this.#pageOver);
    window.addEventListener("drop", this.#pageDrop);
    this.#unsubscribeLocale = subscribeLocale(() => {
      this.requestUpdate();
      this.offset = 0;
      void this.#load(true);
    });
    void this.#load();
  }
  override disconnectedCallback(): void {
    window.removeEventListener("dragenter", this.#pageEnter);
    window.removeEventListener("dragleave", this.#pageLeave);
    window.removeEventListener("dragover", this.#pageOver);
    window.removeEventListener("drop", this.#pageDrop);
    this.#batchGeneration++;
    this.batchRunning = false;
    this.batch = [];
    this.dragCount = null;
    this.#dragDepth = 0;
    this.#createdIds.clear();
    this.#editorGeneration++;
    this.framingOpen = false;
    this.#releaseReplacement();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.#deleteGeneration++;
    this.#viewGeneration++;
    this.viewing = null;
    clearTimeout(this.#searchTimer);
    this.#unsubscribeLocale?.();

    super.disconnectedCallback();
  }
  #text(value: Record<string, string>): string {
    return resolveEnabledContentText(value, currentLocale(), currentContentLanguages());
  }
  #usage(use: ImageUsage) {
    const name = usageName(use);
    const inactive =
      "active" in use && !use.active
        ? ` (${t(use.kind === "department_receipt" ? "image.deleted_department" : "image.disabled_product")})`
        : "";
    if (use.kind === "department_receipt" && !use.active)
      return html`<span>${name}${inactive}</span>`;
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
  #draft(): ImageDraft {
    return {
      file: this.editor!.file,
      framing: { ...this.editor!.framing },
      names: Object.fromEntries(
        Object.entries(this.editor!.names)
          .map(([language, value]) => [language, value.trim()] as const)
          .filter(([, value]) => value !== ""),
      ),
    };
  }
  #edit(image: LibraryImage | null): void {
    if (this.batchRunning) return;
    this.#editorGeneration++;
    this.#scope?.dispose();
    this.framingOpen = false;
    this.#releaseReplacement();

    this.#suggestion = null;
    this.editor = {
      image,
      names: { ...image?.names },
      file: null,
      framing: { ...(image?.framing ?? DEFAULT_FRAMING) },
    };
    this.attempted = false;
    this.refusal = null;
    this.duplicateImage = null;
    this.#baseline = this.#draft();
    this.#registerScope();
  }
  #registerScope(): void {
    const draft = draftScopeFor<ImageDraft>(this, {
      id: this,
      parent: this.draftParent,
      current: () => this.#draft(),
      snapshot: (value) => ({
        names: { ...value.names },
        file: value.file,
        framing: { ...value.framing },
      }),
      equal: (a, b) =>
        a.file === b.file &&
        sameFraming(a.framing, b.framing) &&
        Object.keys(a.names).length === Object.keys(b.names).length &&
        Object.entries(a.names).every(([language, value]) => b.names[language] === value),
      restore: (value) => {
        if (!this.editor) return;
        this.editor = {
          ...this.editor,
          names: { ...value.names },
          file: value.file,
          framing: { ...value.framing },
        };
        this.#syncReplacement();
      },
    });
    this.#leave = draft.coordinator;
    this.#scope = draft.scope;
    this.#scope.commit(this.#baseline!);
  }
  #closeEditor(): void {
    if (this.busy) return;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;

    this.editor = null;
    this.#baseline = undefined;
    this.framingOpen = false;
    this.#releaseReplacement();
  }
  #name(language: string, value: string): void {
    if (this.editor !== null)
      this.editor = { ...this.editor, names: { ...this.editor.names, [language]: value } };
    this.#scope?.changed();
    this.#dropRefusal(`name-${language}`);
  }
  #file(file: File | null): void {
    if (!this.editor || this.busy || this.framingOpen) return;
    const language = this.#suggestion?.language ?? currentContentLanguages().defaultLanguage;
    const names = { ...this.editor.names };
    const current = names[language] ?? "";
    if (!this.editor.image && (!current.trim() || current === this.#suggestion?.name)) {
      const name = file ? imageNameFromFilename(file.name, language, t("image.file")) : "";
      names[language] = name;
      this.#suggestion = file ? { language, name } : null;
    }
    this.editor = {
      ...this.editor,
      file,
      names,
      framing: { ...(file ? DEFAULT_FRAMING : (this.editor.image?.framing ?? DEFAULT_FRAMING)) },
    };
    this.#syncReplacement();
    this.#scope?.changed();
    this.#dropRefusal("file");
  }
  #releaseReplacement(): void {
    if (this.#replacementUrl) URL.revokeObjectURL(this.#replacementUrl);
    this.#replacementUrl = undefined;
  }
  #syncReplacement(): void {
    this.#releaseReplacement();
    if (this.editor?.file && this.isConnected)
      this.#replacementUrl = URL.createObjectURL(this.editor.file);
  }
  #source(): string {
    return this.#replacementUrl ?? `/media/${this.editor!.image!.sourceFilename}`;
  }
  async #closeFraming(framing?: ImageFraming): Promise<void> {
    if (framing && this.editor) {
      this.editor = { ...this.editor, framing: { ...framing } };
      this.#scope?.changed();
    }
    this.framingOpen = false;
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>("[data-test=adjust-framing]")?.focus();
  }
  async #reloadPhoto(): Promise<void> {
    const editor = this.editor;
    if (!editor?.image || this.busy || this.reloading) return;
    const generation = this.#editorGeneration;
    this.reloading = true;
    try {
      const { image } = await this.api.getImage(editor.image.id);
      if (generation !== this.#editorGeneration || this.editor !== editor) return;
      if (this.#leave)
        await this.#leave.request({
          scopes: [this],
          reason: "cancel",
          proceed: () => this.#edit(image),
        });
      else this.#edit(image);
    } catch (error) {
      if (generation === this.#editorGeneration)
        this.refusal = { field: "_form", code: codeOf(error) };
    } finally {
      this.reloading = false;
    }
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
      ["file", ""],
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
    if (editor === null || this.busy || this.framingOpen || saveActionState(this.#scope).unchanged)
      return;
    this.attempted = true;
    this.refusal = null;
    if ([...this.#checked().values()].some(Boolean)) {
      void this.#focusFirstInvalid();
      return;
    }
    this.busy = true;
    this.dispatchEvent(
      new CustomEvent("image-write-state", {
        detail: { busy: true },
        bubbles: true,
        composed: true,
      }),
    );
    const generation = this.#editorGeneration;
    const submitted = this.#draft();
    const scope = this.#scope;
    const metadata: ImageMetadata = { names: editor.names };
    try {
      if (editor.image === null) {
        const result = await this.api.uploadImage(editor.file!, metadata);
        if (generation !== this.#editorGeneration) return;
        this.duplicateImage = result.created ? null : result.image;
        this.#rememberImage(result.image);
      } else {
        const edit = {
          ...metadata,
          framing: editor.framing,
          expectedRevision: editor.image.revision,
        };
        const result = editor.file
          ? await this.api.updateImage(editor.image.id, edit, editor.file)
          : await this.api.updateImage(editor.image.id, edit);
        if (generation !== this.#editorGeneration) return;
        this.#rememberImage(result.image);
        if (this.editor) this.editor.image = result.image;
      }
      if (generation !== this.#editorGeneration) return;
      scope?.commit(submitted);
      this.#baseline = submitted;
      if (this.editor !== editor) return;
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;

      this.editor = null;
      this.#baseline = undefined;
      this.#releaseReplacement();
    } catch (error) {
      if (generation !== this.#editorGeneration) return;
      this.refusal = { field: refusalField(error), code: codeOf(error) };
    } finally {
      this.busy = false;
      this.dispatchEvent(
        new CustomEvent("image-write-state", {
          detail: { busy: false },
          bubbles: true,
          composed: true,
        }),
      );
    }
    if (this.refusal) void this.#focusFirstInvalid();
    else await this.#load();
  }
  async #inspectDeletion(image: LibraryImage): Promise<void> {
    if (this.busy || this.batchRunning) return;
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
  #select(image: LibraryImage): void {
    this.#viewGeneration++;
    this.viewing = null;
    this.dispatchEvent(
      new CustomEvent("select-image", { detail: image, bubbles: true, composed: true }),
    );
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
        <img
          src=${liveMediaImage(viewing.image.filename, "source")}
          alt=${name}
          @load=${(event: Event) => {
            const image = event.currentTarget as HTMLImageElement;
            image.parentElement!.style.setProperty(
              "--photo-ratio",
              String(image.naturalWidth / image.naturalHeight),
            );
          }}
          @error=${(event: Event) =>
            (event.currentTarget as HTMLImageElement).parentElement!.style.removeProperty(
              "--photo-ratio",
            )}
        />
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
          >${t(this.picker ? "image.back" : "image.close")}</wt-button
        >${this.picker ? html`<wt-button data-test="select-preview" variant="primary" @click=${() => this.#select(viewing.image)}>${t("image.select")}</wt-button>` : nothing}</wt-form-actions
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
      this.#forgetImage(deletion.image.id);
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
    const preview = editor.image ? liveMediaImage(editor.image.filename, "square") : null;
    return html`<wt-modal
      size="standard"
      open
      heading=${t(editor.image ? "image.edit" : "image.upload")}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#closeEditor();
      }}
      @keydown=${(event: KeyboardEvent) => {
        if (this.framingOpen) return;
        if (this.busy && event.key === "Escape") event.preventDefault();
        submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"));
      }}
    >
      <div class="fields">
        ${
          editor.image === null
            ? html`<wt-file-input
                name="image-file"
                label=${t("image.file")}
                required
                accept="image/jpeg,image/png,image/webp"
                .locale=${currentLocale()}
                .files=${editor.file ? [editor.file] : []}
                .copy=${{ drop: t("image.drop_one"), choose: t("image.choose_file"), replace: t("image.choose_another"), previewAlt: t("image.preview") }}
                hint=${t("image.formats")}
                error=${fileError}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
                  event.stopPropagation();
                  this.#file(event.detail.files[0] ?? null);
                }}
              ></wt-file-input>`
            : html`<div class="photo-summary">
                ${
                  editor.file || !sameFraming(editor.framing, editor.image.framing)
                    ? html`<media-photo-preview
                        .source=${this.#source()}
                        .framing=${editor.framing}
                        .label=${t("image.preview")}
                      ></media-photo-preview>`
                    : html`<img data-test="preview" src=${preview} alt=${t("image.preview")} />`
                }
                <div class="photo-details">
                  <strong data-test="photo-filename"
                    >${editor.file?.name ?? editor.image.originalFilename ?? editor.image.filename}</strong
                  >
                  <div class="photo-links">
                    <wt-button
                      data-test="adjust-framing"
                      variant="ghost"
                      ?disabled=${this.busy}
                      @click=${() => {
                        this.framingOpen = true;
                      }}
                      >${t("image.adjust_framing")}</wt-button
                    >
                    <wt-file-input
                      name="image-file"
                      compact
                      accept="image/jpeg,image/png,image/webp"
                      .locale=${currentLocale()}
                      .files=${editor.file ? [editor.file] : []}
                      .copy=${{ drop: "", choose: t("image.replace_photo"), replace: t("image.replace_photo"), previewAlt: t("image.preview") }}
                      error=${fileError}
                      ?disabled=${this.busy}
                      @wt-change=${(event: CustomEvent<{ files: File[] }>) => {
                        event.stopPropagation();
                        this.#file(event.detail.files[0] ?? null);
                      }}
                    ></wt-file-input>
                  </div>
                </div>
              </div>`
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
      ${
        refusal?.code === "image.changed"
          ? html`<wt-button
              data-test="reload-photo"
              variant="secondary"
              ?disabled=${this.reloading}
              @click=${() => void this.#reloadPhoto()}
              >${t("image.reload_photo")}</wt-button
            >`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => {
            if (this.#leave)
              void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            else this.#closeEditor();
          }}
          >${t("image.cancel")}</wt-button
        ><wt-button
          data-test="save"
          variant=${saveActionState(this.#scope).variant}
          ?disabled=${saveActionState(this.#scope).unchanged || this.busy || this.framingOpen || invalid}
          @click=${() => void this.#save()}
          >${t("image.save")}</wt-button
        ></wt-form-actions
      >
      ${
        this.framingOpen
          ? html`<media-photo-framing-dialog
              .source=${this.#source()}
              .framing=${editor.framing}
              .draftParent=${this}
              .opener=${this.shadowRoot!.querySelector<HTMLElement>("[data-test=adjust-framing]")}
              @done=${(event: CustomEvent<{ framing: ImageFraming }>) => {
                event.stopPropagation();
                void this.#closeFraming(event.detail.framing);
              }}
              @close=${(event: Event) => {
                event.stopPropagation();
                void this.#closeFraming();
              }}
            ></media-photo-framing-dialog>`
          : nothing
      }
    </wt-modal>`;
  }
  override render() {
    return html`<header class=${this.picker ? "picker-header" : nothing}>
        ${this.picker ? nothing : html`<h1>${t("nav.images")}</h1>`}
        <wt-button
          data-test="upload"
          variant=${this.picker ? "secondary" : "primary"}
          ?disabled=${this.batchRunning}
          @click=${() => this.#edit(null)}
          >${t("image.upload_many")}</wt-button
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
      ${this.#renderBatch()}
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
        ${this.#batchImages().map((image) => {
          const name = this.#text(image.names);
          return html`<article data-image=${image.id}>
            <div class="thumbnail">
              <button
                type="button"
                class="thumb"
                data-test=${`preview-${image.id}`}
                aria-label=${`${t("image.preview_open")}: ${name}`}
                @click=${() => void this.#view(image)}
              >
                <img
                  src=${liveMediaImage(image.filename, "square")}
                  alt=${name}
                  loading="lazy"
                /></button
              >${this.#createdIds.has(image.id) ? html`<span data-new>${t("image.new")}</span>` : nothing}
            </div>
            <div class="tile-title">
              <h2>${name}</h2>
              <wt-row-actions align="end" label=${`${t("image.actions")}: ${name}`}>
                <wt-button
                  data-test=${`edit-${image.id}`}
                  ?disabled=${this.batchRunning}
                  variant="secondary"
                  align="start"
                  aria-label=${`${t("action.edit")}: ${name}`}
                  @click=${() => this.#edit(image)}
                  >${t("action.edit")}</wt-button
                >
                <wt-button
                  data-test=${`delete-${image.id}`}
                  ?disabled=${this.batchRunning}
                  variant="secondary"
                  align="start"
                  aria-label=${`${t("image.delete")}: ${name}`}
                  @click=${() => void this.#inspectDeletion(image)}
                  >${t("image.delete")}</wt-button
                >
              </wt-row-actions>
            </div>
            <time datetime=${image.createdAt}
              >${new Date(image.createdAt).toLocaleDateString(currentLocale())}</time
            >
            ${this.picker ? html`<wt-button class="use" variant="secondary" data-test=${`select-${image.id}`} aria-label=${`${t("image.select")}: ${name}`} @click=${() => this.#select(image)}>${t("image.select")}</wt-button>` : nothing}
          </article>`;
        })}
      </div>
      ${this.#batchImages().length === 0 && !this.loadError ? html`<p>${t("image.empty")}</p>` : nothing}
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
