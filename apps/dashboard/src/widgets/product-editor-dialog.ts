import { html, nothing, type LitElement, type ReactiveController } from "lit";
import type { ContentLanguages } from "@waitron/shared";
import type { DeclarationMenu } from "@waitron/menu";
import type { WtModal } from "@waitron/ui";
import type {
  CategoryInput,
  CategorySummary,
  ProductSaveBody,
  Unit,
  UnitInput,
} from "../api/catalog-api.js";
import type { Course } from "../api/kitchen-api.js";
import type { MenuSettingsAnswer } from "../api/menu-api.js";
import type {
  DashboardApi,
  ExtraList,
  ExtraListInput,
  OptionList,
  OptionListInput,
  OptionListSaveBody,
  Product,
  ProductEditorInput,
  ProductEditorValue,
} from "../api/client.js";
import { allergenRefusalText, codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { ProductChildCreate, type ProductChildKind } from "../state/product-child-create.js";
import { categoryRefusalErrors } from "./category-form.js";
import { refusalText } from "./delete-refusal.js";
import { missingChoiceField } from "./product-editor-missing-choice.js";
import { productEditorField, type ProductEditor } from "./product-editor.js";
import type { ProductEditorDraft } from "./product-editor-model.js";
import type { CourseList } from "./course-list.js";
import { unitRefusalErrors, type UnitFormErrors } from "./unit-form.js";
import type { LiveDeclarationQuestion } from "./live-declarations-dialog.js";
import "./live-declarations-dialog.js";
import "./product-editor.js";
import "./course-list.js";
import "./category-create-form.js";
import "./extra-list-form.js";
import "./option-list-form.js";
import "./unit-form.js";

export interface ProductEditorChoices {
  contentLanguages: ContentLanguages | null;
  menuSettings: MenuSettingsAnswer | null;
  products: Product[];
  categories: CategorySummary[];
  units: Unit[];
  courses: Course[];
  extraLists: ExtraList[];
  optionLists: OptionList[];
}

interface Effects {
  api(): DashboardApi;
  choices(): ProductEditorChoices;
  clearError(): void;
  readError(error: unknown): void;
  refused?(error: unknown): void;
  opened?(id: string, field: string): void;
  closed?(alreadyClosed: boolean): void;
  afterClose?(): void;
  saved(product: ProductEditorValue, created: boolean, current: () => boolean): Promise<void>;
  lateRefused?(product: ProductEditorValue | null, error: unknown): void;
  changeChoices(
    kind: Exclude<ProductChildKind, "categories">,
    current: () => boolean,
  ): Promise<void>;
}

/** The screen owns the address and its lookups; the editor owns the window and its related forms. */
export class ProductEditorDialog implements ReactiveController {
  open = false;
  value: ProductEditorValue | null = null;
  busy = false;
  reading = false;
  #initialField = "";
  #newCategoryId: string | null = null;
  #categorySeed = "";
  #categoryParent: string | null = null;
  #submittedCategoryParent: string | null = null;
  readonly #savedCategories = new Map<string, CategorySummary>();
  #editingList: { kind: "extras" | "options"; value: ExtraList | OptionList } | null = null;
  #fieldErrors: Record<string, string> = {};
  #editorGeneration = 0;
  #childRefusals: { error: unknown; errors: ChildRefusals } | null = null;
  #addedCourse: string | null = null;
  #closingCourses: number | null = null;
  #pendingDeclarations: LiveDeclarationQuestion | null = null;
  #declarationQuestion: LiveDeclarationQuestion | null = null;
  readonly #child: ProductChildCreate;

  constructor(
    private readonly host: LitElement,
    private readonly effects: Effects,
  ) {
    host.addController(this);
    this.#child = new ProductChildCreate(host, {
      accept: (kind, value) => {
        const edited = this.#editingList !== null;
        this.#editingList = null;
        if (edited) return;
        this.#editor()?.selectRelated(kind, value.id);
      },
      refresh: (kind) => this.#refreshRelated(kind),
      loadError: effects.readError,
      focus: (kind) => void this.#returnChildFocus(kind),
    });
  }

  get #api(): DashboardApi {
    return this.effects.api();
  }

  get active(): boolean {
    return (
      this.reading ||
      this.open ||
      this.busy ||
      this.#pendingDeclarations !== null ||
      this.#declarationQuestion !== null
    );
  }

  hostDisconnected(): void {
    this.close();
  }

  close(): void {
    this.#editorGeneration++;
    this.#pendingDeclarations = null;
    this.#declarationQuestion = null;
    this.#child.reset();
    this.#editingList = null;
    this.#fieldErrors = {};
    this.#addedCourse = null;
    this.#newCategoryId = null;
    this.#savedCategories.clear();
    this.#initialField = "";
    this.value = null;
    this.open = false;
    this.busy = false;
    this.reading = false;
  }

  openNew(categoryId: string | null): void {
    this.close();
    this.effects.clearError();
    this.#newCategoryId = this.effects.choices().categories.some(({ id }) => id === categoryId)
      ? categoryId
      : null;
    this.open = true;
  }

  async openExisting(
    productId: string,
    initialField = "",
    options: { prepare?: (current: () => boolean) => Promise<void>; fromAddress?: boolean } = {},
  ): Promise<void> {
    if (!knowsEditorProduct(this.effects.choices().products, productId)) return;
    this.close();
    this.#initialField = initialField === "image" ? "image" : "";
    this.effects.clearError();
    const generation = this.#editorGeneration;
    const current = () => generation === this.#editorGeneration;
    this.reading = true;
    try {
      const api = this.#api;
      const [value] = await Promise.all([
        (api.background ?? api).getProductEditor(productId),
        options.prepare?.(current),
      ]);
      if (!current() || !value.active) return;
      this.value = value;
      this.open = true;
      if (!options.fromAddress) this.effects.opened?.(productId, this.#initialField);
    } catch (error) {
      if (current()) this.effects.readError(error);
    } finally {
      if (current()) {
        this.reading = false;
        this.host.requestUpdate();
      }
    }
  }

  async #save(
    event: CustomEvent<{ value: ProductEditorDraft; body: ProductSaveBody }>,
  ): Promise<void> {
    event.stopPropagation();
    if (this.busy || !this.open) return;
    this.busy = true;
    this.effects.clearError();
    this.#fieldErrors = {};
    this.host.requestUpdate();
    const editing = this.value;
    let generation = this.#editorGeneration;
    let saved: ProductEditorValue & { declarationMenus?: DeclarationMenu[] };
    try {
      saved = editing
        ? await this.#api.updateProductEditor(editing.id, event.detail.body)
        : await this.#api.createProductEditor(event.detail.body);
    } catch (error) {
      if (generation === this.#editorGeneration) {
        this.#fieldErrors = this.#rejectedField(error, event.detail.value);
        if (Object.keys(this.#fieldErrors).length === 0) {
          if (this.effects.refused) this.effects.refused(error);
          else
            this.#fieldErrors = {
              _form: refusalText(codeOf(error), (error as { params?: unknown }).params),
            };
        }
        this.busy = false;
        this.host.requestUpdate();
      } else if (this.host.isConnected) {
        this.effects.lateRefused?.(editing, error);
      }
      return;
    }
    if (!this.host.isConnected) return;
    if (generation === this.#editorGeneration) {
      this.#editor()?.closeSaved(event.detail.value);
      this.close();
      if (editing !== null && saved.declarationMenus?.length)
        this.#pendingDeclarations = { id: saved.id, menus: saved.declarationMenus };
      generation = this.#editorGeneration;
      this.busy = true;
      this.effects.closed?.(false);
    }
    const current = () => generation === this.#editorGeneration;
    try {
      await this.effects.saved(saved, editing === null, current);
    } catch (error) {
      if (current()) this.effects.readError(error);
    } finally {
      if (current()) {
        this.busy = false;
        this.host.requestUpdate();
      }
    }
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    const alreadyClosed = this.#editor()?.shadowRoot?.querySelector("wt-modal")?.open === false;
    this.close();
    this.effects.closed?.(alreadyClosed);
  }

  #afterClose(event: Event): void {
    if (event.composedPath()[0] !== this.#editor()?.shadowRoot?.querySelector("wt-modal")) return;
    if (this.open) return;
    if (this.#pendingDeclarations === null) this.effects.afterClose?.();
    else {
      this.#declarationQuestion = this.#pendingDeclarations;
      this.#pendingDeclarations = null;
      this.host.requestUpdate();
    }
  }

  readonly #closeDeclarations = (event: Event): void => {
    event.stopPropagation();
    this.#declarationQuestion = null;
    this.host.requestUpdate();
    this.effects.afterClose?.();
  };

  readonly #correctDeclarations: DashboardApi["correctLiveDeclarations"] = (id, queued) =>
    this.#api.correctLiveDeclarations(id, queued);

  #coursesWindow(): WtModal {
    return this.host.shadowRoot!.querySelector<WtModal>("[data-test=courses-dialog]")!;
  }

  #editor(): ProductEditor | null {
    return this.host.shadowRoot?.querySelector<ProductEditor>("dashboard-product-editor") ?? null;
  }
  /** Focus handed back before a nested form and its own dialog finish updating does not land: the
   * dialog may still be open. */
  async #returnChildFocus(kind: ProductChildKind): Promise<void> {
    const generation = this.#editorGeneration;
    const tag = CHILD_FORMS[kind];
    if (tag) {
      const form = this.host.shadowRoot!.querySelector<LitElement>(tag);
      await form?.updateComplete;
      await form?.shadowRoot!.querySelector<WtModal>("wt-modal")?.updateComplete;
    }
    if (generation === this.#editorGeneration) this.#editor()?.returnRelatedFocus(kind);
  }

  #rejectedField(error: unknown, submitted: ProductEditorInput): Record<string, string> {
    if (codeOf(error) === "allergen.kinds_required" || codeOf(error) === "allergen.invalid_kind")
      return { allergens: allergenRefusalText(error) };
    const params = (error as { params?: { field?: unknown } }).params ?? {};
    if (typeof params.field === "string") {
      const name = productEditorField(
        params.field,
        this.effects.choices().contentLanguages?.defaultLanguage ?? "",
      );
      if (name === null) return {};
      const code = codeOf(error);
      return {
        [name]:
          code === "product.offered_as_extra" || code === "product.name_taken"
            ? refusalText(code, params)
            : t("editor.field_rejected"),
      };
    }
    const code = codeOf(error);
    const name = missingChoiceField(code, error, submitted);
    return name === null ? {} : { [name]: codeMessage(code) };
  }

  /** Empty while nothing has been refused: the create controller clears its error whenever a form
   * opens or is cancelled. */
  #childRefusalErrors(): ChildRefusals {
    const error = this.#child.error ?? null;
    if (this.#childRefusals?.error === error) return this.#childRefusals.errors;
    const errors: ChildRefusals = { unit: {}, lists: {}, category: {} };
    if (error !== null && this.#child.kind === "categories")
      errors.category = categoryRefusalErrors(error, this.#submittedCategoryParent);
    if (error !== null && this.#child.kind === "unit") errors.unit = unitRefusalErrors(error);
    if (error !== null && (this.#child.kind === "extras" || this.#child.kind === "options")) {
      // Keyed by the field path the server named, or `_form` when it names none.
      const params = (error as { params?: { field?: unknown } }).params ?? {};
      const field = typeof params.field === "string" ? params.field : "_form";
      errors.lists = { [field]: codeMessage(codeOf(error)) };
    }
    this.#childRefusals = { error, errors };
    return errors;
  }

  async #refreshRelated(kind: ProductChildKind): Promise<void> {
    if (kind === "categories") return;
    const generation = this.#editorGeneration;
    await this.effects.changeChoices(kind, () => generation === this.#editorGeneration);
  }

  /** Closing waits for the course list to settle, then brings the product's course in line. The
   * editor is not reseeded, so the product's unsaved edits survive. */
  async #closeCourses(): Promise<void> {
    const generation = this.#editorGeneration;
    if (this.#child.kind !== "courses" || this.#closingCourses === generation) return;
    const list = this.host.shadowRoot!.querySelector<CourseList>("dashboard-course-list")!;
    this.#closingCourses = generation;
    await list.settled();
    if (this.#closingCourses === generation) this.#closingCourses = null;
    if (generation !== this.#editorGeneration) return;
    // Unsaved work stays on screen, unless Escape has already shut the window.
    if (list.unsaved && this.#coursesWindow().open) return;
    const added = this.#addedCourse;
    this.#addedCourse = null;
    this.#child.cancel();
    try {
      await this.#refreshRelated("courses");
    } catch (error) {
      if (generation === this.#editorGeneration) this.effects.readError(error);
      return;
    }
    if (generation !== this.#editorGeneration) return;
    const editor = this.#editor()!;
    const exists = (id: string | null) =>
      this.effects.choices().courses.some((course) => course.id === id);
    if (added !== null && exists(added)) editor.selectRelated("courses", added);
    else if (!exists(editor.currentValue.courseId)) editor.clearCourse();
  }

  /** Every submission is a new refusal, even one the API answers with an identical error object. */
  #submitChild<T extends { id: string }>(
    write: () => Promise<T>,
    committed?: (value: T) => void,
  ): Promise<void> {
    this.#childRefusals = null;
    return this.#child.submit(write, committed);
  }

  #submitCategory = (event: CustomEvent<{ value: Required<CategoryInput> }>): void => {
    event.stopPropagation();
    const value = event.detail.value;
    const form = this.host.shadowRoot!.querySelector("dashboard-category-create-form")!;
    this.#submittedCategoryParent = value.parentId;
    void this.#submitChild(
      () => this.#api.createCategory(value),
      (saved) => {
        this.#savedCategories.set(saved.id, saved);
        form.closeSaved(value);
      },
    );
  };

  #submitUnit = (event: CustomEvent<{ value: UnitInput }>): void => {
    event.stopPropagation();
    const form = this.host.shadowRoot!.querySelector("dashboard-unit-form")!;
    void this.#submitChild(
      async () => {
        const value = await this.#api.createUnit(event.detail.value);
        return { id: value.id, name: value.name };
      },
      () => form.closeSaved(event.detail.value),
    );
  };

  #submitExtraList = (event: CustomEvent<{ value: ExtraListInput }>): void => {
    event.stopPropagation();
    const editing = this.#editingList?.kind === "extras" ? this.#editingList.value : null;
    const form = this.host.shadowRoot!.querySelector("dashboard-extra-list-form")!;
    void this.#submitChild(
      async () =>
        editing
          ? await this.#api.updateExtraList(editing.id, event.detail.value)
          : await this.#api.createExtraList(event.detail.value),
      () => form.closeSaved(event.detail.value),
    );
  };

  #submitOptionList = (
    event: CustomEvent<{ value: OptionListInput; body: OptionListSaveBody }>,
  ): void => {
    event.stopPropagation();
    const editing = this.#editingList?.kind === "options" ? this.#editingList.value : null;
    const form = this.host.shadowRoot!.querySelector("dashboard-option-list-form")!;
    void this.#submitChild(
      async () =>
        editing
          ? await this.#api.updateOptionList(editing.id, event.detail.body)
          : await this.#api.createOptionList(event.detail.value),
      () => form.closeSaved(event.detail.value),
    );
  };

  #editRelated = (event: CustomEvent<{ kind: ProductChildKind; id: string }>): void => {
    event.stopPropagation();
    const { kind, id } = event.detail;
    if (kind !== "extras" && kind !== "options") return;
    const lists: (ExtraList | OptionList)[] =
      kind === "extras" ? this.effects.choices().extraLists : this.effects.choices().optionLists;
    const value = lists.find((entry) => entry.id === id);
    if (!value) return;
    this.#editingList = { kind, value };
    this.#child.open(kind);
  };

  /**
   * Honoured only while a form of that KIND is the open one. A form that does not check its own
   * `open` sends a SECOND `wt-cancel` a task later (the closed `<dialog>`'s native `close`, which
   * `wt-dialog.ts` turns into `wt-close`), and by then a different form can be open. The same kind
   * reopened inside that task needs no check: `wt-dialog.ts` drops the late report for a dialog
   * that is open again.
   */
  #cancelChild(kind: ProductChildKind): void {
    if (this.#child.kind !== kind) return;
    this.#editingList = null;
    this.#child.cancel();
  }

  render(choices: ProductEditorChoices, busy = this.busy) {
    const locales = choices.contentLanguages?.languages ?? [];
    const refusals = this.#childRefusalErrors();
    const saved = this.#savedCategories;
    for (const { id } of saved.size ? choices.categories : []) saved.delete(id);
    const categories = saved.size ? [...choices.categories, ...saved.values()] : choices.categories;
    return html`
      <dashboard-product-editor
        @wt-close=${(event: Event) => this.#afterClose(event)}
        .open=${this.open}
        .busy=${busy}
        .childOpen=${this.#child.kind !== null}
        .locales=${locales}
        .value=${this.value}
        .initialField=${this.#initialField}
        .takeawayVat=${choices.menuSettings?.takeawayVat ?? false}
        .vatRates=${choices.menuSettings?.vatRates ?? []}
        .defaultTakeawayVatRate=${choices.menuSettings?.defaultTakeawayVatRate ?? ""}
        .dineInVatRate=${choices.menuSettings?.dineInVatRate ?? ""}
        .defaultColor=${choices.menuSettings?.defaultColor ?? null}
        .newCategoryId=${this.#newCategoryId}
        .fieldErrors=${this.#fieldErrors}
        .units=${choices.units}
        .categories=${categories}
        .extraLists=${choices.extraLists}
        .optionLists=${choices.optionLists}
        .courses=${choices.courses}
        .api=${this.#api}
        @wt-submit=${(event: CustomEvent<{ value: ProductEditorDraft; body: ProductSaveBody }>) => void this.#save(event)}
        @wt-cancel=${(event: Event) => this.#cancel(event)}
        @wt-create-related=${(event: CustomEvent<{ kind: ProductChildKind; text?: string }>) => {
          event.stopPropagation();
          if (event.detail.kind === "categories" && this.#child.kind === null) {
            this.#categorySeed = event.detail.text ?? "";
            this.#categoryParent = this.#editor()!.currentValue.primaryCategoryId;
          }
          this.#child.open(event.detail.kind);
        }}
        @wt-edit-related=${this.#editRelated}
        @wt-open-product=${(event: CustomEvent<{ productId: string }>) => {
          event.stopPropagation();
          void this.openExisting(event.detail.productId);
        }}
      ></dashboard-product-editor>
      ${
        this.#declarationQuestion === null
          ? nothing
          : html`<dashboard-live-declarations-dialog
              .question=${this.#declarationQuestion}
              .correct=${this.#correctDeclarations}
              @wt-close=${this.#closeDeclarations}
            ></dashboard-live-declarations-dialog>`
      }
      <wt-modal
        size="standard"
        data-test="courses-dialog"
        .open=${this.#child.kind === "courses"}
        heading=${t("kitchen.courses_title")}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          void this.#closeCourses();
        }}
        @course-added=${(event: CustomEvent<{ id: string }>) => {
          event.stopPropagation();
          this.#addedCourse = event.detail.id;
        }}
      >
        ${
          this.#child.kind === "courses"
            ? html`<dashboard-course-list .api=${this.#api}></dashboard-course-list>`
            : nothing
        }
        <wt-form-actions slot="footer"
          ><wt-button
            slot="cancel"
            data-test="courses-done"
            @click=${() => void this.#closeCourses()}
            >${t("action.done")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
      <dashboard-category-create-form
        .open=${this.#child.kind === "categories"}
        .draftParent=${this.#editor() ?? undefined}
        .busy=${this.#child.busy}
        .seed=${this.#categorySeed}
        .parentId=${this.#categoryParent}
        .defaultColor=${choices.menuSettings?.defaultColor ?? null}
        .categories=${categories}
        .fieldErrors=${refusals.category}
        @wt-submit=${this.#submitCategory}
        @wt-cancel=${() => this.#cancelChild("categories")}
      ></dashboard-category-create-form>
      <dashboard-unit-form
        .open=${this.#child.kind === "unit"}
        .draftParent=${this.#editor() ?? undefined}
        .busy=${this.#child.busy}
        .locales=${locales}
        .fieldErrors=${refusals.unit}
        @wt-submit=${this.#submitUnit}
        @wt-cancel=${() => this.#cancelChild("unit")}
      ></dashboard-unit-form>
      ${
        // Both list forms carry translated name fields, so they wait for the content languages
        // rather than offering a field in a guessed language.
        choices.contentLanguages
          ? html`<dashboard-extra-list-form
                .draftParent=${this.#editor() ?? undefined}
                .open=${this.#child.kind === "extras"}
                .busy=${this.#child.busy}
                .languages=${choices.contentLanguages}
                .value=${this.#editingList?.kind === "extras" ? (this.#editingList.value as ExtraList) : null}
                .products=${choices.products}
                .fieldErrors=${refusals.lists}
                @wt-submit=${this.#submitExtraList}
                @wt-cancel=${() => this.#cancelChild("extras")}
              ></dashboard-extra-list-form>
              <dashboard-option-list-form
                .draftParent=${this.#editor() ?? undefined}
                .open=${this.#child.kind === "options"}
                .busy=${this.#child.busy}
                .languages=${choices.contentLanguages}
                .value=${
                  this.#editingList?.kind === "options"
                    ? (this.#editingList.value as OptionList)
                    : null
                }
                .fieldErrors=${refusals.lists}
                @wt-submit=${this.#submitOptionList}
                @wt-cancel=${() => this.#cancelChild("options")}
              ></dashboard-option-list-form>`
          : nothing
      }
    `;
  }
}

export function knowsEditorProduct(products: Product[], productId: string): boolean {
  return products.some(
    ({ id, active, variants }) =>
      active &&
      (id === productId || variants.some((variant) => variant.active && variant.id === productId)),
  );
}

/** The nested forms that draw their own dialog; the courses window is the screen's own. */
const CHILD_FORMS: Partial<Record<ProductChildKind, string>> = {
  categories: "dashboard-category-create-form",
  unit: "dashboard-unit-form",
  extras: "dashboard-extra-list-form",
  options: "dashboard-option-list-form",
};

interface ChildRefusals {
  category: Record<string, string>;
  unit: UnitFormErrors;
  lists: Record<string, string>;
}
