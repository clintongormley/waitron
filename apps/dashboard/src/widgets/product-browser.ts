import type { ProductItemsChange } from "@waitron/menu";
import {
  routingPreviewTable,
  routingPreviewStyles,
} from "@waitron/venue-service/dashboard/routing-preview";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  FormFeedback,
  formMessage,
  formMessageStyles,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import type { ProductItemsRoutingPreview, RoutingModel } from "@waitron/venue-service/routing";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import type {
  ExtraList,
  CategorySummary,
  ProductSelection,
  Course,
  FolderContents,
  FolderSummary,
  DashboardApi,
  Product,
} from "../api/client.js";
import type { ModifierListChoice } from "./product-editor-model.js";
import { categoryRefusalErrors, categoryWithDescendants } from "./category-form.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { fill, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-spinner.js";
import { acceptsMenuDrop, type CategoryNameDraft, type ProductList } from "./product-list.js";
import { folderMadeAt, isRouted, type FolderMadeAt } from "./folder-made-at.js";
import { categoryTree } from "./classification-fields.js";
import "./category-color-form.js";
import { refusalText } from "./delete-refusal.js";
import {
  productListActionFeedback,
  productAvailabilityFeedback,
  productAvailabilityFeedbackStyles,
} from "./product-list-action-feedback.js";
import type { ProductAvailabilityChange } from "./product-tree-availability.js";
import { deleteExtraListWarning } from "./delete-extra-lists.js";
import { offMenusSentence } from "./off-menus.js";
import { countOf } from "./count-text.js";
import {
  deleteSelectionHeading,
  categoryDeleteChoices,
  categoryDeletePaths,
  categoryDeleteImpact,
  productCategoryDeleteStyles,
} from "./product-category-delete.js";

interface OperationDraft {
  destination: string;
  contents: FolderContents;
}

@customElement("dashboard-product-browser")
export class ProductBrowser extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    routingPreviewStyles,
    formMessageStyles,
    productAvailabilityFeedbackStyles,
    productCategoryDeleteStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) 0;
      }
      .delete-extra-lists {
        overflow-wrap: anywhere;
      }
      .error {
        color: var(--wt-color-danger);
      }
      dashboard-product-list[hidden] {
        display: none;
      }
      .operation-footer {
        width: 100%;
      }
      wt-input {
        flex: 1 1 calc(var(--wt-tap-min) * 7);
        min-width: 0;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) courses: Course[] = [];
  @property({ attribute: false }) routing: RoutingModel | null = null;
  /** Whether the routing read failed for a reason other than a refusal. */
  @property({ type: Boolean }) routingFailed = false;
  @property({ attribute: false }) categories: CategorySummary[] = [];
  @property({ attribute: false }) extraLists: ExtraList[] = [];
  @property({ attribute: false }) optionLists: ModifierListChoice[] = [];
  /** The category the address names; the browser opens it, and every category above it, once. */
  @property({ attribute: false }) categoryId: string | null = null;
  @property({ type: Boolean }) canAddProduct = false;
  @property({ type: Boolean }) loaded = false;
  @property({ type: Boolean }) tableHidden = false;
  @property({ attribute: false }) defaultColor: string | null = null;
  @property({ attribute: false }) takeawayVat = false;
  @state() private search = "";
  @state() private nameDraft: CategoryNameDraft | null = null;
  @state() private nameError = "";
  /** The colour chosen in the open name box; undefined until one is. */
  @state() private nameColor: string | null | undefined = undefined;
  /** Whose colour the chooser is open for: a category's row, the name box, or All products' row. */
  @state() private colorTarget:
    { kind: "row"; category: CategorySummary } | { kind: "box" } | { kind: "default" } | null =
    null;
  @state() private colorBusy = false;
  @state() private colorErrors: Record<string, string> = {};

  @state() private selecting = false;
  @state() private selected: string[] = [];
  @state() private operation: "move" | "delete" | null = null;
  @state() private operationSelection: ProductSelection = { productIds: [], categoryIds: [] };
  @state() private destination = "";
  @state() private contents: FolderContents = "move_up";
  @state() private summaries: FolderSummary[] = [];
  @state() private summaryLoading = false;
  @state() private summaryFailed = false;
  @state() private affectedMenuCount: number | null = null;
  #deleteImpactRead = 0;
  #productsToDelete: string[] = [];
  @state() private operationBusy = false;
  @state() private operationError = "";
  @state() private routingPreview: ProductItemsRoutingPreview | null = null;
  @state() private previewBusy = false;
  @state() private previewError = "";
  @state() private previewRetry = false;
  #previewRead = 0;
  readonly #operationFeedback = new FormFeedback(this);

  @property({ attribute: false }) availabilitySaved?: (change: ProductAvailabilityChange) => void;
  @state() private availabilityPending: ReadonlyMap<string, boolean> = new Map();
  @state() private availabilityError: { name: string; error: unknown } | null = null;
  @state() private actionError = "";
  readonly #operationOwner = {};
  #operationScope?: DraftScope<OperationDraft>;
  #operationLeave?: LeaveCoordinator;
  #moveDrop?: { keys: string[]; destination: string };
  get #operationBaseline(): OperationDraft {
    return {
      destination: this.operation === "move" ? (this.#moveDrop?.destination ?? "") : "",
      contents: "move_up",
    };
  }
  readonly #beforeOperationClose = async (reason: LeaveReason): Promise<boolean> =>
    this.isConnected &&
    !this.operationBusy &&
    !this.summaryLoading &&
    (await this.#operationLeave!.request({
      scopes: [this.#operationOwner],
      reason,
      proceed() {},
    })) === "proceeded";

  #operationDraft(): OperationDraft {
    return {
      destination: this.operation === "move" ? this.destination : "",
      contents: this.operation === "delete" ? this.#contentsChoice() : "move_up",
    };
  }
  #releaseOperation(): void {
    this.#operationScope?.dispose();
    this.#operationScope = undefined;
    this.#operationLeave = undefined;
  }
  override disconnectedCallback(): void {
    this.#releaseOperation();
    super.disconnectedCallback();
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }
  #requestOperationClose(): void {
    if (!this.isConnected || this.operationBusy || this.summaryLoading) return;
    if (this.#operationScope)
      void this.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-modal"]>(
        "wt-modal",
      )!.requestClose("cancel");
    else this.operation = null;
  }
  #revealed: string | null = null;
  #folderMadeAt: ReadonlyMap<string, FolderMadeAt> = new Map();

  #drop(keys: string[], folderId: string | null): void {
    if (
      this.operationBusy ||
      this.summaryLoading ||
      !acceptsMenuDrop(keys, folderId, this.categories)
    )
      return;
    this.#openMove(keys, folderId ?? "top");
  }
  override willUpdate(changed: PropertyValues): void {
    if (this.operation === null) this.#releaseOperation();
    else if (!this.#operationScope) {
      this.#operationLeave = leaveCoordinatorFor(this);
      this.#operationScope = this.#operationLeave?.register<OperationDraft>({
        id: this.#operationOwner,
        parent: this,
        current: () => this.#operationDraft(),
        snapshot: (value) => ({ ...value }),
        equal: (a, b) => a.destination === b.destination && a.contents === b.contents,
        restore: (value) => {
          this.destination = value.destination;
          this.contents = value.contents;
        },
      });
      this.#operationScope?.commit(this.#operationBaseline);
    }
    if (changed.has("summaries")) this.#operationScope?.changed();
    if (changed.has("operationError")) this.#operationFeedback.newRefusal();
    if (changed.has("products") || changed.has("categories")) this.#keepSelectionOwned();
    if (
      [
        "operation",
        "destination",
        "operationSelection",
        "categories",
        "products",
        "routing",
        "operationBusy",
      ].some((key) => changed.has(key)) &&
      !this.operationBusy
    )
      void this.#readRoutingPreview();
    if (
      ["operation", "operationSelection", "contents", "summaries", "categories", "products"].some(
        (key) => changed.has(key),
      )
    )
      this.#syncDeleteImpact();
    if (changed.has("nameDraft")) this.nameColor = undefined;
    // Worked out once per change of its inputs, not on every redraw of the browser.
    if (changed.has("routing") || changed.has("categories"))
      this.#folderMadeAt = this.routing ? folderMadeAt(this.routing, this.categories) : new Map();
  }

  get #actionNotice(): string {
    return (this.nameDraft?.kind === "rename" && this.nameError) || this.actionError;
  }

  override updated(changed: PropertyValues): void {
    if (this.tableHidden) return;
    if (changed.has("categoryId") || changed.has("categories") || changed.has("tableHidden")) {
      const id = this.categoryId;
      if (
        id !== null &&
        id !== this.#revealed &&
        this.categories.some((category) => category.id === id)
      ) {
        this.#revealed = id;
        void this.#list()?.revealCategory(id);
      }
    }
    if (
      this.#actionNotice &&
      !this.operation &&
      !this.colorTarget &&
      ["actionError", "nameError", "operation", "colorTarget"].some((key) => changed.has(key))
    ) {
      this.renderRoot
        .querySelector('[data-test="list-action-error"]')
        ?.scrollIntoView({ block: "nearest" });
    }
  }

  #list(): ProductList | null {
    return this.shadowRoot?.querySelector("dashboard-product-list") ?? null;
  }

  /** Opens every category above a product, once the browser has drawn the list that holds it. */
  async revealProduct(id: string): Promise<void> {
    await this.updateComplete;
    await this.#list()?.revealProduct(id);
  }

  focusRowMenu(categoryId: string | null): void {
    this.#list()?.focusRowMenu(categoryId);
  }

  #categoryToggled(event: CustomEvent<{ categoryId: string | null; open: boolean }>): void {
    event.stopPropagation();
    const { categoryId, open } = event.detail;
    if (categoryId === null) {
      if (!open && this.categoryId !== null) {
        this.#revealed = null;
        this.#emit("open-category", { categoryId: null });
      }
      return;
    }
    if (open) {
      this.#revealed = categoryId;
      this.#emit("open-category", { categoryId });
      return;
    }
    if (
      this.categoryId === null ||
      !categoryWithDescendants(categoryId, this.categories).has(this.categoryId)
    )
      return;
    const parentId = this.categories.find(({ id }) => id === categoryId)?.parentId ?? null;
    this.#revealed = parentId;
    this.#emit("open-category", { categoryId: parentId });
  }

  #keepSelectionOwned(): void {
    const products = new Set(this.products.map(({ id }) => id));
    const categories = new Set(this.categories.map(({ id }) => id));
    this.selected = this.selected.filter((key) =>
      key.startsWith("folder:") ? categories.has(key.slice(7)) : products.has(key),
    );
    if ((!this.operation && !this.summaryLoading) || this.operationBusy) return;
    this.operationSelection = {
      productIds: this.operationSelection.productIds.filter((id) => products.has(id)),
      categoryIds: this.operationSelection.categoryIds.filter((id) => categories.has(id)),
    };
    if (!this.operationSelection.productIds.length && !this.operationSelection.categoryIds.length)
      this.operation = null;
    if (this.destination && this.destination !== "top" && !categories.has(this.destination))
      this.destination = "";
  }

  #selection(keys = this.selected): ProductSelection {
    return {
      productIds: keys.filter((key) => !key.startsWith("folder:")),
      categoryIds: keys.filter((key) => key.startsWith("folder:")).map((key) => key.slice(7)),
    };
  }
  /** A row inside a category that moves goes with it; listed as well, the server would re-file it
   * at the destination and pull it out of its category. */
  #outermost(selection: ProductSelection): ProductSelection {
    const under = (categoryId: string | null, self?: string) =>
      categoryId !== null &&
      selection.categoryIds.some(
        (id) => id !== self && categoryWithDescendants(id, this.categories).has(categoryId),
      );
    return {
      productIds: selection.productIds.filter(
        (id) =>
          !under(this.products.find((product) => product.id === id)?.primaryCategoryId ?? null),
      ),
      categoryIds: selection.categoryIds.filter((id) => !under(id, id)),
    };
  }
  #routingChange(): ProductItemsChange | null {
    return this.operation === "move" && this.destination
      ? {
          kind: "move",
          selection: this.operationSelection,
          to: this.destination === "top" ? null : this.destination,
        }
      : null;
  }
  get #routingReady(): boolean {
    return (
      this.#routingChange() === null ||
      (this.routingPreview !== null && !this.previewBusy && !this.previewError)
    );
  }
  async #readRoutingPreview(): Promise<void> {
    const read = ++this.#previewRead;
    const change = this.#routingChange();
    if (change === null) this.routingPreview = null;
    this.previewError = "";
    this.previewRetry = false;
    this.previewBusy = change !== null;
    if (change === null) return;
    try {
      const preview = await this.api.previewProductItemsRouting(change);
      if (read === this.#previewRead) this.routingPreview = preview;
    } catch (error) {
      if (read !== this.#previewRead) return;
      this.routingPreview = null;
      const code = codeOf(error, "");
      this.previewRetry = ![
        "category.name_taken",
        "category.parent_cycle",
        "category.not_found",
        "product.not_found",
        "management.request_invalid",
      ].includes(code);
      this.previewError = this.previewRetry
        ? t("folders.preview_error")
        : refusalText(code, (error as { params?: unknown }).params);
    } finally {
      if (read === this.#previewRead) this.previewBusy = false;
    }
  }

  #openMove(keys = this.selected, droppedDestination?: string): void {
    if (this.operationBusy || this.summaryLoading) return;
    this.actionError = "";
    this.#operationFeedback.reset();
    this.summaryFailed = false;
    this.operationSelection = this.#outermost(this.#selection(keys));
    this.#moveDrop =
      droppedDestination === undefined ? undefined : { keys, destination: droppedDestination };
    this.destination = droppedDestination ?? "";
    this.operationError = "";
    this.operation = "move";
  }
  async #openDelete(keys = this.selected): Promise<void> {
    if (this.operationBusy || this.summaryLoading) return;
    this.actionError = "";
    this.#operationFeedback.reset();
    const selection = this.#selection(keys);
    this.operationSelection = selection;
    this.contents = "move_up";
    this.summaries = [];
    this.summaryFailed = false;
    this.operationError = "";
    this.operation = selection.productIds.length ? "delete" : null;
    if (!selection.categoryIds.length) return;
    this.summaryLoading = true;
    try {
      const summaries = await this.api.summariseFolders(selection.categoryIds);
      const current = this.operationSelection;
      if (!current.productIds.length && !current.categoryIds.length) return;
      if (current.categoryIds.some((id) => !summaries.some((summary) => summary.id === id)))
        throw new Error("incomplete summary");
      this.summaries = current.categoryIds.map((id) =>
        summaries.find((summary) => summary.id === id)!,
      );
      if (
        !current.productIds.length &&
        this.summaries.every(
          (summary) => summary.folders === 0 && summary.products === 0 && summary.routes === 0,
        )
      ) {
        this.summaryLoading = false;
        await this.#confirm("delete");
      } else this.operation = "delete";
    } catch {
      if (!this.operationSelection.productIds.length && !this.operationSelection.categoryIds.length)
        return;
      this.operation = "delete";
      this.summaryFailed = true;
      this.operationError = t("folders.summary_error");
    } finally {
      this.summaryLoading = false;
    }
  }
  #syncDeleteImpact(): void {
    const deleting = this.operation === "delete";
    const active = deleting ? this.products.filter((product) => product.active) : [];
    const activeIds = new Set(active.map(({ id }) => id));
    const productIds = new Set(
      this.operationSelection.productIds.filter((id) => activeIds.has(id)),
    );
    if (deleting && this.#contentsChoice() === "delete") {
      const subtree = new Set(
        this.operationSelection.categoryIds.flatMap((id) => [
          ...categoryWithDescendants(id, this.categories),
        ]),
      );
      for (const { id, primaryCategoryId } of active)
        if (primaryCategoryId !== null && subtree.has(primaryCategoryId)) productIds.add(id);
    }
    if (
      productIds.size === this.#productsToDelete.length &&
      this.#productsToDelete.every((id) => productIds.has(id))
    )
      return;
    this.#productsToDelete = [...productIds];
    void this.#readDeleteImpact(this.#productsToDelete);
  }
  async #readDeleteImpact(productIds: string[]): Promise<void> {
    const read = ++this.#deleteImpactRead;
    this.affectedMenuCount = null;
    if (!productIds.length) return;
    let menus: number | null = null;
    try {
      menus = await (this.api.background ?? this.api).countProductMenus(productIds);
    } catch {
      // An unavailable count must not block deletion.
    }
    if (read === this.#deleteImpactRead) this.affectedMenuCount = menus;
  }
  get #deleteWaiting(): boolean {
    return !this.selected.length || this.summaryLoading;
  }
  /** A confirmation from the dialog reads its counts again before deleting. */
  async #confirm(operation = this.operation, fromDialog = false): Promise<void> {
    if (fromDialog) this.#operationFeedback.press();
    if (fromDialog && !this.#routingReady) return;
    if (
      this.operationBusy ||
      this.summaryLoading ||
      this.summaryFailed ||
      !operation ||
      (operation === "move" && !this.destination)
    )
      return;
    this.operationBusy = true;
    this.actionError = "";
    this.#operationScope?.commit(this.#operationBaseline);
    this.operationError = "";
    try {
      if (operation === "move")
        await this.api.moveProductItems(
          this.operationSelection,
          this.destination === "top" ? null : this.destination,
        );
      else {
        if (fromDialog && this.operationSelection.categoryIds.length && !(await this.#unchanged()))
          return;
        try {
          await this.api.deleteProductItems(
            this.operationSelection,
            this.#contentsChoice(),
            this.summaries.map(({ id, folders, products, activeProducts, routes, ownRoutes }) => ({
              id,
              folders,
              products,
              activeProducts,
              routes,
              ownRoutes,
            })),
          );
        } catch (error) {
          if (codeOf(error, "") !== "category.contents_changed") throw error;
          this.operation = operation;
          const fresh = await this.#readAgain();
          if (fresh) {
            this.operationError = this.#summaryMatches(fresh, "contents")
              ? t("folders.changed_unshown")
              : codeMessage("category.contents_changed");
            this.summaries = fresh;
          }
          return;
        }
      }
      const drop = operation === "move" ? this.#moveDrop : undefined;
      this.#releaseOperation();
      this.operation = null;
      this.selected = drop ? this.selected.filter((key) => !drop.keys.includes(key)) : [];
    } catch (error) {
      this.operation = operation;
      this.operationError = refusalText(
        codeOf(error),
        (error as { params?: unknown } | null)?.params,
        { includeSingleProduct: this.operationSelection.categoryIds.length > 0 },
      );
      if (operation === "move") this.actionError = this.operationError;
    } finally {
      this.operationBusy = false;
    }
  }
  /** The selected categories' contents read again; when they cannot be read, says so and answers
   * null, leaving Delete to try again. A refusal carrying a code is left to the caller. */
  async #readAgain(): Promise<FolderSummary[] | null> {
    const ids = this.operationSelection.categoryIds;
    let read: unknown;
    try {
      read = await this.api.summariseFolders(ids);
    } catch (error) {
      if (codeOf(error, "") !== "") throw error;
    }
    const list: FolderSummary[] = Array.isArray(read) ? read : [];
    const fresh = ids.map((id) => list.find((summary) => summary.id === id));
    if (fresh.some((summary) => summary === undefined)) {
      this.operationError = t("folders.summary_error");
      return null;
    }
    return fresh as FolderSummary[];
  }
  /** Require another confirmation if contents or routing changed. Pass the entire fresh summary
   * to the delete request so the server can also check changes after this read. */
  async #unchanged(): Promise<boolean> {
    const fresh = await this.#readAgain();
    if (!fresh) return false;
    const same = this.#summaryMatches(fresh, "contents-and-routing");
    this.summaries = fresh;
    if (same) return true;
    this.operationError = t("folders.summary_changed");
    return false;
  }
  #summaryMatches(
    fresh: readonly FolderSummary[],
    scope: "contents" | "contents-and-routing",
  ): boolean {
    return fresh.every((summary, index) => {
      const shown = this.summaries[index];
      return (
        shown !== undefined &&
        summary.folders === shown.folders &&
        summary.activeProducts === shown.activeProducts &&
        (scope === "contents" ||
          (summary.routes === shown.routes && summary.ownRoutes === shown.ownRoutes))
      );
    });
  }
  #contentsImpact() {
    return categoryDeleteImpact(
      this.operationSelection,
      this.summaries,
      this.categories,
      this.products,
    );
  }
  #contentsChoice(): FolderContents {
    if (this.contents === "move_up") return "move_up";
    const { folders, active } = this.#contentsImpact();
    return folders || active ? "delete" : "move_up";
  }
  #chooseContents(event: Event): void {
    const radio = event.currentTarget as HTMLInputElement;
    if (!radio.isConnected || this.operationBusy || this.operation !== "delete") return;
    this.contents = radio.value === "delete" ? "delete" : "move_up";
    this.#operationScope?.changed();
  }
  #operationDialog() {
    if (!this.operation) return nothing;
    const selection = this.operationSelection;
    const count = selection.productIds.length + selection.categoryIds.length;
    const excluded = new Set(
      selection.categoryIds.flatMap((id) => [...categoryWithDescendants(id, this.categories)]),
    );
    const destinations = [
      { value: "top", label: t("categories.none") },
      ...categoryTree(this.categories).filter(({ value }) => !excluded.has(value)),
    ];
    const categoryDelete = this.operation === "delete" && selection.categoryIds.length > 0;
    const impact = categoryDelete ? this.#contentsImpact() : null;
    const heading =
      this.operation === "move"
        ? countOf("folders.move_heading", count)
        : deleteSelectionHeading(selection, this.categories, this.products);
    const deletesContents =
      impact !== null && (impact.folders > 0 || impact.active > 0) && this.contents === "delete";
    const deletingCount = this.#productsToDelete.length;
    const offMenus = deletingCount
      ? offMenusSentence(
          deletesContents
            ? "folders.delete_off_menus"
            : selection.productIds.length === 1
              ? "product.off_menus"
              : "folders.off_menus",
          this.affectedMenuCount,
        )
      : "";
    const blocked =
      this.summaryLoading ||
      this.summaryFailed ||
      !this.#routingReady ||
      (this.operation === "move" && !this.destination);
    const bottom = this.#operationFeedback.message(
      { action: this.operationError, preview: this.previewError },
      new Set(),
      "",
    );
    return html`<wt-modal
      size=${this.operation === "move" && this.routingPreview?.moves.length ? "wide" : "compact"}
      .height=${this.operation === "move" && this.routingPreview?.moves.length ? "medium" : undefined}
      .open=${true}
      .heading=${heading}
      .dismissible=${!this.operationBusy && !this.summaryLoading}
      .beforeClose=${this.#operationScope ? this.#beforeOperationClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (
          event.target !== event.currentTarget ||
          !(event.currentTarget as HTMLElement).isConnected
        )
          return;
        if (!this.operationBusy && !this.summaryLoading) this.operation = null;
      }}
    >
      <form
        @submit=${(event: Event) => {
          event.preventDefault();
          if (!(event.currentTarget as HTMLElement).isConnected) return;
          void this.#confirm(this.operation, true);
        }}
      >
        ${
          this.operation === "move"
            ? html`<wt-combobox
                ?preserve-order=${true /* Preserve category tree. */}
                name="destination"
                required
                label=${t("folders.destination")}
                searchPlaceholder=${t("categories.combobox_search")}
                noResultsLabel=${t("categories.combobox_no_results")}
                .options=${destinations}
                .value=${this.destination}
                .disabled=${this.operationBusy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (
                    !(event.currentTarget as HTMLElement).isConnected ||
                    this.operationBusy ||
                    !this.operation
                  )
                    return;
                  this.destination = event.detail.value;
                  this.#operationScope?.changed();
                }}
              ></wt-combobox>`
            : html`
                ${
                  selection.productIds.length
                    ? html`<p>
                        ${t(categoryDelete ? "folders.delete_contents_warning" : "folders.delete_products_body")}
                        ${deletesContents ? nothing : offMenus}
                      </p>`
                    : nothing
                }
                ${categoryDelete ? categoryDeletePaths(selection, this.categories) : nothing}
                ${this.summaryLoading ? html`<wt-spinner></wt-spinner>` : nothing}
                ${
                  impact && !this.summaryLoading && !this.summaryFailed
                    ? categoryDeleteChoices(
                        selection,
                        this.categories,
                        impact,
                        this.contents,
                        this.operationBusy,
                        (event) => this.#chooseContents(event),
                      )
                    : nothing
                }
                ${
                  deletesContents
                    ? html`${!selection.productIds.length ? html`<p>${t("folders.delete_contents_warning")}</p>` : nothing}
                      ${offMenus ? html`<p>${offMenus}</p>` : nothing}`
                    : nothing
                }
              `
        }
        ${
          this.operation === "delete"
            ? deleteExtraListWarning(this.products, this.#productsToDelete, this.extraLists)
            : nothing
        }
        ${
          this.operation === "move"
            ? html`<div data-test="folder-routing-preview">
                ${this.previewBusy ? html`<p role="status">${t("folders.preview_loading")}</p>` : nothing}
                ${this.routingPreview ? routingPreviewTable(this.routingPreview) : nothing}
                ${this.previewRetry ? html`<wt-button data-test="retry-routing-preview" variant="secondary" @click=${() => void this.#readRoutingPreview()}>${t("folders.preview_retry")}</wt-button>` : nothing}
              </div>`
            : nothing
        }
      </form>
      <div slot="footer" class="operation-footer">
        ${formMessage(bottom)}
        <wt-form-actions>
          <wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.operationBusy || this.summaryLoading}
            @click=${(event: Event) => {
              if (!(event.currentTarget as HTMLElement).isConnected) return;
              this.#requestOperationClose();
            }}
            >${t("folders.cancel_selection")}</wt-button
          >
          <wt-button
            data-test="confirm"
            variant=${blocked ? "secondary" : this.operation === "delete" ? "danger" : "primary"}
            .loading=${this.operationBusy}
            .disabled=${this.operationBusy || blocked}
            @click=${(event: Event) => {
              if (!(event.currentTarget as HTMLElement).isConnected) return;
              void this.#confirm(this.operation, true);
            }}
            >${this.operation === "delete" ? t("action.delete") : t("folders.move")}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-modal>`;
  }

  #unroutedFolderIds(): string[] {
    return [...this.#folderMadeAt].filter(([, made]) => !isRouted(made)).map(([id]) => id);
  }
  #emit(name: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
  async #saveName(event: CustomEvent<{ name: string }>): Promise<void> {
    event.stopPropagation();
    // A box sends its name once until refused, so saves run alongside each other, and each answer
    // reaches its own box only while that box is still open.
    const draft = this.nameDraft;
    if (!draft) return;
    this.nameError = "";
    const parentId = draft.kind === "create" ? draft.parentId : null;
    const color = this.nameColor;
    // Sent only when the box changed it, so a plain create or rename sends what it always did.
    const current = this.#renamed(draft)?.color ?? null;
    const colored = color !== undefined && color !== current ? { color } : {};
    try {
      if (draft.kind === "create")
        await this.api.createCategory({ name: event.detail.name, parentId, ...colored });
      else await this.api.updateCategory(draft.categoryId, { name: event.detail.name, ...colored });
      if (this.nameDraft === draft) this.nameDraft = null;
    } catch (error) {
      const message = Object.values(categoryRefusalErrors(error, parentId))[0]!;
      if (this.nameDraft === draft) this.nameError = message;
      else this.actionError = message;
    }
  }
  #renamed(draft: CategoryNameDraft | null): CategorySummary | undefined {
    return draft?.kind === "rename"
      ? this.categories.find(({ id }) => id === draft.categoryId)
      : undefined;
  }
  /** From a row the colour is sent alone, never a name or a parent, so a rename or a move made
   * while the chooser was open is kept. */
  async #chooseColor(color: string | null): Promise<void> {
    const target = this.colorTarget;
    if (!target) return;
    if (target.kind === "box") {
      this.nameColor = color;
      this.colorTarget = null;
      return;
    }
    if (this.colorBusy) return;
    this.colorBusy = true;
    this.colorErrors = {};
    try {
      if (target.kind === "default") await this.api.saveMenuDefaultColor(color);
      else await this.api.updateCategory(target.category.id, { color });
      if (this.colorTarget === target) this.colorTarget = null;
    } catch (error) {
      this.colorErrors = categoryRefusalErrors(error, null);
    } finally {
      this.colorBusy = false;
    }
  }
  #colorHeading(renamed: CategorySummary | undefined): string {
    const target = this.colorTarget;
    const name =
      target?.kind === "row"
        ? target.category.name
        : target?.kind === "default"
          ? t("folders.all_products")
          : renamed?.name;
    return name === undefined
      ? t("folders.new_color_heading")
      : fill("folders.color_heading", { name });
  }
  /** Done removes itself, so focus goes back to the mode's toggle rather than to the page. */
  async #leaveSelection(): Promise<void> {
    this.actionError = "";
    this.selected = [];
    this.selecting = false;
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLElement>('[data-test="select"]')?.focus();
  }
  readonly #changeAvailability = async (event: CustomEvent<ProductAvailabilityChange>) => {
    event.stopPropagation();
    const change = event.detail;
    if (this.availabilityPending.has(change.id)) return;
    this.availabilityPending = new Map(this.availabilityPending).set(change.id, change.available);
    this.availabilityError = null;
    try {
      await this.api.setProductAvailability(change.id, change.available);
      if (this.isConnected) this.availabilitySaved?.(change);
    } catch (error) {
      this.availabilityError = { name: change.name, error };
    } finally {
      const pending = new Map(this.availabilityPending);
      pending.delete(change.id);
      this.availabilityPending = pending;
    }
  };

  override render() {
    const renamed = this.#renamed(this.nameDraft);
    const boxColor = this.nameColor !== undefined ? this.nameColor : (renamed?.color ?? null);
    const refusal = this.availabilityError;
    return html`${productAvailabilityFeedback(
        refusal
          ? fill("product.availability_refused", {
              name: refusal.name,
              reason: refusalText(
                codeOf(refusal.error),
                (refusal.error as { params?: unknown })?.params,
              ),
            })
          : "",
      )}<dashboard-product-list
        .availabilityPending=${this.availabilityPending}
        @change-availability=${this.#changeAvailability}
        .hidden=${this.tableHidden}
        @drop-items=${(event: CustomEvent<{ keys: string[]; folderId: string | null }>) => {
          event.stopPropagation();
          this.#drop(event.detail.keys, event.detail.folderId);
        }}
        .selecting=${this.selecting}
        .reordering=${this.selecting}
        .selected=${this.selected}
        @wt-selection-change=${(event: CustomEvent<{ selected: string[] }>) => {
          event.stopPropagation();
          this.selected = event.detail.selected;
        }}
        @wt-filter-change=${(event: Event) => {
          event.stopPropagation();
        }}
        @delete-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          void this.#openDelete([`folder:${event.detail.folderId}`]);
        }}
        @category-toggle=${this.#categoryToggled}
        .canAddProduct=${this.canAddProduct}
        @move-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.#openMove([`folder:${event.detail.folderId}`]);
        }}
        .nameDraft=${this.nameDraft}
        .nameError=${this.nameError}
        .loaded=${this.loaded}
        @add-category=${(event: CustomEvent<{ parentId: string | null }>) => {
          event.stopPropagation();
          this.search = "";
          this.actionError = "";
          this.nameError = "";
          this.nameDraft = { kind: "create", parentId: event.detail.parentId };
        }}
        .categories=${this.categories}
        .products=${this.products}
        .search=${this.search}
        .courses=${this.courses}
        .unroutedFolderIds=${this.#unroutedFolderIds()}
        .extraLists=${this.extraLists}
        .optionLists=${this.optionLists}
        @rename-folder=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          this.actionError = "";
          this.nameError = "";
          this.nameDraft = { kind: "rename", categoryId: event.detail.folderId };
        }}
        @folder-color=${(event: CustomEvent<{ folderId: string }>) => {
          event.stopPropagation();
          const category = this.categories.find(({ id }) => id === event.detail.folderId);
          if (!category) return;
          this.colorErrors = {};
          this.colorTarget = { kind: "row", category };
        }}
        @root-color=${(event: Event) => {
          event.stopPropagation();
          this.colorErrors = {};
          this.colorTarget = { kind: "default" };
        }}
        .defaultColor=${this.defaultColor}
        .takeawayVat=${this.takeawayVat}
        .nameColor=${boxColor}
        .choosingColor=${this.colorTarget?.kind === "box"}
        @name-color=${(event: Event) => {
          event.stopPropagation();
          this.colorErrors = {};
          this.colorTarget = { kind: "box" };
        }}
        @name-commit=${(event: CustomEvent<{ name: string }>) => void this.#saveName(event)}
        @name-cancel=${(event: Event) => {
          event.stopPropagation();
          this.nameDraft = null;
          this.nameError = "";
        }}
      >
        <wt-icon-button
          slot="toolbar-start"
          data-test="select"
          label=${t("folders.select")}
          icon="select-rows"
          .pressed=${this.selecting}
          @click=${() => {
            this.actionError = "";
            this.selected = [];
            this.selecting = !this.selecting;
          }}
        ></wt-icon-button>
        <wt-input
          slot="toolbar-search"
          name="menu-search"
          type="search"
          label=${t("folders.search")}
          .value=${this.search}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.search = event.detail.value;
          }}
        ></wt-input>
        ${
          this.selecting || this.summaryLoading || this.operationBusy
            ? html`<div
                slot="toolbar-bottom"
                class="actions"
                data-test="selection-bar"
                role="group"
                aria-label=${t("folders.select")}
              >
                ${
                  !this.operation && (this.summaryLoading || this.operationBusy)
                    ? html`<wt-spinner></wt-spinner>`
                    : nothing
                }
                ${
                  this.selecting
                    ? html`<span data-test="selected-count" aria-live="polite"
                          >${countOf("folders.selected", this.selected.length)}</span
                        >
                        <wt-button
                          data-test="move"
                          variant="secondary"
                          .disabled=${!this.selected.length || this.summaryLoading || this.operationBusy}
                          @click=${() => this.#openMove()}
                          >${t("folders.move")}</wt-button
                        >
                        <wt-button
                          data-test="delete"
                          variant=${this.#deleteWaiting ? "secondary" : "danger"}
                          .disabled=${this.#deleteWaiting || this.operationBusy}
                          @click=${() => void this.#openDelete()}
                          >${t("action.delete")}</wt-button
                        >
                        <wt-button
                          data-test="cancel-selection"
                          variant="secondary"
                          @click=${() => void this.#leaveSelection()}
                          >${t("action.done")}</wt-button
                        >`
                    : nothing
                }
              </div>`
            : nothing
        }
        ${
          this.routingFailed && this.categories.length
            ? html`<p
                slot="toolbar-bottom"
                class="error"
                role="status"
                data-test="routing-unavailable"
              >
                ${t("folders.routing_unavailable")}
              </p>`
            : nothing
        }
        ${productListActionFeedback(this.#actionNotice, !this.operation && !this.colorTarget)}
      </dashboard-product-list>
      ${this.#operationDialog()}<dashboard-category-color-form
        .open=${this.colorTarget !== null}
        .busy=${this.colorBusy}
        heading=${this.colorTarget ? this.#colorHeading(renamed) : ""}
        .color=${
          this.colorTarget?.kind === "row"
            ? this.colorTarget.category.color
            : this.colorTarget?.kind === "default"
              ? this.defaultColor
              : boxColor
        }
        .errors=${this.colorErrors}
        @wt-choose=${(event: CustomEvent<{ color: string | null }>) => {
          event.stopPropagation();
          void this.#chooseColor(event.detail.color);
        }}
        @wt-cancel=${(event: Event) => {
          event.stopPropagation();
          this.colorTarget = null;
        }}
      ></dashboard-category-color-form>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-browser": ProductBrowser;
  }
}
