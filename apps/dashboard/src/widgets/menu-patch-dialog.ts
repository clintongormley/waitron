import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  ContentLanguageController,
  baseStyles,
  currentContentLanguages,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  subscribeContentLanguages,
  visuallyHiddenStyles,
  type DraftScope,
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
import type { MenuDocument } from "@waitron/catalogue/src/menu-document-types.js";
import { PATCH_FIELDS } from "@waitron/catalogue/src/menu-patch-types.js";
import { VAT_CLASSES, localToday, vatRateOn } from "@waitron/catalogue/src/vat-rates.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  LiveMenu,
  LocalTime,
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
import {
  changeLines,
  itemNames,
  placeRefusal,
  refusalWords,
  reviewNotes,
  type Refusal,
} from "./menu-patch-review.js";
import { conjunctionList } from "../i18n/list.js";
import { localTimeWords } from "./menu-publications.js";

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

/** The first language whose text alone the patch's parser refuses, else the first language: a
 * refusal from merging with the stored text names no language. */
function refusedLanguage(
  target: MenuPatchTarget,
  field: string,
  value: Record<string, string>,
): string {
  const languages = Object.keys(value);
  return (
    languages.find((language) => {
      try {
        parseMenuPatch([{ target, field, value: { [language]: value[language] } }]);
        return false;
      } catch {
        return true;
      }
    }) ?? languages[0]!
  );
}

const changeKey = (change: MenuPatchChange) => `${targetKey(change.target)}/${change.field}`;

/** The target key of a `changeKey`; field names hold no "/". */
const targetOf = (key: string) => key.slice(0, key.lastIndexOf("/"));

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
      .flag {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-bold);
      }
      .hidden {
        ${visuallyHiddenStyles}
      }
      .note,
      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .review {
        display: grid;
        gap: var(--wt-space-3);
      }
      .changes {
        display: grid;
        gap: var(--wt-space-2);
        padding-inline-start: var(--wt-space-5);
        list-style: disc;
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
  @state() private step: "edit" | "review" = "edit";
  @state() private busy = false;
  /** A refusal that names no field the form shows; it stays until the next save. */
  @state() private refusal: Refusal | null = null;
  /** Why the last Reload failed, shown beside the refusal that offered it. */
  @state() private reloadFailure: string | null = null;
  /** How many staged changes newer live versions have dropped since the dialog opened. */
  @state() private dropped = 0;
  @state() private queued: LocalTime[] = [];

  #draft: MenuPatchDraft | null = null;
  /** What each field shows, keyed `<target key>/<field>`, once the person has edited it: their own
   * text, so a refresh never replaces it, with its error and, for a translated field, the language
   * the error belongs under. A value with an error is not staged. */
  #typed = new Map<string, Typed>();
  #watching: string | null = null;
  #scope: DraftScope<MenuPatchChange[]> | undefined;
  /** Replaced whenever the dialog opens or closes, so an answer to an earlier opening is ignored. */
  #session = {};
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
    // The venue's content languages decide what a patch may hold, so the draft follows them.
    let unsubscribe: (() => void) | undefined;
    this.addController({
      hostConnected: () => {
        unsubscribe = subscribeContentLanguages(() => {
          if (this.live !== null) this.#applyLive(this.live);
        });
      },
      hostDisconnected: () => unsubscribe!(),
    });
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
    this.#queries.release("getMenuPublications");
    this.#watching = wanted;
    this.#session = {};
    this.live = null;
    this.notPublished = false;
    this.readError = null;
    this.search = "";
    this.picked = null;
    this.step = "edit";
    this.busy = false;
    this.refusal = null;
    this.reloadFailure = null;
    this.dropped = 0;
    this.queued = [];
    this.#draft = null;
    this.#typed = new Map();
    this.#scope?.dispose();
    this.#scope = undefined;
    if (wanted === null) return;
    this.#scope = draftScopeFor<MenuPatchChange[]>(this, {
      id: this,
      current: () => this.#current(),
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => JSON.stringify(a) === JSON.stringify(b),
      restore: () => this.#discard(),
    }).scope;
    void this.#load(wanted);
  }

  /** The staged changes in a fixed order, so two drafts holding the same changes compare equal. */
  #current(): MenuPatchChange[] {
    return this.changes.sort((a, b) => changeKey(a).localeCompare(changeKey(b)));
  }

  /** The baseline is always no changes: the scope starts on an empty draft and the dialog closes
   * once it commits. */
  #discard(): void {
    this.#draft = new MenuPatchDraft(this.live!.document, currentContentLanguages());
    this.#typed = new Map();
    this.step = "edit";
    this.requestUpdate();
  }

  async #load(menuId: string): Promise<void> {
    this.readError = null;
    // Each query's error callback records its own failure.
    await Promise.all([
      this.#queries
        .watch("getLiveMenu", [menuId], (answer) => this.#applyLive(answer))
        .catch(() => undefined),
      this.#queries
        .watch("getMenuPublications", [menuId], (answer) => {
          this.queued = answer.editions
            .filter((edition) => edition.state === "queued")
            .map((edition) => edition.local);
        })
        .catch(() => undefined),
    ]);
  }

  #applyLive(answer: LiveMenu | null): void {
    if (answer === null) {
      this.notPublished = true;
      return;
    }
    this.notPublished = false;
    if (this.#draft === null)
      this.#draft = new MenuPatchDraft(answer.document, currentContentLanguages());
    else {
      if (answer.versionId !== this.live!.versionId) {
        // The move a Reload would make has happened.
        if (this.refusal?.code === "menu_patch.base_changed") this.refusal = null;
        this.reloadFailure = null;
      }
      this.dropped += this.#draft.rebase(answer.document, currentContentLanguages()).dropped;
      this.#forgetSettled(answer.document);
      this.#scope!.changed();
    }
    this.live = answer;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The query controller released the watch when the dialog left the page; the draft stays.
    if (this.#watching !== null) void this.#load(this.#watching);
  }

  /** After a rebase, a field neither staged nor refused shows the newer live value again. */
  #forgetSettled(document: MenuDocument): void {
    const staged = new Set(this.#draft!.changes().map(changeKey));
    const items = itemNames(document);
    for (const [key, typed] of this.#typed)
      if (!items.has(targetOf(key)) || (typed.error === "" && !staged.has(key)))
        this.#typed.delete(key);
  }

  /** The names of the items holding a field with an error, in the order they were edited. */
  #itemsToCorrect(): string[] {
    const items = itemNames(this.live!.document);
    const keys = [...this.#typed]
      .filter(([, typed]) => typed.error !== "")
      .map(([key]) => targetOf(key));
    return [...new Set(keys)].map((key) => items.get(key)!);
  }

  #close(): void {
    this.open = false;
  }

  #needsCorrecting(target: MenuPatchTarget): boolean {
    const prefix = `${targetKey(target)}/`;
    return [...this.#typed].some(([key, typed]) => typed.error !== "" && key.startsWith(prefix));
  }

  #hasErrors(): boolean {
    return [...this.#typed.values()].some((typed) => typed.error !== "");
  }

  #review(): void {
    if (saveActionState(this.#scope).unchanged || this.#hasErrors()) return;
    this.step = "review";
  }

  async #putLive(): Promise<void> {
    if (this.busy || saveActionState(this.#scope).unchanged) return;
    const session = this.#session;
    const sent = this.changes;
    const submitted = this.#current();
    this.busy = true;
    this.refusal = null;
    this.reloadFailure = null;
    const outcome = await this.api
      .patchLiveMenu(this.menuId, { baseVersionId: this.live!.versionId, changes: sent })
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
    if (session !== this.#session) return;
    this.busy = false;
    if ("error" in outcome) {
      await this.#refused(outcome.error, sent);
      return;
    }
    this.#scope!.commit(submitted);
    this.dispatchEvent(
      new CustomEvent("wt-menu-patched", { detail: outcome.result, bubbles: true, composed: true }),
    );
    this.renderRoot.querySelector("wt-modal")!.closeAfter("saved");
    this.#close();
  }

  async #refused(error: unknown, sent: readonly MenuPatchChange[]): Promise<void> {
    const placed = placeRefusal(error, sent);
    if ("refusal" in placed) {
      this.refusal = placed.refusal;
      return;
    }
    const { change, message } = placed;
    const key = changeKey(change);
    this.#draft!.clear(change.target, change.field);
    this.#scope!.changed();
    this.#typed.set(key, {
      // Every staged change was typed into its field.
      value: this.#typed.get(key)!.value,
      error: message,
      language: TRANSLATED.has(change.field)
        ? refusedLanguage(change.target, change.field, change.value as Record<string, string>)
        : null,
    });
    this.picked = targetKey(change.target);
    this.step = "edit";
    await this.updateComplete;
    await focusFirstInvalid(this.renderRoot.querySelector('[data-test="form"]')!);
  }

  /** Moves the draft onto the version now live, as a newer live version arriving on its own does. */
  async #reload(): Promise<void> {
    const session = this.#session;
    const read = await this.api.getLiveMenu(this.menuId).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    );
    if (session !== this.#session) return;
    if ("error" in read) {
      this.reloadFailure = codeOf(read.error);
      return;
    }
    this.refusal = null;
    this.reloadFailure = null;
    this.step = "edit";
    this.#applyLive(read.answer);
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
    this.#scope!.changed();
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
      .dismissible=${!this.busy}
      @wt-close=${(event: Event) => {
        if (event.target !== event.currentTarget) return;
        this.#close();
      }}
      >${this.#renderBody()}${this.#renderFooter()}</wt-modal
    >`;
  }

  #showsDraft(): boolean {
    return !this.notPublished && this.readError === null && this.live !== null;
  }

  #renderFooter(): TemplateResult | typeof nothing {
    if (!this.#showsDraft()) return nothing;
    const action = saveActionState(this.#scope);
    const toCorrect = this.#itemsToCorrect();
    const errors = toCorrect.length > 0;
    const bottom = [
      ...(this.refusal === null ? [] : [refusalWords(this.refusal)]),
      ...(this.reloadFailure === null ? [] : [codeMessage(this.reloadFailure)]),
      ...(errors ? [fill("menu_patch.fix_items", { items: conjunctionList(toCorrect) })] : []),
    ].join(" ");
    const count = this.changes.length;
    const reload =
      this.refusal?.code === "menu_patch.base_changed" ||
      this.refusal?.code === "menu_patch.invalid"
        ? html`<wt-button
            slot="secondary"
            variant="secondary"
            data-test="reload"
            ?disabled=${this.busy}
            @click=${() => void this.#reload()}
            >${t("menu_patch.reload")}</wt-button
          >`
        : nothing;
    return html`<wt-form-actions slot="footer" .error=${bottom}>
      ${
        this.step === "edit"
          ? html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="close"
                @click=${() => void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel")}
                >${t("action.close")}</wt-button
              >${reload}<wt-button
                variant=${action.variant}
                data-test="review"
                ?disabled=${action.unchanged || errors}
                @click=${() => this.#review()}
                >${
                  count === 1
                    ? t("menu_patch.review_one")
                    : fill("menu_patch.review_many", { count: String(count) })
                }</wt-button
              >`
          : html`<wt-button
                slot="cancel"
                variant="secondary"
                data-test="keep-editing"
                ?disabled=${this.busy}
                @click=${() => {
                  this.step = "edit";
                }}
                >${t("menu_patch.keep_editing")}</wt-button
              >${reload}<wt-button
                variant=${action.variant}
                data-test="put-live"
                .loading=${this.busy}
                ?disabled=${action.unchanged}
                @click=${() => void this.#putLive()}
                >${t("menu_patch.put_live")}</wt-button
              >`
      }
    </wt-form-actions>`;
  }

  #renderDropped(): TemplateResult | typeof nothing {
    return this.dropped === 0
      ? nothing
      : html`<p class="note" role="status" data-test="dropped">
          ${
            this.dropped === 1
              ? t("menu_patch.dropped_one")
              : fill("menu_patch.dropped_many", { count: String(this.dropped) })
          }
        </p>`;
  }

  #renderReview(): TemplateResult {
    const languages = currentContentLanguages();
    return html`<div class="review" data-test="review-step">
      ${this.#renderDropped()}
      <h3>${t("menu_patch.review_heading")}</h3>
      <ul class="changes">
        ${changeLines(this.live!.document, this.changes, languages).map(
          (line) => html`<li data-test="review-line">${line}</li>`,
        )}
      </ul>
      ${reviewNotes(this.queued.map(localTimeWords)).map(
        (note) => html`<p class="note" data-test="review-note">${note}</p>`,
      )}
    </div>`;
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
    if (this.step === "review") return this.#renderReview();
    const tree = patchTree(this.live.document, t("menu_patch.lists"));
    const search = textSearch(this.search);
    const shown = search === undefined ? tree : matching(tree, search);
    const picked = this.picked === null ? undefined : findNode(tree, this.picked);
    return html`${this.#renderDropped()}
      <div class="layout">
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
      ${
        this.#needsCorrecting(target)
          ? html`<span class="flag" data-test="needs-correcting"
              ><span aria-hidden="true">!</span
              ><span class="hidden">${t("menu_patch.needs_correcting")}</span></span
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
