import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  currentContentLanguages,
  visuallyHiddenStyles,
} from "@waitron/ui";
import {
  MONEY_SCALE,
  decimal,
  foldForSearch,
  textSearch,
  toScale,
  type AppError,
  type TextSearch,
} from "@waitron/shared";
import { parseMenuPatch, patchFieldValue } from "@waitron/catalogue/src/menu-patch.js";
import { PATCH_FIELDS } from "@waitron/catalogue/src/menu-patch-types.js";
import { VAT_CLASSES, localToday, vatRateOn } from "@waitron/catalogue/src/vat-rates.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  LiveMenu,
  MenuPatchChange,
  MenuPatchResult,
  MenuPatchTarget,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { vatClassName } from "../i18n/domain.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import {
  languageText,
  optionalTextFields,
  priceField,
  textField,
  type FieldContext,
} from "./form-fields.js";
import "./image-upload.js";
import type { ImageUploader } from "./image-upload.js";
import { MenuPatchDraft, patchTree, targetKey, type PatchTreeNode } from "./menu-patch-draft.js";

const TRANSLATED = new Set(["customerName", "names", "description"]);

/** The input name each patch field is drawn under; a translated one adds `-<language>`. */
const INPUT_NAMES: Record<string, string> = {
  name: "name",
  internalName: "internal-name",
  customerName: "customer-name",
  names: "names",
  kitchenName: "kitchen-name",
  description: "description",
  price: "price",
  vatClass: "tax",
};

function refusalText(field: string, error: unknown): string {
  if (field === "name") return t("editor.name_required");
  if (field === "internalName") return t("sections.internal_name_required");
  if (field === "price") return t("editor.price_invalid");
  return codeMessage(
    (error as AppError<"menu_patch.invalid">).params.reason ?? "menu_patch.invalid",
  );
}

interface Typed {
  value: unknown;
  error: string;
  language: string | null;
}

/** The first language whose text alone the patch refuses. The patch checks each language's text on
 * its own, so a refused value has one. */
function refusedLanguage(
  target: MenuPatchTarget,
  field: string,
  value: Record<string, string>,
): string {
  return Object.keys(value).find((language) => {
    try {
      parseMenuPatch([{ target, field, value: { [language]: value[language] } }]);
      return false;
    } catch {
      return true;
    }
  })!;
}

function matching(nodes: readonly PatchTreeNode[], search: TextSearch): PatchTreeNode[] {
  return nodes.flatMap((node) => {
    if (search.rank(foldForSearch(node.label)) !== undefined) return [node];
    const children = matching(node.children, search);
    return children.length === 0 ? [] : [{ ...node, children }];
  });
}

function findNode(nodes: readonly PatchTreeNode[], key: string): PatchTreeNode | undefined {
  for (const node of nodes) {
    if (node.target !== null && targetKey(node.target) === key) return node;
    const found = findNode(node.children, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Patches the live version of one menu: a tree of what the version holds, a search narrowing it,
 * and the picked item's form, which shows only the fields a patch may change. Each value is
 * checked by the patch's own parser before it is staged.
 *
 * @fires wt-menu-patched - `detail` is the `MenuPatchResult`, after a patch is put live.
 */
@customElement("dashboard-menu-patch-dialog")
export class MenuPatchDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-5);
      }
      .side {
        display: grid;
        gap: var(--wt-space-3);
        flex: 1 1 calc(var(--wt-field-max-width) / 2);
        min-width: 0;
      }
      .form {
        display: grid;
        gap: var(--wt-space-4);
        flex: 2 1 var(--wt-field-max-width);
        min-width: 0;
      }
      h3 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      h4 {
        margin: 0;
        font-size: var(--wt-font-size-md);
      }
      ul {
        list-style: none;
        margin: 0;
        padding-inline-start: var(--wt-space-4);
      }
      nav > ul {
        padding-inline-start: 0;
      }
      .group {
        display: block;
        padding: var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-medium);
      }
      .node,
      .link {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: 0 var(--wt-space-2);
        border: 0;
        border-radius: var(--wt-radius-sm);
        background: none;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .node {
        width: 100%;
      }
      .node[aria-current="true"] {
        background: var(--wt-color-surface-sunken);
        font-weight: var(--wt-font-weight-bold);
      }
      .link {
        color: var(--wt-color-primary-text);
        text-decoration: underline;
      }
      .dot {
        flex: none;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-primary);
      }
      .hidden {
        ${visuallyHiddenStyles}
      }
      .note,
      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .error {
        display: grid;
        justify-items: start;
        gap: var(--wt-space-3);
        margin: 0;
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property() menuName = "";
  @property({ type: Boolean }) open = false;

  @state() private live: LiveMenu | null = null;
  @state() private notPublished = false;
  @state() private readError: string | null = null;
  @state() private search = "";
  @state() private picked: string | null = null;

  #draft: MenuPatchDraft | null = null;
  /** What each field shows, keyed `<target key>/<field>`, once the person has edited it: their own
   * text, so a refresh never replaces it, with its error and, for a translated field, the language
   * the error belongs under. A value with an error is not staged. */
  #typed = new Map<string, Typed>();
  #watching: string | null = null;
  #taxCache: { key: string; options: { value: string; label: string }[] } | null = null;
  #imageApi: { api: DashboardApi; uploader: ImageUploader } | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.readError = codeOf(error);
    },
    () => {
      this.readError = null;
    },
  );

  constructor() {
    super();
    new LocaleChangeController(this);
    new ContentLanguageController(this);
  }

  /** The staged changes, as a save would send them. */
  get changes(): MenuPatchChange[] {
    return this.#draft?.changes() ?? [];
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("open") || changed.has("menuId")) this.#follow();
  }

  #follow(): void {
    const wanted = this.open && this.menuId !== "" ? this.menuId : null;
    if (wanted === this.#watching) return;
    this.#queries.release("getLiveMenu");
    this.#watching = wanted;
    this.live = null;
    this.notPublished = false;
    this.readError = null;
    this.search = "";
    this.picked = null;
    this.#draft = null;
    this.#typed = new Map();
    if (wanted !== null) void this.#load(wanted);
  }

  async #load(menuId: string): Promise<void> {
    this.readError = null;
    try {
      await this.#queries.watch("getLiveMenu", [menuId], (answer) => {
        if (answer === null) {
          this.notPublished = true;
          return;
        }
        this.notPublished = false;
        if (this.#draft === null)
          this.#draft = new MenuPatchDraft(answer.document, currentContentLanguages());
        else {
          this.#draft.rebase(answer.document);
          this.#forgetSettled();
        }
        this.live = answer;
      });
    } catch {
      // The query's error callback has already recorded the failure.
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The query controller released the watch when the dialog left the page; the draft stays.
    if (this.#watching !== null) void this.#load(this.#watching);
  }

  /** After a rebase, a field neither staged nor refused shows the newer live value again. */
  #forgetSettled(): void {
    const staged = new Set(
      this.#draft!.changes().map((change) => `${targetKey(change.target)}/${change.field}`),
    );
    for (const [key, typed] of this.#typed)
      if (typed.error === "" && !staged.has(key)) this.#typed.delete(key);
  }

  #close(): void {
    this.open = false;
  }

  #liveValue(target: MenuPatchTarget, field: string): unknown {
    return patchFieldValue(this.live!.document, target, field, currentContentLanguages());
  }

  /** What the field shows: the person's own text, which every staged value has, else the live one. */
  #shown(target: MenuPatchTarget, field: string): unknown {
    const typed = this.#typed.get(`${targetKey(target)}/${field}`);
    return typed === undefined ? this.#liveValue(target, field) : typed.value;
  }

  #change(target: MenuPatchTarget, field: string, raw: unknown): void {
    const draft = this.#draft!;
    const value = TRANSLATED.has(field)
      ? Object.fromEntries(
          currentContentLanguages().languages.map((language) => [
            language,
            languageText(raw as Record<string, string>, language),
          ]),
        )
      : raw;
    const key = `${targetKey(target)}/${field}`;
    try {
      const [checked] = parseMenuPatch([{ target, field, value }]);
      draft.set({
        target,
        field,
        value:
          field === "price"
            ? toScale(decimal(checked!.value as string), MONEY_SCALE)
            : checked!.value,
      });
      this.#typed.set(key, { value: raw, error: "", language: null });
    } catch (error) {
      draft.clear(target, field);
      this.#typed.set(key, {
        value: raw,
        error: refusalText(field, error),
        language: TRANSLATED.has(field)
          ? refusedLanguage(target, field, value as Record<string, string>)
          : null,
      });
    }
    this.requestUpdate();
  }

  #pick(target: MenuPatchTarget): void {
    this.picked = targetKey(target);
  }

  get #taxes() {
    const today = localToday();
    const key = `${currentLocale()}/${today}`;
    if (this.#taxCache?.key !== key)
      this.#taxCache = {
        key,
        options: VAT_CLASSES.map((id) => ({
          value: id,
          label: `${vatClassName(id)} (${vatRateOn(id, today).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1")}%)`,
        })),
      };
    return this.#taxCache.options;
  }

  get #uploader(): ImageUploader {
    if (this.#imageApi?.api !== this.api)
      this.#imageApi = {
        api: this.api,
        uploader: { imageLibraryRequest: this.api.imageLibraryRequest },
      };
    return this.#imageApi.uploader;
  }

  override render() {
    const heading =
      this.live === null
        ? ""
        : fill("menu_patch.heading", { number: String(this.live.number), menu: this.menuName });
    return html`<wt-modal
      size="wide"
      .open=${this.open}
      heading=${heading}
      aria-label=${this.menuName}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        this.#close();
      }}
      >${this.#renderBody()}</wt-modal
    >`;
  }

  #renderBody(): TemplateResult | typeof nothing {
    if (this.notPublished)
      return html`<p class="error" data-test="read-error">
        ${codeMessage("menu_patch.not_published")}
      </p>`;
    if (this.readError !== null)
      return html`<div class="error" data-test="read-error">
        <span>${codeMessage(this.readError)}</span>
        <wt-button @click=${() => void this.#load(this.menuId)}>${t("menus.retry")}</wt-button>
      </div>`;
    if (this.live === null) return nothing;
    const tree = patchTree(this.live.document, t("menu_patch.lists"));
    const search = textSearch(this.search);
    const shown = search === undefined ? tree : matching(tree, search);
    const picked = this.picked === null ? undefined : findNode(tree, this.picked);
    return html`<div class="layout">
      <div class="side">
        ${textField(
          { busy: false, locales: [], error: () => "" },
          "search",
          t("menu_patch.search"),
          this.search,
          (value) => {
            this.search = value;
          },
          false,
          t("menu_patch.search_placeholder"),
        )}
        ${
          shown.length === 0
            ? html`<p class="message" data-test="no-matches">${t("menu_patch.no_matches")}</p>`
            : html`<nav aria-label=${t("menu_patch.tree")} data-test="tree">
                ${this.#renderNodes(shown)}
              </nav>`
        }
      </div>
      ${
        picked === undefined
          ? html`<p class="message" data-test="pick-prompt">${t("menu_patch.pick")}</p>`
          : this.#renderForm(picked.target!, picked.label)
      }
    </div>`;
  }

  #renderNodes(nodes: readonly PatchTreeNode[]): TemplateResult {
    return html`<ul>
      ${nodes.map(
        (node) =>
          html`<li>
            ${
              node.target === null
                ? html`<span class="group" data-test="label">${node.label}</span>`
                : this.#renderNode(node.target, node.label)
            }
            ${node.children.length === 0 ? nothing : this.#renderNodes(node.children)}
          </li>`,
      )}
    </ul>`;
  }

  #renderNode(target: MenuPatchTarget, label: string): TemplateResult {
    const current = targetKey(target) === this.picked;
    return html`<button
      type="button"
      class="node"
      aria-current=${current ? "true" : nothing}
      @click=${() => this.#pick(target)}
    >
      <span data-test="label">${label}</span>
      ${
        this.#draft!.changed(target)
          ? html`<span class="dot" data-test="changed"
              ><span class="hidden">${t("menu_patch.changed")}</span></span
            >`
          : nothing
      }
    </button>`;
  }

  #renderForm(target: MenuPatchTarget, label: string): TemplateResult {
    const fields = PATCH_FIELDS[target.kind].filter(
      (field) => this.#liveValue(target, field) !== undefined,
    );
    const offer = target.kind === "offer" ? this.live!.document.offers[target.menuItemId]! : null;
    const variants = offer?.variants ?? [];
    return html`<div class="form" data-test="form">
      <h3>${label}</h3>
      ${fields.map((field) => this.#renderField(target, field))}
      ${
        variants.length === 0
          ? nothing
          : html`<p class="note" data-test="variants-note">${t("menu_patch.variants_note")}</p>
              <h4>${t("menu_patch.variants")}</h4>
              <ul>
                ${variants.map(
                  (variant) =>
                    html`<li>
                      <button
                        type="button"
                        class="link"
                        data-test="variant-link"
                        @click=${() =>
                          this.#pick({
                            kind: "variant",
                            menuItemId: offer!.id,
                            variantId: variant.id,
                          })}
                      >
                        ${variant.name}
                      </button>
                    </li>`,
                )}
              </ul>`
      }
    </div>`;
  }

  #renderField(target: MenuPatchTarget, field: string): TemplateResult {
    const value = this.#shown(target, field);
    const typed = this.#typed.get(`${targetKey(target)}/${field}`);
    const error = typed?.error ?? "";
    const languages = currentContentLanguages();
    const name = INPUT_NAMES[field];
    const errorKey =
      typed === undefined || typed.language === null ? name : `${name}-${typed.language}`;
    const context: FieldContext = {
      busy: false,
      locales: languages.languages,
      error: (key) => (key === errorKey ? error : ""),
    };
    const change = (next: unknown) => this.#change(target, field, next);
    switch (field) {
      case "name":
        return textField(context, "name", t("editor.name"), value as string, change, true);
      case "internalName":
        return textField(
          context,
          "internal-name",
          t("sections.internal_name"),
          value as string,
          change,
          true,
        );
      case "customerName":
      case "names":
      case "description":
        return html`${optionalTextFields(
          context,
          name!,
          t(
            field === "customerName"
              ? "editor.customer_name"
              : field === "names"
                ? "sections.customer_name"
                : "editor.description",
          ),
          (value as Record<string, string> | null) ?? {},
          change,
          field === "customerName" ? (this.#shown(target, "name") as string) : "",
          languages.defaultLanguage,
        )}`;
      case "kitchenName":
        return textField(
          context,
          "kitchen-name",
          t("editor.kitchen_name"),
          (value as string | null) ?? "",
          change,
          false,
          this.#shown(target, "name") as string,
        );
      case "price":
        return priceField(context, "price", t("editor.price"), value as string, change, true);
      case "vatClass":
        return html`<wt-combobox
          name="tax"
          label=${t("product.vat")}
          required
          search="auto"
          searchPlaceholder=${t("categories.combobox_search")}
          noResultsLabel=${t("categories.combobox_no_results")}
          .options=${this.#taxes}
          .value=${value as string}
          error=${error}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            change(event.detail.value);
          }}
        ></wt-combobox>`;
      default:
        return html`<dashboard-image-upload
          label=${t("image.label")}
          .api=${this.#uploader}
          .image=${value as string | null}
          .invalid=${error !== ""}
          @image-changed=${(event: CustomEvent<{ image: string | null }>) => {
            event.stopPropagation();
            change(event.detail.image);
          }}
        ></dashboard-image-upload>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-patch-dialog": MenuPatchDialog;
  }
  interface HTMLElementEventMap {
    "wt-menu-patched": CustomEvent<MenuPatchResult>;
  }
}
