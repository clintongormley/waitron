import type { DashboardRequest } from "@waitron/dashboard-kit";
import type { ProductItemsChange, ExtraOfferUsage } from "@waitron/menu";
import type {
  ProductEditorSaveBody,
  Product,
  ProductEditorValue,
  OptionListRow,
  OptionList,
  OptionListInput,
  OptionListSaveBody,
  OptionListDependants,
  ExtraListRow,
  ExtraList,
  ExtraListInput,
  ExtraListDependants,
} from "@waitron/shared";
import type { ProductItemsRoutingPreview, RoutingView } from "@waitron/venue-service/routing";
import { MenuApi } from "./menu-api.js";

/** A product editor write: the editor's read still carries `vatClass`, which the save refuses. */
export type ProductSaveBody = Omit<ProductEditorSaveBody, "vatClass">;
// ── Menu-management types ──────────────────────────────────────────────────────────────────

export type PricingUnit = "each" | "weight";

export type VatClass = "general" | "reduced" | "super_reduced" | "zero";

export interface CategorySummary {
  id: string;
  name: string;
  parentId: string | null;
  color: string | null;
}

export interface CategoryInput {
  name: string;
  parentId?: string | null;
  color?: string | null;
}

export interface ProductSelection {
  productIds: string[];
  categoryIds: string[];
}

export type FolderContents = "move_up" | "delete";

export interface FolderSummary {
  id: string;
  folders: number;
  /** Products in the category and every category below it, variants left out, inactive ones
   * included. */
  products: number;
  activeProducts: number;
  /** Routing rules naming the category or any category below it: what deleting its contents too
   * removes. */
  routes: number;
  /** Routing rules naming the category itself: what moving its contents up removes. */
  ownRoutes: number;
}
/** One selected category's counts as the client read them before deleting it. */
export type ShownFolderCounts = Pick<
  FolderSummary,
  "id" | "folders" | "products" | "activeProducts" | "routes" | "ownRoutes"
>;

export interface Unit {
  hardwareUnit?: string | null;
  id: string;
  staffName: string;
  staffAbbreviation: string;
  name: Record<string, string>;
  abbreviation: Record<string, string>;
  precision: number;
  measure?: true;
}

export interface UnitInput {
  staffName: string;
  staffAbbreviation: string;
  name: Record<string, string>;
  abbreviation: Record<string, string>;
  precision: number;
  measure: boolean;
}

export interface UnitPatch {
  staffName?: string;
  staffAbbreviation?: string;
  name?: Record<string, string>;
  abbreviation?: Record<string, string>;
  precision?: number;
  measure?: boolean;
}

export interface ProductUsingUnit {
  id: string;
  name: string;
  active: boolean;
}

export class CatalogApi extends MenuApi {
  readonly #request: DashboardRequest;
  constructor(request: DashboardRequest) {
    super(request);
    this.#request = request;
  }
  listCategories(): Promise<CategorySummary[]> {
    return this.#request<CategorySummary[]>("/management-api/categories", "GET");
  }
  previewProductItemsRouting(change: ProductItemsChange): Promise<ProductItemsRoutingPreview> {
    return this.#request(
      "/management-api/venue-service/routing/product-items-preview",
      "POST",
      change,
      { activity: "none" },
    );
  }
  moveProductItems(selection: ProductSelection, to: string | null): Promise<void> {
    return this.#request("/management-api/folders/move", "POST", { ...selection, to });
  }
  deleteProductItems(
    selection: ProductSelection,
    contents: FolderContents,
    shown: ShownFolderCounts[],
  ): Promise<void> {
    return this.#request("/management-api/folders/delete", "POST", {
      ...selection,
      contents,
      shown,
    });
  }
  summariseFolders(categoryIds: string[]): Promise<FolderSummary[]> {
    const query = categoryIds.map((id) => `id=${encodeURIComponent(id)}`).join("&");
    return this.#request(`/management-api/folders/summary?${query}`, "GET");
  }
  /** How many Active menus the products are on, each menu counted once. */
  async countProductMenus(productIds: string[]): Promise<number> {
    const { menus } = await this.#request<{ menus: number }>(
      "/management-api/products/menus",
      "POST",
      { productIds },
      { timeLimitMs: 30_000, activity: "none" },
    );
    return menus;
  }
  createCategory(input: CategoryInput): Promise<CategorySummary> {
    return this.#request<CategorySummary>("/management-api/categories", "POST", input);
  }
  getCategory(id: string): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "GET");
  }
  updateCategory(id: string, input: Partial<CategoryInput>): Promise<CategorySummary> {
    return this.#request(`/management-api/categories/${id}`, "PATCH", input);
  }
  listLibraryProducts(): Promise<Product[]> {
    return this.#request("/management-api/products", "GET");
  }
  listUnits(): Promise<Unit[]> {
    return this.#request<Unit[]>("/management-api/units", "GET");
  }
  listUnitProducts(id: string): Promise<ProductUsingUnit[]> {
    return this.#request<ProductUsingUnit[]>(`/management-api/units/${id}/products`, "GET");
  }
  getUnitAttachedExtrasCount(id: string): Promise<{ dishCount: number }> {
    return this.#request(`/management-api/units/${id}/attached-extras-count`, "GET");
  }
  getUnitExtraUsage(id: string): Promise<ExtraOfferUsage[]> {
    return this.#request<ExtraOfferUsage[]>(`/management-api/units/${id}/extra-usage`, "GET");
  }
  createUnit(input: UnitInput): Promise<Unit> {
    return this.#request<Unit>("/management-api/units", "POST", input);
  }
  updateUnit(id: string, patch: UnitPatch): Promise<Unit> {
    return this.#request<Unit>(`/management-api/units/${id}`, "PATCH", patch);
  }
  deleteUnit(id: string): Promise<void> {
    return this.#request<void>(`/management-api/units/${id}`, "DELETE");
  }
  reassignProductsUnit(
    id: string,
    productIds: string[],
    targetUnitId: string | null,
  ): Promise<ProductUsingUnit[]> {
    return this.#request<ProductUsingUnit[]>(
      `/management-api/units/${id}/products/reassign`,
      "POST",
      { productIds, unitId: targetUnitId },
    );
  }
  setProductAvailability(id: string, available: boolean): Promise<void> {
    return this.setProductsAvailability([id], available);
  }
  setProductsAvailability(productIds: string[], available: boolean): Promise<void> {
    return this.#request("/management-api/products/availability", "PUT", {
      productIds,
      available,
    });
  }
  listProducts(): Promise<Product[]> {
    return this.#request<Product[]>("/management-api/products", "GET");
  }
  getFolderRouting(): Promise<RoutingView> {
    return this.#request<RoutingView>("/management-api/venue-service/routing?periods=false", "GET");
  }
  getProductEditor(id: string): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(`/management-api/products/${id}/editor`, "GET");
  }
  getProductExtraUsage(id: string): Promise<ExtraOfferUsage[]> {
    return this.#request<ExtraOfferUsage[]>(`/management-api/products/${id}/extra-usage`, "GET");
  }
  createProductEditor(input: ProductSaveBody): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>("/management-api/products/editor", "POST", input);
  }
  updateProductEditor(id: string, input: ProductSaveBody): Promise<ProductEditorValue> {
    return this.#request<ProductEditorValue>(`/management-api/products/${id}/editor`, "PUT", input);
  }
  // ── Options lists and extras lists (`/management-api/modifiers/{options,extras}`) ───────────────

  async listOptionLists(): Promise<OptionListRow[]> {
    return (
      await this.#request<{ optionLists: OptionListRow[] }>(
        "/management-api/modifiers/options",
        "GET",
      )
    ).optionLists;
  }
  async getOptionList(id: string): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        `/management-api/modifiers/options/${id}`,
        "GET",
      )
    ).optionList;
  }
  async createOptionList(input: OptionListInput): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        "/management-api/modifiers/options",
        "POST",
        input,
      )
    ).optionList;
  }
  async updateOptionList(id: string, input: OptionListSaveBody): Promise<OptionList> {
    return (
      await this.#request<{ optionList: OptionList }>(
        `/management-api/modifiers/options/${id}`,
        "PATCH",
        input,
      )
    ).optionList;
  }
  async deleteOptionList(id: string): Promise<void> {
    await this.#request<{ ok: true }>(`/management-api/modifiers/options/${id}`, "DELETE");
  }
  async getOptionListDependants(id: string): Promise<OptionListDependants> {
    return (
      await this.#request<{ dependants: OptionListDependants }>(
        `/management-api/modifiers/options/${id}/dependants`,
        "GET",
      )
    ).dependants;
  }
  async listExtraLists(): Promise<ExtraListRow[]> {
    return (
      await this.#request<{ extraLists: ExtraListRow[] }>("/management-api/modifiers/extras", "GET")
    ).extraLists;
  }
  async getExtraList(id: string): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(`/management-api/modifiers/extras/${id}`, "GET")
    ).extraList;
  }
  async createExtraList(input: ExtraListInput): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(
        "/management-api/modifiers/extras",
        "POST",
        input,
      )
    ).extraList;
  }
  async updateExtraList(id: string, input: ExtraListInput): Promise<ExtraList> {
    return (
      await this.#request<{ extraList: ExtraList }>(
        `/management-api/modifiers/extras/${id}`,
        "PATCH",
        input,
      )
    ).extraList;
  }
  async deleteExtraList(id: string): Promise<void> {
    await this.#request<{ ok: true }>(`/management-api/modifiers/extras/${id}`, "DELETE");
  }
  async getExtraListDependants(id: string): Promise<ExtraListDependants> {
    return (
      await this.#request<{ dependants: ExtraListDependants }>(
        `/management-api/modifiers/extras/${id}/dependants`,
        "GET",
      )
    ).dependants;
  }
}
