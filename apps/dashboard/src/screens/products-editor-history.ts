import { encodePathSegment, navigationGuardFor, type UrlStateController } from "@waitron/ui";
import { dashboardPath } from "../navigation.js";

export interface ProductsEditorAddress {
  productId: string | null;
  field?: string;
}

const entryMarker = "__wtProductsEditor";

function editorPath({ productId }: ProductsEditorAddress): string {
  return productId === null ? "editor/new" : `product/${encodePathSegment(productId)}`;
}

function editorKey(address: ProductsEditorAddress | null): string {
  return address === null ? "" : `${editorPath(address)}?${address.field ?? ""}`;
}

export class ProductsEditorHistory {
  #current = "";
  #epoch: string | undefined;
  readonly #pushed = new Map<number, string>();
  readonly #owner = crypto.randomUUID();

  constructor(private readonly url: UrlStateController) {}

  accept(): ProductsEditorAddress | null | undefined {
    const address = this.#read();
    const key = editorKey(address);
    if (key === this.#current) return undefined;
    this.#current = key;
    return address;
  }

  push(address: ProductsEditorAddress): void {
    if (this.url.read("dashboard") !== "products") return;
    const guard = navigationGuardFor(window);
    const url = new URL(guard?.href ?? location.href);
    const category = this.url.read("category");
    url.pathname = `${dashboardPath.basePath}/products/${editorPath(address)}`;
    if (category !== null) url.pathname += `/category/${encodePathSegment(category)}`;
    if (address.field) url.searchParams.set("field", address.field);
    else url.searchParams.delete("field");
    if (url.href === (guard?.href ?? location.href)) return;

    const before = this.#current;
    const key = editorKey(address);
    // A clean guarded write publishes immediately, while the dialog is already opening.
    this.#current = key;
    if (guard) {
      void guard.write(url);
      if (guard.href !== url.href) {
        this.#current = before;
        return;
      }
      const { epoch, index } = guard.position;
      if (epoch !== this.#epoch) this.#pushed.clear();
      else for (const entry of this.#pushed.keys()) if (entry >= index) this.#pushed.delete(entry);
      this.#epoch = epoch;
      this.#pushed.set(index, key);
    } else {
      history.pushState(
        { ...Object(history.state), [entryMarker]: { owner: this.#owner, key } },
        "",
        url,
      );
    }
  }

  close(): void {
    this.#current = "";
    if (this.url.read("dashboard") !== "products") return;
    const address = this.#read();
    if (address !== null && this.#owns(editorKey(address))) history.back();
    else void this.url.write({ product: null, editor: null }, true, ["field"]);
  }

  #read(): ProductsEditorAddress | null {
    const productId = this.url.read("product");
    if (productId !== null) {
      const field = new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get(
        "field",
      );
      return { productId, field: field === "image" ? field : undefined };
    }
    return this.url.read("editor") === "new" ? { productId: null } : null;
  }

  #owns(key: string): boolean {
    const position = navigationGuardFor(window)?.position;
    if (position) return position.epoch === this.#epoch && this.#pushed.get(position.index) === key;
    const entry = history.state?.[entryMarker];
    return entry?.owner === this.#owner && entry.key === key;
  }
}
