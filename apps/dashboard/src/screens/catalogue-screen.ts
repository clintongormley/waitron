import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
// Value imports (not `import type`): pull in the widget modules for their `@customElement` side
// effects, so `<dashboard-product-list>`, `<dashboard-product-form>` and
// `<dashboard-category-manager>` are registered before this screen renders them (the
// `staff-screen.ts` widget-registration pattern).
import "../widgets/product-list.js";
import "../widgets/product-form.js";
import "../widgets/category-manager.js";
import "../widgets/option-group-manager.js";
import type { CreateProductDetail, UpdateProductDetail } from "../widgets/product-form.js";
import type {
  CatalogueSummary,
  CategorySummary,
  Course,
  DashboardApi,
  OptionGroup,
  OptionGroupInput,
  OptionGroupItem,
  OptionGroupItemInput,
  OptionGroupItemPatch,
  OptionGroupPatch,
  Product,
  ProductInput,
  Station,
} from "../api/client.js";

/**
 * The management dashboard's CATALOGUE SCREEN: the composition point (sibling of
 * `dashboard-staff-screen`) that wires the pure-display `<dashboard-product-list>`, the
 * `<dashboard-product-form>` create/edit dialog and the `<dashboard-category-manager>` panel to the
 * injected `DashboardApi`. It is the single owner of the selected catalogue, the form's open state and
 * the loaded catalogues/categories/products.
 *
 * ON CONNECT it loads catalogues + categories, picks the first catalogue and loads its products.
 * Because a product needs a catalogue (`products.catalogue_id` is `NOT NULL`), when NO catalogue
 * exists the screen prompts to create one first and hides the add-product affordance — a
 * create-catalogue field then calls `createCatalogue` and reloads. A catalogue selector switches which
 * catalogue's products show.
 *
 * `active` IS SETTABLE ON CREATE. `#onCreateProduct` threads the form's `active` straight into the
 * `ProductInput`, so a create-INACTIVE is ONE atomic request — never a create-then-patch that could
 * leave the product active/sellable at the till if the follow-up failed (a whole-branch review
 * finding). `active` stays a legal patch key on an edit too, which goes straight through
 * `updateProduct(id, patch)`.
 *
 * ERROR HANDLING, every async path, mirroring `staff-screen.ts`: `#load`, `#switchCatalogue`,
 * `#onCreateProduct`, `#onUpdateProduct`, `#onCreateCategory` and `#doCreateCatalogue` are each fully
 * `try/catch`ed — a rejection becomes `errorKey` (from the thrown `{ code }`, falling back to
 * `server.internal`) rendered in a `role="alert"` banner, never an unhandled promise rejection (the
 * handlers are invoked via `void`). A single-flight `busy` gate on product create/update (passed DOWN
 * to the form to disable its confirm) drops a double-fired mutation, since none is server-idempotent.
 * `stopPropagation` on every child event keeps the composed events inside this screen, the house
 * pattern the staff screen follows.
 */
@customElement("dashboard-catalogue-screen")
export class CatalogueScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    css`
      :host {
        display: block;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-4);
      }
      .actions {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
      }
      .title {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      .prompt {
        color: var(--wt-color-text);
      }
      .new-catalogue {
        display: flex;
        align-items: flex-end;
        gap: var(--wt-space-3);
        margin-top: var(--wt-space-4);
      }
      .field {
        flex: 1;
        min-width: 0;
      }
      .categories {
        margin-top: var(--wt-space-6);
      }
      .option-groups {
        margin-top: var(--wt-space-6);
      }
      .section-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  @state() private catalogues: CatalogueSummary[] = [];
  @state() private categories: CategorySummary[] = [];
  @state() private products: Product[] = [];
  /** The venue's active kitchen stations (KDS-1), loaded on connect and threaded to the category
   * manager + product form as the options their station-routing selects offer. */
  @state() private stations: Station[] = [];
  /** The venue's active kitchen courses (KDS-2), loaded on connect and threaded to the product form as
   * the options its default-course select offers. */
  @state() private courses: Course[] = [];
  /** Every reusable option group (Task 12), loaded on connect and threaded to the option-group manager
   * and (as the attach picker's source) to the product form. */
  @state() private optionGroups: OptionGroup[] = [];
  /** The EXPANDED group's items only — loaded on demand when the manager's Items button is toggled. */
  @state() private optionGroupItems: OptionGroupItem[] = [];
  /** Which group's items panel the manager has open, or null (the `layout-screen.ts` one-expanded-row
   * pattern — only one group's items are ever loaded/shown at a time). */
  @state() private expandedGroupId: string | null = null;
  /** A raw `{ code }` for the manager's group create/edit inline error slot, or null (e.g.
   * `options.group_invalid` on an inconsistent min/max/required). */
  @state() private optionGroupError: string | null = null;
  /** A raw `{ code }` for the manager's item create/edit inline error slot, or null. */
  @state() private optionGroupItemError: string | null = null;
  /** The product being opened for edit's CURRENTLY-attached option group ids, in order — the read-back
   * (`listProductOptionGroupIds`) that seeds the product form's attach section. Reset to `[]` whenever
   * the form opens (create or edit) so a prior edit's attachment never leaks into the next one; an
   * edit's real value arrives asynchronously via {@link #loadAttachedGroups}. */
  @state() private attachedGroupIds: string[] = [];
  /** Which catalogue's products show; the catalogue new products are created under. */
  @state() private selectedCatalogueId = "";
  @state() private formOpen = false;
  /** The product the form is open for (null for a create). */
  @state() private editingProduct: Product | null = null;
  @state() private newCatalogueName = "";
  @state() private errorKey: string | null = null;
  // Single-flight for product create/update, passed DOWN to the form as `.busy` so its confirm
  // disables while a mutation round-trips. Reactive because the form renders off it; set synchronously
  // at handler entry so a double-fired event files at most one mutation.
  @state() private busy = false;

  // Separate re-entrancy guards for the two other create flows (nothing renders off them, so plain
  // fields, like the staff screen's `#creating`).
  #savingCategory = false;
  #savingCatalogue = false;
  #savingOptionGroup = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /**
   * (Re)load catalogues + categories, then the selected catalogue's products. Called on connect and
   * after a catalogue is created. Picks the first catalogue when the current selection is gone (or
   * unset); when NO catalogue exists it clears the selection and the product list (the no-catalogue
   * prompt renders instead). Also loads every reusable option group (Task 12) — a venue-wide list, not
   * scoped to a catalogue, so it belongs beside stations/courses rather than in `#applyCatalogues`. A
   * rejection anywhere becomes the `errorKey` banner.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [catalogues, categories, stations, courses, optionGroups] = await Promise.all([
        this.api.listCatalogues(),
        this.api.listCategories(),
        this.api.listStations(),
        this.api.listCourses(),
        this.api.listOptionGroups(),
      ]);
      this.stations = stations;
      this.courses = courses;
      this.optionGroups = optionGroups;
      await this.#applyCatalogues(catalogues, categories);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Reload catalogues + categories + the selected catalogue's products WITHOUT re-fetching stations —
   * the targeted reload a catalogue create needs. Stations do not change when a catalogue is created, so
   * routing {@link #createCatalogue} through the broad {@link #load} would issue an avoidable
   * `GET /management-api/stations`. Throws to its caller's catch (the create handler's) on rejection.
   */
  async #reloadCatalogues(): Promise<void> {
    const [catalogues, categories] = await Promise.all([
      this.api.listCatalogues(),
      this.api.listCategories(),
    ]);
    await this.#applyCatalogues(catalogues, categories);
  }

  /**
   * Adopt a freshly-fetched catalogue + category set: store them, resolve the selection (keep the current
   * one if it still exists, else the first; clear when none), and load that catalogue's products. Shared
   * by the full {@link #load} and the stations-skipping {@link #reloadCatalogues} so the selection logic
   * lives in one place.
   */
  async #applyCatalogues(
    catalogues: CatalogueSummary[],
    categories: CategorySummary[],
  ): Promise<void> {
    this.catalogues = catalogues;
    this.categories = categories;
    if (catalogues.length === 0) {
      this.selectedCatalogueId = "";
      this.products = [];
      return;
    }
    if (!catalogues.some((c) => c.id === this.selectedCatalogueId)) {
      this.selectedCatalogueId = catalogues[0]!.id;
    }
    this.products = await this.api.listProducts(this.selectedCatalogueId);
  }

  /** Reload the selected catalogue's products (after a create/update). Throws to its caller's catch. */
  async #reloadProducts(): Promise<void> {
    this.products = await this.api.listProducts(this.selectedCatalogueId);
  }

  /** The catalogue selector changed. Native `change` is `composed:false`; `stopPropagation` is
   * defensive consistency with the composed handlers (the login-screen pattern). Reload the products
   * for the newly selected catalogue. */
  #onSelectCatalogue(event: Event): void {
    event.stopPropagation();
    this.selectedCatalogueId = (event.target as HTMLSelectElement).value;
    void this.#switchCatalogue();
  }

  async #switchCatalogue(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Open the create form for the selected catalogue. Clears any prior error and the edit target.
   * `attachedGroupIds` resets to `[]` — a new product has no id yet, so there is nothing to read back
   * (Task 12's attach section starts with nothing picked). */
  #openForm(): void {
    this.errorKey = null;
    this.editingProduct = null;
    this.attachedGroupIds = [];
    this.formOpen = true;
  }

  /**
   * The product list asked to edit `productId`. Resolve it against the list we already hold (it is
   * OURS — from `listProducts` — so an unknown id can only be a stale event; drop it) and open the
   * form pre-filled. `stopPropagation` keeps the composed `edit-product` inside this screen.
   *
   * `attachedGroupIds` is reset to `[]` HERE, synchronously, before the async read-back
   * ({@link #loadAttachedGroups}) resolves — otherwise the form would briefly show whatever the
   * PREVIOUS edit's attachment was (a stale prop from before this open), the same "reset before the
   * async load" shape `recipe-screen.ts`'s `#onSelectProduct` uses for `recipe`.
   */
  #onEditProduct(event: CustomEvent<{ productId: string }>): void {
    event.stopPropagation();
    const product = this.products.find((p) => p.id === event.detail.productId);
    if (product === undefined) return;
    this.errorKey = null;
    this.editingProduct = product;
    this.attachedGroupIds = [];
    this.formOpen = true;
    void this.#loadAttachedGroups(product.id);
  }

  /**
   * Load `productId`'s currently-attached option groups (Task 12's read-back), for the product form's
   * attach section. The selection is captured up front and the result applied only if it is STILL the
   * product being edited, so a slow earlier load cannot overwrite a newer edit the operator opened
   * meanwhile — the same superseded-check `recipe-screen.ts`'s `#loadRecipe` uses.
   */
  async #loadAttachedGroups(productId: string): Promise<void> {
    try {
      const ids = await this.api.listProductOptionGroupIds(productId);
      if (this.editingProduct?.id !== productId) return; // superseded by a newer selection
      this.attachedGroupIds = ids;
    } catch (error) {
      if (this.editingProduct?.id !== productId) return; // superseded — its error is not ours to show
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Create a product from the form's detail, then reload. `active` is threaded straight into the
   * `ProductInput`, so a create-INACTIVE is ONE atomic request — never a create-then-patch that could
   * leave the product active/sellable at the till if the follow-up failed. `allergens`/`image` are
   * carried only when the detail has them (the create-vs-patch asymmetry the form documents);
   * `optionGroupIds` (Task 12) is threaded straight through — the form ALWAYS sends it (`[]` when
   * nothing is picked), so the attach is part of the SAME atomic create request too. On rejection the
   * form stays open with its values intact for a retry.
   */
  async #onCreateProduct(event: CustomEvent<CreateProductDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight: drop a double-click's second create-product
    this.busy = true;
    this.errorKey = null;
    try {
      const detail = event.detail;
      const input: ProductInput = {
        catalogueId: detail.catalogueId,
        categoryId: detail.categoryId,
        descriptions: detail.descriptions,
        unitPrice: detail.unitPrice,
        vatClass: detail.vatClass,
        pricingUnit: detail.pricingUnit,
        active: detail.active,
        optionGroupIds: detail.optionGroupIds,
      };
      if (detail.allergens !== undefined) input.allergens = detail.allergens;
      if (detail.image !== undefined) input.image = detail.image;
      await this.api.createProduct(input);
      this.formOpen = false;
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Patch a product from the form's edit detail, then reload. `active` is a legal patch key here (as it
   * is on create), so the patch goes straight through. On rejection the form stays open.
   */
  async #onUpdateProduct(event: CustomEvent<UpdateProductDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return; // single-flight
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updateProduct(event.detail.id, event.detail.patch);
      this.formOpen = false;
      await this.#reloadProducts();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  /** Create a category from the manager's detail, then reload the category list. Single-flight. */
  async #onCreateCategory(event: CustomEvent<{ name: string }>): Promise<void> {
    event.stopPropagation();
    if (this.#savingCategory) return;
    this.#savingCategory = true;
    this.errorKey = null;
    try {
      await this.api.createCategory(event.detail.name);
      this.categories = await this.api.listCategories();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#savingCategory = false;
    }
  }

  /**
   * Route a CATEGORY to a station (KDS-1) from the category manager's `set-category-station` event.
   * `stopPropagation` keeps the composed event inside this screen. A rejection becomes the `errorKey`
   * banner; there is no reload — the catalogue read does not project a category's routing, so a resync
   * would show nothing new (the write itself is authoritative server-side).
   */
  async #onSetCategoryStation(
    event: CustomEvent<{ categoryId: string; stationId: string | null }>,
  ): Promise<void> {
    event.stopPropagation();
    this.errorKey = null;
    try {
      await this.api.setCategoryStation(event.detail.categoryId, event.detail.stationId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Override a PRODUCT's route to a station (KDS-1) from the product form's `set-product-station`
   * event — the same shape as {@link #onSetCategoryStation}. A rejection becomes the `errorKey` banner;
   * no reload for the same reason (the product read projects no `station_id`).
   */
  async #onSetProductStation(
    event: CustomEvent<{ productId: string; stationId: string | null }>,
  ): Promise<void> {
    event.stopPropagation();
    this.errorKey = null;
    try {
      await this.api.setProductStation(event.detail.productId, event.detail.stationId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Set (or clear) a PRODUCT's default kitchen course (KDS-2) from the product form's
   * `set-product-course` event — the same shape as {@link #onSetProductStation}. A rejection becomes the
   * `errorKey` banner; no reload for the same reason (the product read projects no `course_id`).
   */
  async #onSetProductCourse(
    event: CustomEvent<{ productId: string; courseId: string | null }>,
  ): Promise<void> {
    event.stopPropagation();
    this.errorKey = null;
    try {
      await this.api.setProductCourse(event.detail.productId, event.detail.courseId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Option groups (reusable modifiers) + their items (Task 11/12) ──────────────────────────────
  // The manager's CRUD, wired to the Task 11 routes. `optionGroupError`/`optionGroupItemError` are
  // SEPARATE from `errorKey` — the manager renders them INLINE next to the create/edit form they belong
  // to (never the screen's top-of-page banner), so `options.group_invalid` on an inconsistent
  // min/max/required reads as a form validation error, not an opaque page-level failure.

  /** Reload every option group (after a create/update). Throws to its caller's catch. */
  async #reloadOptionGroups(): Promise<void> {
    this.optionGroups = await this.api.listOptionGroups();
  }

  /** Create an option group from the manager's detail, then reload the group list. Single-flight
   * (the `createCategory` shape) — an option group is authored rarely, but a double-click should still
   * not risk two mutations from one confirm. */
  async #onCreateOptionGroup(event: CustomEvent<OptionGroupInput>): Promise<void> {
    event.stopPropagation();
    if (this.#savingOptionGroup) return;
    this.#savingOptionGroup = true;
    this.optionGroupError = null;
    try {
      await this.api.createOptionGroup(event.detail);
      await this.#reloadOptionGroups();
    } catch (error) {
      this.optionGroupError = codeOf(error);
    } finally {
      this.#savingOptionGroup = false;
    }
  }

  /** Patch an existing option group from the manager's per-field inline edit, then reload — the
   * `set-category-station` shape (no single-flight; each field is its own immediate PATCH). An invalid
   * merged bound configuration rejects `options.group_invalid`, shown inline in the manager. */
  async #onUpdateOptionGroup(
    event: CustomEvent<{ id: string; patch: OptionGroupPatch }>,
  ): Promise<void> {
    event.stopPropagation();
    this.optionGroupError = null;
    try {
      await this.api.updateOptionGroup(event.detail.id, event.detail.patch);
      await this.#reloadOptionGroups();
    } catch (error) {
      this.optionGroupError = codeOf(error);
    }
  }

  /**
   * Open or close a group's items panel (the manager's `toggle-option-group-items`). Closing (the same
   * group clicked again) clears `items` too, so a later re-open always starts from a fresh load rather
   * than briefly showing the last group's stale rows. Opening loads that group's items; a rejection
   * becomes the `errorKey` banner (a READ failure, not a form-validation one, so it does not belong in
   * the manager's inline slots).
   *
   * `optionGroupItemError` is cleared UNCONDITIONALLY at entry, before either branch — fix round 1's
   * regression. Unlike `groupError` (cleared at the top of every create/update ATTEMPT, so it
   * self-heals the moment the operator tries again), an item error had no equivalent reset on
   * NAVIGATION: closing the panel, reopening the SAME group with no new attempt, or switching to a
   * DIFFERENT group all left a stale error standing — worst case showing group A's error while the
   * operator is looking at group B's items, which they never touched.
   */
  async #onToggleOptionGroupItems(event: CustomEvent<{ groupId: string }>): Promise<void> {
    event.stopPropagation();
    this.optionGroupItemError = null;
    const { groupId } = event.detail;
    if (this.expandedGroupId === groupId) {
      this.expandedGroupId = null;
      this.optionGroupItems = [];
      return;
    }
    this.expandedGroupId = groupId;
    this.optionGroupItems = [];
    this.errorKey = null;
    try {
      this.optionGroupItems = await this.api.listOptionGroupItems(groupId);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Create an item within the expanded group from the manager's detail, then reload that group's
   * items. A rejection becomes `optionGroupItemError`, shown inline in the manager's item form. */
  async #onCreateOptionGroupItem(
    event: CustomEvent<{ groupId: string } & OptionGroupItemInput>,
  ): Promise<void> {
    event.stopPropagation();
    const { groupId, ...input } = event.detail;
    this.optionGroupItemError = null;
    try {
      await this.api.createOptionGroupItem(groupId, input);
      this.optionGroupItems = await this.api.listOptionGroupItems(groupId);
    } catch (error) {
      this.optionGroupItemError = codeOf(error);
    }
  }

  /** Patch an existing item from the manager's per-field inline edit, then reload that group's items —
   * the same immediate-PATCH shape as {@link #onUpdateOptionGroup}. */
  async #onUpdateOptionGroupItem(
    event: CustomEvent<{ groupId: string; itemId: string; patch: OptionGroupItemPatch }>,
  ): Promise<void> {
    event.stopPropagation();
    this.optionGroupItemError = null;
    try {
      await this.api.updateOptionGroupItem(
        event.detail.groupId,
        event.detail.itemId,
        event.detail.patch,
      );
      this.optionGroupItems = await this.api.listOptionGroupItems(event.detail.groupId);
    } catch (error) {
      this.optionGroupItemError = codeOf(error);
    }
  }

  /** Capture the new-catalogue field. `stopPropagation` keeps its composed `wt-change` inside this
   * screen (the house field-handler pattern). */
  #onNewCatalogueNameChange(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newCatalogueName = event.detail.value;
  }

  /** Create the first (or a further) catalogue, then reload everything and select it. An empty or
   * whitespace-only name is a no-op; a rejection becomes the error banner. Single-flight. */
  async #createCatalogue(): Promise<void> {
    const name = this.newCatalogueName.trim();
    if (name === "") return;
    if (this.#savingCatalogue) return;
    this.#savingCatalogue = true;
    this.errorKey = null;
    try {
      const created = await this.api.createCatalogue(name);
      this.newCatalogueName = "";
      this.selectedCatalogueId = created.id;
      await this.#reloadCatalogues();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#savingCatalogue = false;
    }
  }

  override render(): TemplateResult {
    const hasCatalogue = this.catalogues.length > 0;
    return html`
      <div class="header">
        <h1 class="title">${t("catalogue.title")}</h1>
        ${
          hasCatalogue
            ? html`<div class="actions">
                <label class="picker"
                  >${t("catalogue.picker")}
                  <select
                    data-test="catalogue-select"
                    @change=${(e: Event) => this.#onSelectCatalogue(e)}
                  >
                    ${this.catalogues.map(
                      (c) =>
                        html`<option value=${c.id} .selected=${c.id === this.selectedCatalogueId}>
                          ${c.name}
                        </option>`,
                    )}
                  </select>
                </label>
                <wt-button
                  variant="primary"
                  data-test="add-product"
                  @click=${() => this.#openForm()}
                  >${t("catalogue.add_product")}</wt-button
                >
              </div>`
            : nothing
        }
      </div>

      ${
        hasCatalogue
          ? html`<dashboard-product-list
              .products=${this.products}
              @edit-product=${(e: CustomEvent<{ productId: string }>) => this.#onEditProduct(e)}
            ></dashboard-product-list>`
          : html`<p class="prompt" data-test="no-catalogue">${t("catalogue.empty_prompt")}</p>`
      }

      <section class="new-catalogue">
        <wt-input
          class="field"
          data-test="new-catalogue-name"
          label=${t("catalogue.new")}
          .value=${this.newCatalogueName}
          @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewCatalogueNameChange(e)}
        ></wt-input>
        <wt-button
          variant="secondary"
          data-test="create-catalogue"
          @click=${() => void this.#createCatalogue()}
          >${t("catalogue.create")}</wt-button
        >
      </section>

      <section class="categories">
        <dashboard-category-manager
          .categories=${this.categories}
          .stations=${this.stations}
          @create-category=${(e: CustomEvent<{ name: string }>) => this.#onCreateCategory(e)}
          @set-category-station=${(
            e: CustomEvent<{ categoryId: string; stationId: string | null }>,
          ) => void this.#onSetCategoryStation(e)}
        ></dashboard-category-manager>
      </section>

      <section class="option-groups">
        <h2 class="section-title">${t("option_group.section_title")}</h2>
        <dashboard-option-group-manager
          .groups=${this.optionGroups}
          .items=${this.optionGroupItems}
          .expandedGroupId=${this.expandedGroupId}
          .groupError=${this.optionGroupError}
          .itemError=${this.optionGroupItemError}
          @create-option-group=${(e: CustomEvent<OptionGroupInput>) =>
            void this.#onCreateOptionGroup(e)}
          @update-option-group=${(e: CustomEvent<{ id: string; patch: OptionGroupPatch }>) =>
            void this.#onUpdateOptionGroup(e)}
          @toggle-option-group-items=${(e: CustomEvent<{ groupId: string }>) =>
            void this.#onToggleOptionGroupItems(e)}
          @create-option-group-item=${(
            e: CustomEvent<{ groupId: string } & OptionGroupItemInput>,
          ) => void this.#onCreateOptionGroupItem(e)}
          @update-option-group-item=${(
            e: CustomEvent<{ groupId: string; itemId: string; patch: OptionGroupItemPatch }>,
          ) => void this.#onUpdateOptionGroupItem(e)}
        ></dashboard-option-group-manager>
      </section>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}

      <dashboard-product-form
        .open=${this.formOpen}
        .catalogueId=${this.selectedCatalogueId}
        .categories=${this.categories}
        .stations=${this.stations}
        .courses=${this.courses}
        .optionGroups=${this.optionGroups}
        .attachedGroupIds=${this.attachedGroupIds}
        .product=${this.editingProduct}
        .api=${this.api}
        .busy=${this.busy}
        @create-product=${(e: CustomEvent<CreateProductDetail>) => void this.#onCreateProduct(e)}
        @update-product=${(e: CustomEvent<UpdateProductDetail>) => void this.#onUpdateProduct(e)}
        @set-product-station=${(e: CustomEvent<{ productId: string; stationId: string | null }>) =>
          void this.#onSetProductStation(e)}
        @set-product-course=${(e: CustomEvent<{ productId: string; courseId: string | null }>) =>
          void this.#onSetProductCourse(e)}
        @wt-close=${() => (this.formOpen = false)}
      ></dashboard-product-form>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-catalogue-screen": CatalogueScreen;
  }
}
