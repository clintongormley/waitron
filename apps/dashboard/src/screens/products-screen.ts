import type { MenuSettingsAnswer } from "../api/menu-api.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ContentLanguages } from "@waitron/shared";
import type { RoutingModel } from "@waitron/venue-service/routing";
import {
  baseStyles,
  pageTitleStyles,
  encodePathSegment,
  navigationGuardFor,
  setContentLanguages,
  UrlStateController,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { DashboardQueries } from "../api/query-controller.js";
import type {
  DashboardApi,
  ExtraList,
  OptionList,
  Product,
} from "../api/client.js";
import type { Course } from "../api/kitchen-api.js";
import type { CategorySummary, Unit } from "../api/catalog-api.js";
import { withoutVatClass } from "../widgets/product-editor-model.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { dashboardPath } from "../navigation.js";
import {
  knowsEditorProduct,
  ProductEditorDialog,
  type ProductEditorChoices,
} from "../widgets/product-editor-dialog.js";
import {
  placementMenus,
  type PlacementFailure,
  type PlacementMenu,
} from "../widgets/add-to-menus.js";
import "../widgets/product-browser.js";
import { productsAddAction, productsAddActionStyles } from "./products-add-action.js";
import { offMenusSentence } from "../widgets/off-menus.js";
import { deleteExtraListWarning } from "../widgets/delete-extra-lists.js";
import { refusalText } from "../widgets/delete-refusal.js";
import { productsWithAvailability } from "../widgets/product-tree-availability.js";
import {
  productsListLoadFeedback,
  restartSharedLanguagesRead,
} from "./products-list-load-feedback.js";

@customElement("dashboard-products-screen")
export class ProductsScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    productsAddActionStyles,
    css`
      :host {
        display: block;
      }
      .delete-extra-lists {
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private menuSettings: MenuSettingsAnswer | null = null;
  @state() private contentLanguages: ContentLanguages | null = null;
  @state() private categories: CategorySummary[] = [];
  @state() private units: Unit[] = [];
  @state() private extraLists: ExtraList[] = [];
  @state() private optionLists: OptionList[] = [];
  @state() private products: Product[] = [];
  @state() private productsLoaded = false;
  @state() private initialLoadError: string | null = null;
  @state() private productsReadError: string | null = null;
  @state() private categoriesReadError: string | null = null;
  @state() private retrying = false;
  @state() private routing: RoutingModel | null = null;
  @state() private routingFailed = false;
  @state() private courses: Course[] = [];
  @state() private deleting = false;
  private get busy(): boolean {
    return this.deleting || this.#editor.busy;
  }
  @state() private categoryId: string | null = null;
  @state() private errorKey: string | null = null;
  /** A read's recovery clears only a read's error. */
  #readErrorShown = false;
  @state() private refusalParams: unknown = null;
  @state() private deletingProduct: { id: string; name: string; isVariant: boolean } | null = null;
  @state() private deleteErrorKey: string | null = null;
  @state() private deleteErrorParams: unknown = null;
  /** Null while the Delete dialog's menu count is unread or unreadable. */
  @state() private deletingMenus: number | null = null;
  #deletingRead = 0;
  /** The product just created, while the Add to menus step that follows its create is open. */
  @state() private placing: { id: string; name: string } | null = null;
  @state() private placementMenus: PlacementMenu[] | null = null;
  @state() private placementLoadError: string | null = null;
  @state() private placementFailures: PlacementFailure[] = [];
  @state() private placementBusy = false;
  #restoreAddFocus: (() => void) | null = null;
  #linkedProduct: string | null = null;
  /** The `product` word as this screen last read or wrote it. A new product's editor is named by
   * none, so only the word going away closes an editor. */
  #addressProduct: string | null = null;

  #writeProductWord(product: string | null, removeQuery: readonly string[] = []): void {
    void this.#url.write({ product }, true, removeQuery);
    if (this.#url.read("dashboard") === "products")
      this.#addressProduct = this.#url.read("product");
  }

  /** A guarded write would ask the leave question whenever unsaved input is held. */
  #nameOpenProduct(id: string): void {
    const guard = navigationGuardFor(window);
    if (guard === undefined) return this.#writeProductWord(id);
    const category = this.#url.read("category");
    const url = new URL(guard.href);
    url.pathname = [
      `${dashboardPath.basePath}/products/product/${encodePathSegment(id)}`,
      ...(category === null ? [] : [`category/${encodePathSegment(category)}`]),
    ].join("/");
    guard.rewrite(url);
  }
  #loading = false;
  readonly #resumeInitialLoad = (): void => {
    if (!this.productsLoaded && this.initialLoadError !== null) void this.#load();
  };
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
      this.#resumeInitialLoad();
    },
  );
  readonly #categoriesQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.categoriesReadError = codeOf(error);
    },
    this.#resumeInitialLoad,
  );
  readonly #productsQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.productsReadError = codeOf(error);
    },
    () => {
      if (this.productsLoaded) void this.#openLinkedProduct();
      else this.#resumeInitialLoad();
    },
  );
  readonly #routingQueries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.routing = null;
      this.routingFailed = codeOf(error) !== "authorization.not_permitted";
    },
  );
  // A re-read that fails after the step's first load keeps the menus it already shows.
  readonly #placementQueries = new DashboardQueries(
    this,
    () => this.api,
    () => undefined,
    (error) => {
      if (this.placementLoadError === codeMessage(codeOf(error))) this.placementLoadError = null;
    },
  );
  readonly #url = new UrlStateController(
    this,
    () => {
      if (this.#url.read("dashboard") !== "products") return;
      this.categoryId = this.#url.read("category");
      const before = this.#addressProduct;
      this.#linkedProduct = this.#addressProduct = this.#url.read("product");
      if (this.#linkedProduct === null) {
        if (before !== null) this.#editor.close();
        else if (this.#editor.value !== null) this.#nameOpenProduct(this.#editor.value.id);
      } else void this.#openLinkedProduct();
    },
    dashboardPath,
  );
  readonly #editor = new ProductEditorDialog(this, {
    api: () => this.api,
    choices: () => this.#editorChoices(),
    clearError: () => this.#showError(null),
    readError: (error) => this.#showReadError(error),
    refused: (error) => this.#showSaveRefusal(error),
    lateRefused: (_product, error) => this.#showSaveRefusal(error),
    opened: (id) => this.#writeProductWord(id),
    closed: () => {
      this.#linkedProduct = null;
      this.#writeProductWord(null, ["field"]);
    },
    afterClose: () => {
      if (this.placing === null) this.#refocusAdd();
    },
    saved: async (saved, created, current) => {
      if (created && current()) void this.#openPlacement(saved);
      const refreshed = await this.#reloadProducts();
      await this.updateComplete;
      if (current()) await this.#browser()?.showSavedProduct(refreshed ? saved.id : null, created);
    },
    changeChoices: async (kind) => {
      if (kind === "unit") {
        const units = await this.api.background.listUnits();
        this.units = units;
      } else if (kind === "extras") {
        const lists = await this.api.background.listExtraLists();
        this.extraLists = lists;
      } else if (kind === "options") {
        const lists = await this.api.background.listOptionLists();
        this.optionLists = lists;
      } else {
        const courses = await this.api.background.listCourses();
        this.courses = courses;
      }
    },
  });

  #showSaveRefusal(error: unknown): void {
    this.#showError(codeOf(error));
    this.refusalParams = (error as { params?: unknown }).params;
  }

  #editorChoices(): ProductEditorChoices {
    return {
      contentLanguages: this.contentLanguages,
      menuSettings: this.menuSettings,
      products: this.products,
      categories: this.categories,
      units: this.units,
      courses: this.courses,
      extraLists: this.extraLists,
      optionLists: this.optionLists,
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#showError(null);
    void this.#load();
  }

  async #load(): Promise<void> {
    if (this.#loading) return;
    this.#loading = true;
    try {
      await Promise.all([
        this.#queries.watch("getMenuSettings", [], (value) => {
          this.menuSettings = value;
        }),
        this.#queries.watch("getContentLanguages", [], (value) => {
          this.contentLanguages = value;
          setContentLanguages(value);
        }),
        this.#watchCategories(),
        this.#routingQueries
          .watch("getFolderRouting", [], (value) => {
            this.routing = value;
            this.routingFailed = false;
          })
          .catch(() => {
            this.routing = null;
          }),
        this.#queries.watch("listUnits", [], (value) => {
          this.units = value;
        }),
        this.#queries.watch("listExtraLists", [], (value) => {
          this.extraLists = value;
        }),
        this.#queries.watch("listOptionLists", [], (value) => {
          this.optionLists = value;
        }),
        this.#queries.watch("listCourses", [], (value) => {
          this.courses = value;
        }),
        this.#watchProducts(),
      ]);
      this.productsLoaded = true;
      this.initialLoadError = null;
      await this.#openLinkedProduct();
    } catch (error) {
      if (!this.productsLoaded) this.initialLoadError = codeOf(error);
    } finally {
      this.#loading = false;
    }
  }

  #watchCategories(): Promise<void> {
    return this.#categoriesQueries.watch("listCategories", [], (value) => {
      this.categories = value;
    });
  }

  #tableReadError(): string | null {
    if (this.#productsQueries.failing("listProducts")) return this.productsReadError;
    if (this.#categoriesQueries.failing("listCategories")) return this.categoriesReadError;
    return this.productsLoaded ? null : this.initialLoadError;
  }

  async #retryTable(): Promise<void> {
    if (this.retrying) return;
    this.retrying = true;
    try {
      if (!this.productsLoaded) {
        if (this.#queries.failing("getContentLanguages"))
          await restartSharedLanguagesRead(this.api);
        await this.#load();
      } else {
        await Promise.allSettled([
          this.#productsQueries.failing("listProducts") && this.#reloadProducts(),
          this.#categoriesQueries.failing("listCategories") && this.#watchCategories(),
        ]);
      }
    } finally {
      this.retrying = false;
    }
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.refusalParams = null;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  #watchProducts(): Promise<void> {
    return this.#productsQueries.watch("listProducts", [], (products) => {
      this.products = products;
    });
  }

  async #reloadProducts(): Promise<boolean> {
    try {
      await this.#watchProducts();
    } catch {
      return false;
    }
    await this.#openLinkedProduct();
    return true;
  }

  async #openLinkedProduct(): Promise<void> {
    const id = this.#linkedProduct;
    if (!this.productsLoaded || id === null || !knowsEditorProduct(this.products, id)) return;
    this.#linkedProduct = null;
    if (this.#editor.value?.id === id) return;
    await this.#editor.openExisting(id, new URL(location.href).searchParams.get("field") ?? "");
  }

  #openDelete(productId: string): void {
    const product = this.products.find(({ id }) => id === productId);
    const variant = this.products
      .flatMap(({ variants }) => variants)
      .find(({ id }) => id === productId);
    const found = product ?? variant;
    this.deletingProduct = found
      ? { id: found.id, name: found.name, isVariant: product === undefined }
      : null;
    this.deleteErrorKey = null;
    this.deleteErrorParams = null;
    this.#showError(null);
    if (found) void this.#readDeletingMenus(found.id);
  }

  async #readDeletingMenus(productId: string): Promise<void> {
    const read = ++this.#deletingRead;
    this.deletingMenus = null;
    let menus: number | null = null;
    try {
      menus = await (this.api.background ?? this.api).countProductMenus([productId]);
    } catch {
      // An unread count uses the unknown-count sentence.
    }
    if (read === this.#deletingRead) this.deletingMenus = menus;
  }

  #closeDelete(): void {
    this.deletingProduct = null;
    this.deleteErrorKey = null;
    this.deleteErrorParams = null;
  }

  async #deleteProduct(): Promise<void> {
    const product = this.deletingProduct;
    if (!product || this.busy) return;
    this.deleting = true;
    this.#showError(null);
    this.deleteErrorKey = null;
    this.deleteErrorParams = null;
    try {
      const value = withoutVatClass(await this.api.getProductEditor(product.id));
      await this.api.updateProductEditor(product.id, { ...value, active: false });
    } catch (error) {
      this.deleteErrorKey = codeOf(error);
      this.deleteErrorParams = (error as { params?: unknown }).params;
      this.deleting = false;
      return;
    }
    this.#closeDelete();
    await this.#reloadProducts();
    this.deleting = false;
  }

  async #openPlacement(product: { id: string; name: string }): Promise<void> {
    const placing = { id: product.id, name: product.name };
    this.placing = placing;
    this.placementMenus = null;
    this.placementLoadError = null;
    this.placementFailures = [];
    try {
      await this.#placementQueries.watch("getMenuStructures", [], (rows) => {
        if (this.placing === placing)
          this.placementMenus = placementMenus(
            rows.map((row) => row.menu),
            rows.map((row) => row.structure),
          );
      });
    } catch (error) {
      if (this.placing === placing) this.placementLoadError = codeMessage(codeOf(error));
    }
  }

  /** One request per section, so a section that refuses leaves the others' additions in place. */
  async #place(event: CustomEvent<{ sectionIds: string[] }>): Promise<void> {
    event.stopPropagation();
    const placing = this.placing;
    if (placing === null || this.placementBusy) return;
    this.placementBusy = true;
    this.placementFailures = [];
    const { sectionIds } = event.detail;
    const settled = await Promise.allSettled(
      sectionIds.map((sectionId) => this.api.addSectionProducts(sectionId, [placing.id])),
    );
    const failures = settled.flatMap((result, index): PlacementFailure[] =>
      result.status === "rejected"
        ? [{ sectionId: sectionIds[index]!, reason: codeMessage(codeOf(result.reason)) }]
        : [],
    );
    this.placementBusy = false;
    if (this.placing !== placing) return;
    this.shadowRoot!.querySelector("dashboard-add-to-menus")!.commitAdded(
      sectionIds.filter((_id, index) => settled[index]!.status === "fulfilled"),
    );
    if (failures.length) this.placementFailures = failures;
    else this.#closePlacement();
  }

  #browser() {
    return this.shadowRoot?.querySelector("dashboard-product-browser") ?? null;
  }

  #refocusAdd(): void {
    const restore = this.#restoreAddFocus;
    this.#restoreAddFocus = null;
    restore?.();
  }

  readonly #addFromHeading = (): void => {
    this.#restoreAddFocus = () =>
      this.renderRoot.querySelector<HTMLElement>('.header [data-test="add-product"]')?.focus();
    this.#editor.openNew(null);
  };

  #closePlacement(): void {
    this.placing = null;
    this.placementMenus = null;
    this.placementLoadError = null;
    this.placementFailures = [];
    this.#placementQueries.release("getMenuStructures");
  }

  override update(changed: PropertyValues): void {
    const leavingRetry =
      this.shadowRoot?.activeElement?.matches('[data-test="products-retry"]') &&
      this.#tableReadError() === null;
    super.update(changed);
    if (leavingRetry) this.renderRoot.querySelector("h1")?.focus();
  }

  override render() {
    const readError = this.#tableReadError();
    const tableHidden = !this.productsLoaded;
    const locales = this.contentLanguages?.languages ?? [];
    const readyToAdd = this.productsLoaded && this.menuSettings !== null;
    const hasUnits = this.units.length > 0;
    const hasLanguages = locales.length > 0;
    const error = this.productsLoaded || !this.#readErrorShown ? this.errorKey : null;
    const errorText = error ? refusalText(error, this.refusalParams) : "";
    return html`
      <div class="header">
        <h1 tabindex="-1">${t("nav.products")}</h1>
        ${productsAddAction(readyToAdd, hasLanguages, hasUnits, this.#addFromHeading)}
      </div>
      ${
        tableHidden || readError !== null
          ? productsListLoadFeedback(readError, this.retrying, () => void this.#retryTable())
          : nothing
      }
      <dashboard-product-browser
        .tableHidden=${tableHidden}
        .api=${this.api}
        .categoryId=${this.categoryId}
        @open-category=${(event: CustomEvent<{ categoryId: string | null }>) => {
          event.stopPropagation();
          this.categoryId = event.detail.categoryId;
          this.#url.write({ category: this.categoryId }, true);
        }}
        .products=${this.products}
        .availabilitySaved=${(ids: readonly string[], available: boolean) => {
          this.products = productsWithAvailability(this.products, ids, available);
          void this.#reloadProducts();
        }}
        .courses=${this.courses}
        .routing=${this.routing}
        .routingFailed=${this.routingFailed}
        .categories=${this.categories}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        .canAddProduct=${readyToAdd && hasLanguages && hasUnits}
        .defaultColor=${this.menuSettings?.defaultColor ?? null}
        .takeawayVat=${this.menuSettings?.takeawayVat ?? false}
        @add-product=${(event: CustomEvent<{ categoryId: string | null }>) => {
          event.stopPropagation();
          const { categoryId } = event.detail;
          this.#restoreAddFocus = () => this.#browser()?.focusRowMenu(categoryId);
          this.#editor.openNew(categoryId);
        }}
        @edit-product=${(event: CustomEvent<{ productId: string; field?: string }>) => {
          event.stopPropagation();
          void this.#editor.openExisting(event.detail.productId, event.detail.field);
        }}
        @delete-product=${(event: CustomEvent<{ productId: string }>) => {
          event.stopPropagation();
          this.#openDelete(event.detail.productId);
        }}
        >${productsAddAction(readyToAdd, hasLanguages, hasUnits, this.#addFromHeading, "empty-action")}</dashboard-product-browser
      >
      ${errorText ? html`<p class="error" role="alert">${errorText}</p>` : nothing}
      ${this.#editor.render(this.#editorChoices(), this.busy)}
      <dashboard-add-to-menus
        @wt-close=${() => this.#refocusAdd()}
        .open=${this.placing !== null}
        .busy=${this.placementBusy}
        productName=${this.placing?.name ?? ""}
        .menus=${this.placementMenus}
        .loadError=${this.placementLoadError}
        .failures=${this.placementFailures}
        @wt-submit=${(event: CustomEvent<{ sectionIds: string[] }>) => void this.#place(event)}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          if (!this.placementBusy) this.#closePlacement();
        }}
      ></dashboard-add-to-menus>
      <wt-modal
        size="compact"
        data-test="delete-dialog"
        .open=${this.deletingProduct !== null}
        heading=${fill(
          this.deletingProduct?.isVariant ? "product.delete_variant_named" : "product.delete_named",
          { name: this.deletingProduct?.name ?? "" },
        )}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          if (!this.busy) this.#closeDelete();
        }}
      >
        <p>
          ${t(
            this.deletingProduct?.isVariant
              ? "product.delete_variant_warning"
              : "product.delete_warning",
          )}
          ${offMenusSentence("product.off_menus", this.deletingMenus)}
        </p>
        ${deleteExtraListWarning(this.products, this.deletingProduct ? [this.deletingProduct.id] : [], this.extraLists)}
        <wt-form-actions
          slot="footer"
          .error=${this.deleteErrorKey ? refusalText(this.deleteErrorKey, this.deleteErrorParams) : ""}
          ><wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.busy}
            @click=${this.#closeDelete}
            >${t("action.cancel")}</wt-button
          ><wt-button
            data-test="confirm-delete"
            variant="danger"
            .loading=${this.busy}
            @click=${() => void this.#deleteProduct()}
            >${t("action.delete")}</wt-button
          ></wt-form-actions
        >
      </wt-modal>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-products-screen": ProductsScreen;
  }
}
