import type { ReactiveControllerHost } from "lit";
import type { DashboardApi, Product } from "../api/client.js";
import { codeOf } from "../i18n/codes.js";
import type { ProductAvailabilityChange } from "./product-tree-availability.js";

type AvailabilityHost = HTMLElement &
  ReactiveControllerHost & {
    api: DashboardApi;
    products: Product[];
    availabilitySaved?: (ids: readonly string[], available: boolean) => void;
  };

export interface ProductAvailabilityRefusal {
  batch: boolean;
  name: string | undefined;
  error: unknown;
}

export class ProductAvailabilityActions {
  pending: ReadonlyMap<string, boolean> = new Map();
  batch: boolean | null = null;
  refusal: ProductAvailabilityRefusal | null = null;

  constructor(private readonly host: AvailabilityHost) {}

  dismissBatchRefusal(): void {
    if (!this.refusal?.batch) return;
    this.refusal = null;
    this.host.requestUpdate();
  }

  async changeOne({ id, name, available }: ProductAvailabilityChange): Promise<void> {
    if (this.pending.has(id)) return;
    await this.#save(
      [id],
      available,
      () => this.host.api.setProductAvailability(id, available),
      (error) => ({ batch: false, name, error }),
    );
  }

  async changeSelected(ids: string[], available: boolean): Promise<boolean> {
    if (this.batch !== null || ids.some((id) => this.pending.has(id))) return false;
    const selected = new Set(ids);
    const names = new Map(
      this.host.products.filter(({ id }) => selected.has(id)).map(({ id, name }) => [id, name]),
    );
    this.batch = available;
    try {
      return await this.#save(
        ids,
        available,
        () => this.host.api.setProductsAvailability(ids, available),
        (error) => {
          const code = codeOf(error);
          if (code === "product.deleted" || code === "product.not_found")
            this.host.api.liveData?.invalidate([{ type: "products" }]);
          const productId = (error as { params?: { productId?: string } })?.params?.productId;
          return {
            batch: true,
            name: productId === undefined ? undefined : names.get(productId),
            error,
          };
        },
      );
    } finally {
      this.batch = null;
      this.host.requestUpdate();
    }
  }

  async #save(
    ids: readonly string[],
    available: boolean,
    write: () => Promise<void>,
    refusal: (error: unknown) => ProductAvailabilityRefusal,
  ): Promise<boolean> {
    const pending = new Map(this.pending);
    for (const id of ids) pending.set(id, available);
    this.pending = pending;
    this.refusal = null;
    this.host.requestUpdate();
    try {
      await write();
      if (this.host.isConnected) this.host.availabilitySaved?.(ids, available);
      return true;
    } catch (error) {
      if (this.host.isConnected) this.refusal = refusal(error);
      return false;
    } finally {
      const remaining = new Map(this.pending);
      for (const id of ids) remaining.delete(id);
      this.pending = remaining;
      this.host.requestUpdate();
    }
  }
}
